/**
 * TechSidebar.jsx — Reporte Global Completo del Equipo (Identidad, BIOS, SO, Licencia, Hardware, Red/Batería y Errores).
 */

import React from 'react';
import {
  Cpu, HardDrive, MemoryStick, MonitorPlay, Server, Zap, Wrench,
  CheckCircle2, AlertTriangle, ShieldCheck, Activity, ChevronRight,
  Laptop, Monitor, Smartphone, Wifi, BatteryCharging, KeyRound, FileDown, Calendar,
} from 'lucide-react';

const ICON_MAP = {
  'Procesador/Refrigeración': { icon: Cpu, color: 'text-cyan-400' },
  'Tarjeta Gráfica': { icon: MonitorPlay, color: 'text-violet-400' },
  'Memoria RAM': { icon: MemoryStick, color: 'text-emerald-400' },
  'Almacenamiento': { icon: HardDrive, color: 'text-amber-400' },
  'Placa Base': { icon: Server, color: 'text-blue-400' },
  'Fuente de Poder': { icon: Zap, color: 'text-yellow-400' },
};

function StatusDot({ ok }) {
  return (
    <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${ok ? 'bg-emerald-500' : 'bg-amber-500'}`} />
  );
}

function InfoRow({ label, value, valueClass = 'text-slate-100' }) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-white/[0.04] last:border-b-0">
      <span className="text-[11px] text-slate-400 shrink-0">{label}</span>
      <span className={`text-[11px] font-medium text-right break-words ${valueClass}`}>{value}</span>
    </div>
  );
}

function parseBoardFallback(placaBase = '') {
  const s = String(placaBase || '').trim();
  const match = s.match(/^(.*?)\s*\(Placa\s+([^)]+)\)\s*$/i);
  if (match) {
    return { modeloComercial: match[1].trim(), modeloPlaca: match[2].trim() };
  }
  return { modeloComercial: s || null, modeloPlaca: null };
}

export default function TechSidebar({ selectedComponent, ticketData, onCloseComponent }) {
  if (!ticketData) {
    return (
      <aside className="w-full md:w-[410px] shrink-0 h-[44vh] md:h-full bg-[#101521] md:bg-[#101521]/95 md:backdrop-blur-xl border-t md:border-t-0 md:border-l border-slate-800/80 p-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-slate-800/70 rounded-lg w-2/3" />
          <div className="h-28 bg-slate-800/50 rounded-xl" />
          <div className="h-40 bg-slate-800/50 rounded-xl" />
        </div>
      </aside>
    );
  }

  const specs = ticketData.specs_json && typeof ticketData.specs_json === 'object' ? ticketData.specs_json : {};
  const components = ticketData.components || {};
  const healthScore =
    ticketData.health_score !== undefined && ticketData.health_score !== null ? ticketData.health_score : 100;
  const isOptimal = healthScore >= 80;
  const isCritical = healthScore < 55;

  // Identidad global del equipo (compatible con tickets nuevos y antiguos)
  const rawTipo = String(specs.tipo_equipo || ticketData.tipo_equipo || 'desktop').toLowerCase();
  const isPhone = rawTipo === 'phone' || rawTipo === 'smartphone' || rawTipo === 'tablet' || rawTipo === 'mobile';
  const isLaptop =
    !isPhone &&
    (rawTipo === 'laptop' ||
      /laptop|lnvnb|loq|legion|tuf|victus|inspiron|thinkpad|macbook|7735hs|7435hs/i.test(
        `${ticketData.placa_base || ''} ${ticketData.cpu || ''}`
      ));
  const tipoLabel = isPhone
    ? rawTipo === 'tablet'
      ? 'Tablet Android'
      : 'Smartphone Android'
    : isLaptop
    ? 'Laptop / Portátil'
    : 'PC de Escritorio';

  const parsedBoard = parseBoardFallback(ticketData.placa_base);
  const modeloEquipo = specs.modelo_comercial || parsedBoard.modeloComercial || 'Equipo Estándar';
  const fabricantePlaca =
    specs.mb_fabricante ||
    specs.equipo_fabricante ||
    (modeloEquipo.includes(' ') ? modeloEquipo.split(' ')[0] : null);
  const modeloPlaca = specs.mb_modelo || parsedBoard.modeloPlaca || (isPhone ? specs.modelo_codigo : null);

  const bios = specs.bios && typeof specs.bios === 'object' ? specs.bios : null;
  const biosProveedor = bios?.proveedor || (bios?.version ? fabricantePlaca : null);
  const biosVersionFecha = bios?.version
    ? `${bios.version}${bios.fecha ? `  [${bios.fecha}]` : ''}`
    : null;

  // Sistema Operativo y Versión
  const soObj = specs.so && typeof specs.so === 'object' ? specs.so : null;
  const soNombre = soObj?.nombre || (typeof specs.so === 'string' ? specs.so : null);
  const soBuild = soObj?.build || null;
  const soUptime = soObj?.uptime || null;

  // Licencia Windows / Integridad Android
  const lic = soObj?.licencia && typeof soObj.licencia === 'object' ? soObj.licencia : null;
  const licText =
    lic && lic.aplicable !== false && lic.estado
      ? `${lic.estado}${lic.partial_key ? ` · ...${lic.partial_key}` : ''}`
      : null;
  const licStatusClass = lic?.sospecha_kms
    ? 'text-rose-300'
    : lic?.activa === false
    ? 'text-amber-300'
    : 'text-emerald-300';

  const integridad = specs.integridad && typeof specs.integridad === 'object' ? specs.integridad : null;
  const integridadText = integridad
    ? integridad.is_rooted
      ? 'Root Detectado · Software Modificado'
      : integridad.verified_boot === 'orange' || integridad.verified_boot === 'red'
      ? `Bootloader ${integridad.verified_boot}`
      : `Oficial · ${integridad.build_tags || 'release-keys'}`
    : null;

  // Red y Batería
  const red = specs.red && typeof specs.red === 'object' ? specs.red : null;
  const bateria = specs.bateria && typeof specs.bateria === 'object' ? specs.bateria : null;

  // Errores y alertas detectados (combinando specs_json.errores_detectados + señales en vivo)
  const detectedErrors = [];
  if (Array.isArray(specs.errores_detectados)) {
    for (const e of specs.errores_detectados) {
      if (e && e.mensaje) detectedErrors.push(e);
    }
  }
  if (lic?.sospecha_kms && !detectedErrors.some((e) => e.area === 'Licencia SO')) {
    detectedErrors.push({
      severidad: 'media',
      area: 'Licencia SO',
      mensaje: `Posible activación KMS no oficial (${lic.estado || 'KMS'}).`,
    });
  }
  if (specs.ram?.uso_pct >= 85 && !detectedErrors.some((e) => e.area === 'RAM')) {
    detectedErrors.push({
      severidad: 'alta',
      area: 'RAM',
      mensaje: `Uso alto de memoria RAM (${specs.ram.uso_pct}%).`,
    });
  }
  if (specs.cpu?.uso_total_pct >= 85 && !detectedErrors.some((e) => e.area === 'CPU')) {
    detectedErrors.push({
      severidad: 'alta',
      area: 'CPU',
      mensaje: `Carga elevada de CPU (${specs.cpu.uso_total_pct}%).`,
    });
  }
  if (Array.isArray(specs.discos?.particiones)) {
    for (const p of specs.discos.particiones) {
      const pct = Number(p.porcentaje ?? p.uso_pct ?? 0);
      if (pct >= 85 && !detectedErrors.some((e) => e.mensaje?.includes(p.punto_montaje || 'Disco'))) {
        detectedErrors.push({
          severidad: pct >= 92 ? 'critica' : 'media',
          area: 'Disco',
          mensaje: `Partición ${p.punto_montaje || ''} al ${Math.round(pct)}% de capacidad.`,
        });
      }
    }
  }

  const eventoLabel = specs.tipo_evento || 'Reporte Global';
  const DeviceIcon = isPhone ? Smartphone : isLaptop ? Laptop : Monitor;

  const checks = [];
  if (ticketData.diagnostico) {
    checks.push({ ok: isOptimal, label: `Diagnóstico: ${ticketData.diagnostico}` });
  }
  if (ticketData.ram) {
    const isRamWarning =
      (specs.ram?.uso_pct ?? 0) >= 85 ||
      ticketData.diagnostico?.toLowerCase().includes('ram') ||
      ticketData.diagnostico?.toLowerCase().includes('memoria');
    checks.push({
      ok: !isRamWarning,
      label: isRamWarning ? 'Memoria RAM: Presión o anomalía detectada' : 'Memoria RAM: Operación estable',
    });
  }
  if (ticketData.almacenamiento) {
    const isStorageWarning =
      detectedErrors.some((e) => e.area === 'Disco' || e.area === 'Almacenamiento') ||
      ticketData.diagnostico?.toLowerCase().includes('disco') ||
      ticketData.diagnostico?.toLowerCase().includes('saturado');
    checks.push({
      ok: !isStorageWarning,
      label: isStorageWarning ? 'Almacenamiento: Capacidad o salud en alerta' : 'Almacenamiento: Unidades verificadas',
    });
  }
  if (licText) {
    checks.push({
      ok: !lic?.sospecha_kms && lic?.activa !== false,
      label: `Licencia Windows: ${licText}`,
    });
  }
  if (checks.length === 0) {
    checks.push({ ok: true, label: 'Auditoría completada sin alertas críticas' });
  }

  return (
    <aside className="w-full md:w-[416px] shrink-0 h-[48vh] md:h-full bg-[#101521] md:bg-[#101521]/95 md:backdrop-blur-xl border-t md:border-t-0 md:border-l border-slate-800/80 flex flex-col overflow-hidden relative z-10 select-none pb-16 md:pb-0 shadow-[inset_1px_0_0_rgba(255,255,255,0.03)]">
      <div className="flex-1 overflow-y-auto px-5 md:px-6 pt-5 md:pt-6 pb-10 space-y-5">
        <header className="pb-4 border-b border-slate-800/80 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-cyan-500/12 border border-cyan-500/25 flex items-center justify-center shrink-0">
                <DeviceIcon className="w-4 h-4 text-cyan-300" />
              </div>
              <h2 className="text-[14px] font-semibold font-mono text-slate-100 tracking-tight truncate">
                {ticketData.id_ticket || ticketData.ticket_id || 'TICKET-ACTIVO'}
              </h2>
            </div>
            <span className="text-[10px] font-medium tracking-wide text-emerald-300 bg-emerald-500/12 border border-emerald-500/25 px-2.5 py-0.5 rounded-full shrink-0">
              {eventoLabel}
            </span>
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="w-3 h-3 text-slate-500" />
              {ticketData.scan_date || 'En tiempo real'}
            </span>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1 text-[10px] font-semibold text-cyan-300 hover:text-white bg-cyan-500/10 border border-cyan-500/25 px-2 py-0.5 rounded-md"
            >
              <FileDown className="w-3 h-3" /> Exportar Reporte
            </button>
          </div>
        </header>

        {!selectedComponent ? (
          <>
            {/* 1. Índice de Salud + Resumen de Errores */}
            <div className="instrument-card rounded-2xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[11px] text-slate-400 font-medium mb-0.5">Índice de Salud Global</p>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-3xl font-bold font-mono tabular-nums text-white">{healthScore}</span>
                    <span className="text-sm text-slate-500 font-medium">/100</span>
                  </div>
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-full border ${
                    isOptimal
                      ? 'text-emerald-300 bg-emerald-500/12 border-emerald-500/25'
                      : isCritical
                      ? 'text-rose-300 bg-rose-500/12 border-rose-500/30'
                      : 'text-amber-300 bg-amber-500/12 border-amber-500/25'
                  }`}
                >
                  {isOptimal ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                  {isOptimal ? 'Certificación Óptima' : isCritical ? 'Estado Crítico' : 'Requiere Atención'}
                </span>
              </div>

              {detectedErrors.length > 0 ? (
                <div className="pt-2.5 border-t border-white/[0.05] space-y-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-rose-300 flex items-center gap-1.5">
                    <AlertTriangle className="w-3 h-3" /> {detectedErrors.length} Alerta{detectedErrors.length === 1 ? '' : 's'} / Error{detectedErrors.length === 1 ? '' : 'es'} Detectados
                  </p>
                  {detectedErrors.map((err, idx) => (
                    <div
                      key={idx}
                      className={`text-[11px] px-2.5 py-1.5 rounded-lg border ${
                        err.severidad === 'critica'
                          ? 'bg-rose-500/10 border-rose-500/25 text-rose-200'
                          : 'bg-amber-500/10 border-amber-500/25 text-amber-200'
                      }`}
                    >
                      <span className="font-semibold">[{err.area}]</span> {err.mensaje}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-emerald-300/90 pt-2 border-t border-white/[0.05]">
                  ✔ Sin errores críticos de hardware, capacidad ni licencia detectados en este reporte.
                </p>
              )}
            </div>

            {/* 2. Identidad del Equipo, Placa Base, Firmware BIOS y Sistema Operativo (Ficha Completa) */}
            <div className="space-y-2">
              <h3 className="text-[11px] text-cyan-400 font-semibold uppercase tracking-wider">
                Identidad, Placa Base, Firmware BIOS y Entorno
              </h3>
              <div className="instrument-card rounded-2xl px-4 py-2.5">
                <InfoRow label="Tipo de Equipo" value={tipoLabel} valueClass="text-cyan-300 font-semibold" />
                <InfoRow label="Modelo del Equipo" value={modeloEquipo} valueClass="text-white font-semibold" />
                <InfoRow label="Fabricante Placa" value={fabricantePlaca} />
                <InfoRow label="Modelo de Placa" value={modeloPlaca} valueClass="font-mono text-slate-200" />
                <InfoRow label="Proveedor BIOS" value={biosProveedor} />
                <InfoRow label="Versión / Fecha BIOS" value={biosVersionFecha} valueClass="font-mono text-slate-200" />
                <InfoRow label="Sistema Operativo" value={soNombre} />
                <InfoRow label="Versión / Build" value={soBuild} valueClass="font-mono text-slate-300" />
                <InfoRow label="Tiempo Encendido" value={soUptime} />
                {licText && (
                  <div className="flex items-start justify-between gap-3 py-1.5 border-b border-white/[0.04] last:border-b-0">
                    <span className="text-[11px] text-slate-400 shrink-0 inline-flex items-center gap-1">
                      <KeyRound className="w-3 h-3 text-slate-500" /> Licencia Windows
                    </span>
                    <span className={`text-[11px] font-semibold text-right ${licStatusClass}`}>{licText}</span>
                  </div>
                )}
                {integridadText && (
                  <InfoRow
                    label="Integridad Android"
                    value={integridadText}
                    valueClass={integridad?.is_rooted ? 'text-rose-300 font-semibold' : 'text-emerald-300'}
                  />
                )}
                {specs.pantalla && specs.pantalla !== 'N/D' && (
                  <InfoRow label="Pantalla" value={specs.pantalla} />
                )}
              </div>
            </div>

            {/* 3. Configuración Base de Hardware */}
            <div className="space-y-2">
              <h3 className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
                Hardware, Sensores y Conectividad
              </h3>
              <div className="instrument-card rounded-2xl p-4 space-y-3">
                {ticketData.cpu && (
                  <div>
                    <span className="text-[9px] uppercase tracking-wider text-cyan-400/90 font-semibold block">
                      Procesador (CPU)
                    </span>
                    <p className="text-xs font-medium text-slate-100 mt-0.5 leading-snug">{ticketData.cpu}</p>
                    {specs.cpu?.uso_total_pct != null && (
                      <p className="text-[10px] font-mono text-slate-400 mt-0.5">
                        Carga registrada: {specs.cpu.uso_total_pct}% · Base {specs.cpu.freq_base_ghz ?? '?'} GHz
                      </p>
                    )}
                  </div>
                )}
                {ticketData.ram && (
                  <div className="border-t border-white/[0.04] pt-2.5">
                    <span className="text-[9px] uppercase tracking-wider text-emerald-400/90 font-semibold block">
                      Memoria RAM
                    </span>
                    <p className="text-xs font-medium text-slate-100 mt-0.5 leading-snug">{ticketData.ram}</p>
                    {specs.ram?.uso_pct != null && (
                      <p className="text-[10px] font-mono text-slate-400 mt-0.5">
                        Uso en escaneo: {specs.ram.uso_pct}%
                        {specs.ram.libre_mb != null ? ` · ${specs.ram.libre_mb} MB disponibles` : ''}
                      </p>
                    )}
                  </div>
                )}
                {ticketData.gpu && (
                  <div className="border-t border-white/[0.04] pt-2.5">
                    <span className="text-[9px] uppercase tracking-wider text-violet-400/90 font-semibold block">
                      Tarjeta Gráfica (GPU)
                    </span>
                    <p className="text-xs font-medium text-slate-100 mt-0.5 leading-snug">{ticketData.gpu}</p>
                  </div>
                )}
                {ticketData.almacenamiento && (
                  <div className="border-t border-white/[0.04] pt-2.5">
                    <span className="text-[9px] uppercase tracking-wider text-amber-400/90 font-semibold block">
                      Almacenamiento
                    </span>
                    <p className="text-xs font-medium text-slate-100 mt-0.5 leading-snug">{ticketData.almacenamiento}</p>
                    {Array.isArray(specs.discos?.particiones) && specs.discos.particiones.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {specs.discos.particiones.slice(0, 4).map((p, idx) => (
                          <span
                            key={idx}
                            className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800/80 text-slate-300 border border-slate-700/60"
                          >
                            {p.punto_montaje || p.dispositivo}: {Math.round(Number(p.porcentaje ?? 0))}%
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {ticketData.refrigeracion && (
                  <div className="border-t border-white/[0.04] pt-2.5">
                    <span className="text-[9px] uppercase tracking-wider text-teal-400/90 font-semibold block">
                      {isPhone ? 'Batería y Energía' : 'Refrigeración'}
                    </span>
                    <p className="text-xs font-medium text-slate-100 mt-0.5 leading-snug">{ticketData.refrigeracion}</p>
                    {bateria && (bateria.voltaje_mv || bateria.tecnologia) && (
                      <p className="text-[10px] font-mono text-slate-400 mt-0.5 inline-flex items-center gap-1">
                        <BatteryCharging className="w-3 h-3 text-emerald-400" />
                        {bateria.tecnologia || 'Li-ion'}
                        {bateria.voltaje_mv ? ` · ${(bateria.voltaje_mv / 1000).toFixed(2)} V` : ''}
                        {bateria.fuente ? ` · ${bateria.fuente}` : ''}
                      </p>
                    )}
                  </div>
                )}
                {red && (red.adaptador || red.ip || red.latencia_ms != null) && (
                  <div className="border-t border-white/[0.04] pt-2.5">
                    <span className="text-[9px] uppercase tracking-wider text-sky-400/90 font-semibold flex items-center gap-1">
                      <Wifi className="w-3 h-3" /> Conectividad de Red
                    </span>
                    <p className="text-xs font-medium text-slate-100 mt-0.5 leading-snug">
                      {red.adaptador || 'Adaptador de Red'}
                    </p>
                    <p className="text-[10px] font-mono text-slate-400 mt-0.5">
                      {red.ip ? `IP ${red.ip}` : 'Red activa'}
                      {red.latencia_ms != null ? ` · Latencia ${Math.round(Number(red.latencia_ms))} ms` : ''}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* 4. Dictamen del Diagnóstico */}
            {ticketData.diagnostico && (
              <div className="space-y-2.5">
                <h3 className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-amber-400" /> Dictamen del Diagnóstico
                </h3>
                <div className="bg-amber-500/[0.06] border border-amber-500/20 rounded-2xl p-4 space-y-3">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[10px] text-amber-400 font-semibold uppercase tracking-wider">Hallazgo Principal</p>
                      <p className="text-xs text-slate-100 mt-0.5 leading-relaxed font-medium">{ticketData.diagnostico}</p>
                    </div>
                  </div>
                  {ticketData.solucion && (
                    <div className="border-t border-amber-500/15 pt-2.5">
                      <p className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wider flex items-center gap-1 mb-1">
                        <CheckCircle2 className="w-3 h-3" /> Guía de Solución Paso a Paso:
                      </p>
                      <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line pl-1">{ticketData.solucion}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 5. Puntos de Auditoría */}
            <div className="space-y-2">
              <h3 className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" /> Puntos de Auditoría
              </h3>
              <div className="space-y-1.5">
                {checks.map((c, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border text-xs leading-snug ${
                      c.ok
                        ? 'bg-emerald-500/[0.05] border-emerald-500/15 text-emerald-200'
                        : 'bg-amber-500/[0.06] border-amber-500/20 text-amber-200'
                    }`}
                  >
                    <StatusDot ok={c.ok} />
                    <span>{c.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 6. Componentes 3D Interactivos */}
            <div className="space-y-2 pt-1">
              <h3 className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold">
                Componentes Auditados (Clic para Inspeccionar)
              </h3>
              {Object.keys(components).map((cat) => {
                const entry = ICON_MAP[cat] || { icon: Wrench, color: 'text-slate-400' };
                const Icon = entry.icon;
                const compData = components[cat] || {};
                return (
                  <button
                    key={cat}
                    onClick={() => onCloseComponent?.({ category: cat, nodeName: cat, data: compData }, 'select')}
                    className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl border border-slate-800 bg-[#141b2a]/70 hover:bg-[#192235] hover:border-cyan-500/35 group text-left"
                  >
                    <Icon className={`w-4 h-4 ${entry.color} shrink-0`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-slate-100 truncate">{cat}</div>
                      <div className="text-[10px] text-slate-400 truncate mt-0.5">{compData.specs || 'Detectado'}</div>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-cyan-300 shrink-0" />
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <button
              onClick={() => onCloseComponent(null, 'close')}
              className="group flex items-center gap-1.5 text-[11px] font-medium text-slate-400 hover:text-white"
            >
              <span>&larr;</span> Volver al reporte global
            </button>

            <div className="instrument-card rounded-2xl p-5 space-y-5">
              <div className="flex items-start gap-3 pb-4 border-b border-white/[0.06]">
                {(() => {
                  const entry = ICON_MAP[selectedComponent.category] || { icon: Wrench, color: 'text-slate-400' };
                  const Icon = entry.icon;
                  return <Icon className={`w-5 h-5 ${entry.color} mt-0.5 shrink-0`} />;
                })()}
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-white">{selectedComponent.category}</h3>
                  <p className="text-[10px] text-slate-400 font-mono mt-0.5 truncate">
                    Nodo 3D: {selectedComponent.nodeName}
                  </p>
                </div>
              </div>

              <div>
                <h4 className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold mb-2">
                  Especificaciones Técnicas
                </h4>
                <p className="text-xs text-slate-100 leading-relaxed font-medium bg-[#0f172a]/80 p-3 rounded-xl border border-slate-800">
                  {selectedComponent.data?.specs || 'Sin datos registrados para esta pieza.'}
                </p>
              </div>

              <div className="bg-[#0f172a]/60 border border-slate-800 rounded-xl p-4">
                <h4 className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold mb-2 flex items-center gap-1.5">
                  <Activity className="w-3 h-3 text-cyan-400" /> Dictamen de Auditoría
                </h4>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {selectedComponent.data?.diagnostic || 'No se registraron anomalías en este componente.'}
                </p>
              </div>

              <div className="bg-emerald-500/[0.05] border border-emerald-500/15 rounded-xl p-4">
                <h4 className="text-[10px] text-emerald-400 uppercase tracking-widest font-semibold mb-2 flex items-center gap-1.5">
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
