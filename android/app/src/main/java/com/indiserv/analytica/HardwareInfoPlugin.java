package com.indiserv.analytica;

/**
 * HardwareInfoPlugin — Plugin Capacitor nativo para telemetría Android (SoC, clústeres CPU-Z, RAM, batería e integridad).
 */
import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.res.Configuration;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Environment;
import android.os.StatFs;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.view.Display;
import android.view.WindowManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.InputStreamReader;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

@CapacitorPlugin(name = "HardwareInfo")
public class HardwareInfoPlugin extends Plugin {

    private String readSingleLineFile(String path) {
        File f = new File(path);
        if (!f.exists() || !f.canRead()) return "";
        try (BufferedReader br = new BufferedReader(new FileReader(f))) {
            String line = br.readLine();
            return line != null ? line.trim() : "";
        } catch (Exception ignored) {
            return "";
        }
    }

    private int readCpuFreqMhz(int cpuIndex, String fileName) {
        String raw = readSingleLineFile("/sys/devices/system/cpu/cpu" + cpuIndex + "/cpufreq/" + fileName);
        if (raw.isEmpty()) return 0;
        try {
            int khz = Integer.parseInt(raw);
            return khz > 0 ? Math.round(khz / 1000f) : 0;
        } catch (Exception ignored) {
            return 0;
        }
    }

    private String mapArmCoreName(String implementer, String part) {
        String imp = implementer == null ? "" : implementer.toLowerCase(Locale.ROOT).trim();
        String p = part == null ? "" : part.toLowerCase(Locale.ROOT).trim();
        if (imp.isEmpty() || p.isEmpty()) return "";

        if (imp.equals("0x41")) {
            switch (p) {
                case "0xd85": return "ARM Cortex-X925";
                case "0xd82": return "ARM Cortex-X5";
                case "0xd44": return "ARM Cortex-X4";
                case "0xd4e": return "ARM Cortex-X3";
                case "0xd48": return "ARM Cortex-X2";
                case "0xd42": return "ARM Cortex-A78AE";
                case "0xd87": return "ARM Cortex-A725";
                case "0xd81": return "ARM Cortex-A720";
                case "0xd4d": return "ARM Cortex-A720";
                case "0xd4b": return "ARM Cortex-A715";
                case "0xd47": return "ARM Cortex-A710";
                case "0xd41": return "ARM Cortex-A78";
                case "0xd0d": return "ARM Cortex-A77";
                case "0xd0b": return "ARM Cortex-A76";
                case "0xd0a": return "ARM Cortex-A75";
                case "0xd09": return "ARM Cortex-A73";
                case "0xd08": return "ARM Cortex-A72";
                case "0xd07": return "ARM Cortex-A57";
                case "0xd80": return "ARM Cortex-A520";
                case "0xd46": return "ARM Cortex-A510";
                case "0xd05": return "ARM Cortex-A55";
                case "0xd03": return "ARM Cortex-A53";
                case "0xd04": return "ARM Cortex-A35";
                default: return "ARM Core (" + p + ")";
            }
        } else if (imp.equals("0x51")) {
            if (p.equals("0x001") || p.equals("0x002")) return "Qualcomm Oryon";
            if (p.equals("0x804") || p.equals("0x805")) return "Qualcomm Kryo 4xx/5xx";
            if (p.equals("0x802") || p.equals("0x803")) return "Qualcomm Kryo 385";
            if (p.equals("0x800") || p.equals("0x801")) return "Qualcomm Kryo 2xx";
            return "Qualcomm Kryo (" + p + ")";
        } else if (imp.equals("0x53")) {
            return "Samsung Exynos M (" + p + ")";
        } else if (imp.equals("0x48")) {
            return "HiSilicon TaiShan (" + p + ")";
        }
        return "";
    }

    private static class CpuInfoParsed {
        String hardware = "";
        String modelName = "";
        Map<Integer, String> coreImplementer = new HashMap<>();
        Map<Integer, String> corePart = new HashMap<>();
    }

