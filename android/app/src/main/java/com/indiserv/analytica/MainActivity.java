package com.indiserv.analytica;

/**
 * MainActivity — Actividad principal de Capacitor con registro de plugins nativos y manejo de retroceso Android.
 */
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebView;

import org.json.JSONObject;

import androidx.activity.OnBackPressedCallback;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HardwareInfoPlugin.class);
        registerPlugin(MaintenancePlugin.class);
        registerPlugin(BiometricAuthPlugin.class);
        registerPlugin(SessionVaultPlugin.class);
        super.onCreate(savedInstanceState);
        handleIncomingOAuthIntent(getIntent());

        // Impedir capturas de pantalla y miniaturas en apps recientes (protege DNI, OTP y credenciales)
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        );

        // Edge-to-edge consistente en Android 10-16: evitamos doble empuje del teclado (adjustPan + IME)
        // controlando en un único punto las barras del sistema, muesca y teclado virtual.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().getDecorView().setBackgroundColor(Color.parseColor("#090c12"));
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(
            getWindow(),
            getWindow().getDecorView()
        );
        if (controller != null) {
            controller.setAppearanceLightStatusBars(false);
            controller.setAppearanceLightNavigationBars(false);
        }

        View content = findViewById(android.R.id.content);
        if (content != null) {
            content.setBackgroundColor(Color.parseColor("#090c12"));
            ViewCompat.setOnApplyWindowInsetsListener(content, (view, windowInsets) -> {
                Insets sys = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars()
                    | WindowInsetsCompat.Type.displayCutout()
                );
                // Aplicamos solo systemBars + displayCutout en el contenedor nativo;
                // el teclado (IME) lo gestiona adjustResize / WebView sin doble padding negro.
                view.setPadding(sys.left, sys.top, sys.right, sys.bottom);
                return new WindowInsetsCompat.Builder(windowInsets)
                    .setInsets(WindowInsetsCompat.Type.systemBars(), Insets.NONE)
                    .setInsets(WindowInsetsCompat.Type.displayCutout(), Insets.NONE)
                    .build();
            });
            ViewCompat.requestApplyInsets(content);
        }

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                if (webView == null) {
                    finish();
                    return;
                }
                webView.evaluateJavascript(
                    "(function(){ return (window.__indiservHandleBack ? window.__indiservHandleBack() : 'exit'); })()",
                    value -> {
                        if (value != null && value.contains("handled")) {
                            return;
                        }
                        if (webView.canGoBack()) {
                            webView.goBack();
                        } else {
                            moveTaskToBack(true);
                        }
                    }
                );
            }
        });
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIncomingOAuthIntent(intent);
    }

    private void handleIncomingOAuthIntent(Intent intent) {
        if (intent == null) {
            return;
        }
        Uri uri = intent.getData();
        if (uri == null) {
            return;
        }
        String full = uri.toString();
        if (!full.startsWith("com.indiserv.analytica://auth-callback")) {
            return;
        }
        SessionVaultPlugin.setPendingOAuthUrl(full);
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null) {
            String jsArg = JSONObject.quote(full);
            webView.post(() -> webView.evaluateJavascript(
                "(function(){ if (window.__indiservDispatchOAuthUrl) { window.__indiservDispatchOAuthUrl(" + jsArg + "); } })()",
                null
            ));
        }
    }
}
