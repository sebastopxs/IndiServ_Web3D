package com.indiserv.analytica;

import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Environment;
import android.os.StatFs;
import android.util.DisplayMetrics;
import android.view.Display;
import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.InputStreamReader;
import java.util.Arrays;

@CapacitorPlugin(name = "HardwareInfo")
public class HardwareInfoPlugin extends Plugin {

    private String readProcCpuInfoField() {
        String hardware = "";
        String modelName = "";
        try (BufferedReader br = new BufferedReader(new FileReader("/proc/cpuinfo"))) {
            String line;
            while ((line = br.readLine()) != null) {
                int idx = line.indexOf(':');
                if (idx <= 0) continue;
                String key = line.substring(0, idx).trim().toLowerCase();
                String val = line.substring(idx + 1).trim();
                if (key.equals("hardware") && hardware.isEmpty() && !val.isEmpty()) {
                    hardware = val;
                } else if ((key.equals("model name") || key.equals("processor")) && modelName.isEmpty() && !val.isEmpty() && !val.matches("\\d+")) {
                    modelName = val;
                }
            }
        } catch (Exception ignored) {
        }
        if (!hardware.isEmpty()) return hardware;
        return modelName;
    }

    private int readMaxCpuFreqMhz(int cores) {
        int maxKhz = 0;
        for (int i = 0; i < Math.max(cores, 8); i++) {
            File f = new File("/sys/devices/system/cpu/cpu" + i + "/cpufreq/cpuinfo_max_freq");
            if (!f.exists()) continue;
            try (BufferedReader br = new BufferedReader(new FileReader(f))) {
                String line = br.readLine();
                if (line != null) {
                    int khz = Integer.parseInt(line.trim());
                    if (khz > maxKhz) maxKhz = khz;
                }
            } catch (Exception ignored) {
            }
        }
        return maxKhz > 0 ? Math.round(maxKhz / 1000f) : 0;
    }

    private String getSystemProp(String key) {
        try {
            Process p = Runtime.getRuntime().exec(new String[]{"getprop", key});
            try (BufferedReader br = new BufferedReader(new InputStreamReader(p.getInputStream()))) {
                String line = br.readLine();
                return line != null ? line.trim() : "";
            }
        } catch (Exception ignored) {
            return "";
        }
    }

    private boolean detectRoot() {
        String tags = Build.TAGS != null ? Build.TAGS : "";
        if (tags.contains("test-keys")) {
            return true;
        }
        String[] paths = {
            "/system/bin/su",
            "/system/xbin/su",
            "/sbin/su",
            "/data/local/xbin/su",
            "/data/local/bin/su",
            "/system/app/Superuser.apk",
            "/su/bin/su"
        };
        for (String path : paths) {
            if (new File(path).exists()) {
                return true;
            }
        }
        return false;
    }

    private boolean detectEmulator() {
        String fp = (Build.FINGERPRINT != null ? Build.FINGERPRINT : "").toLowerCase();
        String model = (Build.MODEL != null ? Build.MODEL : "").toLowerCase();
        String hw = (Build.HARDWARE != null ? Build.HARDWARE : "").toLowerCase();
        String prod = (Build.PRODUCT != null ? Build.PRODUCT : "").toLowerCase();
        return fp.contains("generic")
            || fp.contains("vbox")
            || model.contains("emulator")
            || model.contains("android sdk built for")
            || hw.contains("goldfish")
            || hw.contains("ranchu")
            || prod.contains("sdk_gphone");
    }

    private String mapBatteryHealth(int code) {
        switch (code) {
            case BatteryManager.BATTERY_HEALTH_GOOD:
                return "Óptima";
            case BatteryManager.BATTERY_HEALTH_OVERHEAT:
                return "Sobrecalentada";
            case BatteryManager.BATTERY_HEALTH_DEAD:
                return "Degradada / Crítica";
            case BatteryManager.BATTERY_HEALTH_OVER_VOLTAGE:
                return "Sobrevoltaje";
            case BatteryManager.BATTERY_HEALTH_COLD:
                return "Fría";
            default:
                return "Estándar";
        }
    }

    @PluginMethod
    public void getFullHardwareInfo(PluginCall call) {
        Context ctx = getContext();
        JSObject ret = new JSObject();

        // 1. Identidad del dispositivo
        ret.put("manufacturer", Build.MANUFACTURER != null ? Build.MANUFACTURER : "Android");
        ret.put("brand", Build.BRAND != null ? Build.BRAND : "");
        ret.put("model", Build.MODEL != null ? Build.MODEL : "Dispositivo");
        ret.put("device", Build.DEVICE != null ? Build.DEVICE : "");
        ret.put("board", Build.BOARD != null ? Build.BOARD : "");
        ret.put("product", Build.PRODUCT != null ? Build.PRODUCT : "");

        // 2. Procesador (SoC) y Arquitectura
        String socManuf = "";
        String socModel = "";
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (Build.SOC_MANUFACTURER != null && !Build.SOC_MANUFACTURER.equals("unknown")) {
                socManuf = Build.SOC_MANUFACTURER;
            }
            if (Build.SOC_MODEL != null && !Build.SOC_MODEL.equals("unknown")) {
                socModel = Build.SOC_MODEL;
            }
        }
        String procCpu = readProcCpuInfoField();
        String hwCode = Build.HARDWARE != null ? Build.HARDWARE : "";
        String cpuDisplay;
        if (!socModel.isEmpty()) {
            cpuDisplay = (!socManuf.isEmpty() ? socManuf + " " : "") + socModel;
        } else if (!procCpu.isEmpty()) {
            cpuDisplay = procCpu;
        } else if (!hwCode.isEmpty()) {
            cpuDisplay = hwCode.toUpperCase();
        } else {
            cpuDisplay = "Procesador ARM";
        }