    private CpuInfoParsed parseProcCpuInfo() {
        CpuInfoParsed out = new CpuInfoParsed();
        int currentProc = -1;
        try (BufferedReader br = new BufferedReader(new FileReader("/proc/cpuinfo"))) {
            String line;
            while ((line = br.readLine()) != null) {
                int idx = line.indexOf(':');
                if (idx <= 0) continue;
                String key = line.substring(0, idx).trim().toLowerCase(Locale.ROOT);
                String val = line.substring(idx + 1).trim();
                if (val.isEmpty()) continue;

                if (key.equals("processor")) {
                    if (val.matches("\\d+")) {
                        currentProc = Integer.parseInt(val);
                    } else if (out.modelName.isEmpty()) {
                        out.modelName = val;
                    }
                } else if (key.equals("hardware") && out.hardware.isEmpty()) {
                    out.hardware = val;
                } else if (key.equals("model name") && out.modelName.isEmpty() && !val.matches("\\d+")) {
                    out.modelName = val;
                } else if (key.equals("cpu implementer") && currentProc >= 0) {
                    out.coreImplementer.put(currentProc, val);
                } else if (key.equals("cpu part") && currentProc >= 0) {
                    out.corePart.put(currentProc, val);
                }
            }
        } catch (Exception ignored) {
        }
        return out;
    }

    private JSArray buildCpuClusters(int cores, CpuInfoParsed parsed) {
        Map<String, int[]> clusterStats = new LinkedHashMap<>();
        Map<String, String> clusterArch = new HashMap<>();
        boolean hasRealTopologyData = false;

        for (int i = 0; i < cores; i++) {
            String imp = parsed.coreImplementer.get(i);
            String part = parsed.corePart.get(i);
            String arch = mapArmCoreName(imp, part);
            int maxMhz = readCpuFreqMhz(i, "cpuinfo_max_freq");
            int minMhz = readCpuFreqMhz(i, "cpuinfo_min_freq");

            if (!arch.isEmpty() || maxMhz > 0) {
                hasRealTopologyData = true;
            }
            String displayArch = !arch.isEmpty() ? arch : "Núcleo ARM";
            String key = displayArch + "|" + maxMhz;

            int[] stats = clusterStats.get(key);
            if (stats == null) {
                stats = new int[]{1, minMhz, maxMhz};
                clusterStats.put(key, stats);
                clusterArch.put(key, displayArch);
            } else {
                stats[0] += 1;
                if (minMhz > 0 && (stats[1] == 0 || minMhz < stats[1])) {
                    stats[1] = minMhz;
                }
            }
        }

        JSArray result = new JSArray();
        if (!hasRealTopologyData) {
            return result;
        }

        List<JSObject> list = new ArrayList<>();
        for (Map.Entry<String, int[]> entry : clusterStats.entrySet()) {
            int[] st = entry.getValue();
            JSObject obj = new JSObject();
            obj.put("cores", st[0]);
            obj.put("archName", clusterArch.get(entry.getKey()));
            obj.put("minFreqMhz", st[1]);
            obj.put("maxFreqMhz", st[2]);
            list.add(obj);
        }

        Collections.sort(list, new Comparator<JSObject>() {
            @Override
            public int compare(JSObject a, JSObject b) {
                return Integer.compare(b.optInt("maxFreqMhz", 0), a.optInt("maxFreqMhz", 0));
            }
        });

        for (JSObject o : list) {
            result.put(o);
        }
        return result;
    }

