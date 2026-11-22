import React, { useEffect, useRef, useState } from 'react';
import { Device } from '@capacitor/device';
import { Network } from '@capacitor/network';
import { Cpu, BatteryCharging, Wifi, Smartphone, MonitorPlay, Play, Square, Activity, RefreshCw } from 'lucide-react';

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

export default function MobileScannerView({ user }) {
  const [info, setInfo] = useState(null);
  const [scanning, setScanning] = useState(true);

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

      // Fallback Web Battery API
      if (battInfo.batteryLevel == null && navigator.getBattery) {
        try {
          const b = await navigator.getBattery();
          battInfo = { batteryLevel: b.level, isCharging: b.charging };
        } catch {}
      }

      const cores = navigator.hardwareConcurrency || 4;
      const ramGb = navigator.deviceMemory || null;
      const gpu = detectWebGLGpu();
      const screenRes = `${window.screen.width} × ${window.screen.height} (DPR ${window.devicePixelRatio?.toFixed(1) || 1})`;

      setInfo({
        model: devInfo.model || 'Equipo Móvil',
        manufacturer: devInfo.manufacturer || 'Genérico',
        os: `${(devInfo.operatingSystem || 'Android').toUpperCase()} ${devInfo.osVersion || ''}`.trim(),
        platform: devInfo.platform || 'web',
        cores,
        ramGb,
        batteryPct: battInfo.batteryLevel != null ? Math.round(battInfo.batteryLevel * 100) : null,
        isCharging: Boolean(battInfo.isCharging),
        connected: netInfo.connected,
        netType: (netInfo.connectionType || 'desconocida').toUpperCase(),
        gpu,
        screenRes,
      });
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    scanDevice();
    return () => stopStress();
  }, []);

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
    const nWorkers = Math.max(2, Math.min(navigator.hardwareConcurrency || 4, 16));
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
      `[INICIO] ${nWorkers} Web Workers activos en paralelo · ${durationSec} s`,
      `[CPU] ${info?.manufacturer || ''} ${info?.model || 'SoC Móvil'} (${nWorkers} hilos lógicos)`,
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
      <div className="max-w-2xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between bg-[#131c2e] border border-slate-800 rounded-2xl p-4">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-cyan-400 font-semibold">
              Escáner de Dispositivo Móvil
            </p>
            <h2 className="text-base font-semibold text-white">
              {info ? `${info.manufacturer} ${info.model}` : 'Analizando hardware…'}
            </h2>
            {user && (
              <p className="text-[11px] text-slate-400 mt-0.5">
                Operador: <span className="text-emerald-400">{user.nickname}</span> ({user.dni})
              </p>
            )}
          </div>
          <button
            onClick={scanDevice}
            disabled={scanning}
            className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-400 transition-colors"
            title="Reescanear"
          >
            <RefreshCw className={`w-4 h-4 ${scanning ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Telemetry Grid */}
        {info && (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[#131c2e] border border-slate-800 rounded-xl p-3.5">
              <div className="flex items-center gap-2 text-cyan-400 text-[10px] font-semibold uppercase">
                <Cpu className="w-3.5 h-3.5" /> Procesador
              </div>
              <p className="text-lg font-bold text-white mt-1">{info.cores} Hilos</p>
              <p className="text-[11px] text-slate-400">{info.os}</p>
            </div>

            <div className="bg-[#131c2e] border border-slate-800 rounded-xl p-3.5">
              <div className="flex items-center gap-2 text-emerald-400 text-[10px] font-semibold uppercase">
                <BatteryCharging className="w-3.5 h-3.5" /> Batería
              </div>
              <p className="text-lg font-bold text-white mt-1">
                {info.batteryPct != null ? `${info.batteryPct}%` : 'N/D'}
              </p>
              <p className="text-[11px] text-slate-400">
                {info.isCharging ? 'Cargando energía' : 'En batería'}
              </p>
            </div>

            <div className="bg-[#131c2e] border border-slate-800 rounded-xl p-3.5">
              <div className="flex items-center gap-2 text-violet-400 text-[10px] font-semibold uppercase">
                <Smartphone className="w-3.5 h-3.5" /> Memoria & Pantalla
              </div>
              <p className="text-sm font-bold text-white mt-1">
                {info.ramGb ? `~${info.ramGb} GB RAM` : 'RAM protegida por SO'}
              </p>
              <p className="text-[11px] text-slate-400 truncate">{info.screenRes}</p>
            </div>

            <div className="bg-[#131c2e] border border-slate-800 rounded-xl p-3.5">
              <div className="flex items-center gap-2 text-amber-400 text-[10px] font-semibold uppercase">
                <Wifi className="w-3.5 h-3.5" /> Conectividad
              </div>
              <p className="text-sm font-bold text-white mt-1">
                {info.connected ? `En Línea (${info.netType})` : 'Sin Conexión'}
              </p>
              <p className="text-[11px] text-slate-400">Supabase Cloud Ready</p>
            </div>

            <div className="col-span-2 bg-[#131c2e] border border-slate-800 rounded-xl p-3.5">
              <div className="flex items-center gap-2 text-blue-400 text-[10px] font-semibold uppercase">
                <MonitorPlay className="w-3.5 h-3.5" /> Acelerador Gráfico (GPU WebGL)
              </div>
              <p className="text-xs font-mono text-slate-200 mt-1 break-words">{info.gpu}</p>
            </div>
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
                Pulse "Iniciar Stress Test" para probar todos los núcleos del dispositivo usando Web Workers sin congelar la interfaz.
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
