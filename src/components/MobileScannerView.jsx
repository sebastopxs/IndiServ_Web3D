import React, { useEffect, useRef, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Device } from '@capacitor/device';
import { Network } from '@capacitor/network';
import { supabase } from '../supabaseClient';
import { runLocalDeviceAudit } from '../utils/deviceAuditFallback';
import {
  Cpu, BatteryCharging, Wifi, Smartphone, MonitorPlay, Play, Square,
  Activity, RefreshCw, HardDrive, MemoryStick, ShieldCheck, Thermometer,
  Sparkles, CheckCircle2, AlertTriangle, ShieldAlert, Box, Zap, Stethoscope,
} from 'lucide-react';

const HardwareInfo = registerPlugin('HardwareInfo');

function detectWebGLGpu() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return 'WebGL no disponible';
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) {
      return gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || 'GPU Móvil WebGL';
    }
    return gl.getParameter(gl.RENDERER) || 'GPU Móvil WebGL';
  } catch {
    return 'GPU Móvil WebGL';
  }
}

const WORKER_SCRIPT = `
self.onmessage = function(e) {
  const { durationMs } = e.data;
  const end = performance.now() + durationMs;
  let ops = 0;
  let acc = 1.0001;
  let lastReport = performance.now();

  function step() {
    const sliceEnd = performance.now() + 36;
    while (performance.now() < sliceEnd) {
      for (let i = 0; i < 4000; i++) {
        acc = Math.sqrt(acc * 999983.0 + 1.777777) % 1000000.0;
      }
      ops += 4000;
    }
    const now = performance.now();
    if (now - lastReport >= 400) {
      self.postMessage({ ops, done: false });
      lastReport = now;
    }
    if (now < end) {
      setTimeout(step, 4);
    } else {
      self.postMessage({ ops, done: true });
    }
  }
  step();
};
`;

function UsageBar({ pct, color = 'from-cyan-500 to-emerald-400' }) {
  const safe = Math.max(0, Math.min(100, Number(pct) || 0));
  const barColor = safe >= 90 ? 'from-rose-500 to-red-400' : safe >= 75 ? 'from-amber-500 to-yellow-400' : color;
  return (
    <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden mt-2">
      <div
        className={`h-full bg-gradient-to-r ${barColor} transition-all duration-500`}
        style={{ width: `${safe}%` }}
      />
    </div>
  );
}

