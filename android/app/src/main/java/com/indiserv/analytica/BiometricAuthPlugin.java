package com.indiserv.analytica;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.SecureRandom;
import java.security.spec.MGF1ParameterSpec;
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicBoolean;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.OAEPParameterSpec;
import javax.crypto.spec.PSource;
import javax.crypto.spec.SecretKeySpec;

/**
 * BiometricAuthPlugin — Autenticación biométrica fuerte (BIOMETRIC_STRONG) con
 * BiometricPrompt.CryptoObject estricto por operación (AUTH_WINDOW = 0, sin ventana temporal).
 *
 * Arquitectura criptográfica híbrida (RSA-2048 OAEP en AndroidKeyStore TEE + AES-256-GCM efímero):
 *  - La clave PRIVADA RSA-2048 en AndroidKeyStore exige autenticación biométrica por operación
 *    (setUserAuthenticationParameters(0, AUTH_BIOMETRIC_STRONG) / validity -1 en API < 30) y
 *    se invalida automáticamente al registrar nuevas huellas en el teléfono.
 *  - Descifrar (`authenticate`) requiere obligatoriamente desbloquear el Cipher RSA mediante
 *    BiometricPrompt.CryptoObject firmado por el sensor de huella hardware.
 *  - Rotar el token de un solo uso (`rotateToken`) cifra con la clave PÚBLICA RSA-2048 + un DEK
 *    AES-256-GCM nuevo, permitiendo rotación atómica sin ventana desbloqueada ni segundo prompt.
 */
@CapacitorPlugin(name = "BiometricAuth")
public class BiometricAuthPlugin extends Plugin {
    private static final String KEY_ALIAS = "indiserv_biometric_rsa_crypto_v4";
    private static final String KEYSTORE_PROVIDER = "AndroidKeyStore";
    private static final String PREFS_NAME = "indiserv_biometric_vault_v4";
    private static final String KEY_ENC_DEK = "enc_dek";
    private static final String KEY_ENC_PAYLOAD = "enc_payload";
    private static final String KEY_ENC_IV = "enc_iv";
    private static final String KEY_META_NICK = "meta_nickname";
    private static final String KEY_META_DNI_MASK = "meta_dni_mask";

    private static final String RSA_TRANSFORMATION = "RSA/ECB/OAEPWithSHA-256AndMGF1Padding";
    private static final String AES_TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int GCM_TAG_BITS = 128;

    private static OAEPParameterSpec getOaepSpec() {
        // Estándar AndroidKeyStore: digest SHA-256 con MGF1-SHA1 para compatibilidad total Keymaster (API 24-36)
        return new OAEPParameterSpec(
            "SHA-256",
            "MGF1",
            MGF1ParameterSpec.SHA1,
            PSource.PSpecified.DEFAULT
        );
    }

    private SharedPreferences getVaultPrefs() {
        return getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    private void ensureRsaKeyPair() throws Exception {
        KeyStore ks = KeyStore.getInstance(KEYSTORE_PROVIDER);
        ks.load(null);
        if (ks.containsAlias(KEY_ALIAS)) {
            return;
        }
        KeyPairGenerator kpg = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, KEYSTORE_PROVIDER);
        KeyGenParameterSpec.Builder builder = new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
            .setKeySize(2048)
            .setDigests(KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA1)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // 0 = estricto por operación (exige CryptoObject en cada descifrado, cero ventana temporal)
            builder.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
        } else {
            // API 24-29: -1 exige CryptoObject por operación
            builder.setUserAuthenticationValidityDurationSeconds(-1);
        }

