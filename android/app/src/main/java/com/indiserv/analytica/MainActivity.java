package com.indiserv.analytica;

/**
 * MainActivity — Actividad principal de Capacitor con registro de plugins nativos y manejo de retroceso Android.
 */
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebView;

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
        super.onCreate(savedInstanceState);

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
                Insets ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime());
                int bottomInset = Math.max(sys.bottom, ime.bottom);
                view.setPadding(sys.left, sys.top, sys.right, bottomInset);
                return WindowInsetsCompat.CONSUMED;
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
}
