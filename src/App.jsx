import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Capacitor } from '@capacitor/core';
import ChassisScene from './components/ChassisScene';
import TechSidebar from './components/TechSidebar';
import MobileAuthView from './components/MobileAuthView';
import MobileScannerView from './components/MobileScannerView';
import MobileDiagnosticView from './components/MobileDiagnosticView';
import TicketLookupBar from './components/TicketLookupBar';
import { mapTelemetryTo3DProfile } from './utils/hardwareMapper';
import { supabase } from './supabaseClient';
import {
  RotateCcw, Maximize2, Minimize2, EyeOff, Eye, FileDown, Laptop, Monitor,
  Box, Search, Smartphone, LogOut, Stethoscope,
} from 'lucide-react';

/* ═══════════════════════════════════════════
   Fallback Mock Data (solo cuando NO hay ticket en URL)
   ═══════════════════════════════════════════ */
const FALLBACK = {
  id_ticket: 'TKT-DEMO-OFFLINE',
  ticket_id: 'TKT-DEMO-OFFLINE',
  scan_date: '04/10/2026',
  system_status: 'Certificación Óptima',
  health_score: 95,
  cpu: 'Procesador Demo (8-Core)',
  ram: '16 GB DDR4 @ 3200 MHz',
  gpu: 'Gráficos Dedicados 8 GB',
  almacenamiento: 'SSD 512 GB NVMe',
  placa_base: 'Placa Base ATX Estándar',
  refrigeracion: 'Cooler Torre de Aire',
  diagnostico: 'Modo Offline: No se proporcionó ningún ticket en la URL (?ticket=...).',
  solucion: 'Proporcione un ID de ticket válido generado por IndiServ Analytica para cargar la telemetría en vivo.',
  base_specs: 'Equipo Demo para inspección visual 3D fuera de línea',
  components: {
    'Placa Base': {
      specs: 'Placa Base ATX Genérica',
      diagnostic: 'Modo demostración fuera de línea.',
      recommendation: 'Conectar a Supabase mediante ticket válido.',
    },
    'Procesador/Refrigeración': {
      specs: 'Procesador Demo 8 Núcleos',
      cooler_type: 'Cooler Torre',
      diagnostic: 'Parámetros simulados.',
      recommendation: 'Sin acciones requeridas en demo.',
    },
    'Memoria RAM': {
      specs: '16 GB DDR4',
      populated_slots: 2,
      diagnostic: 'Configuración simulada.',
      recommendation: 'Sin acciones requeridas en demo.',
    },
    'Tarjeta Gráfica': {
      specs: 'Tarjeta Gráfica Dedicada',
      diagnostic: 'Acelerador 3D estándar.',
      recommendation: 'Sin acciones requeridas en demo.',
    },
    'Almacenamiento': {
      specs: 'SSD 512 GB NVMe',
      diagnostic: 'Almacenamiento simulado.',
      recommendation: 'Sin acciones requeridas en demo.',
    },
    'Fuente de Poder': {
      specs: 'Fuente de Poder ATX',
      diagnostic: 'Suministro eléctrico nominal.',
      recommendation: 'Sin acciones requeridas en demo.',
    },
  },
};

/**
 * Normaliza la fila de Supabase ('reportes_diagnostico') a la estructura completa de telemetría
 */
