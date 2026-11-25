/**
 * MobileDiagnosticView.jsx — Sistema Experto Móvil Pro (8 ramas, 28 casos clínicos,
 * asistente interactivo Sí/No paso a paso, diagnóstico multisíntoma, auto-triaje en vivo,
 * checklist interactivo de reparación y sincronización con Reporte Global 3D en Supabase).
 */

import React, { useMemo, useState } from 'react';
import { recordMobileEvent } from '../utils/cloudHistory';
import { DIAGNOSTIC_TREE } from '../data/mobileDiagnosticTree';
import {
  Stethoscope, ChevronRight, ArrowLeft, Search,
  Box, CloudUpload, RotateCcw, Sparkles, ListChecks,
  GitBranch, Layers, CheckSquare, Square, Activity,
} from 'lucide-react';

function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const SEV_RANK = { Crítica: 4, Alta: 3, Media: 2, Baja: 1 };

export default function MobileDiagnosticView({ deviceInfo, user, onOpenPhone3D }) {
  const [mode, setMode] = useState('tree'); // 'tree' | 'multi' | 'search'
  const [selectedBranchId, setSelectedBranchId] = useState(null);
  const [wizardStepIdx, setWizardStepIdx] = useState(0);
  const [wizardHistory, setWizardHistory] = useState([]);
  const [showDirectList, setShowDirectList] = useState(false);

  const [selectedCase, setSelectedCase] = useState(null);
  const [checkedSteps, setCheckedSteps] = useState({});

  // Modo Multisíntoma
  const [multiSelectedCodes, setMultiSelectedCodes] = useState([]);
  const [multiResult, setMultiResult] = useState(null);

  // Buscador
  const [searchTerm, setSearchTerm] = useState('');

  // Persistencia en nube
  const [savingTicket, setSavingTicket] = useState(false);
  const [savedTicketId, setSavedTicketId] = useState(null);

  const allCases = useMemo(() => {
    const list = [];
    for (const b of DIAGNOSTIC_TREE) {
      for (const c of b.cases) {
        list.push({ ...c, branchId: b.id, branchTitle: b.title, componentKey: b.componentKey });
      }
    }
    return list;
  }, []);

  const caseByCode = useMemo(() => {
    const map = {};
    for (const c of allCases) map[c.code] = c;
    return map;
  }, [allCases]);

  // Auto-triaje en vivo basado en la telemetría real del dispositivo
  const liveAlerts = useMemo(() => {
    if (!deviceInfo) return [];
    const alerts = [];
    if (deviceInfo.batteryTempC != null && deviceInfo.batteryTempC >= 39) {
      alerts.push({
        label: `Temperatura batería elevada (${deviceInfo.batteryTempC}°C)`,
        code: 'MOB-BAT-03',
        severity: deviceInfo.batteryTempC >= 43 ? 'Crítica' : 'Alta',
      });
    }
    if (deviceInfo.storageUsedPct != null && deviceInfo.storageUsedPct >= 82) {
      alerts.push({
        label: `Almacenamiento al ${deviceInfo.storageUsedPct}% (${deviceInfo.storageAvailGb ?? '?'} GB libres)`,
        code: 'MOB-MEM-01',
        severity: deviceInfo.storageUsedPct >= 92 ? 'Crítica' : 'Alta',
      });
    }
    if (deviceInfo.ramUsedPct != null && deviceInfo.ramUsedPct >= 82) {
      alerts.push({
        label: `Alta presión de RAM (${deviceInfo.ramUsedPct}% en uso)`,
        code: 'MOB-MEM-02',
        severity: 'Media',
      });
    }
    if (deviceInfo.isRooted || deviceInfo.verifiedBootState === 'orange' || deviceInfo.verifiedBootState === 'red') {
      alerts.push({
        label: `Integridad alterada (Root: ${deviceInfo.isRooted ? 'Sí' : 'No'} · Boot: ${deviceInfo.verifiedBootState || 'N/D'})`,
        code: 'MOB-SEC-02',
        severity: 'Alta',
      });
    }
    if (deviceInfo.isEmulator) {
      alerts.push({
        label: 'Entorno virtualizado o sospecha de alteración de hardware',
        code: 'MOB-SEC-03',
        severity: 'Crítica',
      });
    }
    return alerts;
  }, [deviceInfo]);

  const activeBranch = useMemo(
    () => DIAGNOSTIC_TREE.find((b) => b.id === selectedBranchId) || null,
    [selectedBranchId]
  );

  const searchResults = useMemo(() => {
    const q = normalizeText(searchTerm).trim();
    if (!q) return allCases;
    return allCases.filter((c) =>
      normalizeText(`${c.symptom} ${c.diagnosis} ${c.category} ${c.branchTitle} ${c.code}`).includes(q)
    );
  }, [searchTerm, allCases]);

  const openCase = (caseObj) => {
    setSelectedCase(caseObj);
    setMultiResult(null);
    setCheckedSteps({});
    setSavedTicketId(null);
  };

  const resetAll = () => {
    setSelectedBranchId(null);
    setWizardStepIdx(0);
    setWizardHistory([]);
    setShowDirectList(false);
    setSelectedCase(null);
    setMultiResult(null);
    setCheckedSteps({});
    setSavedTicketId(null);
  };

  const handleWizardAnswer = (isYes) => {
    if (!activeBranch) return;
    const step = activeBranch.wizard[wizardStepIdx];
    if (!step) return;
    if (isYes) {
      if (step.yesCase && caseByCode[step.yesCase]) {
        openCase(caseByCode[step.yesCase]);
      } else if (typeof step.yesNext === 'number') {
        setWizardHistory((prev) => [...prev, wizardStepIdx]);
        setWizardStepIdx(step.yesNext);
      }
    } else {
      if (step.noCase && caseByCode[step.noCase]) {
        openCase(caseByCode[step.noCase]);
      } else if (typeof step.noNext === 'number') {
        setWizardHistory((prev) => [...prev, wizardStepIdx]);
        setWizardStepIdx(step.noNext);
      }
    }
  };

  const handleWizardBack = () => {
    if (wizardHistory.length > 0) {
      const prev = wizardHistory[wizardHistory.length - 1];
      setWizardHistory((h) => h.slice(0, -1));
      setWizardStepIdx(prev);
    } else {
      setSelectedBranchId(null);
    }
  };

  const toggleMultiCode = (code) => {
    setMultiSelectedCodes((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  };

  const runMultiAnalysis = () => {
    const chosen = multiSelectedCodes.map((c) => caseByCode[c]).filter(Boolean);
    if (chosen.length === 0) return;
    chosen.sort((a, b) => (SEV_RANK[b.severity] || 0) - (SEV_RANK[a.severity] || 0));
    const top = chosen[0];
    const combinedSteps = [];
    const seen = new Set();
    for (const c of chosen) {
      for (const st of c.steps) {
        if (!seen.has(st)) {
          seen.add(st);
          combinedSteps.push(`[${c.category}] ${st}`);
        }
      }
    }
    const avgHw = Math.round(chosen.reduce((acc, c) => acc + (c.hwPct ?? 50), 0) / chosen.length);
    setMultiResult({
      code: `MULTI-${chosen.length}S`,
      severity: top.severity,
      hwPct: avgHw,
      componentKey: top.componentKey,
      category: `Análisis Multisíntoma (${chosen.length} hallazgos)`,
      symptom: chosen.map((c) => c.symptom).join(' + '),
      diagnosis:
        chosen.length > 1
          ? `Se detectó correlación entre ${chosen.length} síntomas. Prioridad principal: ${top.diagnosis}`
          : top.diagnosis,
      cases: chosen,
      steps: combinedSteps.slice(0, 10),
    });
    setSelectedCase(null);
    setCheckedSteps({});
    setSavedTicketId(null);
  };

  const activeReport = selectedCase || multiResult;

  const handleSaveCloudReport = async () => {
    if (!activeReport) return;
    setSavingTicket(true);
    try {
      const score =
        activeReport.severity === 'Crítica'
          ? 45
          : activeReport.severity === 'Alta'
          ? 65
          : activeReport.severity === 'Media'
          ? 78
          : 88;
      const extraErrors = activeReport.cases
        ? activeReport.cases.map((c) => ({
            severidad: c.severity === 'Crítica' ? 'critica' : c.severity === 'Alta' ? 'alta' : 'media',
            area: c.category,
            mensaje: c.symptom,
          }))
        : [
            {
              severidad:
                activeReport.severity === 'Crítica'
                  ? 'critica'
                  : activeReport.severity === 'Alta'
                  ? 'alta'
                  : 'media',
              area: activeReport.category,
              mensaje: `${activeReport.symptom} — ${activeReport.diagnosis}`,
            },
          ];

      const tid = await recordMobileEvent({
        user,
        deviceInfo: deviceInfo || { displayName: 'Dispositivo Móvil', os: 'Android' },
        tipoEvento: activeReport.cases ? 'Diagnóstico Multisíntoma' : 'Diagnóstico Experto Móvil',
        prefix: 'DIAG',
        diagnostico: `[${activeReport.code}] ${activeReport.category} — ${activeReport.diagnosis}`,
        solucion: activeReport.steps.map((s, i) => `${i + 1}. ${s}`).join('\n'),
        healthScore: score,
        extraErrors,
      });
      setSavedTicketId(tid || 'LOCAL-OK');
    } finally {
      setSavingTicket(false);
    }
  };

  const sevBadgeClass = (sev) => {
    if (sev === 'Crítica') return 'bg-rose-500/15 text-rose-300 border-rose-500/35';
    if (sev === 'Alta') return 'bg-amber-500/15 text-amber-300 border-amber-500/35';
    if (sev === 'Media') return 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30';
    return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
  };

  const completedStepsCount = activeReport
    ? activeReport.steps.filter((_, idx) => Boolean(checkedSteps[idx])).length
    : 0;

  return (
    <div className="h-full w-full overflow-y-auto bg-[#090c12] text-slate-100 p-4 md:p-5 lg:p-6 pb-28 md:pb-24">
      <div className="max-w-3xl md:max-w-none xl:max-w-[1440px] mx-auto space-y-4">
        {/* Encabezado */}
        <div className="instrument-card rounded-2xl p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
                <Stethoscope className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-emerald-400 font-semibold">
                  Motor Experto Móvil Pro · 8 Ramas · {allCases.length} Casos
                </p>
                <h2 className="text-base font-semibold text-white leading-tight">
                  Árbol de Diagnóstico Interactivo
                </h2>
              </div>
            </div>
            {(activeBranch || activeReport) && (
              <button
                type="button"
                onClick={resetAll}
                className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 rounded-lg bg-[#101521] border border-slate-700 text-slate-300 hover:text-white shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Inicio
              </button>
            )}
          </div>

          {/* Selector de 3 Modos */}
          {!activeReport && (
            <div className="grid grid-cols-3 gap-1.5 bg-[#101521] p-1 rounded-xl border border-slate-800/90 lg:min-w-[380px]">
              {[
                { id: 'tree', label: 'Árbol Guiado', icon: GitBranch },
                { id: 'multi', label: `Multisíntoma${multiSelectedCodes.length ? ` (${multiSelectedCodes.length})` : ''}`, icon: Layers },
                { id: 'search', label: 'Buscador', icon: Search },
              ].map((m) => {
                const MIcon = m.icon;
                const active = mode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setMode(m.id);
                      if (m.id !== 'tree') setSelectedBranchId(null);
                    }}
                    className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-[11px] font-semibold border ${
                      active
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35'
                        : 'text-slate-400 border-transparent hover:text-slate-200'
                    }`}
                  >
                    <MIcon className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{m.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Auto-Triaje en Vivo con Sensores Reales */}
        {!activeReport && !activeBranch && liveAlerts.length > 0 && (
          <div className="bg-amber-500/[0.07] border border-amber-500/30 rounded-2xl p-4 space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
              <Sparkles className="w-4 h-4 shrink-0" />
              Auto-Triaje en Vivo: {liveAlerts.length} alerta{liveAlerts.length === 1 ? '' : 's'} detectada{liveAlerts.length === 1 ? '' : 's'} en tus sensores
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              {liveAlerts.map((al, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-2 bg-[#101521]/90 border border-amber-500/20 rounded-xl px-3 py-2"
                >
                  <div className="min-w-0">
                    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border mr-1.5 ${sevBadgeClass(al.severity)}`}>
                      {al.severity}
                    </span>
                    <span className="text-xs text-slate-200">{al.label}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => caseByCode[al.code] && openCase(caseByCode[al.code])}
                    className="shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/30"
                  >
                    Diagnosticar
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* VISTA 1: DICTAMEN COMPLETO (Caso único o Multisíntoma) */}
        {activeReport ? (
          <div className="view-enter space-y-4">
            <div className="instrument-card rounded-2xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono font-bold px-2.5 py-0.5 rounded-lg bg-cyan-500/12 text-cyan-300 border border-cyan-500/25">
                    {activeReport.code}
                  </span>
                  <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-lg border ${sevBadgeClass(activeReport.severity)}`}>
                    Severidad {activeReport.severity}
                  </span>
                </div>
                <span className="text-[11px] text-slate-400 font-medium">{activeReport.category}</span>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-white leading-snug">{activeReport.symptom}</h3>
                <p className="text-xs text-slate-300 mt-1.5 leading-relaxed bg-[#101521] border border-slate-800 rounded-xl p-3">
                  <strong className="text-cyan-300">Causa raíz probable: </strong>
                  {activeReport.diagnosis}
                </p>
              </div>

              {/* Indicador Probabilidad Hardware vs Software */}
              <div className="space-y-1.5 bg-[#101521]/80 border border-slate-800/90 rounded-xl p-3">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-amber-300 font-semibold">Hardware: {activeReport.hwPct ?? 50}%</span>
                  <span className="text-slate-500 flex items-center gap-1 text-[10px]">
                    <Activity className="w-3 h-3" /> Probabilidad de origen
                  </span>
                  <span className="text-emerald-300 font-semibold">Software: {100 - (activeReport.hwPct ?? 50)}%</span>
                </div>
                <div className="h-2 rounded-full bg-emerald-500/30 overflow-hidden flex">
                  <div
                    className="h-full bg-amber-400 transition-all duration-300"
                    style={{ width: `${activeReport.hwPct ?? 50}%` }}
                  />
                </div>
              </div>

              {/* Checklist Interactivo de Reparación Paso a Paso */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
                    <ListChecks className="w-4 h-4" /> Plan de Acción Interactivo (marca cada paso)
                  </h4>
                  <span className="text-[11px] font-mono text-slate-400">
                    {completedStepsCount}/{activeReport.steps.length} hechos
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-emerald-400 transition-all duration-300"
                    style={{
                      width: `${activeReport.steps.length ? Math.round((completedStepsCount / activeReport.steps.length) * 100) : 0}%`,
                    }}
                  />
                </div>
                <div className="space-y-2">
                  {activeReport.steps.map((step, idx) => {
                    const done = Boolean(checkedSteps[idx]);
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setCheckedSteps((prev) => ({ ...prev, [idx]: !prev[idx] }))}
                        className={`w-full text-left flex items-start gap-2.5 p-3 rounded-xl border text-xs leading-relaxed ${
                          done
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200 line-through opacity-80'
                            : 'bg-[#101521] border-slate-800 text-slate-200 hover:border-cyan-500/35'
                        }`}
                      >
                        {done ? (
                          <CheckSquare className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                        )}
                        <span>
                          <strong className="font-mono text-cyan-400 mr-1.5">{idx + 1}.</strong>
                          {step}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Acciones del Dictamen: Guardar en Reporte Global + Ver en 3D */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2">
                <button
                  type="button"
                  disabled={savingTicket}
                  onClick={handleSaveCloudReport}
                  className="py-2.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#03160f] font-semibold text-xs flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  <CloudUpload className="w-4 h-4" />
                  {savingTicket
                    ? 'Guardando Reporte…'
                    : savedTicketId
                    ? `Guardado (${savedTicketId})`
                    : 'Guardar en Reporte Global'}
                </button>
                {onOpenPhone3D && (
                  <button
                    type="button"
                    onClick={() =>
                      onOpenPhone3D({
                        deviceInfo,
                        ticketId: savedTicketId || activeReport.code,
                        healthScore: activeReport.severity === 'Crítica' ? 48 : 72,
                        diagnostico: `${activeReport.category}: ${activeReport.diagnosis}`,
                        solucion: activeReport.steps.map((s, i) => `${i + 1}. ${s}`).join('\n'),
                        affectedComponent: activeReport.componentKey,
                      })
                    }
                    className="py-2.5 px-4 rounded-xl bg-[#172033] hover:bg-[#202e48] border border-cyan-500/35 text-cyan-200 font-semibold text-xs flex items-center justify-center gap-2"
                  >
                    <Box className="w-4 h-4" /> Ver Pieza Afectada en 3D
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : mode === 'search' ? (
          /* VISTA 2: BUSCADOR INSTANTÁNEO DE LOS 28 CASOS */
          <div className="view-enter space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Describe el problema: ej. agua, pantalla negra, se calienta, wifi, huella, clon…"
                className="w-full bg-[#101521] border border-slate-700 focus:border-emerald-400 rounded-xl pl-10 pr-3 py-3 text-sm text-white outline-none"
              />
            </div>
            <p className="text-[11px] text-slate-400 px-1">
              {searchResults.length} caso{searchResults.length === 1 ? '' : 's'} clínico{searchResults.length === 1 ? '' : 's'} encontrado{searchResults.length === 1 ? '' : 's'}
            </p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
              {searchResults.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => openCase(c)}
                  className="w-full text-left instrument-card hover:border-cyan-500/40 rounded-xl p-3.5 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 mb-1">
                      <span className="text-[10px] font-mono text-cyan-300">{c.code}</span>
                      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${sevBadgeClass(c.severity)}`}>
                        {c.severity}
                      </span>
                      <span className="text-[10px] text-slate-400">{c.branchTitle}</span>
                    </div>
                    <p className="text-xs font-semibold text-white">{c.symptom}</p>
                    <p className="text-[11px] text-slate-400 truncate mt-0.5">{c.diagnosis}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                </button>
              ))}
            </div>
          </div>
        ) : mode === 'multi' ? (
          /* VISTA 3: DIAGNÓSTICO MULTISÍNTOMA COMBINADO */
          <div className="view-enter space-y-3">
            <div className="instrument-card rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-white">Selecciona todos los síntomas que presenta tu equipo</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  El motor cruzará los síntomas para crear un plan priorizado por gravedad.
                </p>
              </div>
              <button
                type="button"
                disabled={multiSelectedCodes.length === 0}
                onClick={runMultiAnalysis}
                className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#03160f] font-semibold text-xs disabled:opacity-40"
              >
                Analizar {multiSelectedCodes.length || ''} Síntoma{multiSelectedCodes.length === 1 ? '' : 's'} →
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
              {DIAGNOSTIC_TREE.map((branch) => {
                const BIcon = branch.icon;
                return (
                  <div key={branch.id} className="instrument-card rounded-2xl p-3.5 space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-white">
                      <BIcon className={`w-4 h-4 ${branch.color}`} />
                      {branch.title}
                    </div>
                    <div className="space-y-1.5">
                      {branch.cases.map((c) => {
                        const checked = multiSelectedCodes.includes(c.code);
                        return (
                          <button
                            key={c.code}
                            type="button"
                            onClick={() => toggleMultiCode(c.code)}
                            className={`w-full text-left flex items-center gap-2.5 p-2.5 rounded-xl border text-xs ${
                              checked
                                ? 'bg-emerald-500/12 border-emerald-500/35 text-emerald-200'
                                : 'bg-[#101521] border-slate-800 text-slate-300 hover:border-slate-700'
                            }`}
                          >
                            {checked ? (
                              <CheckSquare className="w-4 h-4 text-emerald-400 shrink-0" />
                            ) : (
                              <Square className="w-4 h-4 text-slate-500 shrink-0" />
                            )}
                            <span className="flex-1">{c.symptom}</span>
                            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border shrink-0 ${sevBadgeClass(c.severity)}`}>
                              {c.severity}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : activeBranch ? (
          /* VISTA 4: ASISTENTE INTERACTIVO SÍ/NO DE LA RAMA SELECCIONADA */
          <div className="view-enter space-y-4">
            <div className="instrument-card rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={handleWizardBack}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-cyan-300 hover:text-white"
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> {wizardHistory.length > 0 ? 'Pregunta anterior' : 'Volver a ramas'}
                </button>
                <span className="text-[11px] font-mono text-slate-400">
                  Paso {wizardStepIdx + 1} de {activeBranch.wizard.length}
                </span>
              </div>

              <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-cyan-400 transition-all duration-300"
                  style={{ width: `${Math.round(((wizardStepIdx + 1) / activeBranch.wizard.length) * 100)}%` }}
                />
              </div>

              <div className="flex items-center gap-2.5">
                {(() => {
                  const BIcon = activeBranch.icon;
                  return (
                    <div className={`w-9 h-9 rounded-xl ${activeBranch.bg} border ${activeBranch.border} flex items-center justify-center shrink-0`}>
                      <BIcon className={`w-4 h-4 ${activeBranch.color}`} />
                    </div>
                  );
                })()}
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Triaje Interactivo</p>
                  <h3 className="text-sm font-semibold text-white">{activeBranch.title}</h3>
                </div>
              </div>

              {!showDirectList && activeBranch.wizard[wizardStepIdx] ? (
                <div className="space-y-4 pt-1">
                  <p className="text-sm font-medium text-slate-100 leading-relaxed bg-[#101521] border border-slate-800 rounded-xl p-4">
                    {activeBranch.wizard[wizardStepIdx].q}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => handleWizardAnswer(true)}
                      className="py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#03160f] font-bold text-sm"
                    >
                      ✔ Sí, ocurre esto
                    </button>
                    <button
                      type="button"
                      onClick={() => handleWizardAnswer(false)}
                      className="py-3.5 rounded-xl bg-[#172033] hover:bg-[#202e48] border border-slate-700 text-slate-100 font-semibold text-sm"
                    >
                      ✖ No, continuar
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="pt-2 border-t border-white/[0.05]">
                <button
                  type="button"
                  onClick={() => setShowDirectList((v) => !v)}
                  className="text-xs text-cyan-300 hover:text-cyan-200 font-medium"
                >
                  {showDirectList ? '↑ Volver a preguntas guiadas' : `Ver los ${activeBranch.cases.length} casos directos de ${activeBranch.title} →`}
                </button>
                {showDirectList && (
                  <div className="space-y-2 mt-3">
                    {activeBranch.cases.map((c) => (
                      <button
                        key={c.code}
                        type="button"
                        onClick={() =>
                          openCase({
                            ...c,
                            branchId: activeBranch.id,
                            branchTitle: activeBranch.title,
                            componentKey: activeBranch.componentKey,
                          })
                        }
                        className="w-full text-left bg-[#101521] hover:bg-[#172033] border border-slate-800 hover:border-cyan-500/35 rounded-xl p-3 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border mr-1.5 ${sevBadgeClass(c.severity)}`}>
                            {c.severity}
                          </span>
                          <span className="text-xs font-medium text-slate-100">{c.symptom}</span>
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* VISTA 5: GRILLA DE LAS 8 RAMAS ESPECIALIZADAS */
          <div className="view-enter grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {DIAGNOSTIC_TREE.map((branch) => {
              const BIcon = branch.icon;
              return (
                <button
                  key={branch.id}
                  type="button"
                  onClick={() => {
                    setSelectedBranchId(branch.id);
                    setWizardStepIdx(0);
                    setWizardHistory([]);
                    setShowDirectList(false);
                  }}
                  className="text-left instrument-card hover:border-cyan-500/40 rounded-2xl p-4 flex items-start gap-3.5"
                >
                  <div className={`w-10 h-10 rounded-xl ${branch.bg} border ${branch.border} flex items-center justify-center shrink-0`}>
                    <BIcon className={`w-5 h-5 ${branch.color}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-white truncate">{branch.title}</h3>
                      <span className="text-[10px] font-mono text-slate-400 shrink-0">{branch.cases.length} casos</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1 leading-snug">{branch.subtitle}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
