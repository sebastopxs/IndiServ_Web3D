/**
 * TechSidebar.jsx — Panel técnico de inspección de componentes, especificaciones y diagnóstico en el visor 3D.
 */

import React from 'react';
import {
  Cpu, HardDrive, MemoryStick, MonitorPlay, Server, Zap, Wrench,
  CheckCircle2, AlertTriangle, ShieldCheck, Activity, ChevronRight,
} from 'lucide-react';

const ICON_MAP = {
  'Procesador/Refrigeración': { icon: Cpu,         color: 'text-cyan-400' },
  'Tarjeta Gráfica':          { icon: MonitorPlay,  color: 'text-violet-400' },
  'Memoria RAM':              { icon: MemoryStick,  color: 'text-emerald-400' },
  'Almacenamiento':           { icon: HardDrive,    color: 'text-amber-400' },
  'Placa Base':               { icon: Server,       color: 'text-blue-400' },
  'Fuente de Poder':          { icon: Zap,          color: 'text-yellow-400' },
};

function StatusDot({ ok }) {
  return (
    <span className={`inline-block w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-amber-500'}`} />
  );
}

export default function TechSidebar({ selectedComponent, ticketData, onCloseComponent }) {

  if (!ticketData) {
    return (
      <aside className="w-full md:w-[390px] shrink-0 h-[44vh] md:h-full bg-[#101521]/95 backdrop-blur-xl border-t md:border-t-0 md:border-l border-slate-800/80 p-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-slate-800/70 rounded-lg w-2/3" />
          <div className="h-28 bg-slate-800/50 rounded-xl" />
          <div className="h-40 bg-slate-800/50 rounded-xl" />
        </div>
      </aside>
    );
  }

  const components = ticketData.components || {};
  const healthScore = ticketData.health_score !== undefined && ticketData.health_score !== null
    ? ticketData.health_score
    : 100;
  const isOptimal = healthScore >= 80;

  const checks = [];
  if (ticketData.diagnostico) {
    checks.push({
      ok: isOptimal,
      label: `Diagnóstico: ${ticketData.diagnostico}`,
    });
  }
  if (ticketData.ram) {
    const isRamWarning = ticketData.diagnostico?.toLowerCase().includes('ram') || ticketData.diagnostico?.toLowerCase().includes('memoria');
    checks.push({
      ok: !isRamWarning,
      label: isRamWarning ? 'Alerta detectada en memoria RAM' : 'Memoria RAM: Estado íntegro',
    });
  }
  if (ticketData.cpu) {
    const isCpuWarning = ticketData.diagnostico?.toLowerCase().includes('cpu') || ticketData.diagnostico?.toLowerCase().includes('termal') || ticketData.diagnostico?.toLowerCase().includes('temperatura');
    checks.push({
      ok: !isCpuWarning,
      label: isCpuWarning ? 'Alerta térmica o de rendimiento en CPU' : 'Procesador: Parámetros dentro de norma',
    });
  }
  if (ticketData.almacenamiento) {
    const isStorageWarning = ticketData.diagnostico?.toLowerCase().includes('disco') || ticketData.diagnostico?.toLowerCase().includes('almacenamiento') || ticketData.diagnostico?.toLowerCase().includes('saturado');
    checks.push({
      ok: !isStorageWarning,
      label: isStorageWarning ? 'Almacenamiento: Capacidad o salud crítica' : 'Almacenamiento: Unidades verificadas',
    });
  }
  if (checks.length === 0) {
    checks.push({ ok: true, label: 'Auditoría completada sin alertas críticas' });
  }

  return (
    <aside className="w-full md:w-[396px] shrink-0 h-[46vh] md:h-full bg-[#101521]/95 backdrop-blur-xl border-t md:border-t-0 md:border-l border-slate-800/80 flex flex-col overflow-hidden relative z-10 select-none pb-16 md:pb-0 shadow-[inset_1px_0_0_rgba(255,255,255,0.03)]">

      <div className="flex-1 overflow-y-auto px-5 md:px-6 pt-5 md:pt-6 pb-10 space-y-5">

        <header className="pb-4 border-b border-slate-800/80">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[15px] font-semibold font-mono text-slate-100 tracking-tight truncate max-w-[230px]">
              {ticketData.id_ticket || ticketData.ticket_id || 'TICKET-ACTIVO'}
            </h2>
            <span className="text-[10px] font-medium tracking-wide text-emerald-300 bg-emerald-500/12 border border-emerald-500/25 px-2.5 py-0.5 rounded-full shrink-0">
              Registro Auditado
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Auditoría de Hardware · {ticketData.scan_date || 'En tiempo real'}
          </p>
        </header>

        {!selectedComponent ? (

          <>

            <div className="instrument-card rounded-2xl p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[11px] text-slate-400 font-medium mb-1">Índice de Salud</p>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-3xl font-bold font-mono tabular-nums text-white">{healthScore}</span>
                    <span className="text-sm text-slate-500 font-medium">/100</span>
                  </div>
                </div>
                <span className={`inline-flex items-center gap-1.5 text-[10px] font-medium px-2.5 py-1 rounded-full border ${
                  isOptimal
                    ? 'text-emerald-300 bg-emerald-500/12 border-emerald-500/25'
                    : 'text-amber-300 bg-amber-500/12 border-amber-500/25'
                }`}>
                  {isOptimal ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                  {isOptimal ? 'Certificación Óptima' : 'Requiere Atención'}
                </span>
              </div>
            </div>

            <div className="space-y-2.5">
              <h3 className="text-[11px] text-slate-400 font-semibold">Configuración Base Detectada</h3>
              <div className="instrument-card rounded-2xl p-4 space-y-3">
                {ticketData.cpu && (
                  <div>
                    <span className="text-[9px] uppercase tracking-wider text-cyan-400/80 font-semibold block">Procesador (CPU)</span>
                    <p className="text-xs font-medium text-zinc-200 mt-0.5 leading-snug">{ticketData.cpu}</p>
                  </div>
                )}
                {ticketData.ram && (
                  <div className="border-t border-white/[0.04] pt-2.5">
                    <span className="text-[9px] uppercase tracking-wider text-emerald-400/80 font-semibold block">Memoria RAM</span>
                    <p className="text-xs font-medium text-zinc-200 mt-0.5 leading-snug">{ticketData.ram}</p>
                  </div>
                )}
                {ticketData.gpu && (
                  <div className="border-t border-white/[0.04] pt-2.5">
                    <span className="text-[9px] uppercase tracking-wider text-violet-400/80 font-semibold block">Tarjeta Gráfica (GPU)</span>
                    <p className="text-xs font-medium text-zinc-200 mt-0.5 leading-snug">{ticketData.gpu}</p>
                  </div>
                )}
                {ticketData.almacenamiento && (
                  <div className="border-t border-white/[0.04] pt-2.5">
                    <span className="text-[9px] uppercase tracking-wider text-amber-400/80 font-semibold block">Almacenamiento</span>
                    <p className="text-xs font-medium text-zinc-200 mt-0.5 leading-snug">{ticketData.almacenamiento}</p>
                  </div>
                )}
                {ticketData.placa_base && (
                  <div className="border-t border-white/[0.04] pt-2.5">
                    <span className="text-[9px] uppercase tracking-wider text-blue-400/80 font-semibold block">Placa Base</span>
                    <p className="text-xs font-medium text-zinc-200 mt-0.5 leading-snug">{ticketData.placa_base}</p>
                  </div>
                )}
                {ticketData.refrigeracion && (
                  <div className="border-t border-white/[0.04] pt-2.5">
                    <span className="text-[9px] uppercase tracking-wider text-teal-400/80 font-semibold block">Refrigeración</span>
                    <p className="text-xs font-medium text-zinc-200 mt-0.5 leading-snug">{ticketData.refrigeracion}</p>
                  </div>
                )}
              </div>
            </div>

            {ticketData.diagnostico && (
              <div className="space-y-3">
                <h3 className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-amber-400" /> Dictamen del Diagnóstico
                </h3>
                <div className="bg-amber-500/[0.05] border border-amber-500/20 rounded-xl p-4 space-y-3">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[10px] text-amber-400 font-semibold uppercase tracking-wider">Hallazgo Principal</p>
                      <p className="text-xs text-zinc-200 mt-0.5 leading-relaxed font-medium">{ticketData.diagnostico}</p>
                    </div>
                  </div>

                  {ticketData.solucion && (
                    <div className="border-t border-amber-500/15 pt-2.5">
                      <p className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wider flex items-center gap-1 mb-1">
                        <CheckCircle2 className="w-3 h-3" /> Guía de Solución Paso a Paso:
                      </p>
                      <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-line pl-1">{ticketData.solucion}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-3">
              <h3 className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" /> Puntos de Auditoría
              </h3>
              <div className="space-y-1.5">
                {checks.map((c, i) => (
                  <div key={i} className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg border text-xs leading-snug ${
                    c.ok
                      ? 'bg-emerald-500/[0.04] border-emerald-500/10 text-emerald-300/90'
                      : 'bg-amber-500/[0.04] border-amber-500/10 text-amber-300/90'
                  }`}>
                    <StatusDot ok={c.ok} />
                    <span>{c.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2 pt-2">
              <h3 className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold">
                Componentes Auditados (Clic para Inspeccionar)
              </h3>
              {Object.keys(components).map((cat) => {
                const entry = ICON_MAP[cat] || { icon: Wrench, color: 'text-zinc-400' };
                const Icon = entry.icon;
                const compData = components[cat] || {};
                return (
                  <button
                    key={cat}
                    onClick={() => onCloseComponent?.({ category: cat, nodeName: cat, data: compData }, 'select')}
                    className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg border border-white/[0.04] bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/[0.1] transition-all group text-left"
                  >
                    <Icon className={`w-4 h-4 ${entry.color} shrink-0`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-zinc-200 truncate">{cat}</div>
                      <div className="text-[10px] text-zinc-500 truncate mt-0.5">{compData.specs || 'Detectado'}</div>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-300 transition-colors shrink-0" />
                  </button>
                );
              })}
            </div>
          </>
        ) : (

          <>
            <button
              onClick={() => onCloseComponent(null, 'close')}
              className="group flex items-center gap-1.5 text-[11px] font-medium text-zinc-400 hover:text-white transition-colors"
            >
              <span className="group-hover:-translate-x-0.5 transition-transform">&larr;</span> Volver al resumen
            </button>

            <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5 space-y-5">

              <div className="flex items-start gap-3 pb-4 border-b border-white/[0.06]">
                {(() => {
                  const entry = ICON_MAP[selectedComponent.category] || { icon: Wrench, color: 'text-zinc-400' };
                  const Icon = entry.icon;
                  return <Icon className={`w-5 h-5 ${entry.color} mt-0.5 shrink-0`} />;
                })()}
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-white">{selectedComponent.category}</h3>
                  <p className="text-[10px] text-zinc-500 font-mono mt-0.5 truncate">Nodo 3D: {selectedComponent.nodeName}</p>
                </div>
              </div>

              <div>
                <h4 className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold mb-2">Especificaciones Técnicas</h4>
                <p className="text-xs text-zinc-200 leading-relaxed font-medium bg-white/[0.02] p-3 rounded-lg border border-white/[0.04]">
                  {selectedComponent.data?.specs || 'Sin datos registrados para esta pieza.'}
                </p>
              </div>

              <div className="bg-white/[0.02] border border-white/[0.05] rounded-lg p-4">
                <h4 className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold mb-2 flex items-center gap-1.5">
                  <Activity className="w-3 h-3 text-cyan-400" /> Dictamen de Auditoría
                </h4>
                <p className="text-xs text-zinc-300 leading-relaxed">
                  {selectedComponent.data?.diagnostic || 'No se registraron anomalías en este componente.'}
                </p>
              </div>

              <div className="bg-emerald-500/[0.04] border border-emerald-500/10 rounded-lg p-4">
                <h4 className="text-[10px] text-emerald-400/90 uppercase tracking-widest font-semibold mb-2 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3 h-3" /> Recomendación Técnica
                </h4>
                <p className="text-xs text-emerald-200/90 leading-relaxed whitespace-pre-line">
                  {selectedComponent.data?.recommendation || 'Sin acciones correctivas requeridas.'}
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