function formatSupabaseTelemetry(data) {
  if (!data) return null;

  const diagText = data.diagnostico || '';
  const solText = data.solucion || '';

  const isAffected = (keywords) => {
    const text = (diagText + ' ' + solText).toLowerCase();
    return keywords.some((kw) => text.includes(kw));
  };

  const components = {
    'Procesador/Refrigeración': {
      specs: data.cpu || 'CPU no registrada',
      cooler_type: data.refrigeracion || 'Refrigeración estándar',
      diagnostic: isAffected(['cpu', 'procesador', 'temperatura', 'termal', 'cooler', 'calor', 'ventilador', 'throttling'])
        ? diagText
        : 'Frecuencia y operación térmica dentro de umbrales normales.',
      recommendation: isAffected(['cpu', 'procesador', 'temperatura', 'termal', 'cooler', 'calor', 'ventilador', 'throttling'])
        ? solText
        : 'Sin anomalías térmicas ni de frecuencia detectadas.',
    },
    'Tarjeta Gráfica': {
      specs: data.gpu || 'GPU no registrada',
      diagnostic: isAffected(['gpu', 'gráfica', 'grafica', 'video', 'vram', 'artefacto', 'pantalla negra', 'driver'])
        ? diagText
        : 'Controlador y aceleración de gráficos operativa sin fallas.',
      recommendation: isAffected(['gpu', 'gráfica', 'grafica', 'video', 'vram', 'artefacto', 'pantalla negra', 'driver'])
        ? solText
        : 'Controladores y hardware en estado óptimo.',
    },
    'Memoria RAM': {
      specs: data.ram || 'RAM no registrada',
      populated_slots: data.specs_json?.ram?.ranuras || (data.ram?.includes('2 ranuras') ? 2 : 2),
      diagnostic: isAffected(['ram', 'memoria', 'xmp', 'expo', 'dimm', 'pantalla azul', 'bsod'])
        ? diagText
        : 'Módulos validados con integridad de memoria estable.',
      recommendation: isAffected(['ram', 'memoria', 'xmp', 'expo', 'dimm', 'pantalla azul', 'bsod'])
        ? solText
        : 'Configuración de módulos estable.',
    },
    'Placa Base': {
      specs: data.placa_base || 'Placa Base ATX',
      diagnostic: isAffected(['placa', 'motherboard', 'bios', 'post', 'cmos', 'pitido'])
        ? diagText
        : `Placa base y BIOS v${data.specs_json?.bios?.version || 'actual'} operativas.`,
      recommendation: isAffected(['placa', 'motherboard', 'bios', 'post', 'cmos', 'pitido'])
        ? solText
        : 'Sin fallos de comunicación en bus o firmware.',
    },
    'Almacenamiento': {
      specs: data.almacenamiento || 'Almacenamiento no registrado',
      diagnostic: isAffected(['almacenamiento', 'disco', 'ssd', 'hdd', 'nvme', 'saturado', 'chkdsk', 'smart'])
        ? diagText
        : 'Unidades de almacenamiento en línea y particiones accesibles.',
      recommendation: isAffected(['almacenamiento', 'disco', 'ssd', 'hdd', 'nvme', 'saturado', 'chkdsk', 'smart'])
        ? solText
        : 'Capacidad y estado de salud dentro de los límites.',
    },
    'Fuente de Poder': {
      specs: 'Fuente de Poder (PSU)',
      diagnostic: isAffected(['fuente', 'psu', 'poder', 'energia', 'voltaje', 'apagado', 'reinic'])
        ? diagText
        : 'Suministro eléctrico dentro de tolerancias estándar.',
      recommendation: isAffected(['fuente', 'psu', 'poder', 'energia', 'voltaje', 'apagado', 'reinic'])
        ? solText
        : 'Entrega de voltaje y energía estable.',
    },
  };

  const scanDate = data.fecha_creacion
    ? new Date(data.fecha_creacion).toLocaleDateString('es-ES', { year: 'numeric', month: '2-digit', day: '2-digit' })
    : new Date().toLocaleDateString();

  const baseSpecs = [data.cpu, data.ram, data.gpu, data.almacenamiento].filter(Boolean).join(' · ');

  return {
    id_ticket: data.id_ticket,
    ticket_id: data.id_ticket,
    scan_date: scanDate,
    system_status: (data.health_score ?? 100) >= 80 ? 'Certificación Óptima' : 'Requiere Atención',
    base_specs: baseSpecs || 'Telemetría completa de hardware',
    cpu: data.cpu,
    ram: data.ram,
    gpu: data.gpu,
    almacenamiento: data.almacenamiento,
    placa_base: data.placa_base,
    refrigeracion: data.refrigeracion,
    health_score: data.health_score,
    diagnostico: data.diagnostico,
    solucion: data.solucion,
    specs_json: data.specs_json,
    components,
  };
}

/* ═══════════════════════════════════════════
   WebGL Error Boundary
   ═══════════════════════════════════════════ */
