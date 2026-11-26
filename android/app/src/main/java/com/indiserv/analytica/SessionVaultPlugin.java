package com.indiserv.analytica;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * SessionVaultPlugin — Persistencia cifrada de la sesión de 15 min en AndroidKeyStore (AES-256-GCM).
 * Elimina el almacenamiento en texto plano del session_token dentro de WebView localStorage.
 */
@CapacitorPlugin(name = "SessionVault")
public class SessionVaultPlugin extends Plugin {
    private static final String KEY_ALIAS = "indiserv_session_aes_gcm_v1";
    private static final String KEYSTORE_PROVIDER = "AndroidKeyStore";
    private static final String PREFS_NAME = "indiserv_session_vault_v1";
    private static final String KEY_ENC_PAYLOAD = "enc_payload";
    private static final String KEY_ENC_IV = "enc_iv";
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

    @PluginMethod
    public void saveSession(PluginCall call) {
        String token = call.getString("token", "").trim();
        String deviceHash = call.getString("deviceHash", "").trim();
        if (token.isEmpty() || deviceHash.isEmpty()) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            call.resolve(ret);
            return;
        }
        try {
            JSONObject payload = new JSONObject();
            payload.put("token", token);
            payload.put("deviceHash", deviceHash);

            SecretKey key = getOrCreateSecretKey();
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, key);
            byte[] iv = cipher.getIV();
            byte[] enc = cipher.doFinal(payload.toString().getBytes(StandardCharsets.UTF_8));

            getVaultPrefs()
                .edit()
                .putString(KEY_ENC_PAYLOAD, Base64.encodeToString(enc, Base64.NO_WRAP))
                .putString(KEY_ENC_IV, Base64.encodeToString(iv, Base64.NO_WRAP))
                .apply();

            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception ex) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void loadSession(PluginCall call) {
        SharedPreferences prefs = getVaultPrefs();
        String b64Data = prefs.getString(KEY_ENC_PAYLOAD, null);
        String b64Iv = prefs.getString(KEY_ENC_IV, null);
        if (b64Data == null || b64Iv == null) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            call.resolve(ret);
            return;
        }
        try {
            byte[] enc = Base64.decode(b64Data, Base64.NO_WRAP);
            byte[] iv = Base64.decode(b64Iv, Base64.NO_WRAP);

            SecretKey key = getOrCreateSecretKey();
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_BITS, iv));
            byte[] plain = cipher.doFinal(enc);
            JSONObject obj = new JSONObject(new String(plain, StandardCharsets.UTF_8));

            String tok = obj.optString("token", "").trim();
            String dh = obj.optString("deviceHash", "").trim();
            JSObject ret = new JSObject();
            if (!tok.isEmpty() && !dh.isEmpty()) {
                ret.put("ok", true);
                ret.put("token", tok);
                ret.put("deviceHash", dh);
            } else {
                ret.put("ok", false);
            }
            call.resolve(ret);
        } catch (Exception ex) {
            prefs.edit().clear().apply();
            JSObject ret = new JSObject();
            ret.put("ok", false);
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void clearSession(PluginCall call) {
        getVaultPrefs().edit().clear().apply();
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }
}
