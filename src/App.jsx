/**
 * App.jsx — Componente raíz de IndiServ Web3D y APK Android.
 * Coordina autenticación, escáner nativo, diagnóstico, mantenimiento, tickets privados y visor 3D.
 */

import React, { Suspense, lazy, useEffect, useState, useCallback, useMemo } from 'react';
import { Capacitor } from '@capacitor/core';
import TechSidebar from './components/TechSidebar';
import MobileAuthView from './components/MobileAuthView';
import MobileScannerView from './components/MobileScannerView';
import MobileDiagnosticView from './components/MobileDiagnosticView';
import MobileMaintenanceView from './components/MobileMaintenanceView';
import MobileAccountView from './components/MobileAccountView';
import TicketLookupBar from './components/TicketLookupBar';

const ChassisScene = lazy(() => import('./components/ChassisScene'));
import { mapTelemetryTo3DProfile } from './utils/hardwareMapper';
import { supabase } from './supabaseClient';
import {
  installBrowserConsoleHoneypot,
  isHoneyTicket,
  triggerHoneytokenAlert,
  hydrateNativeSession,
  loadSessionToken,
  clearSessionToken,
  callAuthOtp,
} from './utils/security';
import {
  RotateCcw, Maximize2, Minimize2, EyeOff, Eye, FileDown, Laptop, Monitor,
  Box, Search, Smartphone, LogOut, Stethoscope, Snowflake, ArrowLeft, User,
} from 'lucide-react';

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
    ? new Date(data.fecha_creacion).toLocaleString('es-ES', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : new Date().toLocaleDateString();

  const baseSpecs = [data.cpu, data.ram, data.gpu, data.almacenamiento].filter(Boolean).join(' · ');

  return {
    id_ticket: data.id_ticket,
    ticket_id: data.id_ticket,
    fecha_creacion: data.fecha_creacion || null,
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

const MemoizedChassisScene = React.memo(ChassisScene, (prevProps, nextProps) => {
  return prevProps.explodedView === nextProps.explodedView
      && prevProps.telemetry === nextProps.telemetry
      && prevProps.profile === nextProps.profile;
});

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

  const [authUser, setAuthUser] = useState(null);
  const [authNotice, setAuthNotice] = useState('');
  const [restoringSession, setRestoringSession] = useState(() => isNativeApp || Boolean(loadSessionToken()));
  const [guestUnlocked, setGuestUnlocked] = useState(!isNativeApp || Boolean(initialTicketParam));

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const saved = await hydrateNativeSession();
        if (!active) return;
        if (!saved) {
          setRestoringSession(false);
          return;
        }
        const res = await callAuthOtp({
          action: 'session_validate',
          session_token: saved.token,
          device_hash: saved.deviceHash,
        });
        if (!active) return;
        if (res?.ok && res?.user) {
          setAuthUser(res.user);
        } else {
          clearSessionToken();
        }
      } catch {
        if (active) clearSessionToken();
      } finally {
        if (active) setRestoringSession(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const handleLogout = useCallback(() => {
    const saved = loadSessionToken();
    clearSessionToken();
    setAuthUser(null);
    setAuthNotice('');
    setGuestUnlocked(false);
    setTabHistory([]);
    if (saved) {
      callAuthOtp({
        action: 'session_logout',
        session_token: saved.token,
        device_hash: saved.deviceHash,
      }).catch(() => {});
    }
  }, []);

  const handleAccountDeleted = useCallback((ticketsEliminados = 0) => {
    clearSessionToken();
    setAuthUser(null);
    setGuestUnlocked(false);
    setTabHistory([]);
    setAuthNotice(
      `Cuenta eliminada permanentemente junto con ${ticketsEliminados} ticket(s) de diagnóstico.`
    );
  }, []);

  const handleSessionExpired = useCallback(() => {
    clearSessionToken();
    setAuthUser(null);
    setGuestUnlocked(false);
    setTabHistory([]);
    setAuthNotice('Tu sesión segura de 15 minutos expiró. Vuelve a iniciar sesión.');
  }, []);

  const handleUserUpdated = useCallback((patch) => {
    setAuthUser((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);
  const [activeTab, setActiveTab] = useState(isNativeApp && !initialTicketParam ? 'scanner' : '3d');
  const [tabHistory, setTabHistory] = useState([]);
  const [mobileDeviceInfo, setMobileDeviceInfo] = useState(null);

  const navigateToTab = useCallback((nextTab) => {
    setActiveTab((prev) => {
      if (prev === nextTab) return prev;
      setTabHistory((hist) => [...hist.slice(-11), prev]);
      return nextTab;
    });
  }, []);

  const goBackTab = useCallback(() => {
    if (tabHistory.length > 0) {
      const prevTab = tabHistory[tabHistory.length - 1];
      setTabHistory((hist) => hist.slice(0, -1));
      setActiveTab(prevTab);
      return true;
    }
    if (activeTab !== 'scanner' && (isNativeApp || !initialTicketParam)) {
      setActiveTab('scanner');
      return true;
    }
    return false;
  }, [tabHistory, activeTab, isNativeApp, initialTicketParam]);

  useEffect(() => {
    window.__indiservHandleBack = () => {
      const handled = goBackTab();
      return handled ? 'handled' : 'exit';
    };
    return () => {
      delete window.__indiservHandleBack;
    };
  }, [goBackTab]);

  const [telemetry, setTelemetry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isLive, setIsLive] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);

  const [selectedComponent, setSelectedComponent] = useState(null);
  const [explodedView, setExplodedView] = useState(false);
  const [showCase, setShowCase] = useState(true);
  const [resetCameraFn, setResetCameraFn] = useState(null);

  const profile = useMemo(() => mapTelemetryTo3DProfile(telemetry), [telemetry]);

  const loadTicketById = useCallback(async (ticketIdRaw, tipoParam = '', shareTokenRaw = '') => {
    const ticketParam = (ticketIdRaw || '').trim();
    const stParam = (shareTokenRaw || '').trim();
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
      const saved = loadSessionToken();
      const reqBody = {
        action: 'ticket_get_public',
        ticket_id: ticketParam,
        ...(stParam ? { share_token: stParam } : {}),
        ...(saved ? { session_token: saved.token, device_hash: saved.deviceHash } : {}),
      };
      let res = await callAuthOtp(reqBody);
      if (!res?.ok && ticketParam) {
        await new Promise((r) => setTimeout(r, 1200));
        res = await callAuthOtp(reqBody);
      }
      const data = res?.ok ? res.ticket : null;

      if (!data) {
        setStatusMessage(`[${res?.error || (res?.error_conexion ? 'Error al consultar ticket' : 'Ticket no encontrado')}]`);
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

  useEffect(() => {
    installBrowserConsoleHoneypot();
    const params = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
    const ticketParam = params.get('ticket')?.trim() || '';
    const tipoParam = params.get('tipo')?.trim()?.toLowerCase() || '';
    // Priorizar #st=... (hash fragment que nunca viaja al servidor en logs HTTP) con fallback a ?st=
    const stParam = hashParams.get('st')?.trim() || params.get('st')?.trim() || '';

    // Limpiar el token compartido de la barra de dirección inmediatamente tras leerlo en memoria
    if (stParam && typeof window !== 'undefined' && window.history?.replaceState) {
      try {
        params.delete('st');
        const cleanQuery = params.toString();
        const cleanUrl = `${window.location.pathname}${cleanQuery ? `?${cleanQuery}` : ''}`;
        window.history.replaceState(null, '', cleanUrl);
      } catch {
        // Ignorar en entornos restringidos
      }
    }

    const trapParams = ['admin', 'debug', 'dump', 'sql', 'config', 'env', 'backup'];
    const touchedTrap = trapParams.find((p) => params.has(p));
    if (touchedTrap) {
      triggerHoneytokenAlert(
        'URL_RECON_PARAMETER',
        `Parámetro trampa '?${touchedTrap}=${params.get(touchedTrap)}' detectado en URL`
      );
    }
    if (ticketParam && isHoneyTicket(ticketParam)) {
      triggerHoneytokenAlert(
        'TICKET_SENUELO_URL',
        `Acceso directo por URL a ticket trampa '?ticket=${ticketParam.slice(0, 80)}'`
      );
    }

    loadTicketById(ticketParam, tipoParam, stParam);
  }, [loadTicketById]);

  const handleSelectTicketFromMobile = useCallback(async (idTicket, shareToken = '') => {
    navigateToTab('3d');
    await loadTicketById(idTicket, '', shareToken);
  }, [loadTicketById, navigateToTab]);

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
    navigateToTab('3d');
  }, [mobileDeviceInfo, navigateToTab]);

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

  const showAppNav = isNativeApp || !initialTicketParam;
  const canGoBack = tabHistory.length > 0 || (showAppNav && activeTab !== 'scanner');

  const open3DTabSmart = useCallback(() => {
    if (mobileDeviceInfo && (!telemetry || telemetry.id_ticket === 'TKT-DEMO-OFFLINE')) {
      handleOpenPhone3D({ deviceInfo: mobileDeviceInfo });
    } else {
      navigateToTab('3d');
    }
  }, [mobileDeviceInfo, telemetry, handleOpenPhone3D, navigateToTab]);

  if (restoringSession && !guestUnlocked && !authUser) {
    return (
      <div className="min-h-screen w-full bg-[#090c12] text-slate-100 flex flex-col items-center justify-center p-4">
        <div className="w-8 h-8 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-xs font-medium text-slate-300">Verificando sesión segura (15 min)…</p>
      </div>
    );
  }

  if (!guestUnlocked && !authUser) {
    return (
      <MobileAuthView
        initialNotice={authNotice}
        onAuthenticated={(user) => {
          setAuthNotice('');
          setAuthUser(user);
          setTabHistory([]);
          setActiveTab('scanner');
        }}
        onGuestDemo={() => {
          setAuthNotice('');
          setGuestUnlocked(true);
          setTabHistory([]);
          setActiveTab('scanner');
        }}
      />
    );
  }

  return (
    <div className="w-screen h-screen flex flex-col md:flex-row bg-zinc-950 font-sans text-zinc-100 overflow-hidden relative">

      {showAppNav && (
        <aside className="hidden md:flex flex-col items-center justify-between w-[80px] shrink-0 bg-[#101521] border-r border-slate-800/80 py-3.5 px-2 z-30 shadow-[inset_-1px_0_0_rgba(255,255,255,0.03)]">
          <div className="flex flex-col items-center gap-2 w-full">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/12 border border-emerald-500/30 flex items-center justify-center mb-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
              <div className="w-3 h-3 bg-emerald-400 rounded-[3px] shadow-[0_0_10px_rgba(16,185,129,0.65)]" />
            </div>
            {canGoBack && (
              <button
                onClick={goBackTab}
                className="w-full flex flex-col items-center gap-0.5 py-2 px-1 rounded-xl bg-[#161f32] hover:bg-[#1e2a42] text-cyan-300 border border-cyan-500/25 mb-1"
                title="Retroceder"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="text-[9px] font-semibold">Atrás</span>
              </button>
            )}
            <TabletNavBtn icon={Smartphone} label="Equipo" active={activeTab === 'scanner'} onClick={() => navigateToTab('scanner')} />
            <TabletNavBtn icon={Stethoscope} label="Diagnóst." active={activeTab === 'diagnostic'} onClick={() => navigateToTab('diagnostic')} />
            <TabletNavBtn icon={Snowflake} label="Cuidado" active={activeTab === 'maintenance'} onClick={() => navigateToTab('maintenance')} />
            <TabletNavBtn icon={Search} label="Tickets" active={activeTab === 'tickets'} onClick={() => navigateToTab('tickets')} />
            <TabletNavBtn icon={Box} label="Visor 3D" active={activeTab === '3d'} onClick={open3DTabSmart} />
            <TabletNavBtn icon={User} label="Cuenta" active={activeTab === 'account'} onClick={() => navigateToTab('account')} avatarUrl={authUser?.avatar_data} />
          </div>
          {(isNativeApp || authUser) && (
            <TabletNavBtn
              icon={LogOut}
              label="Salir"
              active={false}
              onClick={handleLogout}
            />
          )}
        </aside>
      )}

      {activeTab === 'scanner' ? (
        <div key="tab-scanner" className="view-enter flex-1 overflow-hidden flex flex-col bg-[#090c12]">
          <MobileScannerView
            user={authUser}
            onDeviceScanned={setMobileDeviceInfo}
            onOpenPhone3D={handleOpenPhone3D}
            onOpenDiagnostic={() => navigateToTab('diagnostic')}
            onOpenMaintenance={() => navigateToTab('maintenance')}
          />
        </div>
      ) : activeTab === 'diagnostic' ? (
        <div key="tab-diagnostic" className="view-enter flex-1 overflow-hidden flex flex-col bg-[#090c12]">
          {canGoBack && (
            <div className="shrink-0 safe-top bg-[#101521] border-b border-slate-800/80 px-3.5 py-2.5 flex items-center justify-between gap-2">
              <button
                onClick={goBackTab}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-300 hover:text-white bg-[#172033] border border-slate-700/70 px-3 py-1.5 rounded-lg shrink-0"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Atrás
              </button>
              <span className="text-xs font-semibold text-slate-200 tracking-wide truncate">Diagnóstico Experto</span>
              <span className="w-16 shrink-0" />
            </div>
          )}
          <div className="flex-1 overflow-hidden">
            <MobileDiagnosticView
              deviceInfo={mobileDeviceInfo}
              user={authUser}
              onOpenPhone3D={handleOpenPhone3D}
            />
          </div>
        </div>
      ) : activeTab === 'maintenance' ? (
        <div key="tab-maintenance" className="view-enter flex-1 overflow-hidden flex flex-col bg-[#090c12]">
          {canGoBack && (
            <div className="shrink-0 safe-top bg-[#101521] border-b border-slate-800/80 px-3.5 py-2.5 flex items-center justify-between gap-2">
              <button
                onClick={goBackTab}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-300 hover:text-white bg-[#172033] border border-slate-700/70 px-3 py-1.5 rounded-lg shrink-0"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Atrás
              </button>
              <span className="text-xs font-semibold text-slate-200 tracking-wide truncate">Enfriamiento y Cuidado</span>
              <span className="w-16 shrink-0" />
            </div>
          )}
          <div className="flex-1 overflow-hidden">
            <MobileMaintenanceView
              deviceInfo={mobileDeviceInfo}
              user={authUser}
            />
          </div>
        </div>
      ) : activeTab === 'tickets' ? (
        <div key="tab-tickets" className="view-enter flex-1 overflow-hidden flex flex-col bg-[#090c12]">
          {canGoBack && (
            <div className="shrink-0 safe-top bg-[#101521] border-b border-slate-800/80 px-3.5 py-2.5 flex items-center justify-between gap-2">
              <button
                onClick={goBackTab}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-300 hover:text-white bg-[#172033] border border-slate-700/70 px-3 py-1.5 rounded-lg shrink-0"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Atrás
              </button>
              <span className="text-xs font-semibold text-slate-200 tracking-wide truncate">Mis Tickets Privados</span>
              <span className="w-16 shrink-0" />
            </div>
          )}
          <div className="flex-1 overflow-hidden">
            <TicketLookupBar
              user={authUser}
              onSelectTicket={handleSelectTicketFromMobile}
              onRequestLogin={() => setGuestUnlocked(false)}
            />
          </div>
        </div>
      ) : activeTab === 'account' ? (
        <div key="tab-account" className="view-enter flex-1 overflow-hidden flex flex-col bg-[#090c12]">
          {canGoBack && (
            <div className="shrink-0 safe-top bg-[#101521] border-b border-slate-800/80 px-3.5 py-2.5 flex items-center justify-between gap-2">
              <button
                onClick={goBackTab}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-300 hover:text-white bg-[#172033] border border-slate-700/70 px-3 py-1.5 rounded-lg shrink-0"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Atrás
              </button>
              <span className="text-xs font-semibold text-slate-200 tracking-wide truncate">Mi Cuenta y Seguridad</span>
              {authUser ? (
                <button
                  onClick={handleLogout}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-rose-300 hover:text-rose-200 bg-rose-500/10 border border-rose-500/25 px-2.5 py-1.5 rounded-lg shrink-0"
                >
                  <LogOut className="w-3.5 h-3.5" /> Salir
                </button>
              ) : (
                <span className="w-16 shrink-0" />
              )}
            </div>
          )}
          <div className="flex-1 overflow-hidden">
            <MobileAccountView
              user={authUser}
              onUserUpdated={handleUserUpdated}
              onAccountDeleted={handleAccountDeleted}
              onSessionExpired={handleSessionExpired}
              onRequestLogin={() => setGuestUnlocked(false)}
            />
          </div>
        </div>
      ) : (
        <>

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
                <Suspense
                  fallback={
                    <div className="absolute inset-0 flex items-center justify-center bg-[#090c12]">
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                        <span className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-medium">
                          Inicializando motor 3D WebGL
                        </span>
                      </div>
                    </div>
                  }
                >
                  <MemoizedChassisScene
                    profile={profile}
                    telemetry={telemetry}
                    onSelectComponent={handleSelect}
                    explodedView={explodedView}
                    registerReset={(fn) => setResetCameraFn(() => fn)}
                  />
                </Suspense>
              </CanvasErrorBoundary>
            )}

            <div className="absolute top-0 left-0 right-0 pointer-events-none z-10 p-3 md:p-5 flex flex-wrap items-start justify-between gap-2">

              <div className="pointer-events-auto instrument-panel flex items-center gap-2.5 rounded-2xl px-3.5 md:px-4 py-2.5">
                {canGoBack && (
                  <button
                    onClick={goBackTab}
                    className="flex items-center gap-1 text-[11px] font-semibold text-cyan-300 hover:text-white bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/25 px-2.5 py-1 rounded-lg mr-1"
                    title="Volver a la pantalla anterior"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" /> Atrás
                  </button>
                )}
                <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                  <div className="w-2.5 h-2.5 bg-emerald-400 rounded-[3px] shadow-[0_0_8px_rgba(16,185,129,0.7)]" />
                </div>
                <div>
                  <h1 className="text-xs md:text-sm font-semibold text-slate-100 tracking-tight leading-none">
                    IndiServ <span className="font-normal text-slate-400">Analytica</span>
                  </h1>
                  <p className="text-[9px] text-slate-400 tracking-wide mt-0.5">
                    Gemelo Digital 3D · Telemetría
                  </p>
                </div>
                {isLive ? (
                  <span className="hidden sm:flex ml-2 text-[10px] text-emerald-300 font-medium bg-emerald-500/12 border border-emerald-500/30 px-2.5 py-0.5 rounded-full items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    En Línea
                  </span>
                ) : (
                  <span className="hidden sm:inline ml-2 text-[10px] text-amber-300 font-medium bg-amber-500/12 border border-amber-500/25 px-2.5 py-0.5 rounded-full">
                    {statusMessage || 'Offline'}
                  </span>
                )}
              </div>

              <div className="pointer-events-auto instrument-panel flex items-center gap-1.5 rounded-2xl px-2 py-1.5">
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
                <div className="w-px h-5 bg-white/[0.08]" />
                <ToolbarBtn icon={RotateCcw} label="Restablecer" onClick={resetView} />
                <div className="w-px h-5 bg-white/[0.08]" />
                <ToolbarBtn icon={explodedView ? Minimize2 : Maximize2} label={explodedView ? 'Colapsar' : 'Explosión'} active={explodedView} onClick={() => { setExplodedView((v) => !v); if (!explodedView && showCase) setShowCase(false); }} />
                <ToolbarBtn icon={showCase ? EyeOff : Eye} label={showCase ? 'Sin Chasis' : 'Chasis'} onClick={() => setShowCase((v) => !v)} />
                <div className="hidden sm:block w-px h-5 bg-white/[0.08]" />
                <button onClick={() => window.print()} className="hidden sm:flex items-center gap-1.5 text-[11px] font-semibold text-[#03160f] bg-emerald-500 hover:bg-emerald-400 px-3 py-1.5 rounded-xl shadow-[0_0_16px_rgba(16,185,129,0.28)]">
                  <FileDown className="w-3.5 h-3.5" /> Reporte
                </button>
              </div>
            </div>
          </div>

          <TechSidebar
            selectedComponent={selectedComponent}
            ticketData={telemetry}
            onCloseComponent={handleSidebarAction}
          />
        </>
      )}

      {showAppNav && (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-[#101521] border-t border-slate-800/90 px-1 pt-1.5 safe-bottom flex items-center justify-around shadow-[0_-8px_24px_rgba(0,0,0,0.45)]">
          <MobileNavBtn icon={Smartphone} label="Equipo" active={activeTab === 'scanner'} onClick={() => navigateToTab('scanner')} />
          <MobileNavBtn icon={Stethoscope} label="Diagnóst." active={activeTab === 'diagnostic'} onClick={() => navigateToTab('diagnostic')} />
          <MobileNavBtn icon={Snowflake} label="Cuidado" active={activeTab === 'maintenance'} onClick={() => navigateToTab('maintenance')} />
          <MobileNavBtn icon={Search} label="Tickets" active={activeTab === 'tickets'} onClick={() => navigateToTab('tickets')} />
          <MobileNavBtn icon={Box} label="3D" active={activeTab === '3d'} onClick={open3DTabSmart} />
          <MobileNavBtn icon={User} label="Cuenta" active={activeTab === 'account'} onClick={() => navigateToTab('account')} avatarUrl={authUser?.avatar_data} />
        </nav>
      )}
    </div>
  );
}

const TabletNavBtn = React.memo(function TabletNavBtn({ icon: Icon, label, active, onClick, avatarUrl }) {
  return (
    <button
      onClick={onClick}
      className={`relative w-full min-h-[48px] flex flex-col items-center justify-center gap-1 py-2 px-1 rounded-xl ${
        active
          ? 'text-emerald-300 bg-emerald-500/12 border border-emerald-500/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
          : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.04] border border-transparent'
      }`}
    >
      {active && <span className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-r-full bg-emerald-400" />}
      {avatarUrl ? (
        <img src={avatarUrl} alt="" className="w-5 h-5 rounded-full object-cover border border-cyan-400/50" />
      ) : (
        <Icon className="w-4 h-4" />
      )}
      <span className="text-[9px] font-semibold leading-tight">{label}</span>
    </button>
  );
});

const MobileNavBtn = React.memo(function MobileNavBtn({ icon: Icon, label, active, onClick, avatarUrl }) {
  return (
    <button
      onClick={onClick}
      className={`relative min-w-[44px] min-h-[44px] flex flex-col items-center justify-center gap-0.5 px-1.5 py-1 rounded-xl ${
        active ? 'text-emerald-300 bg-emerald-500/12' : 'text-slate-400 hover:text-slate-100'
      }`}
    >
      {active && <span className="absolute top-0 left-2.5 right-2.5 h-[2px] rounded-full bg-emerald-400" />}
      {avatarUrl ? (
        <img src={avatarUrl} alt="" className="w-4 h-4 rounded-full object-cover border border-cyan-400/50" />
      ) : (
        <Icon className="w-4 h-4" />
      )}
      <span className="text-[9px] font-semibold leading-tight">{label}</span>
    </button>
  );
});

const ToolbarBtn = React.memo(function ToolbarBtn({ icon: Icon, label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-xl ${
        active
          ? 'text-emerald-300 bg-emerald-500/15 border border-emerald-500/30'
          : 'text-slate-300 hover:text-white hover:bg-white/[0.06] border border-transparent'
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
      <span className="hidden xl:inline">{label}</span>
    </button>
  );
});