class CanvasErrorBoundary extends React.Component {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(err, info) { console.error('WebGL fatal:', err, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-950">
          <div className="text-center space-y-4 p-8 rounded-2xl border border-rose-500/20 bg-zinc-900/80 backdrop-blur">
            <p className="text-base font-semibold text-rose-400">WebGL Context Lost</p>
            <p className="text-xs text-zinc-400">GPU acceleration failed.</p>
            <button onClick={() => window.location.reload()} className="text-xs text-rose-300 border border-rose-500/30 rounded-lg px-5 py-2 hover:bg-rose-500/10 transition-colors">
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Memoized ChassisScene to completely decouple 3D rendering from UI state changes
const MemoizedChassisScene = React.memo(ChassisScene, (prevProps, nextProps) => {
  return prevProps.explodedView === nextProps.explodedView 
      && prevProps.telemetry === nextProps.telemetry
      && prevProps.profile === nextProps.profile;
});

/* ═══════════════════════════════════════════
   App Principal
   ═══════════════════════════════════════════ */
export default function App() {
  const isNativeApp = useMemo(() => {
    try {
      return Capacitor.isNativePlatform();
    } catch {
      return false;
    }
  }, []);

  const initialTicketParam = useMemo(
    () => new URLSearchParams(window.location.search).get('ticket')?.trim() || '',
    []
  );

  // Autenticación solo requerida al iniciar como APK nativo (enlaces públicos ?ticket= de Vercel entran directo)
  const [authUser, setAuthUser] = useState(null);
  const [guestUnlocked, setGuestUnlocked] = useState(!isNativeApp || Boolean(initialTicketParam));
  const [activeTab, setActiveTab] = useState(isNativeApp && !initialTicketParam ? 'scanner' : '3d');
  const [mobileDeviceInfo, setMobileDeviceInfo] = useState(null);

  const [telemetry, setTelemetry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isLive, setIsLive] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);
  
  // UI State
  const [selectedComponent, setSelectedComponent] = useState(null);
  const [explodedView, setExplodedView] = useState(false);
  const [showCase, setShowCase] = useState(true);
  const [resetCameraFn, setResetCameraFn] = useState(null);

  // Build 3D profile from telemetry
  const profile = useMemo(() => mapTelemetryTo3DProfile(telemetry), [telemetry]);

  const loadTicketById = useCallback(async (ticketIdRaw, tipoParam = '') => {
    const ticketParam = (ticketIdRaw || '').trim();
    setLoading(true);
    setSelectedComponent(null);

    if (!ticketParam) {
      const normalizedTipo = tipoParam === 'phone' || tipoParam === 'laptop' ? tipoParam : 'desktop';
      const fallbackData =
        normalizedTipo !== 'desktop'
          ? { ...FALLBACK, tipo_equipo: normalizedTipo, specs_json: { tipo_equipo: normalizedTipo } }
          : FALLBACK;
      setTelemetry(fallbackData);
      setIsLive(false);
      setStatusMessage('[Offline — Snapshot de respaldo cargado]');
      setLoading(false);
      return;
    }

    try {
      let { data, error } = await supabase
        .from('reportes_diagnostico')
        .select('*')
        .eq('id_ticket', ticketParam)
        .single();

      if ((error || !data) && ticketParam) {
        await new Promise((r) => setTimeout(r, 1200));
        const retry = await supabase
          .from('reportes_diagnostico')
          .select('*')
          .eq('id_ticket', ticketParam)
          .single();
        data = retry.data;
        error = retry.error;
      }

      if (error || !data) {
        setStatusMessage(`[${error ? 'Error al consultar ticket' : 'Ticket no encontrado'}]`);
        setTelemetry({ ...FALLBACK, id_ticket: ticketParam, ticket_id: ticketParam });
        setIsLive(false);
        return;
      }

      const parsed = formatSupabaseTelemetry(data);
      setTelemetry(parsed);
      setIsLive(true);
      setStatusMessage(null);
    } catch {
      setStatusMessage('[Error de conexión con base de datos]');
      setTelemetry({ ...FALLBACK, id_ticket: ticketParam, ticket_id: ticketParam });
      setIsLive(false);
    } finally {
      setLoading(false);
    }
  }, []);

  /* ── Carga inicial desde URL (?ticket=... / ?tipo=...) ── */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ticketParam = params.get('ticket')?.trim() || '';
    const tipoParam = params.get('tipo')?.trim()?.toLowerCase() || '';
    loadTicketById(ticketParam, tipoParam);
  }, [loadTicketById]);

  const handleSelectTicketFromMobile = useCallback(async (idTicket) => {
    setActiveTab('3d');
    await loadTicketById(idTicket);
  }, [loadTicketById]);

