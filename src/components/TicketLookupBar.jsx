/**
 * TicketLookupBar.jsx — Buscador de tickets por ID exacto e historial privado filtrado por titular (owner_dni).
 */

import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import {
  isHoneyTicket,
  triggerHoneytokenAlert,
  fetchHoneytokenAlerts,
} from '../utils/security';
import {
  Search, Laptop, Monitor, Smartphone, ArrowRight, RefreshCw, Lock, LogIn, ShieldAlert,
} from 'lucide-react';

export default function TicketLookupBar({ user, onSelectTicket, onRequestLogin }) {
  const [query, setQuery] = useState('');
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
        .limit(30);
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
      const list = await fetchHoneytokenAlerts(15);
      setHoneyAlerts(list);
      setLoadingAlerts(false);
    }
  };

  const maskedDni = ownerDni.length >= 4 ? `••••${ownerDni.slice(-4)}` : ownerDni;

  return (
    <div className="h-full w-full overflow-y-auto bg-[#0b0f19] text-zinc-100 p-4 pb-24">
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="bg-[#131c2e] border border-slate-800 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-emerald-400 font-semibold">
                Consulta Privada · Supabase
              </p>
              <h2 className="text-base font-semibold text-white">Buscar Ticket por ID Exacto</h2>
            </div>
            {ownerDni && (
              <button
                onClick={fetchMyTickets}
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300"
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
                placeholder="Ej. 6130-TICKET-5738 o TKT-MOB-..."
                className="w-full bg-[#0f172a] border border-slate-700 focus:border-emerald-400 rounded-xl pl-10 pr-3 py-2.5 text-sm text-white outline-none"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#04140e] font-semibold text-xs shrink-0"
            >
              Abrir 3D
            </button>
          </form>
        </div>

        <div className="space-y-2.5">
          <div className="flex items-center justify-between px-1">
            <p className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-emerald-400" />
              {ownerDni ? `Mis Tickets Privados (DNI ${maskedDni})` : 'Historial Privado en la Nube'}
            </p>
            {ownerDni && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleToggleHoneyAlerts}
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-lg border flex items-center gap-1 transition-colors ${
                    showHoneyAlerts
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                      : 'bg-slate-800/80 text-amber-400/90 border-slate-700 hover:bg-slate-800'
                  }`}
                >
                  <ShieldAlert className="w-3 h-3" />
                  {showHoneyAlerts ? 'Ver Mis Tickets' : '🍯 Alertas Honeytoken'}
                </button>
                <span className="text-[10px] text-slate-500 font-mono">
                  {recent.length} reporte{recent.length === 1 ? '' : 's'}
                </span>
              </div>
            )}
          </div>

          {ownerDni && showHoneyAlerts ? (
            loadingAlerts ? (
              <div className="p-6 text-center text-xs text-slate-500">Consultando alertas Honeytoken…</div>
            ) : honeyAlerts.length === 0 ? (
              <div className="bg-[#131c2e] border border-emerald-500/25 rounded-2xl p-6 text-center text-xs text-emerald-300">
                ✔ 0 alertas de Honeytoken disparadas. Ningún intruso ha tocado las trampas señuelo.
              </div>
            ) : (
              <div className="space-y-2">
                {honeyAlerts.map((al) => (
                  <div
                    key={al.id_ticket}
                    className="bg-[#131c2e] border border-rose-500/35 rounded-xl p-3 text-xs space-y-1"
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
            <div className="bg-[#131c2e] border border-slate-800 rounded-2xl p-6 text-center space-y-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center mx-auto">
                <Lock className="w-5 h-5 text-emerald-400" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-white">Acceso restringido por privacidad</h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
                  Por seguridad, los reportes en la nube solo se muestran al titular de la cuenta que los generó. Inicia sesión para ver tu historial o ingresa un ID de ticket exacto arriba.
                </p>
              </div>
              {onRequestLogin && (
                <button
                  onClick={onRequestLogin}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#04140e] text-xs font-semibold transition-colors"
                >
                  <LogIn className="w-3.5 h-3.5" /> Iniciar Sesión
                </button>
              )}
            </div>
          ) : loading ? (
            <div className="p-6 text-center text-xs text-slate-500">Consultando tus reportes en Supabase…</div>
          ) : recent.length === 0 ? (
            <div className="bg-[#131c2e] border border-slate-800 rounded-2xl p-6 text-center text-xs text-slate-400">
              Aún no tienes tickets guardados con tu cuenta ({maskedDni}). Genera un diagnóstico en tu PC, Laptop o Android para verlo aquí.
            </div>
          ) : (
            recent.map((item) => {
              const tipo = item.specs_json?.tipo_equipo;
              const evento = item.specs_json?.tipo_evento || 'Diagnóstico';
              const isPhone = tipo === 'phone';
              const isLap =
                !isPhone &&
                (tipo === 'laptop' ||
                  /laptop|lnvnb|fa506|7735hs|7445hs/i.test(`${item.placa_base || ''} ${item.cpu || ''}`));
              const fechaFmt = item.fecha_creacion
                ? new Date(item.fecha_creacion).toLocaleString('es-ES', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : '';
              return (
                <button
                  key={item.id_ticket}
                  onClick={() => onSelectTicket(item.id_ticket)}
                  className="w-full text-left bg-[#131c2e] hover:bg-[#172238] border border-slate-800 hover:border-cyan-500/40 rounded-xl p-3.5 flex items-center justify-between gap-3 transition-all"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                        isPhone
                          ? 'bg-violet-500/15 text-violet-400'
                          : isLap
                          ? 'bg-cyan-500/15 text-cyan-400'
                          : 'bg-emerald-500/15 text-emerald-400'
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
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/25">
                          {evento}
                        </span>
                        <span className="text-sm font-semibold text-white truncate">{item.id_ticket}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                          {isPhone ? 'Teléfono' : isLap ? 'Laptop' : 'PC'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-300 truncate mt-0.5">
                        {item.diagnostico || item.placa_base || item.cpu || 'Equipo diagnosticado'}
                      </p>
                      <p className="text-[10px] text-slate-500 truncate mt-0.5">
                        {item.placa_base || item.cpu || 'Hardware'}
                        {fechaFmt ? ` · ${fechaFmt}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-mono font-bold text-emerald-400">
                      {item.health_score ?? 100}/100
                    </span>
                    <ArrowRight className="w-4 h-4 text-slate-500" />
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