        kpg.initialize(builder.build());
        kpg.generateKeyPair();
    }

    private PublicKey getPublicKey() throws Exception {
        ensureRsaKeyPair();
        KeyStore ks = KeyStore.getInstance(KEYSTORE_PROVIDER);
        ks.load(null);
        java.security.cert.Certificate cert = ks.getCertificate(KEY_ALIAS);
        if (cert == null) {
            throw new IllegalStateException("Certificado AndroidKeyStore no encontrado.");
        }
        return cert.getPublicKey();
    }

    private PrivateKey getPrivateKey() throws Exception {
        KeyStore ks = KeyStore.getInstance(KEYSTORE_PROVIDER);
        ks.load(null);
        KeyStore.Entry entry = ks.getEntry(KEY_ALIAS, null);
        if (entry instanceof KeyStore.PrivateKeyEntry) {
            return ((KeyStore.PrivateKeyEntry) entry).getPrivateKey();
        }
        throw new IllegalStateException("Clave privada biométrica no disponible.");
    }

    private Cipher initDecryptRsaCipher() throws Exception {
        PrivateKey privKey = getPrivateKey();
        Cipher rsaCipher = Cipher.getInstance(RSA_TRANSFORMATION);
        rsaCipher.init(Cipher.DECRYPT_MODE, privKey, getOaepSpec());
        return rsaCipher;
    }

    private void deleteKeyAndVault() {
        getVaultPrefs().edit().clear().apply();
        getContext().getSharedPreferences("indiserv_biometric_vault_v1", Context.MODE_PRIVATE).edit().clear().apply();
        getContext().getSharedPreferences("indiserv_biometric_vault_v2", Context.MODE_PRIVATE).edit().clear().apply();
        getContext().getSharedPreferences("indiserv_biometric_vault_v3", Context.MODE_PRIVATE).edit().clear().apply();
        try {
            KeyStore ks = KeyStore.getInstance(KEYSTORE_PROVIDER);
            ks.load(null);
            for (String alias : new String[]{KEY_ALIAS, "indiserv_biometric_aes_strong_v3"}) {
                if (ks.containsAlias(alias)) {
                    ks.deleteEntry(alias);
                }
            }
        } catch (Exception ignored) {
            // Silencioso
        }
    }

    private void encryptAndStore(String dni, String biometricToken, String nickname) throws Exception {
        JSONObject payload = new JSONObject();
        payload.put("dni", dni);
        payload.put("biometric_token", biometricToken);
        payload.put("nickname", nickname);

        byte[] dek = new byte[32];
        byte[] iv = new byte[12];
        SecureRandom rng = new SecureRandom();
        rng.nextBytes(dek);
        rng.nextBytes(iv);

        try {
            Cipher aesCipher = Cipher.getInstance(AES_TRANSFORMATION);
            aesCipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(dek, "AES"), new GCMParameterSpec(GCM_TAG_BITS, iv));
            byte[] cipherBytes = aesCipher.doFinal(payload.toString().getBytes(StandardCharsets.UTF_8));

            PublicKey pubKey = getPublicKey();
            Cipher rsaCipher = Cipher.getInstance(RSA_TRANSFORMATION);
            rsaCipher.init(Cipher.ENCRYPT_MODE, pubKey, getOaepSpec());
            byte[] wrappedDek = rsaCipher.doFinal(dek);

            String dniMask = dni.length() >= 4 ? "••••" + dni.substring(dni.length() - 4) : dni;
            getVaultPrefs()
                .edit()
                .putString(KEY_ENC_DEK, Base64.encodeToString(wrappedDek, Base64.NO_WRAP))
                .putString(KEY_ENC_PAYLOAD, Base64.encodeToString(cipherBytes, Base64.NO_WRAP))
                .putString(KEY_ENC_IV, Base64.encodeToString(iv, Base64.NO_WRAP))
                .putString(KEY_META_NICK, nickname)
                .putString(KEY_META_DNI_MASK, dniMask)
                .apply();
        } finally {
            Arrays.fill(dek, (byte) 0);
        }
    }

    private JSONObject decryptStoredWithUnlockedCipher(Cipher unlockedRsaCipher) throws Exception {
        SharedPreferences prefs = getVaultPrefs();
        String b64Dek = prefs.getString(KEY_ENC_DEK, null);
        String b64Data = prefs.getString(KEY_ENC_PAYLOAD, null);
        String b64Iv = prefs.getString(KEY_ENC_IV, null);
        if (b64Dek == null || b64Data == null || b64Iv == null) {
            return null;
        }
        byte[] wrappedDek = Base64.decode(b64Dek, Base64.NO_WRAP);
        byte[] cipherBytes = Base64.decode(b64Data, Base64.NO_WRAP);
        byte[] iv = Base64.decode(b64Iv, Base64.NO_WRAP);

        byte[] dek = unlockedRsaCipher.doFinal(wrappedDek);
        try {
            Cipher aesCipher = Cipher.getInstance(AES_TRANSFORMATION);
            aesCipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(dek, "AES"), new GCMParameterSpec(GCM_TAG_BITS, iv));
            byte[] plainBytes = aesCipher.doFinal(cipherBytes);
            return new JSONObject(new String(plainBytes, StandardCharsets.UTF_8));
        } finally {
            Arrays.fill(dek, (byte) 0);
        }
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        Context ctx = getContext();
        BiometricManager bm = BiometricManager.from(ctx);
        int canAuth = bm.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);
        boolean available = (canAuth == BiometricManager.BIOMETRIC_SUCCESS);

        String reason = "ready";
        if (canAuth == BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE) {
            reason = "no_hardware";
        } else if (canAuth == BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE) {
            reason = "hw_unavailable";
        } else if (canAuth == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED) {
            reason = "none_enrolled";
        } else if (!available) {
            reason = "unavailable";
        }

        SharedPreferences prefs = getVaultPrefs();
        boolean hasSaved =
            prefs.getString(KEY_ENC_DEK, null) != null &&
            prefs.getString(KEY_ENC_PAYLOAD, null) != null &&
            prefs.getString(KEY_ENC_IV, null) != null;

        JSObject ret = new JSObject();
        ret.put("available", available);
        ret.put("reason", reason);
        ret.put("hasSavedCredentials", hasSaved);
        ret.put("nickname", hasSaved ? prefs.getString(KEY_META_NICK, "Operador") : "");
        ret.put("dniMask", hasSaved ? prefs.getString(KEY_META_DNI_MASK, "") : "");
        call.resolve(ret);
    }

    @PluginMethod
    public void enableBiometric(PluginCall call) {
        String dni = call.getString("dni", "").trim();
        String biometricToken = call.getString("biometric_token", "").trim();
        String nickname = call.getString("nickname", "Operador").trim();

        if (dni.length() < 8 || biometricToken.length() < 32) {
            JSObject err = new JSObject();
            err.put("ok", false);
            err.put("error", "Token biométrico inválido para vincular huella.");
            call.resolve(err);
            return;
        }

        FragmentActivity activity = getActivity();
        if (activity == null) {
            JSObject err = new JSObject();
            err.put("ok", false);
            err.put("error", "Actividad Android no disponible.");
            call.resolve(err);
            return;
        }

        BiometricManager bm = BiometricManager.from(activity);
        if (bm.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) != BiometricManager.BIOMETRIC_SUCCESS) {
            JSObject err = new JSObject();
            err.put("ok", false);
            err.put("error", "Configura una huella digital fuerte (Clase 3) en los Ajustes de Android.");
            call.resolve(err);
            return;
        }

        // Reiniciar par de claves limpio y validar el CryptoObject por operación antes de guardar
        deleteKeyAndVault();
        final Cipher probeCipher;
        final byte[] probeWrapped;
        final byte[] probeChallenge = new byte[32];
        try {
            ensureRsaKeyPair();
            new SecureRandom().nextBytes(probeChallenge);
            Cipher encProbe = Cipher.getInstance(RSA_TRANSFORMATION);
            encProbe.init(Cipher.ENCRYPT_MODE, getPublicKey(), getOaepSpec());
            probeWrapped = encProbe.doFinal(probeChallenge);
            probeCipher = initDecryptRsaCipher();
        } catch (Exception ex) {
            deleteKeyAndVault();
            JSObject err = new JSObject();
            err.put("ok", false);
            err.put("error", "No se pudo inicializar la bóveda AndroidKeyStore: " + ex.getMessage());
            call.resolve(err);
            return;
        }

        AtomicBoolean settled = new AtomicBoolean(false);
        activity.runOnUiThread(() -> {
            BiometricPrompt prompt = new BiometricPrompt(
                activity,
                ContextCompat.getMainExecutor(activity),
                new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                        if (!settled.compareAndSet(false, true)) return;
                        try {
                            BiometricPrompt.CryptoObject co = result.getCryptoObject();
                            if (co == null || co.getCipher() == null) {
                                throw new SecurityException("CryptoObject biométrico ausente.");
                            }
                            byte[] unwrapped = co.getCipher().doFinal(probeWrapped);
                            if (!Arrays.equals(unwrapped, probeChallenge)) {
                                throw new SecurityException("Verificación criptográfica del TEE fallida.");
                            }
                            String safeNick = nickname.isEmpty() ? "Operador" : nickname;
                            encryptAndStore(dni, biometricToken, safeNick);
                            String dniMask = dni.length() >= 4 ? "••••" + dni.substring(dni.length() - 4) : dni;
                            JSObject ret = new JSObject();
                            ret.put("ok", true);
                            ret.put("nickname", safeNick);
                            ret.put("dniMask", dniMask);
                            call.resolve(ret);
                        } catch (KeyPermanentlyInvalidatedException inv) {
                            deleteKeyAndVault();
                            JSObject ret = new JSObject();
                            ret.put("ok", false);
                            ret.put("error", "Las huellas del dispositivo cambiaron; intenta activarla nuevamente.");
                            call.resolve(ret);
                        } catch (Exception ex) {
                            deleteKeyAndVault();
                            JSObject ret = new JSObject();
                            ret.put("ok", false);
                            ret.put("error", "No se pudo cifrar en AndroidKeyStore: " + ex.getMessage());
                            call.resolve(ret);
                        }
                    }

                    @Override
                    public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                        if (!settled.compareAndSet(false, true)) return;
                        deleteKeyAndVault();
                        JSObject ret = new JSObject();
                        ret.put("ok", false);
                        ret.put("cancelled", true);
                        ret.put("error", errString.toString());
                        call.resolve(ret);
                    }
                }
            );

            BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                .setTitle("Activar acceso con huella")
                .setSubtitle("Confirma tu huella digital (CryptoObject TEE/StrongBox)")
                .setNegativeButtonText("Cancelar")
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                .build();

            prompt.authenticate(info, new BiometricPrompt.CryptoObject(probeCipher));
        });
    }

    @PluginMethod
    public void rotateToken(PluginCall call) {
        String dni = call.getString("dni", "").trim();
        String biometricToken = call.getString("biometric_token", "").trim();
        String nickname = call.getString("nickname", "Operador").trim();
        if (dni.length() < 8 || biometricToken.length() < 32) {
            JSObject err = new JSObject();
            err.put("ok", false);
            call.resolve(err);
            return;
        }
        try {
            // Re-cifra con la clave PÚBLICA RSA-2048 + nuevo DEK AES-256-GCM (la clave privada permanece bloqueada)
            encryptAndStore(dni, biometricToken, nickname.isEmpty() ? "Operador" : nickname);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception ex) {
            JSObject err = new JSObject();
            err.put("ok", false);
            call.resolve(err);
        }
    }

    @PluginMethod
    public void authenticate(PluginCall call) {
        SharedPreferences prefs = getVaultPrefs();
        if (
            prefs.getString(KEY_ENC_DEK, null) == null ||
            prefs.getString(KEY_ENC_PAYLOAD, null) == null ||
            prefs.getString(KEY_ENC_IV, null) == null
        ) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("error", "No hay una sesión biométrica guardada en este dispositivo.");
            call.resolve(ret);
            return;
        }

        FragmentActivity activity = getActivity();
        if (activity == null) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("error", "Actividad Android no disponible.");
            call.resolve(ret);
            return;
        }

        final Cipher rsaDecryptCipher;
        try {
            rsaDecryptCipher = initDecryptRsaCipher();
        } catch (KeyPermanentlyInvalidatedException inv) {
            deleteKeyAndVault();
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("invalidated", true);
            ret.put("error", "Las huellas registradas cambiaron. Inicia sesión con contraseña para reactivarla.");
            call.resolve(ret);
            return;
        } catch (Exception ex) {
            deleteKeyAndVault();
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("invalidated", true);
            ret.put("error", "La clave biométrica fue invalidada. Inicia sesión con contraseña para reactivarla.");
            call.resolve(ret);
            return;
        }

        String nick = prefs.getString(KEY_META_NICK, "Operador");
        AtomicBoolean settled = new AtomicBoolean(false);
        activity.runOnUiThread(() -> {
            BiometricPrompt prompt = new BiometricPrompt(
                activity,
                ContextCompat.getMainExecutor(activity),
                new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                        if (!settled.compareAndSet(false, true)) return;
                        try {
                            BiometricPrompt.CryptoObject co = result.getCryptoObject();
                            if (co == null || co.getCipher() == null) {
                                throw new SecurityException("CryptoObject biométrico ausente.");
                            }
                            JSONObject data = decryptStoredWithUnlockedCipher(co.getCipher());
                            if (data == null || data.optString("biometric_token", "").isEmpty()) {
                                deleteKeyAndVault();
                                JSObject ret = new JSObject();
                                ret.put("ok", false);
                                ret.put("invalidated", true);
                                ret.put("error", "Token biométrico obsoleto. Inicia sesión con contraseña para reactivarlo.");
                                call.resolve(ret);
                                return;
                            }
                            JSObject ret = new JSObject();
                            ret.put("ok", true);
                            ret.put("dni", data.optString("dni", ""));
                            ret.put("biometric_token", data.optString("biometric_token", ""));
                            ret.put("nickname", data.optString("nickname", "Operador"));
                            call.resolve(ret);
                        } catch (Exception ex) {
                            deleteKeyAndVault();
                            JSObject ret = new JSObject();
                            ret.put("ok", false);
                            ret.put("invalidated", true);
                            ret.put("error", "La clave biométrica cambió o fue invalidada. Inicia sesión con contraseña para reactivarla.");
                            call.resolve(ret);
                        }
                    }

                    @Override
                    public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                        if (!settled.compareAndSet(false, true)) return;
                        JSObject ret = new JSObject();
                        ret.put("ok", false);
                        ret.put("cancelled", true);
                        ret.put("error", errString.toString());
                        call.resolve(ret);
                    }
                }
            );

            BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                .setTitle("Ingresar a IndiServ Analytica")
                .setSubtitle("Verifica tu huella digital para entrar como " + nick)
                .setNegativeButtonText("Usar contraseña")
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                .build();

            prompt.authenticate(info, new BiometricPrompt.CryptoObject(rsaDecryptCipher));
        });
    }

    @PluginMethod
    public void disableBiometric(PluginCall call) {
        deleteKeyAndVault();
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }
}