  const handleOpenPhone3D = useCallback(({
    deviceInfo,
    ticketId,
    healthScore = 92,
    diagnostico,
    solucion,
    affectedComponent = null,
  } = {}) => {
    const dev = deviceInfo || mobileDeviceInfo;
    const battText = dev?.batteryPct != null
      ? `${dev.batteryPct}% (${dev.batteryHealth || 'Estándar'}${dev.batteryTempC != null ? ` · ${dev.batteryTempC}°C` : ''}${dev.batteryVoltageMv ? ` · ${(dev.batteryVoltageMv / 1000).toFixed(2)}V` : ''})`
      : 'Batería Li-ion Smartphone';
    const cpuText = dev?.cpuName
      ? `${dev.cpuName} (${dev.cpuCores || 8} núcleos · ${dev.cpuArch || 'arm64-v8a'})`
      : 'SoC Móvil ARM64';
    const ramText = dev?.ramTotalGb
      ? `${dev.ramTotalGb} GB LPDDR (${dev.ramUsedPct ?? 0}% uso)`
      : 'RAM Móvil LPDDR';
    const storageText = dev?.storageTotalGb
      ? `${dev.storageTotalGb} GB UFS (${dev.storageAvailGb ?? '?'} GB libres)`
      : 'Almacenamiento Interno UFS';
    const gpuText = dev?.gpu || 'GPU Móvil Integrada';
    const boardText = dev?.displayName
      ? `${dev.displayName}${dev.board ? ` · Board ${dev.board}` : ''}`
      : 'Placa Lógica Smartphone';

    const diagFinal = diagnostico || `Telemetría en vivo de ${dev?.displayName || 'Smartphone Android'} (${dev?.os || 'Android'}).`;
    const solFinal = solucion || 'Hardware móvil operando dentro de parámetros nominales. Toca cada pieza del teléfono 3D para inspeccionarla.';

    const makeComp = (key, specs, defaultDiag, defaultRec) => ({
      specs,
      diagnostic: affectedComponent === key ? diagFinal : defaultDiag,
      recommendation: affectedComponent === key ? solFinal : defaultRec,
    });

    const phoneTelemetry = {
      id_ticket: ticketId || 'TEL-EN-VIVO',
      ticket_id: ticketId || 'TEL-EN-VIVO',
      scan_date: new Date().toLocaleDateString('es-ES', { year: 'numeric', month: '2-digit', day: '2-digit' }),
      system_status: healthScore >= 80 ? 'Certificación Óptima' : 'Requiere Atención',
      health_score: healthScore,
      tipo_equipo: 'phone',
      specs_json: { tipo_equipo: 'phone' },
      cpu: cpuText,
      ram: ramText,
      gpu: gpuText,
      almacenamiento: storageText,
      placa_base: boardText,
      refrigeracion: battText,
      diagnostico: diagFinal,
      solucion: solFinal,
      base_specs: `${cpuText} · ${ramText} · ${storageText}`,
      components: {
        'Procesador/Refrigeración': makeComp('Procesador/Refrigeración', cpuText, 'Frecuencia y operación del SoC móvil en rangos estables.', 'Ejecuta el Micro-Stress Test para validar estabilidad térmica.'),
        'Tarjeta Gráfica': makeComp('Tarjeta Gráfica', `${gpuText}${dev?.screenRes ? ` · ${dev.screenRes}` : ''}`, 'Acelerador gráfico móvil y pantalla operativos.', 'Mantén Android System WebView actualizado.'),
        'Memoria RAM': makeComp('Memoria RAM', ramText, 'Memoria LPDDR disponible sin presión crítica.', 'Evita apps pesadas residentes si el uso supera el 85%.'),
        'Placa Base': makeComp('Placa Base', `${boardText} · ${dev?.os || 'Android'}`, `Parche ${dev?.securityPatch || 'N/D'} · Boot: ${dev?.verifiedBootState || 'unknown'}.`, 'Usa la Auditoría IA para comprobar integridad del firmware.'),
        'Almacenamiento': makeComp('Almacenamiento', storageText, 'Partición interna accesible.', 'Mantén al menos 15% libre para preservar velocidad UFS.'),
        'Fuente de Poder': makeComp('Fuente de Poder', `${battText} · ${dev?.batteryPlugged || 'Desconectado'}`, `Tecnología ${dev?.batteryTechnology || 'Li-ion'} · Estado: ${dev?.batteryStatusText || 'En uso'}.`, 'Evita cargas frecuentes por encima de 40°C para prolongar la celda.'),
      },
    };

    setTelemetry(phoneTelemetry);
    setIsLive(true);
    setStatusMessage(null);
    setLoading(false);
    setSelectedComponent(
      affectedComponent
        ? { category: affectedComponent, nodeName: affectedComponent, data: phoneTelemetry.components[affectedComponent] }
        : null
    );
    setActiveTab('3d');
  }, [mobileDeviceInfo]);

