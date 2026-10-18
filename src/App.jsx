import React, { useEffect, useState, useCallback, useMemo } from 'react';
import ChassisScene from './components/ChassisScene';
import TechSidebar from './components/TechSidebar';
import { mapTelemetryTo3DProfile } from './utils/hardwareMapper';
import { supabase } from './supabaseClient';
import { RotateCcw, Maximize2, Minimize2, EyeOff, Eye, FileDown } from 'lucide-react';

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
      && prevProps.telemetry === nextProps.telemetry;
});

/* ═══════════════════════════════════════════
   App Principal
   ═══════════════════════════════════════════ */
export default function App() {
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

  /* ── Consulta a Supabase con id_ticket ── */
  useEffect(() => {
    (async () => {
      // 1. Extraer el ticket de la URL limpiando espacios
      const ticketParam = new URLSearchParams(window.location.search).get('ticket')?.trim();

      if (!ticketParam) {
        console.info("Sin parámetro 'ticket' en la URL. Activando snapshot de respaldo.");
        setTelemetry(FALLBACK);
        setIsLive(false);
        setStatusMessage('[Offline — Snapshot de respaldo cargado]');
        setLoading(false);
        return;
      }

      try {
        console.log(`[Supabase] Consultando ticket: "${ticketParam}" en tabla 'reportes_diagnostico'...`);
        
        // 2. Consulta exacta a 'reportes_diagnostico' por 'id_ticket'
        const { data, error } = await supabase
          .from('reportes_diagnostico')
          .select('*')
          .eq('id_ticket', ticketParam)
          .single();

        // 3. Manejo explícito de error
        if (error) {
          console.error("Error Supabase:", error);
          setStatusMessage(`[Error: ${error.message || 'Ticket no encontrado'}]`);
          setTelemetry({ ...FALLBACK, id_ticket: ticketParam, ticket_id: ticketParam });
          setIsLive(false);
          return;
        }

        if (data) {
          console.log("[Supabase] Telemetría real recuperada:", data);
          const parsed = formatSupabaseTelemetry(data);
          setTelemetry(parsed);
          setIsLive(true);
          setStatusMessage(null);
        } else {
          console.warn("[Supabase] No se encontró fila para ticket:", ticketParam);
          setStatusMessage('[Ticket no encontrado en base de datos]');
          setTelemetry({ ...FALLBACK, id_ticket: ticketParam, ticket_id: ticketParam });
          setIsLive(false);
        }
      } catch (err) {
        console.error("Error inesperado al conectar con Supabase:", err);
        setStatusMessage('[Error de conexión con base de datos]');
        setTelemetry({ ...FALLBACK, id_ticket: ticketParam, ticket_id: ticketParam });
        setIsLive(false);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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

  return (
    <div className="w-screen h-screen flex bg-zinc-950 font-sans text-zinc-100 overflow-hidden">
      {/* ── 3D Viewport ── */}
      <div className="flex-1 relative">
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
        <div className="absolute top-0 left-0 right-0 pointer-events-none z-10 p-5 flex items-start justify-between">
          {/* Brand & Connection Status */}
          <div className="pointer-events-auto flex items-center gap-3 bg-zinc-950/70 backdrop-blur-md border border-white/[0.06] rounded-xl px-4 py-3 shadow-lg">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center">
              <div className="w-2.5 h-2.5 bg-emerald-400 rounded-[3px]" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-white tracking-tight leading-none">IndiServ <span className="font-light text-zinc-400">Analytica</span></h1>
              <p className="text-[9px] text-zinc-600 tracking-wider uppercase mt-0.5">Gemelo Digital 3D &amp; Telemetría</p>
            </div>
            {isLive ? (
              <span className="ml-3 text-[10px] text-emerald-400 font-medium bg-emerald-500/10 border border-emerald-500/25 px-2.5 py-0.5 rounded flex items-center gap-1.5 shadow-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                [En Línea — Telemetría en Vivo]
              </span>
            ) : (
              <span className="ml-3 text-[10px] text-amber-400/90 font-medium bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 rounded">
                {statusMessage || '[Offline — Snapshot de respaldo cargado]'}
              </span>
            )}
          </div>

          {/* Toolbar */}
          <div className="pointer-events-auto flex items-center gap-2 bg-zinc-950/70 backdrop-blur-md border border-white/[0.06] rounded-xl px-2 py-1.5 shadow-lg">
            <ToolbarBtn icon={RotateCcw} label="Restablecer" onClick={resetView} />
            <div className="w-px h-5 bg-white/[0.06]" />
            <ToolbarBtn icon={explodedView ? Minimize2 : Maximize2} label={explodedView ? 'Colapsar' : 'Explosión'} active={explodedView} onClick={() => { setExplodedView((v) => !v); if (!explodedView && showCase) setShowCase(false); }} />
            <ToolbarBtn icon={showCase ? EyeOff : Eye} label={showCase ? 'Sin Chasis' : 'Chasis'} onClick={() => setShowCase((v) => !v)} />
            <div className="w-px h-5 bg-white/[0.06]" />
            <button onClick={() => window.print()} className="flex items-center gap-1.5 text-[11px] font-medium text-white bg-emerald-600/90 hover:bg-emerald-500 px-3 py-1.5 rounded-lg transition-colors">
              <FileDown className="w-3.5 h-3.5" /> Reporte
            </button>
          </div>
        </div>
      </div>

      {/* ── Sidebar ── */}
      <TechSidebar
        selectedComponent={selectedComponent}
        ticketData={telemetry}
        onCloseComponent={handleSidebarAction}
      />
    </div>
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
