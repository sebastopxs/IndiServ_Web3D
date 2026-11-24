/**
 * TicketLookupBar.jsx — Centro de Flota y Reportes Privados por Cuenta.
 * Permite buscar por ID, filtrar por tipo/errores, ordenar a elección del usuario y agrupar por Fecha o Dispositivo.
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import {
  isHoneyTicket,
  triggerHoneytokenAlert,
  fetchHoneytokenAlerts,
} from '../utils/security';
import {
  Search, Laptop, Monitor, Smartphone, ArrowRight, RefreshCw, Lock, LogIn,
  ShieldAlert, Calendar, Layers, ArrowUpDown, AlertTriangle, Filter, CheckCircle2,
} from 'lucide-react';

function classifyDevice(item) {
  const specs = item.specs_json || {};
  const rawTipo = String(specs.tipo_equipo || '').toLowerCase();
  if (rawTipo === 'phone' || rawTipo === 'smartphone' || rawTipo === 'tablet' || rawTipo === 'mobile') {
    return 'phone';
  }
  if (
    rawTipo === 'laptop' ||
    /laptop|lnvnb|loq|legion|tuf|victus|inspiron|thinkpad|macbook|7735hs|7435hs/i.test(
      `${item.placa_base || ''} ${item.cpu || ''}`
    )
  ) {
    return 'laptop';
  }
  return 'desktop';
}

function getDeviceModelName(item) {
  const specs = item.specs_json || {};
  if (specs.modelo_comercial) return String(specs.modelo_comercial).trim();
  const pb = String(item.placa_base || '').trim();
  if (pb) return pb.replace(/\s*\(Placa\s+[^)]+\)\s*$/i, '').trim() || pb;
  return String(item.cpu || 'Equipo sin modelo').slice(0, 40);
}

function getDateGroupLabel(isoDate) {
  if (!isoDate) return 'Sin fecha registrada';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return 'Sin fecha registrada';

  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startItem = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((startToday - startItem) / 86_400_000);

  const exactStr = d.toLocaleDateString('es-ES', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  if (diffDays === 0) return `Hoy · ${exactStr}`;
  if (diffDays === 1) return `Ayer · ${exactStr}`;
  return exactStr.charAt(0).toUpperCase() + exactStr.slice(1);
}

function getDateKey(isoDate) {
  if (!isoDate) return '0000-00-00';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return '0000-00-00';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function TicketLookupBar({ user, onSelectTicket, onRequestLogin }) {
  const [query, setQuery] = useState('');
  const [filterText, setFilterText] = useState('');
  const [deviceFilter, setDeviceFilter] = useState('all'); // 'all' | 'laptop' | 'desktop' | 'phone' | 'alerts'
  const [groupBy, setGroupBy] = useState('date'); // 'date' | 'device' | 'none'
  const [sortBy, setSortBy] = useState('date_desc'); // 'date_desc' | 'date_asc' | 'health_asc' | 'health_desc' | 'model_asc'

  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showHoneyAlerts, setShowHoneyAlerts] = useState(false);
  const [honeyAlerts, setHoneyAlerts] = useState([]);
  const [loadingAlerts, setLoadingAlerts] = useState(false);

  const ownerDni = user?.dni ? String(user.dni).trim() : '';

  const fetchMyTickets = useCallback(async () => {
    if (!ownerDni) {
      setRecent([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('reportes_diagnostico')
        .select('id_ticket, cpu, placa_base, health_score, diagnostico, fecha_creacion, specs_json')
        .eq('specs_json->>owner_dni', ownerDni)
        .order('fecha_creacion', { ascending: false })
        .limit(120);
      if (error) {
        console.warn('[TicketLookupBar] Error consultando tickets privados:', error.message);
        setRecent([]);
      } else {
        setRecent(data || []);
      }
    } catch {
      setRecent([]);
    } finally {
      setLoading(false);
    }
  }, [ownerDni]);

  useEffect(() => {
    fetchMyTickets();
  }, [fetchMyTickets]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const cleaned = query.trim();
    if (!cleaned) return;
    if (isHoneyTicket(cleaned)) {
      triggerHoneytokenAlert(
        'TICKET_SENUELO_BUSCADOR',
        `Intento de consulta manual sobre ticket trampa o payload '${cleaned.slice(0, 80)}'`
      );
    }
    onSelectTicket(cleaned);
  };

  const handleToggleHoneyAlerts = async () => {
    const next = !showHoneyAlerts;
    setShowHoneyAlerts(next);
    if (next) {
      setLoadingAlerts(true);
      const list = await fetchHoneytokenAlerts(20);
      setHoneyAlerts(list);
      setLoadingAlerts(false);
    }
  };

  // Estadísticas globales de flota (para gestionar 30+ PCs, Laptops y Teléfonos)
  const fleetStats = useMemo(() => {
    const uniqueDevices = new Set();
    let alertCount = 0;
    let totalHealth = 0;
    for (const item of recent) {
      uniqueDevices.add(`${classifyDevice(item)}::${getDeviceModelName(item).toLowerCase()}`);
      const score = Number(item.health_score ?? 100);
      const errs = Array.isArray(item.specs_json?.errores_detectados) ? item.specs_json.errores_detectados.length : 0;
      if (score < 80 || errs > 0) alertCount += 1;
      totalHealth += score;
    }
    return {
      totalReports: recent.length,
      uniqueDevices: uniqueDevices.size,
      alertCount,
      avgHealth: recent.length > 0 ? Math.round(totalHealth / recent.length) : 100,
    };
  }, [recent]);

  // Filtrar y ordenar según preferencias del usuario
  const processedTickets = useMemo(() => {
    const kw = filterText.trim().toLowerCase();
    const filtered = recent.filter((item) => {
      const kind = classifyDevice(item);
      const score = Number(item.health_score ?? 100);
      const errs = Array.isArray(item.specs_json?.errores_detectados) ? item.specs_json.errores_detectados.length : 0;
      if (deviceFilter === 'laptop' && kind !== 'laptop') return false;
      if (deviceFilter === 'desktop' && kind !== 'desktop') return false;
      if (deviceFilter === 'phone' && kind !== 'phone') return false;
      if (deviceFilter === 'alerts' && score >= 80 && errs === 0) return false;

      if (kw) {
        const hay = `${item.id_ticket || ''} ${getDeviceModelName(item)} ${item.placa_base || ''} ${item.cpu || ''} ${item.diagnostico || ''} ${item.specs_json?.tipo_evento || ''}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      const tA = a.fecha_creacion ? new Date(a.fecha_creacion).getTime() : 0;
      const tB = b.fecha_creacion ? new Date(b.fecha_creacion).getTime() : 0;
      const sA = Number(a.health_score ?? 100);
      const sB = Number(b.health_score ?? 100);
      if (sortBy === 'date_asc') return tA - tB;
      if (sortBy === 'health_asc') return sA - sB || tB - tA;
      if (sortBy === 'health_desc') return sB - sA || tB - tA;
      if (sortBy === 'model_asc') return getDeviceModelName(a).localeCompare(getDeviceModelName(b));
      return tB - tA; // date_desc
    });
    return sorted;
  }, [recent, deviceFilter, filterText, sortBy]);

  // Agrupación dinámica (Por Fecha / Por Dispositivo / Lista Plana)
  const groupedSections = useMemo(() => {
    if (groupBy === 'none') {
      return [{ key: 'all', title: null, items: processedTickets }];
    }
    const map = new Map();
    for (const item of processedTickets) {
      const key =
        groupBy === 'date'
          ? getDateKey(item.fecha_creacion)
          : `${classifyDevice(item)}::${getDeviceModelName(item)}`;
      const title =
        groupBy === 'date'
          ? getDateGroupLabel(item.fecha_creacion)
          : getDeviceModelName(item);
      if (!map.has(key)) map.set(key, { key, title, items: [] });
      map.get(key).items.push(item);
    }
    return Array.from(map.values());
  }, [processedTickets, groupBy]);

  const maskedDni = ownerDni.length >= 4 ? `••••${ownerDni.slice(-4)}` : ownerDni;

  const renderTicketCard = (item) => {
    const kind = classifyDevice(item);
    const isPhone = kind === 'phone';
    const isLap = kind === 'laptop';
    const evento = item.specs_json?.tipo_evento || 'Diagnóstico';
    const modelName = getDeviceModelName(item);
    const score = Number(item.health_score ?? 100);
    const errs = Array.isArray(item.specs_json?.errores_detectados) ? item.specs_json.errores_detectados : [];
    const soName = item.specs_json?.so?.nombre || (typeof item.specs_json?.so === 'string' ? item.specs_json.so : null);
    const licEstado = item.specs_json?.so?.licencia?.estado || null;

    const fechaFmt = item.fecha_creacion
      ? new Date(item.fecha_creacion).toLocaleString('es-ES', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '';

    const scoreColor =
      score >= 80
        ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25'
        : score >= 55
        ? 'text-amber-300 bg-amber-500/10 border-amber-500/25'
        : 'text-rose-300 bg-rose-500/10 border-rose-500/30';

    return (
      <button
        key={item.id_ticket}
        onClick={() => onSelectTicket(item.id_ticket)}
        className="w-full text-left instrument-card hover:bg-[#192235] hover:border-cyan-500/40 rounded-xl p-3.5 flex items-center justify-between gap-3"
      >
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
              isPhone
                ? 'bg-violet-500/15 text-violet-300 border border-violet-500/25'
                : isLap
                ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/25'
                : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25'
            }`}
          >
            {isPhone ? (
              <Smartphone className="w-4 h-4" />
            ) : isLap ? (
              <Laptop className="w-4 h-4" />
            ) : (
              <Monitor className="w-4 h-4" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-cyan-500/12 text-cyan-300 border border-cyan-500/25">
                {evento}
              </span>
              <span className="text-xs font-mono font-semibold text-white truncate">{item.id_ticket}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                {isPhone ? 'Teléfono' : isLap ? 'Laptop' : 'PC'}
              </span>
              {errs.length > 0 && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30 inline-flex items-center gap-1">
                  <AlertTriangle className="w-2.5 h-2.5" /> {errs.length} alerta{errs.length === 1 ? '' : 's'}
                </span>
              )}
            </div>
            <p className="text-xs font-semibold text-slate-100 truncate mt-1">{modelName}</p>
            <p className="text-[11px] text-slate-400 truncate mt-0.5">
              {item.diagnostico || item.cpu || 'Reporte global de telemetría'}
            </p>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-500 mt-1">
              {fechaFmt && <span className="font-mono text-slate-400">📅 {fechaFmt}</span>}
              {soName && <span>· {soName}</span>}
              {licEstado && <span className="text-emerald-400/80">· {licEstado}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-xs font-mono font-bold px-2 py-1 rounded-lg border ${scoreColor}`}>
            {score}/100
          </span>
          <ArrowRight className="w-4 h-4 text-slate-500" />
        </div>
      </button>
    );
  };

  return (
    <div className="h-full w-full overflow-y-auto bg-[#090c12] text-slate-100 p-4 pb-24">
      <div className="max-w-3xl mx-auto space-y-4">
        {/* Buscador directo por ID exacto */}
        <div className="instrument-card rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-emerald-400 font-semibold">
                Centro de Flota y Reportes · Supabase
              </p>
              <h2 className="text-base font-semibold text-white">Consultar Ticket por ID o Gestionar Equipos</h2>
            </div>
            {ownerDni && (
              <button
                onClick={fetchMyTickets}
                className="p-2 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-slate-300 border border-slate-700/70"
                title="Actualizar mis tickets"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            )}
          </div>

          <form onSubmit={handleSubmit} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Abrir reporte exacto: Ej. 6130-SCAN-556D3C22"
                className="w-full bg-[#101521] border border-slate-700 focus:border-emerald-400 rounded-xl pl-10 pr-3 py-2.5 text-sm text-white outline-none"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#03160f] font-semibold text-xs shrink-0"
            >
              Abrir 3D
            </button>
          </form>
        </div>

        {/* Resumen Global de Flota (KPIs) */}
        {ownerDni && recent.length > 0 && !showHoneyAlerts && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="instrument-card rounded-xl p-3">
              <span className="text-[10px] text-slate-400 block">Reportes Totales</span>
              <span className="text-xl font-bold font-mono text-white">{fleetStats.totalReports}</span>
            </div>
            <div className="instrument-card rounded-xl p-3">
              <span className="text-[10px] text-slate-400 block">Equipos Distintos</span>
              <span className="text-xl font-bold font-mono text-cyan-300">{fleetStats.uniqueDevices}</span>
            </div>
            <div className="instrument-card rounded-xl p-3">
              <span className="text-[10px] text-slate-400 block">Con Alertas / Errores</span>
              <span className={`text-xl font-bold font-mono ${fleetStats.alertCount > 0 ? 'text-amber-300' : 'text-emerald-400'}`}>
                {fleetStats.alertCount}
              </span>
            </div>
            <div className="instrument-card rounded-xl p-3">
              <span className="text-[10px] text-slate-400 block">Salud Promedio</span>
              <span className="text-xl font-bold font-mono text-emerald-400">{fleetStats.avgHealth}/100</span>
            </div>
          </div>
        )}

        {/* Controles de Organización, Filtro y Ordenamiento elegibles por el usuario */}
        {ownerDni && !showHoneyAlerts && (
          <div className="instrument-card rounded-2xl p-3.5 space-y-3">
            {/* Filtro por texto en vivo */}
            <div className="relative">
              <Filter className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Filtrar entre tus equipos por modelo (LOQ, Galaxy...), CPU, fecha o error…"
                className="w-full bg-[#101521] border border-slate-800 focus:border-cyan-400 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-100 outline-none"
              />
            </div>

            {/* Pills de Tipo de Equipo */}
            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { id: 'all', label: 'Todos' },
                { id: 'laptop', label: '💻 Laptops' },
                { id: 'desktop', label: '🖥️ PCs' },
                { id: 'phone', label: '📱 Teléfonos' },
                { id: 'alerts', label: '⚠ Con Alertas' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setDeviceFilter(tab.id)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border ${
                    deviceFilter === tab.id
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35'
                      : 'bg-[#101521] text-slate-400 border-slate-800 hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Agrupar por + Ordenar por */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/[0.05]">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] text-slate-400 font-semibold inline-flex items-center gap-1">
                  <Layers className="w-3 h-3" /> Agrupar:
                </span>
                {[
                  { id: 'date', label: '📅 Por Fecha' },
                  { id: 'device', label: '💻 Por Equipo' },
                  { id: 'none', label: 'Lista' },
                ].map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setGroupBy(g.id)}
                    className={`px-2 py-1 rounded-lg text-[10px] font-semibold border ${
                      groupBy === g.id
                        ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/35'
                        : 'bg-[#101521] text-slate-400 border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1.5">
                <ArrowUpDown className="w-3 h-3 text-slate-400" />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="bg-[#101521] border border-slate-700 text-slate-200 text-[11px] rounded-lg px-2 py-1 outline-none focus:border-cyan-400"
                >
                  <option value="date_desc">Más recientes primero</option>
                  <option value="date_asc">Más antiguos primero</option>
                  <option value="health_asc">Peor salud / Errores primero</option>
                  <option value="health_desc">Mejor salud primero</option>
                  <option value="model_asc">Modelo / Equipo (A-Z)</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Cabecera de lista + botón Honeytoken */}
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <p className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-emerald-400" />
              {ownerDni ? `Mis Reportes Privados (DNI ${maskedDni})` : 'Historial Privado en la Nube'}
            </p>
            {ownerDni && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleToggleHoneyAlerts}
                  className={`text-[10px] font-semibold px-2.5 py-1 rounded-lg border flex items-center gap-1 ${
                    showHoneyAlerts
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                      : 'bg-[#101521] text-amber-400/90 border-slate-700 hover:border-amber-500/40'
                  }`}
                >
                  <ShieldAlert className="w-3 h-3" />
                  {showHoneyAlerts ? 'Ver Mis Reportes' : '🍯 Alertas Honeytoken'}
                </button>
                <span className="text-[10px] text-slate-500 font-mono">
                  {processedTickets.length}/{recent.length}
                </span>
              </div>
            )}
          </div>

          {ownerDni && showHoneyAlerts ? (
            loadingAlerts ? (
              <div className="p-6 text-center text-xs text-slate-500">Consultando alertas Honeytoken…</div>
            ) : honeyAlerts.length === 0 ? (
              <div className="instrument-card border-emerald-500/25 rounded-2xl p-6 text-center text-xs text-emerald-300 flex flex-col items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                ✔ 0 alertas de Honeytoken disparadas. Ningún intruso ha tocado las trampas señuelo.
              </div>
            ) : (
              <div className="space-y-2">
                {honeyAlerts.map((al) => (
                  <div
                    key={al.id_ticket}
                    className="instrument-card border-rose-500/35 rounded-xl p-3 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-rose-300">🍯 {al.id_ticket}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 font-semibold">
                        INTRUSIÓN DETECTADA
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-300 font-mono break-words">{al.sugerencia}</p>
                  </div>
                ))}
              </div>
            )
          ) : !ownerDni ? (
            <div className="instrument-card rounded-2xl p-6 text-center space-y-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center mx-auto">
                <Lock className="w-5 h-5 text-emerald-400" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-white">Acceso restringido por privacidad</h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
                  Por seguridad, los reportes en la nube solo se muestran al titular de la cuenta que los generó. Inicia sesión para ver tu flota de equipos o ingresa un ID de ticket exacto arriba.
                </p>
              </div>
              {onRequestLogin && (
                <button
                  onClick={onRequestLogin}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#03160f] text-xs font-semibold"
                >
                  <LogIn className="w-3.5 h-3.5" /> Iniciar Sesión
                </button>
              )}
            </div>
          ) : loading ? (
            <div className="p-6 text-center text-xs text-slate-500">Consultando tus reportes en Supabase…</div>
          ) : processedTickets.length === 0 ? (
            <div className="instrument-card rounded-2xl p-6 text-center text-xs text-slate-400">
              {recent.length === 0
                ? `Aún no tienes reportes guardados con tu cuenta (${maskedDni}).`
                : 'No hay reportes que coincidan con los filtros seleccionados.'}
            </div>
          ) : (
            <div className="space-y-4">
              {groupedSections.map((section) => (
                <div key={section.key} className="space-y-2">
                  {section.title && (
                    <div className="flex items-center justify-between px-1 pt-1">
                      <span className="text-[11px] font-semibold text-cyan-300 flex items-center gap-1.5">
                        {groupBy === 'date' ? <Calendar className="w-3.5 h-3.5" /> : <Laptop className="w-3.5 h-3.5" />}
                        {section.title}
                      </span>
                      <span className="text-[10px] font-mono text-slate-500">
                        {section.items.length} reporte{section.items.length === 1 ? '' : 's'}
                      </span>
                    </div>
                  )}
                  <div className="space-y-2">{section.items.map(renderTicketCard)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