    private int readMaxCpuFreqMhz(int cores) {
        int maxMhz = 0;
        for (int i = 0; i < Math.max(cores, 8); i++) {
            int mhz = readCpuFreqMhz(i, "cpuinfo_max_freq");
            if (mhz > maxMhz) maxMhz = mhz;
        }
        return maxMhz;
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

    private String firstNonEmptyProp(String... keys) {
        for (String k : keys) {
            String v = getSystemProp(k);
            if (!v.isEmpty() && !v.equalsIgnoreCase("unknown") && !v.equalsIgnoreCase("none")) {
                return v;
            }
        }
        return "";
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
        String fp = (Build.FINGERPRINT != null ? Build.FINGERPRINT : "").toLowerCase(Locale.ROOT);
        String model = (Build.MODEL != null ? Build.MODEL : "").toLowerCase(Locale.ROOT);
        String hw = (Build.HARDWARE != null ? Build.HARDWARE : "").toLowerCase(Locale.ROOT);
        String prod = (Build.PRODUCT != null ? Build.PRODUCT : "").toLowerCase(Locale.ROOT);
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

    private String mapBatteryPlugged(int plugged) {
        switch (plugged) {
            case BatteryManager.BATTERY_PLUGGED_AC:
                return "Cargador AC";
            case BatteryManager.BATTERY_PLUGGED_USB:
                return "Puerto USB";
            case BatteryManager.BATTERY_PLUGGED_WIRELESS:
                return "Carga Inalámbrica";
            default:
                return "Desconectado";
        }
    }

    private String mapBatteryStatus(int status) {
        switch (status) {
            case BatteryManager.BATTERY_STATUS_CHARGING:
                return "Cargando";
            case BatteryManager.BATTERY_STATUS_FULL:
                return "Carga Completa";
            case BatteryManager.BATTERY_STATUS_DISCHARGING:
                return "Descargando";
            case BatteryManager.BATTERY_STATUS_NOT_CHARGING:
                return "No cargando";
            default:
                return "En uso";
        }
    }

    @PluginMethod
    public void getFullHardwareInfo(PluginCall call) {
        Context ctx = getContext();
        JSObject ret = new JSObject();

        String marketName = firstNonEmptyProp(
            "ro.product.marketname",
            "ro.product.vendor.marketname",
            "ro.product.odm.marketname",
            "ro.vendor.oplus.market.name",
            "ro.oppo.market.name",
            "ro.vivo.market.name",
            "ro.config.marketing_name",
            "ro.product.system.marketname"
        );
        String deviceNameSetting = "";
        try {
            String dn = Settings.Global.getString(ctx.getContentResolver(), "device_name");
            if (dn != null && !dn.trim().isEmpty()) {
                deviceNameSetting = dn.trim();
            }
        } catch (Exception ignored) {
        }

        ret.put("manufacturer", Build.MANUFACTURER != null ? Build.MANUFACTURER : "Android");
        ret.put("brand", Build.BRAND != null ? Build.BRAND : "");
        ret.put("model", Build.MODEL != null ? Build.MODEL : "Dispositivo");
        ret.put("device", Build.DEVICE != null ? Build.DEVICE : "");
        ret.put("productDevice", Build.DEVICE != null ? Build.DEVICE : "");
        ret.put("board", Build.BOARD != null ? Build.BOARD : "");
        ret.put("product", Build.PRODUCT != null ? Build.PRODUCT : "");
        ret.put("marketName", marketName);
        ret.put("deviceNameSetting", deviceNameSetting);

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
        CpuInfoParsed cpuParsed = parseProcCpuInfo();
        String procCpu = !cpuParsed.hardware.isEmpty() ? cpuParsed.hardware : cpuParsed.modelName;
        String hwCode = Build.HARDWARE != null ? Build.HARDWARE : "";
        String hardwarePlatform = firstNonEmptyProp("ro.board.platform");
        String chipName = firstNonEmptyProp(
            "ro.chipname",
            "ro.hardware.chipname",
            "ro.mediatek.platform",
            "ro.soc.model"
        );

        String cpuDisplay;
        if (!socModel.isEmpty()) {
            cpuDisplay = (!socManuf.isEmpty() ? socManuf + " " : "") + socModel;
        } else if (!chipName.isEmpty()) {
            cpuDisplay = chipName;
        } else if (!procCpu.isEmpty()) {
            cpuDisplay = procCpu;
        } else if (!hardwarePlatform.isEmpty()) {
            cpuDisplay = hardwarePlatform.toUpperCase(Locale.ROOT);
        } else if (!hwCode.isEmpty()) {
            cpuDisplay = hwCode.toUpperCase(Locale.ROOT);
        } else {
            cpuDisplay = "Procesador ARM";
        }

        String socCodename = !socModel.isEmpty()
            ? socModel
            : (!chipName.isEmpty() ? chipName : (!hardwarePlatform.isEmpty() ? hardwarePlatform : hwCode));

        int cores = Runtime.getRuntime().availableProcessors();
        int maxFreqMhz = readMaxCpuFreqMhz(cores);
        String[] abis = Build.SUPPORTED_ABIS != null ? Build.SUPPORTED_ABIS : new String[]{"arm64-v8a"};
        String primaryAbi = abis.length > 0 ? abis[0] : "arm64-v8a";
        JSArray cpuClusters = buildCpuClusters(cores, cpuParsed);
        String cpuGovernor = readSingleLineFile("/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor");

        ret.put("cpuName", cpuDisplay);
        ret.put("socManufacturer", socManuf);
        ret.put("socModel", socModel);
        ret.put("socCodename", socCodename);
        ret.put("hardwareCode", hwCode);
        ret.put("hardwarePlatform", hardwarePlatform);
        ret.put("chipName", chipName);
        ret.put("cpuCores", cores);
        ret.put("cpuMaxFreqMhz", maxFreqMhz);
        ret.put("cpuArch", primaryAbi);
        ret.put("supportedAbis", String.join(", ", Arrays.asList(abis)));
        ret.put("cpuClusters", cpuClusters);
        ret.put("cpuGovernor", cpuGovernor);

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

        try {
            IntentFilter ifilter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
            Intent batteryStatus = ctx.registerReceiver(null, ifilter);
            if (batteryStatus != null) {
                int level = batteryStatus.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                int scale = batteryStatus.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
                int status = batteryStatus.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
                int plugged = batteryStatus.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0);
                int tempTenths = batteryStatus.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0);
                int voltage = batteryStatus.getIntExtra(BatteryManager.EXTRA_VOLTAGE, 0);
                int health = batteryStatus.getIntExtra(BatteryManager.EXTRA_HEALTH, BatteryManager.BATTERY_HEALTH_UNKNOWN);
                String tech = batteryStatus.getStringExtra(BatteryManager.EXTRA_TECHNOLOGY);

                int pct = (level >= 0 && scale > 0) ? Math.round((level * 100f) / scale) : -1;
                boolean charging = (status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL);

                ret.put("batteryPct", pct);
                ret.put("batteryCharging", charging);
                ret.put("batteryStatusText", mapBatteryStatus(status));
                ret.put("batteryPlugged", mapBatteryPlugged(plugged));
                ret.put("batteryTechnology", (tech != null && !tech.isEmpty()) ? tech : "Li-ion");
                ret.put("batteryTempC", Math.round((tempTenths / 10.0) * 10.0) / 10.0);
                ret.put("batteryVoltageMv", voltage);
                ret.put("batteryHealth", mapBatteryHealth(health));

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    BatteryManager bm = (BatteryManager) ctx.getSystemService(Context.BATTERY_SERVICE);
                    if (bm != null) {
                        int currentUa = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CURRENT_NOW);
                        if (currentUa != Integer.MIN_VALUE && currentUa != 0) {
                            ret.put("batteryCurrentMa", Math.round(currentUa / 1000f));
                        }
                        int chargeCounterUah = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CHARGE_COUNTER);
                        if (chargeCounterUah > 0) {
                            ret.put("batteryChargeCounterMah", Math.round(chargeCounterUah / 1000f));
                        }
                    }
                }
            }
        } catch (Exception ignored) {
        }

        boolean isTablet = false;
        double diagInches = 0.0;
        try {
            Configuration cfg = ctx.getResources().getConfiguration();
            int swDp = cfg.smallestScreenWidthDp;
            int screenSize = cfg.screenLayout & Configuration.SCREENLAYOUT_SIZE_MASK;
            if (swDp >= 600 || screenSize >= Configuration.SCREENLAYOUT_SIZE_LARGE) {
                isTablet = true;
            }
            WindowManager wm = (WindowManager) ctx.getSystemService(Context.WINDOW_SERVICE);
            if (wm != null) {
                Display display = wm.getDefaultDisplay();
                DisplayMetrics dm = new DisplayMetrics();
                display.getRealMetrics(dm);
                ret.put("screenWidthPx", dm.widthPixels);
                ret.put("screenHeightPx", dm.heightPixels);
                ret.put("refreshRateHz", Math.round(display.getRefreshRate()));
                if (dm.xdpi >= 72f && dm.ydpi >= 72f) {
                    double xIn = dm.widthPixels / (double) dm.xdpi;
                    double yIn = dm.heightPixels / (double) dm.ydpi;
                    diagInches = Math.round(Math.hypot(xIn, yIn) * 10.0) / 10.0;
                    if (diagInches >= 7.0) {
                        isTablet = true;
                    }
                }
            }
        } catch (Exception ignored) {
        }
        ret.put("isTablet", isTablet);
        ret.put("screenDiagonalInches", diagInches);

        String buildTags = Build.TAGS != null ? Build.TAGS : "unknown";
        String verifiedBoot = getSystemProp("ro.boot.verifiedbootstate");
        if (verifiedBoot.isEmpty()) verifiedBoot = "unknown";

        ret.put("buildTags", buildTags);
        ret.put("fingerprint", Build.FINGERPRINT != null ? Build.FINGERPRINT : "");
        ret.put("verifiedBootState", verifiedBoot);
        ret.put("isRooted", detectRoot());
        ret.put("isEmulator", detectEmulator());

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