        int cores = Runtime.getRuntime().availableProcessors();
        int maxFreqMhz = readMaxCpuFreqMhz(cores);
        String[] abis = Build.SUPPORTED_ABIS != null ? Build.SUPPORTED_ABIS : new String[]{"arm64-v8a"};
        String primaryAbi = abis.length > 0 ? abis[0] : "arm64-v8a";

        ret.put("cpuName", cpuDisplay);
        ret.put("socManufacturer", socManuf);
        ret.put("socModel", socModel);
        ret.put("hardwareCode", hwCode);
        ret.put("cpuCores", cores);
        ret.put("cpuMaxFreqMhz", maxFreqMhz);
        ret.put("cpuArch", primaryAbi);
        ret.put("supportedAbis", String.join(", ", Arrays.asList(abis)));

        // 3. Memoria RAM Real (ActivityManager)
        try {
            ActivityManager am = (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
            ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
            if (am != null) {
                am.getMemoryInfo(mi);
                double totalMb = mi.totalMem / (1024.0 * 1024.0);
                double availMb = mi.availMem / (1024.0 * 1024.0);
                double usedPct = totalMb > 0 ? ((totalMb - availMb) / totalMb) * 100.0 : 0.0;
                ret.put("ramTotalMb", Math.round(totalMb));
                ret.put("ramAvailMb", Math.round(availMb));
                ret.put("ramUsedPct", Math.round(usedPct * 10.0) / 10.0);
                ret.put("ramLowMemory", mi.lowMemory);
            }
        } catch (Exception ignored) {
        }

        // 4. Almacenamiento Interno Real (StatFs)
        try {
            File path = Environment.getDataDirectory();
            StatFs stat = new StatFs(path.getPath());
            double totalBytes = (double) stat.getTotalBytes();
            double availBytes = (double) stat.getAvailableBytes();
            double usedBytes = Math.max(0.0, totalBytes - availBytes);
            double gb = 1024.0 * 1024.0 * 1024.0;
            double totalGb = totalBytes / gb;
            double availGb = availBytes / gb;
            double usedGb = usedBytes / gb;
            double usedPct = totalBytes > 0 ? (usedBytes / totalBytes) * 100.0 : 0.0;
            ret.put("storageTotalGb", Math.round(totalGb * 10.0) / 10.0);
            ret.put("storageAvailGb", Math.round(availGb * 10.0) / 10.0);
            ret.put("storageUsedGb", Math.round(usedGb * 10.0) / 10.0);
            ret.put("storageUsedPct", Math.round(usedPct * 10.0) / 10.0);
        } catch (Exception ignored) {
        }

        // 5. Batería Real, Temperatura y Voltaje
        try {
            IntentFilter ifilter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
            Intent batteryStatus = ctx.registerReceiver(null, ifilter);
            if (batteryStatus != null) {
                int level = batteryStatus.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                int scale = batteryStatus.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
                int status = batteryStatus.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
                int tempTenths = batteryStatus.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0);
                int voltage = batteryStatus.getIntExtra(BatteryManager.EXTRA_VOLTAGE, 0);
                int health = batteryStatus.getIntExtra(BatteryManager.EXTRA_HEALTH, BatteryManager.BATTERY_HEALTH_UNKNOWN);

                int pct = (level >= 0 && scale > 0) ? Math.round((level * 100f) / scale) : -1;
                boolean charging = (status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL);

                ret.put("batteryPct", pct);
                ret.put("batteryCharging", charging);
                ret.put("batteryTempC", Math.round((tempTenths / 10.0) * 10.0) / 10.0);
                ret.put("batteryVoltageMv", voltage);
                ret.put("batteryHealth", mapBatteryHealth(health));
            }
        } catch (Exception ignored) {
        }

        // 6. Pantalla física y Tasa de Refresco (Hz)
        try {
            WindowManager wm = (WindowManager) ctx.getSystemService(Context.WINDOW_SERVICE);
            if (wm != null) {
                Display display = wm.getDefaultDisplay();
                DisplayMetrics dm = new DisplayMetrics();
                display.getRealMetrics(dm);
                ret.put("screenWidthPx", dm.widthPixels);
                ret.put("screenHeightPx", dm.heightPixels);
                ret.put("refreshRateHz", Math.round(display.getRefreshRate()));
            }
        } catch (Exception ignored) {
        }

        // 7. Integridad de Sistema (Bootloader, Tags, Root, Emulador)
        String buildTags = Build.TAGS != null ? Build.TAGS : "unknown";
        String verifiedBoot = getSystemProp("ro.boot.verifiedbootstate");
        if (verifiedBoot.isEmpty()) verifiedBoot = "unknown";

        ret.put("buildTags", buildTags);
        ret.put("fingerprint", Build.FINGERPRINT != null ? Build.FINGERPRINT : "");
        ret.put("verifiedBootState", verifiedBoot);
        ret.put("isRooted", detectRoot());
        ret.put("isEmulator", detectEmulator());

        // 8. Sistema Operativo y Kernel
        ret.put("androidRelease", Build.VERSION.RELEASE != null ? Build.VERSION.RELEASE : "?");
        ret.put("sdkInt", Build.VERSION.SDK_INT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            ret.put("securityPatch", Build.VERSION.SECURITY_PATCH != null ? Build.VERSION.SECURITY_PATCH : "N/D");
        } else {
            ret.put("securityPatch", "N/D");
        }
        ret.put("kernelVersion", System.getProperty("os.version", "Linux"));

        call.resolve(ret);
    }
}
