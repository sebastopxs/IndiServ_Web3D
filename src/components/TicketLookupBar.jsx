import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { Search, Laptop, Monitor, ArrowRight, RefreshCw } from 'lucide-react';

export default function TicketLookupBar({ onSelectTicket }) {
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchRecent = async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('reportes_diagnostico')
        .select('id_ticket, cpu, placa_base, health_score, fecha_creacion, specs_json')
        .order('fecha_creacion', { ascending: false })
        .limit(12);
      setRecent(data || []);
    } catch {
      setRecent([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecent();
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    const cleaned = query.trim();
    if (cleaned) onSelectTicket(cleaned);
  };

  return (
    <div className="h-full w-full overflow-y-auto bg-[#0b0f19] text-zinc-100 p-4 pb-24">
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="bg-[#131c2e] border border-slate-800 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-emerald-400 font-semibold">
                Consulta en Vivo · Supabase
              </p>
              <h2 className="text-base font-semibold text-white">Buscar Ticket de PC o Laptop</h2>
            </div>
            <button
              onClick={fetchRecent}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300"
              title="Actualizar"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ej. 6130-TICKET-5738"
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
          <p className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold px-1">
            Tickets Recientes en la Nube
          </p>
          {loading ? (
            <div className="p-6 text-center text-xs text-slate-500">Consultando Supabase…</div>
          ) : recent.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">No hay tickets recientes.</div>
          ) : (
            recent.map((item) => {
              const isLap =
                item.specs_json?.tipo_equipo === 'laptop' ||
                /laptop|lnvnb|fa506|7735hs|7445hs/i.test(`${item.placa_base || ''} ${item.cpu || ''}`);
              return (
                <button
                  key={item.id_ticket}
                  onClick={() => onSelectTicket(item.id_ticket)}
                  className="w-full text-left bg-[#131c2e] hover:bg-[#172238] border border-slate-800 hover:border-cyan-500/40 rounded-xl p-3.5 flex items-center justify-between gap-3 transition-all"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${isLap ? 'bg-cyan-500/15 text-cyan-400' : 'bg-emerald-500/15 text-emerald-400'}`}>
                      {isLap ? <Laptop className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white truncate">{item.id_ticket}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                          {isLap ? 'Laptop' : 'PC'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 truncate mt-0.5">
                        {item.placa_base || item.cpu || 'Equipo diagnosticado'}
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