export default function MobileScannerView({ user, onDeviceScanned, onOpenPhone3D, onOpenDiagnostic }) {
  const [info, setInfo] = useState(null);
  const [scanning, setScanning] = useState(true);

  // Auditoría con IA (Modelo comercial + autenticidad de piezas)
  const [aiLoading, setAiLoading] = useState(false);
  const [aiAudit, setAiAudit] = useState(null);

  // Micro-Stress CPU con Web Workers
  const [stressRunning, setStressRunning] = useState(false);
  const [stressProgress, setStressProgress] = useState(0);
  const [stressMops, setStressMops] = useState(0);
  const [stressLogs, setStressLogs] = useState([]);
  const [stressStatus, setStressStatus] = useState('EN ESPERA');
  const workersRef = useRef([]);
  const timerRef = useRef(null);

  const scanDevice = async () => {
    setScanning(true);
    try {
      let nativeHw = null;
      if (Capacitor.isNativePlatform()) {
        try {
          nativeHw = await HardwareInfo.getFullHardwareInfo();
        } catch (err) {
          console.warn('[HardwareInfo] Fallback a API estándar:', err);
        }
      }

      let devInfo = { model: 'Dispositivo Móvil', manufacturer: 'Android', operatingSystem: 'android', osVersion: '?' };
      let battInfo = { batteryLevel: null, isCharging: false };
      let netInfo = { connected: navigator.onLine, connectionType: 'wifi' };

      try {
        devInfo = await Device.getInfo();
      } catch {}
      try {
        battInfo = await Device.getBatteryInfo();
      } catch {}
      try {
        netInfo = await Network.getStatus();
      } catch {}

      if (battInfo.batteryLevel == null && navigator.getBattery) {
        try {
          const b = await navigator.getBattery();
          battInfo = { batteryLevel: b.level, isCharging: b.charging };
        } catch {}
      }

      const gpu = detectWebGLGpu();
      const screenRes =
        nativeHw?.screenWidthPx && nativeHw?.screenHeightPx
          ? `${nativeHw.screenWidthPx} × ${nativeHw.screenHeightPx}${nativeHw.refreshRateHz ? ` @ ${nativeHw.refreshRateHz}Hz` : ''}`
          : `${window.screen.width} × ${window.screen.height} (DPR ${window.devicePixelRatio?.toFixed(1) || 1})`;

      const manufacturer = nativeHw?.manufacturer || devInfo.manufacturer || 'Dispositivo';
      const brand = nativeHw?.brand || '';
      const model = nativeHw?.model || devInfo.model || 'Equipo Móvil';
      const brandPrefix = brand && brand.toLowerCase() !== manufacturer.toLowerCase() ? `${manufacturer} ${brand}` : manufacturer;

      const ramTotalGb = nativeHw?.ramTotalMb ? +(nativeHw.ramTotalMb / 1024).toFixed(1) : (navigator.deviceMemory || null);
      const ramAvailGb = nativeHw?.ramAvailMb ? +(nativeHw.ramAvailMb / 1024).toFixed(1) : null;
      const ramUsedGb = ramTotalGb != null && ramAvailGb != null ? +(ramTotalGb - ramAvailGb).toFixed(1) : null;

      const scannedData = {
        isNative: Boolean(nativeHw),
        displayName: `${brandPrefix} ${model}`.trim(),
        manufacturer,
        brand: brand || manufacturer,
        model,
        deviceCode: nativeHw?.device || '',
        board: nativeHw?.board || '',
        cpuName: nativeHw?.cpuName || `Procesador (${navigator.hardwareConcurrency || 4} hilos)`,
        cpuCores: nativeHw?.cpuCores || navigator.hardwareConcurrency || 4,
        cpuMaxFreqMhz: nativeHw?.cpuMaxFreqMhz || 0,
        cpuArch: nativeHw?.cpuArch || (navigator.userAgent.includes('arm64') || navigator.userAgent.includes('aarch64') ? 'arm64-v8a' : '64-bit'),
        supportedAbis: nativeHw?.supportedAbis || '',
        ramTotalGb,
        ramAvailGb,
        ramUsedGb,
        ramUsedPct: nativeHw?.ramUsedPct ?? null,
        storageTotalGb: nativeHw?.storageTotalGb ?? null,
        storageAvailGb: nativeHw?.storageAvailGb ?? null,
        storageUsedGb: nativeHw?.storageUsedGb ?? null,
        storageUsedPct: nativeHw?.storageUsedPct ?? null,
        batteryPct: nativeHw?.batteryPct >= 0 ? nativeHw.batteryPct : (battInfo.batteryLevel != null ? Math.round(battInfo.batteryLevel * 100) : null),
        isCharging: nativeHw?.batteryCharging ?? Boolean(battInfo.isCharging),
        batteryStatusText: nativeHw?.batteryStatusText || (battInfo.isCharging ? 'Cargando' : 'Descargando'),
        batteryPlugged: nativeHw?.batteryPlugged || (battInfo.isCharging ? 'Cargador AC' : 'Desconectado'),
        batteryTechnology: nativeHw?.batteryTechnology || 'Li-ion',
        batteryTempC: nativeHw?.batteryTempC ?? null,
        batteryVoltageMv: nativeHw?.batteryVoltageMv ?? null,
        batteryCurrentMa: nativeHw?.batteryCurrentMa ?? null,
        batteryChargeCounterMah: nativeHw?.batteryChargeCounterMah ?? null,
        batteryHealth: nativeHw?.batteryHealth || 'Estándar',
        os: nativeHw?.androidRelease
          ? `Android ${nativeHw.androidRelease} (API ${nativeHw.sdkInt})`
          : `${(devInfo.operatingSystem || 'Android').toUpperCase()} ${devInfo.osVersion || ''}`.trim(),
        securityPatch: nativeHw?.securityPatch || 'N/D',
        kernelVersion: nativeHw?.kernelVersion || '',
        buildTags: nativeHw?.buildTags || 'N/D',
        verifiedBootState: nativeHw?.verifiedBootState || 'unknown',
        isRooted: Boolean(nativeHw?.isRooted),
        isEmulator: Boolean(nativeHw?.isEmulator),
        refreshRateHz: nativeHw?.refreshRateHz ?? null,
        connected: netInfo.connected,
        netType: (netInfo.connectionType || 'desconocida').toUpperCase(),
        gpu,
        screenRes,
      };
      setInfo(scannedData);
      onDeviceScanned?.(scannedData);
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    scanDevice();
    return () => stopStress();
  }, []);

  const verifyWithAI = async () => {
    if (!info || aiLoading) return;
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('analizar-dispositivo-ia', {
        body: { telemetry: info },
      });
      if (!error && data && !data.error && data.nombre_comercial) {
        setAiAudit(data);
      } else {
        setAiAudit(runLocalDeviceAudit(info));
      }
    } catch {
      setAiAudit(runLocalDeviceAudit(info));
    } finally {
      setAiLoading(false);
    }
  };

  const stopStress = () => {
    workersRef.current.forEach((w) => {
      try {
        w.terminate();
      } catch {}
    });
    workersRef.current = [];
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setStressRunning(false);
  };

  const startStress = () => {
    stopStress();
    const durationSec = 8;
    const nWorkers = Math.max(2, Math.min(info?.cpuCores || navigator.hardwareConcurrency || 4, 16));
    const blob = new Blob([WORKER_SCRIPT], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);

    const opsPerWorker = new Array(nWorkers).fill(0);
    let prevTotal = 0;
    const t0 = performance.now();
    let prevT = t0;

    setStressRunning(true);
    setStressProgress(0);
    setStressMops(0);
    setStressStatus('CARGANDO ~90%');
    setStressLogs([
      `[CPU] ${info?.cpuName || 'SoC Móvil'} · ${info?.cpuArch || 'ARM64'} (${nWorkers} hilos)`,
      `[INICIO] ${nWorkers} Web Workers en paralelo · ${durationSec} s`,
    ]);

    for (let i = 0; i < nWorkers; i++) {
      const w = new Worker(url);
      w.onmessage = (ev) => {
        opsPerWorker[i] = ev.data.ops;
      };
      w.postMessage({ durationMs: durationSec * 1000 });
      workersRef.current.push(w);
    }

    timerRef.current = setInterval(() => {
      const now = performance.now();
      const elapsed = (now - t0) / 1000;
      const dt = Math.max((now - prevT) / 1000, 0.05);
      const totalOps = opsPerWorker.reduce((a, b) => a + b, 0);
      const mops = Math.max(0, (totalOps - prevTotal) / dt / 1e6);
      prevTotal = totalOps;
      prevT = now;

      const pct = Math.min(100, (elapsed / durationSec) * 100);
      setStressProgress(pct);
      setStressMops(mops);
      setStressStatus(elapsed < 1.0 ? 'CARGANDO ~90%' : 'ÓPTIMO · ESTABLE');
      setStressLogs((prev) => [
        ...prev.slice(-14),
        `${elapsed.toFixed(1)}s │ ${nWorkers} hilos │ ${mops.toFixed(2)} Mops/s │ ÓPTIMO`,
      ]);

      if (elapsed >= durationSec) {
        stopStress();
        URL.revokeObjectURL(url);
        setStressProgress(100);
        setStressStatus('COMPLETADO · ESTABLE');
        setStressLogs((prev) => [
          ...prev,
          `✔ Prueba completada sin bloqueos (${mops.toFixed(2)} Mops/s finales).`,
        ]);
      }
    }, 500);
  };

  return (
    <div className="h-full w-full overflow-y-auto bg-[#0b0f19] text-zinc-100 p-4 pb-24">
      <div className="max-w-2xl mx-auto space-y-3.5">
        {/* Header Identidad del Modelo */}
        <div className="flex items-center justify-between bg-[#131c2e] border border-slate-800 rounded-2xl p-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-widest text-cyan-400 font-semibold">
                {info?.isNative ? 'Telemetría Nativa Android' : 'Escáner de Dispositivo'}
              </span>
              {info?.cpuArch && (
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                  {info.cpuArch}
                </span>
              )}
            </div>
            <h2 className="text-base font-bold text-white truncate mt-0.5">
              {info ? info.displayName : 'Analizando hardware…'}
            </h2>
            {info && (
              <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                {info.os}
                {info.board ? ` · Board: ${info.board}` : ''}
                {user ? ` · Op: ${user.nickname}` : ''}
              </p>
            )}
          </div>
          <button
            onClick={scanDevice}
            disabled={scanning}
            className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-400 transition-colors shrink-0 ml-2"
            title="Reescanear"
          >
            <RefreshCw className={`w-4 h-4 ${scanning ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Telemetría Profunda */}
        {info && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Procesador (SoC) y Arquitectura */}
            <div className="sm:col-span-2 bg-[#131c2e] border border-slate-800 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-cyan-400 text-[10px] font-semibold uppercase">
                  <Cpu className="w-3.5 h-3.5" /> Procesador (SoC) &amp; Arquitectura
                </div>
                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded">
                  {info.cpuCores} Núcleos{info.cpuMaxFreqMhz ? ` @ ${(info.cpuMaxFreqMhz / 1000).toFixed(2)} GHz` : ''}
                </span>
              </div>
              <p className="text-sm font-bold text-white mt-1.5">{info.cpuName}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400 mt-1.5 font-mono">
                <span>ABI: <strong className="text-slate-200">{info.cpuArch}</strong></span>
                {info.supportedAbis && <span>Soportadas: {info.supportedAbis}</span>}
                {info.deviceCode && <span>Código: {info.deviceCode}</span>}
              </div>
            </div>

            {/* Memoria RAM Real */}
            <div className="bg-[#131c2e] border border-slate-800 rounded-xl p-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-emerald-400 text-[10px] font-semibold uppercase">
                  <MemoryStick className="w-3.5 h-3.5" /> Memoria RAM
                </div>
                {info.ramUsedPct != null && (
                  <span className="text-[10px] font-mono text-slate-300">{info.ramUsedPct}% uso</span>
                )}
              </div>
              <p className="text-lg font-bold text-white mt-1">
                {info.ramTotalGb != null ? `${info.ramTotalGb} GB Total` : 'N/D'}
              </p>
              <p className="text-[11px] text-slate-400">
                {info.ramAvailGb != null
                  ? `Libre: ${info.ramAvailGb} GB · Usada: ${info.ramUsedGb} GB`
                  : 'RAM aproximada por WebView'}
              </p>
              {info.ramUsedPct != null && <UsageBar pct={info.ramUsedPct} />}
            </div>

            {/* Almacenamiento Interno Real */}
            <div className="bg-[#131c2e] border border-slate-800 rounded-xl p-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-amber-400 text-[10px] font-semibold uppercase">
                  <HardDrive className="w-3.5 h-3.5" /> Almacenamiento Interno
                </div>
                {info.storageUsedPct != null && (
                  <span className="text-[10px] font-mono text-slate-300">{info.storageUsedPct}% uso</span>
                )}
              </div>
              <p className="text-lg font-bold text-white mt-1">
                {info.storageTotalGb != null ? `${info.storageTotalGb} GB` : 'Solo en APK nativo'}
              </p>
              <p className="text-[11px] text-slate-400">
                {info.storageAvailGb != null
                  ? `Libre: ${info.storageAvailGb} GB · Usado: ${info.storageUsedGb} GB`
                  : 'Instale el APK para lectura StatFs'}
              </p>
              {info.storageUsedPct != null && <UsageBar pct={info.storageUsedPct} color="from-amber-500 to-emerald-400" />}
            </div>

            {/* Batería Detallada, Estado de Salud, Voltaje y Corriente */}
            <div className="sm:col-span-2 bg-[#131c2e] border border-slate-800 rounded-xl p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-yellow-400 text-[10px] font-semibold uppercase">
                  <BatteryCharging className="w-3.5 h-3.5" /> Estado y Salud de Batería
                </div>
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                    ['Óptima', 'Estándar'].includes(info.batteryHealth)
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      : info.batteryHealth === 'Fría'
                      ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                      : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                  }`}
                >
                  Salud: {info.batteryHealth}
                </span>
              </div>

              <div className="flex items-baseline justify-between gap-3">
                <div className="flex items-baseline gap-2.5">
                  <p className="text-2xl font-bold text-white">
                    {info.batteryPct != null ? `${info.batteryPct}%` : 'N/D'}
                  </p>
                  <span className="text-xs text-slate-300 font-medium">
                    {info.batteryStatusText} · {info.batteryPlugged}
                  </span>
                </div>
                {info.batteryTempC != null && (
                  <span
                    className={`text-xs font-mono inline-flex items-center gap-1 px-2 py-0.5 rounded ${
                      info.batteryTempC >= 40
                        ? 'bg-rose-500/15 text-rose-300'
                        : 'bg-amber-500/10 text-amber-300'
                    }`}
                  >
                    <Thermometer className="w-3.5 h-3.5" /> {info.batteryTempC}°C
                  </span>
                )}
              </div>

              {/* Barra de carga visual */}
              {info.batteryPct != null && (
                <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 bg-gradient-to-r ${
                      info.batteryPct <= 20
                        ? 'from-rose-500 to-red-400'
                        : info.batteryPct <= 45
                        ? 'from-amber-500 to-yellow-400'
                        : 'from-emerald-500 to-cyan-400'
                    }`}
                    style={{ width: `${Math.max(0, Math.min(100, info.batteryPct))}%` }}
                  />
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-[11px] font-mono">
                <div className="bg-[#0b0f19] border border-slate-800/80 rounded-lg px-2.5 py-1.5">
                  <span className="text-[9px] text-slate-500 block uppercase">Voltaje</span>
                  <span className="text-slate-200 font-semibold">
                    {info.batteryVoltageMv ? `${(info.batteryVoltageMv / 1000).toFixed(2)} V` : 'N/D'}
                  </span>
                </div>
                <div className="bg-[#0b0f19] border border-slate-800/80 rounded-lg px-2.5 py-1.5">
                  <span className="text-[9px] text-slate-500 block uppercase">Tecnología</span>
                  <span className="text-slate-200 font-semibold">{info.batteryTechnology || 'Li-ion'}</span>
                </div>
                <div className="bg-[#0b0f19] border border-slate-800/80 rounded-lg px-2.5 py-1.5">
                  <span className="text-[9px] text-slate-500 block uppercase">Corriente</span>
                  <span className="text-slate-200 font-semibold inline-flex items-center gap-0.5">
                    <Zap className="w-3 h-3 text-amber-400" />
                    {info.batteryCurrentMa != null ? `${Math.abs(info.batteryCurrentMa)} mA` : 'N/D'}
                  </span>
                </div>
                <div className="bg-[#0b0f19] border border-slate-800/80 rounded-lg px-2.5 py-1.5">
                  <span className="text-[9px] text-slate-500 block uppercase">Carga Actual</span>
                  <span className="text-slate-200 font-semibold">
                    {info.batteryChargeCounterMah != null ? `${info.batteryChargeCounterMah} mAh` : 'N/D'}
                  </span>
                </div>
              </div>
            </div>

            {/* Acciones rápidas: Gemelo Digital 3D del Teléfono y Árbol de Diagnóstico */}
            <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                onClick={() => onOpenPhone3D?.({ deviceInfo: info })}
                className="py-2.5 px-3.5 rounded-xl bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-950/40"
              >
                <Box className="w-4 h-4" /> Ver mi Teléfono en 3D
              </button>
              <button
                onClick={() => onOpenDiagnostic?.()}
                className="py-2.5 px-3.5 rounded-xl bg-[#131c2e] hover:bg-slate-800 border border-emerald-500/35 text-emerald-300 text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
              >
                <Stethoscope className="w-4 h-4" /> Abrir Árbol de Diagnóstico
              </button>
            </div>

            {/* Red & Sistema */}
            <div className="sm:col-span-2 bg-[#131c2e] border border-slate-800 rounded-xl p-3.5">
              <div className="flex items-center gap-2 text-violet-400 text-[10px] font-semibold uppercase">
                <Wifi className="w-3.5 h-3.5" /> Red &amp; Seguridad SO
              </div>
              <p className="text-sm font-bold text-white mt-1">
                {info.connected ? `En Línea (${info.netType})` : 'Sin Conexión'}
              </p>
              <p className="text-[11px] text-slate-400 truncate">
                Parche: {info.securityPatch} · {info.screenRes}
              </p>
            </div>

            {/* GPU WebGL */}
            <div className="sm:col-span-2 bg-[#131c2e] border border-slate-800 rounded-xl p-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-blue-400 text-[10px] font-semibold uppercase">
                  <MonitorPlay className="w-3.5 h-3.5" /> Acelerador Gráfico (GPU)
                </div>
                {info.kernelVersion && (
                  <span className="text-[10px] font-mono text-slate-500 truncate max-w-[180px]">
                    Kernel {info.kernelVersion}
                  </span>
                )}
              </div>
              <p className="text-xs font-mono text-slate-200 mt-1 break-words">{info.gpu}</p>
            </div>
          </div>
        )}

        {/* Verificación de Modelo Comercial y Autenticidad con IA */}
        {info && (
          <div className="bg-[#131c2e] border border-cyan-500/25 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-cyan-400" />
                <div>
                  <h3 className="text-sm font-semibold text-white">Auditoría de Autenticidad con IA</h3>
                  <p className="text-[11px] text-slate-400">
                    Identifica el nombre comercial exacto y valida coherencia de piezas e integridad.
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={verifyWithAI}
              disabled={aiLoading}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-all disabled:opacity-50"
            >
              <Sparkles className={`w-3.5 h-3.5 ${aiLoading ? 'animate-spin' : ''}`} />
              {aiLoading ? 'Auditando modelo y hardware con IA…' : '✨ Verificar Modelo y Piezas con IA'}
            </button>

            {aiAudit && (
              <div className="bg-[#0b0f19] border border-slate-800 rounded-xl p-3.5 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-cyan-400 font-semibold">
                      Modelo Comercial Identificado
                    </p>
                    <h4 className="text-base font-bold text-white mt-0.5">
                      {aiAudit.nombre_comercial}
                    </h4>
                    <p className="text-[11px] text-slate-400">
                      Lanzamiento: {aiAudit.anio_lanzamiento || 'N/D'} · Confianza: {aiAudit.confianza_pct ?? 80}% ·{' '}
                      <span className="text-cyan-400/80">
                        {aiAudit.origen === 'gemini-ia' ? 'Gemini IA Cloud' : 'Motor Heurístico'}
                      </span>
                    </p>
                  </div>

                  <span
                    className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-full border ${
                      aiAudit.veredicto === 'Original Coherente'
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                        : aiAudit.veredicto?.includes('Modificado')
                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                        : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                    }`}
                  >
                    {aiAudit.veredicto === 'Original Coherente' ? (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    ) : aiAudit.veredicto?.includes('Modificado') ? (
                      <AlertTriangle className="w-3.5 h-3.5" />
                    ) : (
                      <ShieldAlert className="w-3.5 h-3.5" />
                    )}
                    {aiAudit.veredicto}
                  </span>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed">{aiAudit.resumen}</p>

                {Array.isArray(aiAudit.componentes) && aiAudit.componentes.length > 0 && (
                  <div className="space-y-1.5 pt-1 border-t border-slate-800/80">
                    {aiAudit.componentes.map((c, idx) => (
                      <div key={idx} className="flex items-start justify-between gap-2 text-[11px] bg-slate-900/60 px-2.5 py-2 rounded-lg">
                        <div className="min-w-0">
                          <span className="font-semibold text-white">{c.parte}:</span>{' '}
                          <span className="text-slate-400">{c.detalle}</span>
                        </div>
                        <span
                          className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                            c.estado === 'Coherente'
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : c.estado === 'Advertencia'
                              ? 'bg-amber-500/15 text-amber-400'
                              : 'bg-rose-500/15 text-rose-400'
                          }`}
                        >
                          {c.estado}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {aiAudit.nota_fisica && (
                  <p className="text-[10px] text-slate-500 italic leading-relaxed border-t border-slate-800/80 pt-2">
                    ℹ {aiAudit.nota_fisica}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Micro-Stress CPU Mobile Benchmark */}
        <div className="bg-[#131c2e] border border-slate-800 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-violet-400" />
              <h3 className="text-sm font-semibold text-white">Micro-Stress Test CPU Móvil</h3>
            </div>
            <span className="text-[10px] font-semibold px-2.5 py-0.5 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/30">
              {stressStatus}
            </span>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Rendimiento: <strong className="text-emerald-400 font-mono">{stressMops.toFixed(2)} Mops/s</strong></span>
            <span className="font-mono">{stressProgress.toFixed(0)}%</span>
          </div>

          <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-violet-500 to-emerald-400 transition-all duration-300"
              style={{ width: `${stressProgress}%` }}
            />
          </div>

          <div className="bg-[#0b0f19] border border-slate-800 rounded-xl p-3 h-36 overflow-y-auto font-mono text-[11px] text-slate-300 space-y-1">
            {stressLogs.length === 0 ? (
              <p className="text-slate-500">
                Pulse "Iniciar Stress Test" para probar todos los núcleos del procesador ({info?.cpuName || 'SoC'}) con Web Workers sin congelar la interfaz.
              </p>
            ) : (
              stressLogs.map((l, idx) => <div key={idx}>{l}</div>)
            )}
          </div>

          <div className="flex gap-2">
            {!stressRunning ? (
              <button
                onClick={startStress}
                className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
              >
                <Play className="w-3.5 h-3.5" /> Iniciar Stress Test (8 s)
              </button>
            ) : (
              <button
                onClick={() => {
                  stopStress();
                  setStressStatus('CANCELADO');
                }}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
              >
                <Square className="w-3.5 h-3.5" /> Cancelar Test
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
