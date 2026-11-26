/**
 * MobileMaintenanceView.jsx — Módulo de monitoreo térmico en vivo y mantenimiento real Android (Nivel 1 y Nivel 2).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { recordMobileEvent } from '../utils/cloudHistory';
import {
  Thermometer, Snowflake, Trash2, ShieldCheck, Settings, HardDrive,
  AppWindow, RefreshCw, AlertTriangle, CheckCircle2, FolderSearch,
  Lock, Zap, MemoryStick, ExternalLink, X, Clock, Flame,
} from 'lucide-react';

const Maintenance = registerPlugin('Maintenance');

function formatMinutes(mins) {
  const m = Number(mins) || 0;
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h} h ${rem} min` : `${h} h`;
}

function formatDateShort(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });
  } catch {
    return '';
  }
}

export default function MobileMaintenanceView({ deviceInfo, user }) {
  const isNative = useMemo(() => {
    try {
      return Capacitor.isNativePlatform();
    } catch {
      return false;
    }
  }, []);

  const [thermal, setThermal] = useState(null);
  const [coolingActive, setCoolingActive] = useState(false);
  const [coolingSecondsLeft, setCoolingSecondsLeft] = useState(60);
  const [coolingStartTemp, setCoolingStartTemp] = useState(null);
  const [coolingReport, setCoolingReport] = useState(null);
  const coolingTimerRef = useRef(null);
  const latestTempRef = useRef(null);

  const [perms, setPerms] = useState({ hasUsageStats: false, hasAllFilesAccess: false });
  const [cacheClearing, setCacheClearing] = useState(false);
  const [cacheMessage, setCacheMessage] = useState('');
  const [topApps, setTopApps] = useState([]);
  const [loadingApps, setLoadingApps] = useState(false);

  const [minLargeMb, setMinLargeMb] = useState(100);
  const [scanningFiles, setScanningFiles] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [selectedPaths, setSelectedPaths] = useState(() => new Set());
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [deletingFiles, setDeletingFiles] = useState(false);
  const [deleteFeedback, setDeleteFeedback] = useState('');

  const [actionToast, setActionToast] = useState('');

  const flashNotice = (msg) => {
    setActionToast(msg);
    setTimeout(() => setActionToast((cur) => (cur === msg ? '' : cur)), 4500);
  };

  const fetchThermal = useCallback(async () => {
    if (!isNative) {
      setThermal({
        batteryPct: deviceInfo?.batteryPct ?? null,
        batteryCharging: deviceInfo?.isCharging ?? false,
        batteryTempC: deviceInfo?.batteryTempC ?? null,
        batteryVoltageMv: deviceInfo?.batteryVoltageMv ?? null,
        batteryCurrentMa: deviceInfo?.batteryCurrentMa ?? null,
        ramAvailMb: deviceInfo?.ramAvailGb != null ? Math.round(deviceInfo.ramAvailGb * 1024) : null,
        ramUsedPct: deviceInfo?.ramUsedPct ?? null,
        thermalStatus: 'Nominal',
        appCacheKb: 0,
      });
      return;
    }
    try {
      const snap = await Maintenance.getThermalSnapshot();
      setThermal(snap);
      if (snap?.batteryTempC != null) {
        latestTempRef.current = snap.batteryTempC;
      }
    } catch (err) {
      console.warn('[Maintenance] getThermalSnapshot error:', err);
    }
  }, [isNative, deviceInfo]);

  const refreshPermissionsAndApps = useCallback(async () => {
    if (!isNative) return;
    try {
      const p = await Maintenance.getPermissionStatus();
      const nextPerms = {
        hasUsageStats: Boolean(p?.hasUsageStats),
        hasAllFilesAccess: Boolean(p?.hasAllFilesAccess),
      };
      setPerms(nextPerms);

      if (nextPerms.hasUsageStats) {
        setLoadingApps(true);
        try {
          const res = await Maintenance.getTopActiveApps();
          setTopApps(Array.isArray(res?.apps) ? res.apps : []);
        } catch {
          setTopApps([]);
        } finally {
          setLoadingApps(false);
        }
      } else {
        setTopApps([]);
      }
    } catch (err) {
      console.warn('[Maintenance] getPermissionStatus error:', err);
    }
  }, [isNative]);

  useEffect(() => {
    fetchThermal();
    refreshPermissionsAndApps();

    const pollId = setInterval(fetchThermal, 2000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        fetchThermal();
        refreshPermissionsAndApps();
      }
    };
    const onFocus = () => {
      fetchThermal();
      refreshPermissionsAndApps();
    };

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);

    return () => {
      clearInterval(pollId);
      if (coolingTimerRef.current) clearInterval(coolingTimerRef.current);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [fetchThermal, refreshPermissionsAndApps]);

  const stopCoolingSession = () => {
    if (coolingTimerRef.current) {
      clearInterval(coolingTimerRef.current);
      coolingTimerRef.current = null;
    }
    setCoolingActive(false);
  };

  const startCoolingSession = () => {
    stopCoolingSession();
    const startTemp = thermal?.batteryTempC ?? latestTempRef.current ?? null;
    setCoolingStartTemp(startTemp);
    setCoolingReport(null);
    setCoolingSecondsLeft(60);
    setCoolingActive(true);

    let remaining = 60;
    coolingTimerRef.current = setInterval(() => {
      remaining -= 1;
      setCoolingSecondsLeft(remaining);

      if (remaining <= 0) {
        stopCoolingSession();
        const endTemp = latestTempRef.current ?? thermal?.batteryTempC ?? startTemp;
        const delta =
          startTemp != null && endTemp != null
            ? +(endTemp - startTemp).toFixed(1)
            : null;

        const summary = {
          startTemp,
          endTemp,
          delta,
          thermalStatus: thermal?.thermalStatus || 'Nominal',
        };
        setCoolingReport(summary);
        flashNotice('Sesión de enfriamiento completada (guardado en nube desactivado por defecto).');
      }
    }, 1000);
  };

  const handleClearInternalCache = async () => {
    if (!isNative || cacheClearing) return;
    setCacheClearing(true);
    setCacheMessage('');
    try {
      const res = await Maintenance.clearAppInternalCache();
      const kb = res?.freedKb ?? 0;
      const mb = res?.freedMb ?? 0;
      const text =
        kb >= 1024
          ? `Caché interna de IndiServ limpiada: ${mb.toFixed(2)} MB liberados.`
          : `Caché interna de IndiServ limpiada: ${kb} KB liberados.`;
      setCacheMessage(text);
      fetchThermal();
    } catch {
      setCacheMessage('No se pudo limpiar la caché interna.');
    } finally {
      setCacheClearing(false);
    }
  };

  const handleOpenSystemStorage = async () => {
    if (!isNative) return;
    try {
      await Maintenance.openSystemStorageCleanup();
    } catch {
      flashNotice('No se pudo abrir la pantalla de almacenamiento del sistema.');
    }
  };

  const handleOpenBatterySettings = async () => {
    if (!isNative) return;
    try {
      await Maintenance.openBatterySettings();
    } catch {
      flashNotice('No se pudieron abrir los ajustes de batería.');
    }
  };

  const handleOpenAppDetails = async (packageName) => {
    if (!isNative || !packageName) return;
    try {
      await Maintenance.openAppDetailsSettings({ packageName });
    } catch {
      flashNotice('No se pudo abrir la ficha de la aplicación.');
    }
  };

  const handleScanFiles = async () => {
    if (!isNative || scanningFiles) return;
    setScanningFiles(true);
    setDeleteFeedback('');
    setSelectedPaths(new Set());
    try {
      const res = await Maintenance.scanJunkAndLargeFiles({ minLargeMb });
      if (res?.permissionRequired) {
        setPerms((prev) => ({ ...prev, hasAllFilesAccess: false }));
        setScanResult(null);
      } else {
        setScanResult(res);
      }
    } catch {
      flashNotice('Error al escanear carpetas de usuario.');
    } finally {
      setScanningFiles(false);
    }
  };

  const toggleSelectPath = (path) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const groupedItems = useMemo(() => {
    const items = scanResult?.items || [];
    const groups = {
      'APK Antiguo': [],
      'Temporal / Log': [],
      'Archivo Grande': [],
    };
    for (const item of items) {
      if (groups[item.category]) {
        groups[item.category].push(item);
      } else {
        groups['Archivo Grande'].push(item);
      }
    }
    return groups;
  }, [scanResult]);

  const selectedSummary = useMemo(() => {
    const items = scanResult?.items || [];
    let totalMb = 0;
    let count = 0;
    for (const it of items) {
      if (selectedPaths.has(it.path)) {
        totalMb += Number(it.sizeMb) || 0;
        count += 1;
      }
    }
    return { count, totalMb: +totalMb.toFixed(2) };
  }, [scanResult, selectedPaths]);

  const handleConfirmDelete = async () => {
    if (!isNative || deletingFiles || selectedPaths.size === 0) return;
    setDeletingFiles(true);
    setShowConfirmDelete(false);
    try {
      const pathsArr = Array.from(selectedPaths);
      const res = await Maintenance.deleteSelectedFiles({ paths: pathsArr });
      const deletedCount = res?.deletedCount ?? 0;
      const freedMb = res?.freedMb ?? 0;

      setDeleteFeedback(`✔ Eliminados ${deletedCount} archivo(s) seleccionados (${freedMb.toFixed(2)} MB liberados).`);
      setSelectedPaths(new Set());

      await handleScanFiles();
    } catch {
      setDeleteFeedback('No se pudieron eliminar los archivos seleccionados.');
    } finally {
      setDeletingFiles(false);
    }
  };

  const thermalColor =
    thermal?.thermalStatus === 'Crítico' || thermal?.thermalStatus === 'Severo'
      ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
      : thermal?.thermalStatus === 'Moderado' || (thermal?.batteryTempC != null && thermal.batteryTempC >= 39)
      ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
      : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';

  return (
    <div className="h-full w-full overflow-y-auto bg-[#0b0f19] text-zinc-100 p-4 md:p-5 lg:p-6 pb-28 md:pb-24">
      <div className="max-w-2xl md:max-w-none xl:max-w-[1440px] mx-auto space-y-4">

        <div className="bg-[#131c2e] border border-slate-800 rounded-2xl p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center shrink-0">
              <Snowflake className="w-5 h-5 text-cyan-400" />
            </div>
            <div className="min-w-0">
              <span className="text-[10px] uppercase tracking-widest text-cyan-400 font-semibold">
                Control Térmico &amp; Mantenimiento Real
              </span>
              <h2 className="text-base font-bold text-white truncate">
                Enfriamiento y Optimización Android
              </h2>
              <p className="text-[11px] text-slate-400 truncate">
                Lecturas reales del sistema · Cero métricas simuladas
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              fetchThermal();
              refreshPermissionsAndApps();
            }}
            className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-400 transition-colors shrink-0"
            title="Actualizar sensores y permisos"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {!isNative && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3.5 text-xs text-amber-200 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <strong className="text-amber-100">Modo Web (Vercel):</strong> las APIs nativas de Android
              (sensores térmicos cada 2 s, estadísticas de uso y escáner de descargas) se ejecutan
              únicamente dentro del APK <code>IndiServ_Analytica.apk</code>.
            </div>
          </div>
        )}

        {actionToast && (
          <div className="bg-emerald-500/15 border border-emerald-500/35 rounded-xl px-3.5 py-2.5 text-xs text-emerald-200 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{actionToast}</span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <div className="lg:col-span-6 bg-[#131c2e] border border-slate-800 rounded-2xl p-4 space-y-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Thermometer className="w-4 h-4 text-cyan-400" />
              <h3 className="text-sm font-semibold text-white">Monitor Térmico en Vivo (Nivel 1)</h3>
            </div>
            <span className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-full border ${thermalColor}`}>
              Térmica: {thermal?.thermalStatus || 'Nominal'}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="bg-[#0b0f19] border border-slate-800 rounded-xl p-2.5">
              <span className="text-[9px] uppercase text-slate-500 block">Temperatura</span>
              <span
                className={`text-base font-bold font-mono ${
                  thermal?.batteryTempC != null && thermal.batteryTempC >= 40
                    ? 'text-rose-400'
                    : thermal?.batteryTempC != null && thermal.batteryTempC >= 37
                    ? 'text-amber-300'
                    : 'text-emerald-400'
                }`}
              >
                {thermal?.batteryTempC != null ? `${thermal.batteryTempC}°C` : 'N/D'}
              </span>
            </div>
            <div className="bg-[#0b0f19] border border-slate-800 rounded-xl p-2.5">
              <span className="text-[9px] uppercase text-slate-500 block">Corriente</span>
              <span className="text-sm font-bold font-mono text-white inline-flex items-center gap-1 mt-0.5">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                {thermal?.batteryCurrentMa != null ? `${Math.abs(thermal.batteryCurrentMa)} mA` : 'N/D'}
              </span>
            </div>
            <div className="bg-[#0b0f19] border border-slate-800 rounded-xl p-2.5">
              <span className="text-[9px] uppercase text-slate-500 block">RAM Libre</span>
              <span className="text-sm font-bold font-mono text-white inline-flex items-center gap-1 mt-0.5">
                <MemoryStick className="w-3.5 h-3.5 text-emerald-400" />
                {thermal?.ramAvailMb != null ? `${(thermal.ramAvailMb / 1024).toFixed(1)} GB` : 'N/D'}
              </span>
            </div>
            <div className="bg-[#0b0f19] border border-slate-800 rounded-xl p-2.5">
              <span className="text-[9px] uppercase text-slate-500 block">Uso RAM</span>
              <span className="text-sm font-bold font-mono text-slate-200 block mt-0.5">
                {thermal?.ramUsedPct != null ? `${thermal.ramUsedPct}%` : 'N/D'}
              </span>
            </div>
          </div>

          <div className="bg-[#0b0f19] border border-slate-800/90 rounded-xl p-3 space-y-1.5 text-[11px] text-slate-300">
            <p className="font-semibold text-cyan-300 flex items-center gap-1.5">
              <Flame className="w-3.5 h-3.5" /> Acciones reales para disipar calor
            </p>
            <ul className="space-y-1 text-slate-400 list-disc pl-4">
              {thermal?.batteryCharging && thermal?.batteryTempC != null && thermal.batteryTempC >= 38 && (
                <li className="text-amber-300">
                  Estás cargando a {thermal.batteryTempC}°C: desconecta el cargador rápido unos minutos para cortar el calor de la celda.
                </li>
              )}
              <li>Baja el brillo de pantalla por debajo del 50% y cambia de 120 Hz a 60 Hz si el equipo supera 39°C.</li>
              <li>Retira fundas gruesas y evita juegos 3D o cámara 4K durante la sesión de reposo térmico.</li>
            </ul>
          </div>

          {!coolingActive ? (
            <button
              onClick={startCoolingSession}
              disabled={!isNative}
              className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-all disabled:opacity-40"
            >
              <Snowflake className="w-4 h-4" />
              Iniciar Sesión de Enfriamiento Guiado (60 s)
            </button>
          ) : (
            <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-xl p-3.5 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-cyan-200 flex items-center gap-1.5">
                  <Clock className="w-4 h-4 animate-pulse" /> Monitoreando enfriamiento real…
                </span>
                <span className="font-mono font-bold text-white">{coolingSecondsLeft}s</span>
              </div>
              <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-all duration-500"
                  style={{ width: `${((60 - coolingSecondsLeft) / 60) * 100}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-300 font-mono">
                <span>Inicio: {coolingStartTemp != null ? `${coolingStartTemp}°C` : 'N/D'}</span>
                <span>Actual: {thermal?.batteryTempC != null ? `${thermal.batteryTempC}°C` : 'N/D'}</span>
                <button
                  onClick={stopCoolingSession}
                  className="text-rose-300 hover:text-rose-200 underline font-sans"
                >
                  Detener
                </button>
              </div>
            </div>
          )}

          {coolingReport && (
            <div className="bg-emerald-500/10 border border-emerald-500/25 rounded-xl p-3 text-xs text-emerald-200">
              <strong>Resultado real (60 s):</strong>{' '}
              {coolingReport.startTemp != null && coolingReport.endTemp != null
                ? `${coolingReport.startTemp}°C → ${coolingReport.endTemp}°C (Δ ${
                    coolingReport.delta > 0 ? `+${coolingReport.delta}` : coolingReport.delta
                  }°C).`
                : `Estado térmico final: ${coolingReport.thermalStatus}.`}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              onClick={handleOpenBatterySettings}
              disabled={!isNative}
              className="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-40"
            >
              <Settings className="w-3.5 h-3.5 text-amber-400" /> Ajustes de Batería
            </button>
            <button
              onClick={handleOpenSystemStorage}
              disabled={!isNative}
              className="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-40"
            >
              <HardDrive className="w-3.5 h-3.5 text-cyan-400" /> Caché del Sistema Android
            </button>
          </div>
        </div>

        <div className="lg:col-span-6 space-y-4">
        <div className="bg-[#131c2e] border border-slate-800 rounded-2xl p-4 space-y-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AppWindow className="w-4 h-4 text-violet-400" />
              <h3 className="text-sm font-semibold text-white">Caché Propia &amp; Apps Activas (24 h)</h3>
            </div>
            <span className="text-[10px] font-mono text-slate-400">
              Caché IndiServ: {thermal?.appCacheKb != null ? `${thermal.appCacheKb} KB` : 'N/D'}
            </span>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={handleClearInternalCache}
              disabled={!isNative || cacheClearing}
              className="flex-1 py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-40"
            >
              <Trash2 className="w-3.5 h-3.5 text-emerald-400" />
              {cacheClearing ? 'Limpiando…' : 'Limpiar Caché Interna de IndiServ'}
            </button>
          </div>

          {cacheMessage && (
            <p className="text-[11px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
              {cacheMessage}
            </p>
          )}

          <div className="border-t border-slate-800 pt-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-violet-400" /> Auditoría de Apps que Más Consumen (Nivel 2)
              </span>
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                  perms.hasUsageStats
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                {perms.hasUsageStats ? 'Permiso activo' : 'Requiere permiso'}
              </span>
            </div>

            {!perms.hasUsageStats ? (
              <div className="bg-[#0b0f19] border border-slate-800 rounded-xl p-3 space-y-2.5">
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Para mostrar qué aplicaciones consumen más tiempo de pantalla y energía en las últimas 24 horas,
                  Android exige activar manualmente el permiso <strong className="text-slate-200">Acceso a datos de uso</strong> en Ajustes.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => isNative && Maintenance.requestUsageStatsPermission().catch(() => {})}
                    disabled={!isNative}
                    className="px-3.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-40"
                  >
                    <Lock className="w-3.5 h-3.5" /> Activar Permiso de Uso
                  </button>
                  <button
                    onClick={refreshPermissionsAndApps}
                    disabled={!isNative}
                    className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium disabled:opacity-40"
                  >
                    Verificar de nuevo
                  </button>
                </div>
              </div>
            ) : loadingApps ? (
              <p className="text-xs text-slate-400 py-3 text-center">Consultando UsageStatsManager…</p>
            ) : topApps.length === 0 ? (
              <p className="text-xs text-slate-400 py-3 text-center">
                Sin aplicaciones de usuario con más de 1 minuto de uso en las últimas 24 h.
              </p>
            ) : (
              <div className="space-y-1.5">
                {topApps.map((app) => (
                  <div
                    key={app.packageName}
                    className="bg-[#0b0f19] border border-slate-800/90 rounded-xl px-3 py-2.5 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white truncate">{app.appName}</p>
                      <p className="text-[10px] text-slate-400 font-mono truncate">
                        {formatMinutes(app.foregroundMinutes)} en primer plano · {app.packageName}
                      </p>
                    </div>
                    <button
                      onClick={() => handleOpenAppDetails(app.packageName)}
                      className="shrink-0 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 text-[10px] font-semibold flex items-center gap-1"
                    >
                      Restringir / Detener <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="bg-[#131c2e] border border-slate-800 rounded-2xl p-4 space-y-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FolderSearch className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-semibold text-white">Escáner de Descargas &amp; APKs (Nivel 2)</h3>
            </div>
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                perms.hasAllFilesAccess
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              {perms.hasAllFilesAccess ? 'Acceso concedido' : 'Requiere permiso'}
            </span>
          </div>

          {!perms.hasAllFilesAccess ? (
            <div className="bg-[#0b0f19] border border-slate-800 rounded-xl p-3 space-y-2.5">
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Para detectar instaladores <code>.apk</code> antiguos, archivos temporales y archivos grandes en
                <strong className="text-slate-200"> Descargas y Documentos</strong> (nunca tocamos tus fotos de{' '}
                <code>DCIM/Camera</code> ni carpetas de sistema), activa el acceso de archivos en Ajustes.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => isNative && Maintenance.requestAllFilesPermission().catch(() => {})}
                  disabled={!isNative}
                  className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-40"
                >
                  <Lock className="w-3.5 h-3.5" /> Activar Acceso a Archivos
                </button>
                <button
                  onClick={refreshPermissionsAndApps}
                  disabled={!isNative}
                  className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium disabled:opacity-40"
                >
                  Verificar de nuevo
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <span>Archivo grande ≥</span>
                  {[50, 100, 250].map((mb) => (
                    <button
                      key={mb}
                      onClick={() => setMinLargeMb(mb)}
                      className={`px-2 py-1 rounded-lg font-mono text-[10px] border transition-colors ${
                        minLargeMb === mb
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                          : 'bg-slate-900 text-slate-400 border-slate-800'
                      }`}
                    >
                      {mb} MB
                    </button>
                  ))}
                </div>
                <button
                  onClick={handleScanFiles}
                  disabled={scanningFiles}
                  className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  <FolderSearch className={`w-3.5 h-3.5 ${scanningFiles ? 'animate-pulse' : ''}`} />
                  {scanningFiles ? 'Escaneando…' : 'Escanear Descargas'}
                </button>
              </div>

              {deleteFeedback && (
                <p className="text-[11px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 rounded-lg px-3 py-2">
                  {deleteFeedback}
                </p>
              )}

              {scanResult && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-[11px] text-slate-400 bg-[#0b0f19] border border-slate-800 rounded-xl px-3 py-2">
                    <span>
                      Analizados: <strong className="text-white">{scanResult.totalScannedFiles}</strong> archivos en Download/Documents
                    </span>
                    <span className="font-mono text-amber-300">
                      {scanResult.totalReclaimableMb} MB detectados
                    </span>
                  </div>

                  {(scanResult.items || []).length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-4">
                      No se encontraron APKs antiguos, temporales ni archivos ≥ {minLargeMb} MB en Download/Documents.
                    </p>
                  ) : (
                    <>
                      {Object.entries(groupedItems).map(([cat, list]) =>
                        list.length === 0 ? null : (
                          <div key={cat} className="space-y-1.5">
                            <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold px-1">
                              {cat} ({list.length})
                            </p>
                            {list.map((file) => {
                              const checked = selectedPaths.has(file.path);
                              return (
                                <label
                                  key={file.path}
                                  className={`flex items-center justify-between gap-2.5 px-3 py-2 rounded-xl border cursor-pointer transition-colors ${
                                    checked
                                      ? 'bg-rose-500/10 border-rose-500/35'
                                      : 'bg-[#0b0f19] border-slate-800/90 hover:border-slate-700'
                                  }`}
                                >
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => toggleSelectPath(file.path)}
                                      className="accent-rose-500 w-4 h-4 rounded shrink-0"
                                    />
                                    <div className="min-w-0">
                                      <p className="text-xs font-medium text-white truncate">{file.name}</p>
                                      <p className="text-[10px] text-slate-500 font-mono truncate">
                                        {formatDateShort(file.lastModified)} · {file.path}
                                      </p>
                                    </div>
                                  </div>
                                  <span className="shrink-0 text-[11px] font-mono font-semibold text-amber-300">
                                    {file.sizeMb} MB
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        )
                      )}

                      <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-2">
                        <span className="text-xs text-slate-300">
                          Seleccionados: <strong>{selectedSummary.count}</strong> ({selectedSummary.totalMb} MB)
                        </span>
                        <button
                          onClick={() => setShowConfirmDelete(true)}
                          disabled={selectedSummary.count === 0 || deletingFiles}
                          className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-40"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          {deletingFiles ? 'Eliminando…' : 'Eliminar Seleccionados'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        </div>
        </div>
      </div>

      {showConfirmDelete && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-[#131c2e] border border-rose-500/35 rounded-2xl p-5 space-y-4 shadow-2xl">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 text-rose-400">
                <AlertTriangle className="w-5 h-5" />
                <h3 className="text-sm font-bold text-white">Confirmar Eliminación</h3>
              </div>
              <button
                onClick={() => setShowConfirmDelete(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Se eliminarán permanentemente{' '}
              <strong className="text-white">{selectedSummary.count} archivo(s)</strong> seleccionados en
              Descargas/Documentos, liberando aproximadamente{' '}
              <strong className="text-emerald-400">{selectedSummary.totalMb} MB</strong>. Esta acción no se
              puede deshacer.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowConfirmDelete(false)}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold"
              >
                Sí, Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
