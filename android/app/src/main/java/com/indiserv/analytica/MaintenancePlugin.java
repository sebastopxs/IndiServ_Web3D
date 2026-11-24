package com.indiserv.analytica;

import android.Manifest;
import android.app.ActivityManager;
import android.app.AppOpsManager;
import android.app.usage.UsageStats;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Environment;
import android.os.PowerManager;
import android.os.Process;
import android.os.storage.StorageManager;
import android.provider.Settings;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

@CapacitorPlugin(name = "Maintenance")
public class MaintenancePlugin extends Plugin {

    private static final int MAX_SCAN_DEPTH = 4;
    private static final int MAX_RETURNED_ITEMS = 120;

    private String mapThermalStatus(int status) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            return "Nominal";
        }
        switch (status) {
            case PowerManager.THERMAL_STATUS_NONE:
                return "Nominal";
            case PowerManager.THERMAL_STATUS_LIGHT:
                return "Ligero";
            case PowerManager.THERMAL_STATUS_MODERATE:
                return "Moderado";
            case PowerManager.THERMAL_STATUS_SEVERE:
                return "Severo";
            case PowerManager.THERMAL_STATUS_CRITICAL:
            case PowerManager.THERMAL_STATUS_EMERGENCY:
            case PowerManager.THERMAL_STATUS_SHUTDOWN:
                return "Crítico";
            default:
                return "Nominal";
        }
    }

    private boolean checkUsageStatsGranted(Context ctx) {
        try {
            AppOpsManager appOps = (AppOpsManager) ctx.getSystemService(Context.APP_OPS_SERVICE);
            if (appOps == null) return false;
            int mode;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                mode = appOps.unsafeCheckOpNoThrow(
                    AppOpsManager.OPSTR_GET_USAGE_STATS,
                    Process.myUid(),
                    ctx.getPackageName()
                );
            } else {
                mode = appOps.checkOpNoThrow(
                    AppOpsManager.OPSTR_GET_USAGE_STATS,
                    Process.myUid(),
                    ctx.getPackageName()
                );
            }
            if (mode == AppOpsManager.MODE_DEFAULT) {
                return ctx.checkCallingOrSelfPermission(Manifest.permission.PACKAGE_USAGE_STATS)
                    == PackageManager.PERMISSION_GRANTED;
            }
            return mode == AppOpsManager.MODE_ALLOWED;
        } catch (Exception ignored) {
            return false;
        }
    }

    private boolean checkAllFilesGranted(Context ctx) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            return Environment.isExternalStorageManager();
        }
        return ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_EXTERNAL_STORAGE)
            == PackageManager.PERMISSION_GRANTED;
    }

    private long getDirSizeBytes(File dir) {
        if (dir == null || !dir.exists()) return 0L;
        if (dir.isFile()) return dir.length();
        long total = 0L;
        File[] children = dir.listFiles();
        if (children == null) return 0L;
        for (File child : children) {
            total += getDirSizeBytes(child);
        }
        return total;
    }

    private long deleteDirContents(File dir) {
        if (dir == null || !dir.exists() || !dir.isDirectory()) return 0L;
        long freed = 0L;
        File[] children = dir.listFiles();
        if (children == null) return 0L;
        for (File child : children) {
            if (child.isDirectory()) {
                freed += deleteDirContents(child);
                child.delete();
            } else {
                long len = child.length();
                if (child.delete()) {
                    freed += len;
                }
            }
        }
        return freed;
    }

    private boolean isSafeUserDeletableFile(File file) {
        try {
            if (file == null || !file.exists() || !file.isFile()) return false;
            File extRoot = Environment.getExternalStorageDirectory();
            if (extRoot == null) return false;

            String rootCanonical = extRoot.getCanonicalPath();
            String fileCanonical = file.getCanonicalPath();

            if (!fileCanonical.startsWith(rootCanonical + File.separator)) {
                return false;
            }

            String relLower = fileCanonical.substring(rootCanonical.length() + 1).toLowerCase(Locale.ROOT);
            if (relLower.contains("..")) return false;

            // Bloquear carpetas críticas del sistema y fotos personales
            if (relLower.startsWith("android/")
                || relLower.startsWith("android\\")
                || relLower.startsWith("dcim/camera")
                || relLower.startsWith("dcim\\camera")
                || relLower.startsWith(".android")
                || relLower.startsWith("system/")
                || relLower.startsWith("data/")) {
                return false;
            }

            // Permitir únicamente dentro de carpetas seguras de usuario (Download / Documents)
            return relLower.startsWith("download/")
                || relLower.startsWith("download\\")
                || relLower.startsWith("downloads/")
                || relLower.startsWith("documents/")
                || relLower.startsWith("documents\\");
        } catch (IOException e) {
            return false;
        }
    }

    private void scanDirectoryRecursive(
        File dir,
        int depth,
        long minLargeBytes,
        List<JSObject> foundItems,
        long[] totalBytesHolder,
        int[] scannedCountHolder
    ) {
        if (dir == null || !dir.exists() || !dir.isDirectory() || depth > MAX_SCAN_DEPTH) {
            return;
        }
        File[] children = dir.listFiles();
        if (children == null) return;

        for (File f : children) {
            if (foundItems.size() >= MAX_RETURNED_ITEMS) return;
            String name = f.getName();
            if (name.startsWith(".")) continue;

            if (f.isDirectory()) {
                String lower = name.toLowerCase(Locale.ROOT);
                if (lower.equals("android") || lower.equals("camera") || lower.equals("dcim")) {
                    continue;
                }
                scanDirectoryRecursive(f, depth + 1, minLargeBytes, foundItems, totalBytesHolder, scannedCountHolder);
            } else if (f.isFile() && isSafeUserDeletableFile(f)) {
                scannedCountHolder[0]++;
                String lower = name.toLowerCase(Locale.ROOT);
                long size = f.length();
                String category = null;

                if (lower.endsWith(".apk") || lower.endsWith(".apkm") || lower.endsWith(".xapk")) {
                    category = "APK Antiguo";
                } else if (lower.endsWith(".tmp") || lower.endsWith(".log") || lower.endsWith(".bak") || lower.endsWith(".old")) {
                    category = "Temporal / Log";
                } else if (size >= minLargeBytes) {
                    category = "Archivo Grande";
                }

                if (category != null) {
                    double sizeMb = Math.round((size / (1024.0 * 1024.0)) * 100.0) / 100.0;
                    totalBytesHolder[0] += size;
                    JSObject item = new JSObject();
                    try {
                        item.put("path", f.getCanonicalPath());
                    } catch (IOException e) {
                        item.put("path", f.getAbsolutePath());
                    }
                    item.put("name", name);
                    item.put("sizeMb", sizeMb);
                    item.put("category", category);
                    item.put("lastModified", f.lastModified());
                    foundItems.add(item);
                }
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // NIVEL 1 — SIN PERMISOS INVASIVOS
    // ═══════════════════════════════════════════════════════════════════════

    @PluginMethod
    public void getThermalSnapshot(PluginCall call) {
        Context ctx = getContext();
        JSObject ret = new JSObject();

        // Batería, temperatura, voltaje y corriente
        try {
            IntentFilter ifilter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
            Intent batteryStatus = ctx.registerReceiver(null, ifilter);
            if (batteryStatus != null) {
                int level = batteryStatus.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                int scale = batteryStatus.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
                int status = batteryStatus.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
                int tempTenths = batteryStatus.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0);
                int voltage = batteryStatus.getIntExtra(BatteryManager.EXTRA_VOLTAGE, 0);

                int pct = (level >= 0 && scale > 0) ? Math.round((level * 100f) / scale) : -1;
                boolean charging = (status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL);

                ret.put("batteryPct", pct);
                ret.put("batteryCharging", charging);
                ret.put("batteryTempC", Math.round((tempTenths / 10.0) * 10.0) / 10.0);
                ret.put("batteryVoltageMv", voltage);
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                BatteryManager bm = (BatteryManager) ctx.getSystemService(Context.BATTERY_SERVICE);
                if (bm != null) {
                    int currentUa = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CURRENT_NOW);
                    if (currentUa != Integer.MIN_VALUE && currentUa != 0) {
                        ret.put("batteryCurrentMa", Math.round(currentUa / 1000f));
                    }
                }
            }
        } catch (Exception ignored) {
        }

        // RAM libre y usada
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
            }
        } catch (Exception ignored) {
        }

        // Estado térmico oficial de Android (API 29+)
        String thermalStatus = "Nominal";
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    thermalStatus = mapThermalStatus(pm.getCurrentThermalStatus());
                }
            }
        } catch (Exception ignored) {
        }
        ret.put("thermalStatus", thermalStatus);

        // Tamaño actual de caché interna de IndiServ
        long cacheBytes = getDirSizeBytes(ctx.getCacheDir()) + getDirSizeBytes(ctx.getExternalCacheDir());
        ret.put("appCacheKb", Math.round(cacheBytes / 1024.0));
        ret.put("timestamp", System.currentTimeMillis());

        call.resolve(ret);
    }

    @PluginMethod
    public void clearAppInternalCache(PluginCall call) {
        Context ctx = getContext();
        long freedBytes = 0L;
        try {
            freedBytes += deleteDirContents(ctx.getCacheDir());
            freedBytes += deleteDirContents(ctx.getExternalCacheDir());
        } catch (Exception ignored) {
        }

        JSObject ret = new JSObject();
        ret.put("freedBytes", freedBytes);
        ret.put("freedKb", Math.round(freedBytes / 1024.0));
        ret.put("freedMb", Math.round((freedBytes / (1024.0 * 1024.0)) * 100.0) / 100.0);
        call.resolve(ret);
    }

    @PluginMethod
    public void openSystemStorageCleanup(PluginCall call) {
        Context ctx = getContext();
        try {
            Intent intent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                intent = new Intent(StorageManager.ACTION_CLEAR_APP_CACHE);
                if (intent.resolveActivity(ctx.getPackageManager()) == null) {
                    intent = new Intent(Settings.ACTION_INTERNAL_STORAGE_SETTINGS);
                }
            } else {
                intent = new Intent(Settings.ACTION_INTERNAL_STORAGE_SETTINGS);
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("opened", true);
            call.resolve(ret);
        } catch (Exception e) {
            try {
                Intent fallback = new Intent(Settings.ACTION_SETTINGS);
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(fallback);
            } catch (Exception ignored) {
            }
            call.reject("No se pudo abrir la pantalla de almacenamiento: " + e.getMessage());
        }
    }

    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        Context ctx = getContext();
        try {
            Intent intent = new Intent(Settings.ACTION_BATTERY_SAVER_SETTINGS);
            if (intent.resolveActivity(ctx.getPackageManager()) == null) {
                intent = new Intent(Intent.ACTION_POWER_USAGE_SUMMARY);
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("opened", true);
            call.resolve(ret);
        } catch (Exception e) {
            try {
                Intent fallback = new Intent(Settings.ACTION_SETTINGS);
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(fallback);
            } catch (Exception ignored) {
            }
            call.reject("No se pudieron abrir los ajustes de batería: " + e.getMessage());
        }
    }

    @PluginMethod
    public void openAppDetailsSettings(PluginCall call) {
        Context ctx = getContext();
        String pkg = call.getString("packageName", ctx.getPackageName());
        if (pkg == null || pkg.trim().isEmpty()) {
            pkg = ctx.getPackageName();
        }
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.parse("package:" + pkg.trim()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("opened", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("No se pudo abrir la ficha de la aplicación: " + e.getMessage());
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // NIVEL 2 — PERMISOS EXPLÍCITOS EN AJUSTES
    // ═══════════════════════════════════════════════════════════════════════

    @PluginMethod
    public void getPermissionStatus(PluginCall call) {
        Context ctx = getContext();
        JSObject ret = new JSObject();
        ret.put("hasUsageStats", checkUsageStatsGranted(ctx));
        ret.put("hasAllFilesAccess", checkAllFilesGranted(ctx));
        call.resolve(ret);
    }

    @PluginMethod
    public void requestUsageStatsPermission(PluginCall call) {
        Context ctx = getContext();
        try {
            Intent intent = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
            intent.setData(Uri.parse("package:" + ctx.getPackageName()));
            if (intent.resolveActivity(ctx.getPackageManager()) == null) {
                intent = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("opened", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("No se pudo abrir el permiso de datos de uso: " + e.getMessage());
        }
    }

    @PluginMethod
    public void requestAllFilesPermission(PluginCall call) {
        Context ctx = getContext();
        try {
            Intent intent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
                intent.setData(Uri.parse("package:" + ctx.getPackageName()));
                if (intent.resolveActivity(ctx.getPackageManager()) == null) {
                    intent = new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
                }
            } else {
                intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.parse("package:" + ctx.getPackageName()));
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("opened", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("No se pudo abrir el permiso de acceso a archivos: " + e.getMessage());
        }
    }

    @PluginMethod
    public void getTopActiveApps(PluginCall call) {
        Context ctx = getContext();
        if (!checkUsageStatsGranted(ctx)) {
            JSObject ret = new JSObject();
            ret.put("permissionRequired", true);
            ret.put("apps", new JSArray());
            call.resolve(ret);
            return;
        }

        UsageStatsManager usm = (UsageStatsManager) ctx.getSystemService(Context.USAGE_STATS_SERVICE);
        if (usm == null) {
            JSObject ret = new JSObject();
            ret.put("permissionRequired", false);
            ret.put("apps", new JSArray());
            call.resolve(ret);
            return;
        }

        long end = System.currentTimeMillis();
        long start = end - (24L * 60L * 60L * 1000L);
        List<UsageStats> stats = usm.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, start, end);

        Map<String, Long> fgTimeByPkg = new HashMap<>();
        Map<String, Long> lastUsedByPkg = new HashMap<>();
        if (stats != null) {
            for (UsageStats s : stats) {
                String pkg = s.getPackageName();
                long fg = s.getTotalTimeInForeground();
                if (pkg == null || fg <= 0) continue;
                fgTimeByPkg.put(pkg, fgTimeByPkg.getOrDefault(pkg, 0L) + fg);
                long prevLast = lastUsedByPkg.getOrDefault(pkg, 0L);
                if (s.getLastTimeUsed() > prevLast) {
                    lastUsedByPkg.put(pkg, s.getLastTimeUsed());
                }
            }
        }

        PackageManager pm = ctx.getPackageManager();
        String ownPkg = ctx.getPackageName();
        List<JSObject> candidates = new ArrayList<>();

        for (Map.Entry<String, Long> entry : fgTimeByPkg.entrySet()) {
            String pkg = entry.getKey();
            long fgMs = entry.getValue();
            if (pkg.equals(ownPkg) || pkg.startsWith("com.android.systemui") || pkg.contains("launcher")) {
                continue;
            }
            if (fgMs < 60_000L) continue; // Ignorar trazas < 1 minuto

            String appName = pkg;
            boolean isCoreSystem = false;
            try {
                ApplicationInfo ai = pm.getApplicationInfo(pkg, 0);
                CharSequence label = pm.getApplicationLabel(ai);
                if (label != null && label.length() > 0) {
                    appName = label.toString();
                }
                boolean isSystem = (ai.flags & ApplicationInfo.FLAG_SYSTEM) != 0;
                boolean isUpdatedSystem = (ai.flags & ApplicationInfo.FLAG_UPDATED_SYSTEM_APP) != 0;
                // Filtrar servicios puros de sistema que no tienen ícono de lanzamiento
                if (isSystem && !isUpdatedSystem && pm.getLaunchIntentForPackage(pkg) == null) {
                    isCoreSystem = true;
                }
            } catch (PackageManager.NameNotFoundException ignored) {
                // Conservar nombre de paquete si no es visible por visibilidad Android 11+
            }

            if (isCoreSystem) continue;

            JSObject appObj = new JSObject();
            appObj.put("packageName", pkg);
            appObj.put("appName", appName);
            appObj.put("foregroundMinutes", Math.round(fgMs / 60000.0));
            appObj.put("lastTimeUsed", lastUsedByPkg.getOrDefault(pkg, 0L));
            candidates.add(appObj);
        }

        Collections.sort(candidates, new Comparator<JSObject>() {
            @Override
            public int compare(JSObject a, JSObject b) {
                return Long.compare(b.optLong("foregroundMinutes", 0L), a.optLong("foregroundMinutes", 0L));
            }
        });

        JSArray topArr = new JSArray();
        int limit = Math.min(10, candidates.size());
        for (int i = 0; i < limit; i++) {
            topArr.put(candidates.get(i));
        }

        JSObject ret = new JSObject();
        ret.put("permissionRequired", false);
        ret.put("apps", topArr);
        call.resolve(ret);
    }

    @PluginMethod
    public void scanJunkAndLargeFiles(PluginCall call) {
        Context ctx = getContext();
        if (!checkAllFilesGranted(ctx)) {
            JSObject ret = new JSObject();
            ret.put("permissionRequired", true);
            ret.put("totalScannedFiles", 0);
            ret.put("totalReclaimableMb", 0);
            ret.put("items", new JSArray());
            call.resolve(ret);
            return;
        }

        int minLargeMb = call.getInt("minLargeMb", 100);
        if (minLargeMb < 10) minLargeMb = 10;
        long minLargeBytes = minLargeMb * 1024L * 1024L;

        File extRoot = Environment.getExternalStorageDirectory();
        List<JSObject> foundItems = new ArrayList<>();
        long[] totalBytes = new long[]{0L};
        int[] scannedCount = new int[]{0};

        if (extRoot != null && extRoot.exists()) {
            File downloadDir = new File(extRoot, Environment.DIRECTORY_DOWNLOADS);
            File documentsDir = new File(extRoot, Environment.DIRECTORY_DOCUMENTS);
            scanDirectoryRecursive(downloadDir, 0, minLargeBytes, foundItems, totalBytes, scannedCount);
            scanDirectoryRecursive(documentsDir, 0, minLargeBytes, foundItems, totalBytes, scannedCount);
        }

        Collections.sort(foundItems, new Comparator<JSObject>() {
            @Override
            public int compare(JSObject a, JSObject b) {
                return Double.compare(b.optDouble("sizeMb", 0.0), a.optDouble("sizeMb", 0.0));
            }
        });

        JSArray arr = new JSArray();
        for (JSObject item : foundItems) {
            arr.put(item);
        }

        JSObject ret = new JSObject();
        ret.put("permissionRequired", false);
        ret.put("totalScannedFiles", scannedCount[0]);
        ret.put("totalReclaimableMb", Math.round((totalBytes[0] / (1024.0 * 1024.0)) * 100.0) / 100.0);
        ret.put("items", arr);
        call.resolve(ret);
    }

    @PluginMethod
    public void deleteSelectedFiles(PluginCall call) {
        Context ctx = getContext();
        if (!checkAllFilesGranted(ctx)) {
            call.reject("Permiso de acceso a archivos no concedido.");
            return;
        }

        JSArray paths = call.getArray("paths");
        if (paths == null || paths.length() == 0) {
            JSObject ret = new JSObject();
            ret.put("deletedCount", 0);
            ret.put("freedMb", 0.0);
            call.resolve(ret);
            return;
        }

        int deletedCount = 0;
        long freedBytes = 0L;

        for (int i = 0; i < paths.length(); i++) {
            try {
                String rawPath = paths.getString(i);
                if (rawPath == null || rawPath.trim().isEmpty() || rawPath.contains("..")) {
                    continue;
                }
                File target = new File(rawPath.trim());
                if (!isSafeUserDeletableFile(target)) {
                    continue;
                }
                long len = target.length();
                if (target.delete()) {
                    deletedCount++;
                    freedBytes += len;
                }
            } catch (JSONException ignored) {
            }
        }

        JSObject ret = new JSObject();
        ret.put("deletedCount", deletedCount);
        ret.put("freedMb", Math.round((freedBytes / (1024.0 * 1024.0)) * 100.0) / 100.0);
        call.resolve(ret);
    }
}