  const handleSelect = useCallback((comp) => {
    setSelectedComponent(comp);
  }, []);

  const handleSidebarAction = useCallback((comp, action) => {
    if (action === 'close') {
      setSelectedComponent(null);
      resetCameraFn?.();
    } else if (action === 'select') {
      setSelectedComponent(comp);
    }
  }, [resetCameraFn]);

  const resetView = useCallback(() => {
    setSelectedComponent(null);
    setExplodedView(false);
    resetCameraFn?.();
  }, [resetCameraFn]);

  const currentDeviceType = profile?.tipo_equipo || 'desktop';
  const toggleDeviceType = useCallback(() => {
    setTelemetry((prev) => {
      if (!prev) return prev;
      const nextTipo =
        currentDeviceType === 'desktop'
          ? 'laptop'
          : currentDeviceType === 'laptop'
          ? 'phone'
          : 'desktop';
      return {
        ...prev,
        tipo_equipo: nextTipo,
        specs_json: { ...(prev.specs_json || {}), tipo_equipo: nextTipo },
      };
    });
  }, [currentDeviceType]);

  // Pantalla de Login/Registro en APK Android nativo (cuando aún no inicia sesión)
  if (!guestUnlocked && !authUser) {
    return (
      <MobileAuthView
        onAuthenticated={(user) => {
          setAuthUser(user);
          setActiveTab('scanner');
        }}
        onGuestDemo={() => {
          setGuestUnlocked(true);
          setActiveTab('scanner');
        }}
      />
    );
  }

  return (
    <div className="w-screen h-screen flex flex-col md:flex-row bg-zinc-950 font-sans text-zinc-100 overflow-hidden relative">
      {activeTab === 'scanner' ? (
        <div className="flex-1 overflow-hidden">
          <MobileScannerView
            user={authUser}
            onDeviceScanned={setMobileDeviceInfo}
            onOpenPhone3D={handleOpenPhone3D}
            onOpenDiagnostic={() => setActiveTab('diagnostic')}
          />
        </div>
      ) : activeTab === 'diagnostic' ? (
        <div className="flex-1 overflow-hidden">
          <MobileDiagnosticView
            deviceInfo={mobileDeviceInfo}
            user={authUser}
            onOpenPhone3D={handleOpenPhone3D}
          />
        </div>
      ) : activeTab === 'tickets' ? (
        <div className="flex-1 overflow-hidden">
          <TicketLookupBar onSelectTicket={handleSelectTicketFromMobile} />
        </div>
      ) : (
        <>
          {/* ── 3D Viewport ── */}
          <div className="flex-1 relative min-h-[48vh]">
            {loading ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 font-medium">Cargando telemetría del equipo</span>
                </div>
              </div>
            ) : (
              <CanvasErrorBoundary>
                <MemoizedChassisScene
                  profile={profile}
                  telemetry={telemetry}
                  onSelectComponent={handleSelect}
                  explodedView={explodedView}
                  registerReset={(fn) => setResetCameraFn(() => fn)}
                />
              </CanvasErrorBoundary>
            )}

            {/* ── Top bar ── */}
            <div className="absolute top-0 left-0 right-0 pointer-events-none z-10 p-3 md:p-5 flex flex-wrap items-start justify-between gap-2">
              {/* Brand & Connection Status */}
              <div className="pointer-events-auto flex items-center gap-2.5 bg-zinc-950/75 backdrop-blur-md border border-white/[0.06] rounded-xl px-3 md:px-4 py-2 md:py-3 shadow-lg">
                <div className="w-6 h-6 md:w-7 md:h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center">
                  <div className="w-2.5 h-2.5 bg-emerald-400 rounded-[3px]" />
                </div>
                <div>
                  <h1 className="text-xs md:text-sm font-semibold text-white tracking-tight leading-none">
                    IndiServ <span className="font-light text-zinc-400">Analytica</span>
                  </h1>
                  <p className="text-[8px] md:text-[9px] text-zinc-500 tracking-wider uppercase mt-0.5">
                    Gemelo Digital 3D &amp; Telemetría
                  </p>
                </div>
                {isLive ? (
                  <span className="hidden sm:flex ml-2 text-[10px] text-emerald-400 font-medium bg-emerald-500/10 border border-emerald-500/25 px-2 py-0.5 rounded items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    En Línea
                  </span>
                ) : (
                  <span className="hidden sm:inline ml-2 text-[10px] text-amber-400/90 font-medium bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded">
                    {statusMessage || '[Offline]'}
                  </span>
                )}
              </div>

              {/* Toolbar */}
              <div className="pointer-events-auto flex items-center gap-1.5 bg-zinc-950/75 backdrop-blur-md border border-white/[0.06] rounded-xl px-2 py-1.5 shadow-lg">
                <ToolbarBtn
                  icon={
                    currentDeviceType === 'phone'
                      ? Smartphone
                      : currentDeviceType === 'laptop'
                      ? Laptop
                      : Monitor
                  }
                  label={
                    currentDeviceType === 'phone'
                      ? 'Modo: Teléfono'
                      : currentDeviceType === 'laptop'
                      ? 'Modo: Laptop'
                      : 'Modo: PC'
                  }
                  active={currentDeviceType !== 'desktop'}
                  onClick={toggleDeviceType}
                />
                <div className="w-px h-5 bg-white/[0.06]" />
                <ToolbarBtn icon={RotateCcw} label="Restablecer" onClick={resetView} />
                <div className="w-px h-5 bg-white/[0.06]" />
                <ToolbarBtn icon={explodedView ? Minimize2 : Maximize2} label={explodedView ? 'Colapsar' : 'Explosión'} active={explodedView} onClick={() => { setExplodedView((v) => !v); if (!explodedView && showCase) setShowCase(false); }} />
                <ToolbarBtn icon={showCase ? EyeOff : Eye} label={showCase ? 'Sin Chasis' : 'Chasis'} onClick={() => setShowCase((v) => !v)} />
                <div className="hidden sm:block w-px h-5 bg-white/[0.06]" />
                <button onClick={() => window.print()} className="hidden sm:flex items-center gap-1.5 text-[11px] font-medium text-white bg-emerald-600/90 hover:bg-emerald-500 px-3 py-1.5 rounded-lg transition-colors">
                  <FileDown className="w-3.5 h-3.5" /> Reporte
                </button>
              </div>
            </div>
          </div>

          {/* ── Sidebar (Derecha en Desktop, Inferior en Móvil) ── */}
          <TechSidebar
            selectedComponent={selectedComponent}
            ticketData={telemetry}
            onCloseComponent={handleSidebarAction}
          />
        </>
      )}

