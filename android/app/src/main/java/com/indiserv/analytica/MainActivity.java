package com.indiserv.analytica;

/**
 * MainActivity — Actividad principal de Capacitor con registro de plugins nativos y manejo de retroceso Android.
 */
import android.os.Bundle;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HardwareInfoPlugin.class);
        registerPlugin(MaintenancePlugin.class);
        super.onCreate(savedInstanceState);

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
