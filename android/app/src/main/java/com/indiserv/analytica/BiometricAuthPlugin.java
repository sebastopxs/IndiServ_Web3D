package com.indiserv.analytica;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
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
import java.security.KeyStore;
import java.util.concurrent.atomic.AtomicBoolean;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * BiometricAuthPlugin — Autenticación biométrica nativa Android (huella digital)
 * con bóveda cifrada AES-256-GCM en AndroidKeyStore.
 *
 * Nunca almacena contraseñas en texto plano: cifra únicamente el hash derivado
 * (indiserv_v1$...) y exige verificación biométrica del sistema antes de guardar o descifrar.
 */
@CapacitorPlugin(name = "BiometricAuth")
public class BiometricAuthPlugin extends Plugin {
    private static final String KEY_ALIAS = "indiserv_biometric_aes_v1";
    private static final String KEYSTORE_PROVIDER = "AndroidKeyStore";
    private static final String PREFS_NAME = "indiserv_biometric_vault_v1";
    private static final String KEY_ENC_PAYLOAD = "enc_payload";
    private static final String KEY_ENC_IV = "enc_iv";
    private static final String KEY_META_NICK = "meta_nickname";
    private static final String KEY_META_DNI_MASK = "meta_dni_mask";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int GCM_TAG_BITS = 128;

    private SharedPreferences getVaultPrefs() {
        return getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    private SecretKey getOrCreateSecretKey() throws Exception {
        KeyStore ks = KeyStore.getInstance(KEYSTORE_PROVIDER);
        ks.load(null);
        if (ks.containsAlias(KEY_ALIAS)) {
            KeyStore.Entry entry = ks.getEntry(KEY_ALIAS, null);
            if (entry instanceof KeyStore.SecretKeyEntry) {
                return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
            }
        }
        KeyGenerator keyGen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER);
        KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build();
        keyGen.init(spec);
        return keyGen.generateKey();
    }

    private void encryptAndStore(String dni, String correo, String passwordHash, String nickname) throws Exception {
        JSONObject payload = new JSONObject();
        payload.put("dni", dni);
        payload.put("correo", correo);
        payload.put("password_hash", passwordHash);
        payload.put("nickname", nickname);

        SecretKey key = getOrCreateSecretKey();
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, key);
        byte[] iv = cipher.getIV();
        byte[] cipherBytes = cipher.doFinal(payload.toString().getBytes(StandardCharsets.UTF_8));

        String dniMask = dni.length() >= 4 ? "••••" + dni.substring(dni.length() - 4) : dni;
        getVaultPrefs()
            .edit()
            .putString(KEY_ENC_PAYLOAD, Base64.encodeToString(cipherBytes, Base64.NO_WRAP))
            .putString(KEY_ENC_IV, Base64.encodeToString(iv, Base64.NO_WRAP))
            .putString(KEY_META_NICK, nickname)
            .putString(KEY_META_DNI_MASK, dniMask)
            .apply();
    }

    private JSONObject decryptStored() throws Exception {
        SharedPreferences prefs = getVaultPrefs();
        String b64Data = prefs.getString(KEY_ENC_PAYLOAD, null);
        String b64Iv = prefs.getString(KEY_ENC_IV, null);
        if (b64Data == null || b64Iv == null) {
            return null;
        }
        byte[] cipherBytes = Base64.decode(b64Data, Base64.NO_WRAP);
        byte[] iv = Base64.decode(b64Iv, Base64.NO_WRAP);

        SecretKey key = getOrCreateSecretKey();
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_BITS, iv));
        byte[] plainBytes = cipher.doFinal(cipherBytes);
        return new JSONObject(new String(plainBytes, StandardCharsets.UTF_8));
    }

    private void clearVault() {
        getVaultPrefs().edit().clear().apply();
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        Context ctx = getContext();
        BiometricManager bm = BiometricManager.from(ctx);
        int canAuth = bm.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK);
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
        String correo = call.getString("correo", "").trim();
        String passwordHash = call.getString("password_hash", "").trim();
        String nickname = call.getString("nickname", "Operador").trim();

        if (dni.length() < 8 || !correo.contains("@") || !passwordHash.startsWith("indiserv_v1$")) {
            JSObject err = new JSObject();
            err.put("ok", false);
            err.put("error", "Credenciales incompletas para activar huella digital.");
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
        if (bm.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK) != BiometricManager.BIOMETRIC_SUCCESS) {
            JSObject err = new JSObject();
            err.put("ok", false);
            err.put("error", "Configura al menos una huella digital en los Ajustes de Android.");
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
                            encryptAndStore(dni, correo, passwordHash, nickname.isEmpty() ? "Operador" : nickname);
                            String dniMask = dni.length() >= 4 ? "••••" + dni.substring(dni.length() - 4) : dni;
                            JSObject ret = new JSObject();
                            ret.put("ok", true);
                            ret.put("nickname", nickname.isEmpty() ? "Operador" : nickname);
                            ret.put("dniMask", dniMask);
                            call.resolve(ret);
                        } catch (Exception ex) {
                            clearVault();
                            JSObject ret = new JSObject();
                            ret.put("ok", false);
                            ret.put("error", "No se pudo cifrar en AndroidKeyStore: " + ex.getMessage());
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
                .setTitle("Activar acceso con huella")
                .setSubtitle("Confirma tu huella digital para guardar tu sesión en este teléfono")
                .setNegativeButtonText("Cancelar")
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_WEAK)
                .build();

            prompt.authenticate(info);
        });
    }

    @PluginMethod
    public void authenticate(PluginCall call) {
        SharedPreferences prefs = getVaultPrefs();
        if (prefs.getString(KEY_ENC_PAYLOAD, null) == null || prefs.getString(KEY_ENC_IV, null) == null) {
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
                            JSONObject data = decryptStored();
                            if (data == null) {
                                JSObject ret = new JSObject();
                                ret.put("ok", false);
                                ret.put("error", "No se encontraron credenciales guardadas.");
                                call.resolve(ret);
                                return;
                            }
                            JSObject ret = new JSObject();
                            ret.put("ok", true);
                            ret.put("dni", data.optString("dni", ""));
                            ret.put("correo", data.optString("correo", ""));
                            ret.put("password_hash", data.optString("password_hash", ""));
                            ret.put("nickname", data.optString("nickname", "Operador"));
                            call.resolve(ret);
                        } catch (Exception ex) {
                            clearVault();
                            JSObject ret = new JSObject();
                            ret.put("ok", false);
                            ret.put("invalidated", true);
                            ret.put("error", "La clave biométrica cambió. Inicia sesión con contraseña para reactivarla.");
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
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_WEAK)
                .build();

            prompt.authenticate(info);
        });
    }

    @PluginMethod
    public void disableBiometric(PluginCall call) {
        clearVault();
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }
}