      {/* ── Barra de Navegación Inferior (Visible en Móvil / Android App) ── */}
      {(isNativeApp || !initialTicketParam) && (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-[#0f172a]/95 backdrop-blur-xl border-t border-white/10 px-1.5 py-2 flex items-center justify-around">
          <MobileNavBtn icon={Smartphone} label="Mi Android" active={activeTab === 'scanner'} onClick={() => setActiveTab('scanner')} />
          <MobileNavBtn icon={Stethoscope} label="Diagnóstico" active={activeTab === 'diagnostic'} onClick={() => setActiveTab('diagnostic')} />
          <MobileNavBtn icon={Search} label="Tickets" active={activeTab === 'tickets'} onClick={() => setActiveTab('tickets')} />
          <MobileNavBtn
            icon={Box}
            label="Visor 3D"
            active={activeTab === '3d'}
            onClick={() => {
              if (mobileDeviceInfo && (!telemetry || telemetry.id_ticket === 'TKT-DEMO-OFFLINE')) {
                handleOpenPhone3D({ deviceInfo: mobileDeviceInfo });
              } else {
                setActiveTab('3d');
              }
            }}
          />
          {isNativeApp && (
            <MobileNavBtn
              icon={LogOut}
              label="Cuenta"
              active={false}
              onClick={() => {
                setAuthUser(null);
                setGuestUnlocked(false);
              }}
            />
          )}
        </nav>
      )}
    </div>
  );
}

function MobileNavBtn({ icon: Icon, label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg transition-colors ${
        active ? 'text-emerald-400 bg-emerald-500/10' : 'text-slate-400 hover:text-white'
      }`}
    >
      <Icon className="w-4 h-4" />
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );
}

/* Small toolbar button */
function ToolbarBtn({ icon: Icon, label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-lg transition-colors ${
        active ? 'text-emerald-300 bg-emerald-500/15' : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
      <span className="hidden xl:inline">{label}</span>
    </button>
  );
}
