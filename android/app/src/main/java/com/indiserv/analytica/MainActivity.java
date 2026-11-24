package com.indiserv.analytica;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HardwareInfoPlugin.class);
        registerPlugin(MaintenancePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
