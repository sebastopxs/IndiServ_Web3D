import React, { useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import {
  Stethoscope, BatteryWarning, Cpu, HardDrive, MonitorPlay, Wifi, ShieldAlert,
  ChevronRight, ArrowLeft, Search, CheckCircle2, AlertTriangle, Wrench,
  Box, CloudUpload, RotateCcw, Sparkles,
} from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════════════════
   Árbol de Diagnóstico Experto Android (6 Ramas · 18 Casos con Soluciones)
   ═══════════════════════════════════════════════════════════════════════════ */
const DIAGNOSTIC_TREE = [
  {
    id: 'bateria',
    title: 'Batería y Carga',
    subtitle: 'Drenaje rápido, carga lenta, sobrecalentamiento o apagones',
    icon: BatteryWarning,
    color: 'text-amber-400',
    border: 'border-amber-500/25',
    bg: 'bg-amber-500/10',
    componentKey: 'Fuente de Poder',
    question: '¿Qué síntoma principal presenta la batería o el sistema de carga?',
    cases: [
      {
        code: 'MOB-BAT-01',
        symptom: 'La batería se descarga muy rápido (drenaje excesivo)',
        severity: 'Alta',
        category: 'Batería / Energía',
        diagnosis: 'Drenaje acelerado por degradación química de celda Li-ion o procesos en segundo plano con wakelocks activos.',
        steps: [
          'Verifica en Ajustes → Batería qué aplicaciones consumen más del 15% en segundo plano y restringe su actividad.',
          'Reduce la tasa de refresco de 120 Hz a 60 Hz y activa el Modo Oscuro (ahorra hasta 25% en pantallas OLED/AMOLED).',
          'Si la salud de batería reporta "Degradada" o baja del 80% de capacidad de diseño (>500 ciclos), programa reemplazo de celda.',
          'Evita descargas al 0% y mantén la carga diaria entre 20% y 85% para prolongar la vida útil.',
        ],
      },
      {
        code: 'MOB-BAT-02',
        symptom: 'Carga muy lenta, intermitente o no reconoce carga rápida',
        severity: 'Media',
        category: 'Puerto USB-C / PMIC',
        diagnosis: 'Resistencia elevada en puerto USB-C, cable defectuoso o negociación fallida del protocolo USB-PD / QuickCharge.',
        steps: [
          'Inspecciona y limpia el puerto USB-C con aire comprimido o un palillo no metálico (pelusa compactada impide el contacto).',
          'Prueba con un cargador certificado USB-PD y cable original; verifica en "Mi Android" que la fuente marque "Cargador AC" y no "Puerto USB".',
          'Revisa la corriente de carga (mA) en la tarjeta de Batería: valores menores a 500 mA en AC indican cable dañado o pin CC sulfatado.',
          'Si el fallo persiste con 2 cargadores distintos, requiere diagnóstico físico del flex de carga / IC PMIC.',
        ],
      },
      {
        code: 'MOB-BAT-03',
        symptom: 'Batería caliente (>40°C) o apagones repentinos con carga restante',
        severity: 'Crítica',
        category: 'Térmica / Celda Batería',
        diagnosis: 'Caída de voltaje bajo carga (voltage sag) por alta resistencia interna o estrés térmico de la celda.',
        steps: [
          'Desconecta el cargador inmediatamente y retira fundas gruesas si la temperatura supera los 42°C.',
          'No utilices videojuegos pesados ni cámara 4K mientras el equipo está conectado a carga rápida.',
          'Revisa el voltaje en telemetría: por debajo de 3.50 V con >20% de carga indica celda químicamente agotada.',
          'Realiza respaldo de datos y reemplaza la batería en servicio técnico para evitar hinchamiento.',
        ],
      },
    ],
  },
  {
    id: 'rendimiento',
    title: 'Rendimiento y Térmica (SoC)',
    subtitle: 'Lentitud, tirones, caídas de FPS o calentamiento del procesador',
    icon: Cpu,
    color: 'text-cyan-400',
    border: 'border-cyan-500/25',
    bg: 'bg-cyan-500/10',
    componentKey: 'Procesador/Refrigeración',
    question: '¿Cómo se manifiesta el problema de rendimiento o temperatura?',
    cases: [
      {
        code: 'MOB-CPU-01',
        symptom: 'El teléfono se calienta mucho y bajan los FPS en juegos o apps',
        severity: 'Alta',
        category: 'Thermal Throttling SoC',
        diagnosis: 'Estrangulamiento térmico (Thermal Throttling): el SoC reduce frecuencias para proteger el silicio por disipación saturada.',
        steps: [
          'Ejecuta el "Micro-Stress Test CPU" en la pestaña Mi Android y observa si los Mops/s caen drásticamente tras 4 segundos.',
          'Cierra aplicaciones pesadas en segundo plano y reduce brillo y calidad gráfica en juegos prolongados.',
          'Retira carcasas térmicamente aislantes durante cargas pesadas y evita exposición directa al sol.',
          'Actualiza las apps y el sistema operativo: parches de kernel suelen optimizar el governor del SoC.',
        ],
      },
      {
        code: 'MOB-CPU-02',
        symptom: 'Sistema lento, animaciones entrecortadas o congelamientos',
        severity: 'Media',
        category: 'CPU / Planificador SO',
        diagnosis: 'Saturación de hilos del SoC por servicios residentes, caché corrupta o almacenamiento casi lleno.',
        steps: [
          'Reinicia el dispositivo completamente (libera procesos zombis y reinicia el planificador del kernel).',
          'Verifica que tengas al menos 15% de almacenamiento libre; la memoria UFS/eMMC se degrada drásticamente al >90% de uso.',
          'Desinstala aplicaciones duplicadas de "limpieza" o antivirus redundantes que consumen CPU constante.',
          'En Opciones de Desarrollador, reduce las escalas de animación a 0.5x para mejorar la fluidez percibida.',
        ],
      },
      {
        code: 'MOB-CPU-03',
        symptom: 'Reinicios aleatorios (bootloop o pantallas congeladas)',
        severity: 'Crítica',
        category: 'Kernel / Hardware SoC',
        diagnosis: 'Kernel panic por corrupción del sistema, app con fallo nativo o inestabilidad de voltaje en placa lógica.',
        steps: [
          'Inicia en Modo Seguro de Android (mantén pulsado "Apagar" en el menú de energía) para descartar apps de terceros.',
          'Si en Modo Seguro no se reinicia, desinstala las últimas aplicaciones instaladas o actualizadas.',
          'Borra la partición de caché desde el menú Recovery (sin borrar datos de usuario).',
          'Si continúa reiniciándose en Modo Seguro, respalda tus datos y realiza restablecimiento de fábrica o revisión de placa.',
        ],
      },
    ],
  },
  {
    id: 'memoria',
    title: 'RAM y Almacenamiento',
    subtitle: 'Apps que se cierran solas, falta de espacio o lectura lenta',
    icon: HardDrive,
    color: 'text-emerald-400',
    border: 'border-emerald-500/25',
    bg: 'bg-emerald-500/10',
    componentKey: 'Almacenamiento',
    question: '¿Qué comportamiento observas en la memoria RAM o almacenamiento?',
    cases: [
      {
        code: 'MOB-MEM-01',
        symptom: 'Almacenamiento interno casi lleno (>85%) y lentitud al abrir apps',
        severity: 'Alta',
        category: 'Almacenamiento UFS/eMMC',
        diagnosis: 'Saturación de memoria flash: sin espacio libre para caché SLC y wear-leveling, la velocidad de escritura cae drásticamente.',
        steps: [
          'Libera al menos 15% a 20% del espacio total eliminando videos pesados, descargas antiguas y papelera de galería.',
          'Limpia la caché de aplicaciones de redes sociales y mensajería (WhatsApp/Telegram/TikTok suelen acumular >5 GB).',
          'Respalda fotos y videos en la nube o PC y usa "Liberar espacio" en Google Fotos / Galería.',
          'Comprueba el nuevo porcentaje de uso en la pestaña "Mi Android" tras la limpieza.',
        ],
      },
      {
        code: 'MOB-MEM-02',
        symptom: 'Las aplicaciones se recargan o cierran solas al cambiar de ventana',
        severity: 'Media',
        category: 'Memoria RAM / LMKD',
        diagnosis: 'Presión alta de memoria RAM: el demonio LMKD (Low Memory Killer) termina procesos en segundo plano por falta de RAM libre.',
        steps: [
          'Revisa el uso de RAM en "Mi Android": si supera el 85% en reposo, revisa apps con inicio automático.',
          'Desactiva widgets pesados y fondos animados que residen permanentemente en memoria.',
          'Habilita RAM Plus / Extensión de memoria (2–4 GB) solo si tienes suficiente almacenamiento UFS libre.',
          'Para apps críticas que no deben cerrarse, configúralas en "Sin restricciones" dentro de Ajustes → Batería.',
        ],
      },
      {
        code: 'MOB-MEM-03',
        symptom: 'Errores al guardar archivos, fotos corruptas o apps que no instalan',
        severity: 'Alta',
        category: 'Sistema de Archivos / Flash',
        diagnosis: 'Permisos dañados, caché de Play Store corrupta o sectores degradados en la memoria interna.',
        steps: [
          'Borra caché y datos de "Google Play Store" y "Servicios de Google Play", luego reinicia el equipo.',
          'Verifica permisos de almacenamiento de la app afectada en Ajustes → Aplicaciones.',
          'Si ocurre con archivos locales y cámara, haz copia de seguridad inmediata: podría indicar desgaste de memoria flash.',
        ],
      },
    ],
  },
  {
    id: 'pantalla',
    title: 'Pantalla y GPU',
    subtitle: 'Táctil fantasma, parpadeo, brillo bajo o fallos gráficos',
    icon: MonitorPlay,
    color: 'text-blue-400',
    border: 'border-blue-500/25',
    bg: 'bg-blue-500/10',
    componentKey: 'Tarjeta Gráfica',
    question: '¿Qué falla presenta la pantalla o los gráficos?',
    cases: [
      {
        code: 'MOB-DSP-01',
        symptom: 'Toques fantasma o zonas de la pantalla que no responden',
        severity: 'Alta',
        category: 'Digitalizador Táctil',
        diagnosis: 'Interferencia capacitiva por mica/protector dañado, humedad, cargador sin filtro o fallo del flex digitalizador.',
        steps: [
          'Desconecta el cargador: cargadores genéricos con ruido eléctrico causan toques fantasma inmediatamente.',
          'Retira temporalmente protectores de vidrio templado agrietados y limpia la superficie con paño de microfibra.',
          'Activa "Mostrar toques" en Opciones de Desarrollador para mapear si hay una franja muerta constante.',
          'Si una franja fija no responde incluso tras reiniciar, requiere cambio de módulo de pantalla/digitalizador.',
        ],
      },
      {
        code: 'MOB-DSP-02',
        symptom: 'Parpadeo de pantalla, líneas verdes/rosas o imagen quemada',
        severity: 'Crítica',
        category: 'Panel OLED/LCD / Flex',
        diagnosis: 'Daño físico en el flex COF del panel OLED/LCD o retención de fósforo (burn-in) por brillo máximo prolongado.',
        steps: [
          'Toma una captura de pantalla y ábrela en otro dispositivo: si las líneas NO aparecen en la captura, el fallo es 100% físico del panel.',
          'Desactiva "Brillo adaptable" y prueba alternar entre 60 Hz y 120 Hz para verificar si el parpadeo responde al PWM.',
          'Ante líneas verticales persistentes tras golpe o humedad, el módulo de pantalla requiere reemplazo.',
        ],
      },
      {
        code: 'MOB-DSP-03',
        symptom: 'Artefactos gráficos, texturas corruptas o cierres en apps 3D',
        severity: 'Media',
        category: 'GPU / Vulkan / WebGL',
        diagnosis: 'Caché de shaders corrupta, incompatibilidad de driver gráfico Vulkan/OpenGL ES o sobrecalentamiento de GPU.',
        steps: [
          'Borra la caché de la aplicación o juego afectado para forzar la recompilación limpia de shaders.',
          'Actualiza Android System WebView y el navegador Chrome desde Play Store.',
          'Comprueba el nombre de tu GPU en "Mi Android" y asegúrate de no tener forzados modos experimentales en Opciones de Desarrollador.',
        ],
      },
    ],
  },
  {
    id: 'conectividad',
    title: 'Conectividad y Red',
    subtitle: 'Wi-Fi inestable, datos móviles lentos, Bluetooth o GPS',
    icon: Wifi,
    color: 'text-violet-400',
    border: 'border-violet-500/25',
    bg: 'bg-violet-500/10',
    componentKey: 'Placa Base',
    question: '¿Qué interfaz de conectividad está fallando?',
    cases: [
      {
        code: 'MOB-NET-01',
        symptom: 'Wi-Fi se desconecta constantemente o navega muy lento',
        severity: 'Media',
        category: 'Módulo Wi-Fi / DNS',
        diagnosis: 'Interferencia en banda 2.4 GHz, lease DHCP corrupto o servidor DNS lento en el enrutador.',
        steps: [
          'Olvida la red Wi-Fi afectada y vuelve a conectarte; prioriza la banda de 5 GHz si estás cerca del router.',
          'Configura DNS Privado en Ajustes → Red e Internet → DNS Privado: usa `dns.google` o `one.one.one.one`.',
          'Desactiva temporalmente VPNs o proxies activos que puedan estar estrangulando el tráfico.',
          'Si falla en todas las redes Wi-Fi, ejecuta "Restablecer ajustes de Wi-Fi, datos móviles y Bluetooth".',
        ],
      },
      {
        code: 'MOB-NET-02',
        symptom: 'Sin señal móvil, llamadas cortadas o datos 4G/5G intermitentes',
        severity: 'Alta',
        category: 'Módem Celular / SIM',
        diagnosis: 'Tarjeta SIM oxidada, configuración APN incorrecta o conmutación inestable entre antenas 5G/4G.',
        steps: [
          'Activa el Modo Avión durante 20 segundos y desactívalo para forzar registro limpio en la torre celular.',
          'Extrae la bandeja SIM, limpia suavemente los contactos dorados y vuelve a insertarla.',
          'Prueba fijar el tipo de red preferida en "4G/LTE" si la cobertura 5G de tu zona es débil.',
          'Restablece los APN (Nombres de punto de acceso) a valores predeterminados de tu operador.',
        ],
      },
      {
        code: 'MOB-NET-03',
        symptom: 'Bluetooth se corta o el GPS no fija ubicación con precisión',
        severity: 'Media',
        category: 'Antena BT / GNSS',
        diagnosis: 'Caché Bluetooth saturada, ahorro de batería agresivo o calibración de brújula/GNSS pendiente.',
        steps: [
          'Desvincula el accesorio Bluetooth, reinicia el teléfono y vuelve a emparejarlo.',
          'Activa "Precisión de ubicación de Google" en Ajustes → Ubicación.',
          'Calibra la brújula moviendo el teléfono en forma de 8 en un espacio abierto lejos de imanes o fundas magnéticas.',
        ],
      },
    ],
  },
  {
    id: 'seguridad',
    title: 'Sistema y Seguridad Android',
    subtitle: 'Publicidad invasiva, apps bancarias bloqueadas o integridad',
    icon: ShieldAlert,
    color: 'text-rose-400',
    border: 'border-rose-500/25',
    bg: 'bg-rose-500/10',
    componentKey: 'Placa Base',
    question: '¿Qué alerta de sistema o seguridad estás experimentando?',
    cases: [
      {
        code: 'MOB-SEC-01',
        symptom: 'Anuncios emergentes en pantalla o apps desconocidas instaladas',
        severity: 'Alta',
        category: 'Adware / Seguridad SO',
        diagnosis: 'Aplicación maliciosa (adware) con permiso de superposición en pantalla o notificaciones abusivas del navegador.',
        steps: [
          'Abre Play Store → Menú → Play Protect y ejecuta un análisis completo de aplicaciones.',
          'Revisa Ajustes → Aplicaciones → Acceso especial → "Mostrar sobre otras apps" y revoca apps sospechosas o sin ícono.',
          'En Chrome, ve a Configuración → Notificaciones y bloquea sitios web desconocidos que envían spam.',
          'Desinstala aplicaciones recientes instaladas fuera de Google Play (archivos APK de fuentes no verificadas).',
        ],
      },
      {
        code: 'MOB-SEC-02',
        symptom: 'Apps bancarias o pagos NFC bloqueados por seguridad',
        severity: 'Alta',
        category: 'Integridad / Play Integrity',
        diagnosis: 'Bootloader desbloqueado, acceso root detectado, ROM modificada o Depuración USB activa.',
        steps: [
          'Ejecuta la "Auditoría de Autenticidad con IA" en la pestaña Mi Android para revisar `verifiedBootState`, `buildTags` y root.',
          'Desactiva "Opciones de Desarrollador" y "Depuración USB": varias apps bancarias bloquean su ejecución si están activas.',
          'Verifica que el teléfono tenga firmware oficial (`release-keys`) y bootloader bloqueado (`green`).',
          'Mantén actualizado el parche de seguridad de Android y Servicios de Google Play.',
        ],
      },
      {
        code: 'MOB-SEC-03',
        symptom: 'El sistema no actualiza o falla Google Play Services',
        severity: 'Media',
        category: 'Firmware / Servicios Google',
        diagnosis: 'Espacio insuficiente para paquete OTA, fecha/hora desincronizada o caché de marco de servicios dañada.',
        steps: [
          'Activa fecha y hora automáticas proporcionadas por la red en Ajustes → Sistema.',
          'Asegúrate de tener al menos 5 GB libres y más de 50% de batería antes de descargar actualizaciones OTA.',
          'Limpia la caché de "Google Play Store" y "Servicios de Google Play" y reinicia el teléfono.',
        ],
      },
    ],
  },
];

function generatePhoneTicketId() {
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  const stamp = Date.now().toString(36).slice(-4).toUpperCase();
  return `TKT-MOB-${stamp}-${rand}`;
}

export default function MobileDiagnosticView({ deviceInfo, user, onOpenPhone3D }) {
  const [selectedBranchId, setSelectedBranchId] = useState(null);
  const [selectedCase, setSelectedCase] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [savingTicket, setSavingTicket] = useState(false);
  const [savedTicketId, setSavedTicketId] = useState(null);
  const [saveError, setSaveError] = useState('');

  // Alertas automáticas detectadas desde la telemetría real del teléfono
  const autoAlerts = useMemo(() => {
    if (!deviceInfo) return [];
    const alerts = [];
    if (deviceInfo.batteryTempC != null && deviceInfo.batteryTempC >= 40) {
      alerts.push({
        label: `Temperatura de batería elevada (${deviceInfo.batteryTempC}°C)`,
        branchId: 'bateria',
        caseCode: 'MOB-BAT-03',
      });
    }
    if (deviceInfo.batteryHealth && !['Óptima', 'Estándar'].includes(deviceInfo.batteryHealth)) {
      alerts.push({
        label: `Estado de batería: ${deviceInfo.batteryHealth}`,
        branchId: 'bateria',
        caseCode: 'MOB-BAT-01',
      });
    }
    if (deviceInfo.storageUsedPct != null && deviceInfo.storageUsedPct >= 85) {
      alerts.push({
        label: `Almacenamiento saturado (${deviceInfo.storageUsedPct}% usado)`,
        branchId: 'memoria',
        caseCode: 'MOB-MEM-01',
      });
    }
    if (deviceInfo.ramUsedPct != null && deviceInfo.ramUsedPct >= 88) {
      alerts.push({
        label: `Presión alta de RAM (${deviceInfo.ramUsedPct}% en uso)`,
        branchId: 'memoria',
        caseCode: 'MOB-MEM-02',
      });
    }
    if (deviceInfo.isRooted || (deviceInfo.verifiedBootState && !['green', 'unknown'].includes(deviceInfo.verifiedBootState.toLowerCase()))) {
      alerts.push({
        label: 'Integridad modificada (Root o Bootloader desbloqueado)',
        branchId: 'seguridad',
        caseCode: 'MOB-SEC-02',
      });
    }
    return alerts;
  }, [deviceInfo]);

  const activeBranch = useMemo(
    () => DIAGNOSTIC_TREE.find((b) => b.id === selectedBranchId) || null,
    [selectedBranchId]
  );

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const out = [];
    for (const branch of DIAGNOSTIC_TREE) {
      for (const c of branch.cases) {
        const hay = `${branch.title} ${c.symptom} ${c.category} ${c.diagnosis} ${c.code}`.toLowerCase();
        if (hay.includes(q)) {
          out.push({ branch, diagCase: c });
        }
      }
    }
    return out;
  }, [searchQuery]);

  const openCaseDirectly = (branchId, caseCode) => {
    const b = DIAGNOSTIC_TREE.find((x) => x.id === branchId);
    const c = b?.cases.find((x) => x.code === caseCode);
    if (b && c) {
      setSelectedBranchId(b.id);
      setSelectedCase(c);
      setSavedTicketId(null);
      setSaveError('');
    }
  };

  const resetTree = () => {
    setSelectedBranchId(null);
    setSelectedCase(null);
    setSavedTicketId(null);
    setSaveError('');
  };

  const computeHealthScore = (severity) => {
    if (severity === 'Crítica') return 45;
    if (severity === 'Alta') return 65;
    return 80;
  };

  const handleSaveAndOpen3D = async (open3DAfter = true) => {
    if (!selectedCase || !activeBranch) return;
    setSavingTicket(true);
    setSaveError('');

    const ticketId = savedTicketId || generatePhoneTicketId();
    const healthScore = computeHealthScore(selectedCase.severity);
    const solucionText = selectedCase.steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
    const cpuLabel = deviceInfo?.cpuName
      ? `${deviceInfo.cpuName} (${deviceInfo.cpuCores} núcleos · ${deviceInfo.cpuArch})`
      : 'Procesador Móvil ARM64';
    const ramLabel = deviceInfo?.ramTotalGb
      ? `${deviceInfo.ramTotalGb} GB LPDDR (${deviceInfo.ramUsedPct ?? 0}% uso)`
      : 'RAM Móvil';
    const gpuLabel = deviceInfo?.gpu || 'GPU Móvil Integrada';
    const storageLabel = deviceInfo?.storageTotalGb
      ? `${deviceInfo.storageTotalGb} GB UFS (${deviceInfo.storageAvailGb ?? '?'} GB libres)`
      : 'Almacenamiento Interno Flash';
    const boardLabel = deviceInfo?.displayName
      ? `${deviceInfo.displayName}${deviceInfo.board ? ` (${deviceInfo.board})` : ''}`
      : 'Placa Lógica Smartphone';
    const batteryLabel = deviceInfo?.batteryPct != null
      ? `Batería ${deviceInfo.batteryPct}% · ${deviceInfo.batteryHealth}${deviceInfo.batteryTempC != null ? ` · ${deviceInfo.batteryTempC}°C` : ''}`
      : 'Batería Li-ion Smartphone';

    const ownerDni = user?.dni ? String(user.dni).trim() : null;
    const specsJson = {
      tipo_equipo: 'phone',
      tipo_evento: 'Árbol Diagnóstico',
      owner_dni: ownerDni,
      owner_nick: user?.nickname || null,
      modelo_comercial: deviceInfo?.displayName || 'Smartphone Android',
      so: deviceInfo?.os || 'Android',
      bateria: {
        porcentaje: deviceInfo?.batteryPct ?? null,
        salud: deviceInfo?.batteryHealth || 'Estándar',
        temperatura_c: deviceInfo?.batteryTempC ?? null,
        voltaje_mv: deviceInfo?.batteryVoltageMv ?? null,
        tecnologia: deviceInfo?.batteryTechnology || 'Li-ion',
        fuente: deviceInfo?.batteryPlugged || 'Desconectado',
      },
      pantalla: deviceInfo?.screenRes || 'N/D',
      codigo_diagnostico: selectedCase.code,
    };

    if (!ownerDni) {
      setSavingTicket(false);
      setSaveError('Inicia sesión con tu cuenta para guardar tickets privados en la nube (el Visor 3D funciona localmente).');
    } else {
      try {
        const { error } = await supabase.from('reportes_diagnostico').upsert(
          {
            id_ticket: ticketId,
            cpu: cpuLabel,
            ram: ramLabel,
            gpu: gpuLabel,
            almacenamiento: storageLabel,
            placa_base: boardLabel,
            refrigeracion: batteryLabel,
            health_score: healthScore,
            diagnostico: `[${selectedCase.code}] ${selectedCase.diagnosis}`,
            solucion: solucionText,
            specs_json: specsJson,
          },
          { onConflict: 'id_ticket' }
        );

        if (error) {
          console.warn('[MobileDiagnosticView] Error sincronizando ticket:', error.message);
          setSaveError('No se pudo sincronizar con Supabase. El modelo 3D se cargará localmente.');
        } else {
          setSavedTicketId(ticketId);
        }
      } catch (err) {
        console.warn('[MobileDiagnosticView] Excepción Supabase:', err);
        setSaveError('Modo sin conexión: el modelo 3D se cargará localmente.');
      } finally {
        setSavingTicket(false);
      }
    }

    if (open3DAfter && onOpenPhone3D) {
      onOpenPhone3D({
        deviceInfo,
        ticketId,
        healthScore,
        diagnostico: `[${selectedCase.code}] ${selectedCase.diagnosis}`,
        solucion: solucionText,
        affectedComponent: activeBranch.componentKey,
      });
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto bg-[#0b0f19] text-zinc-100 p-4 pb-24">
      <div className="max-w-2xl mx-auto space-y-3.5">
        {/* Header */}
        <div className="bg-[#131c2e] border border-slate-800 rounded-2xl p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
              <Stethoscope className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <span className="text-[10px] uppercase tracking-widest text-emerald-400 font-semibold">
                Sistema Experto Android
              </span>
              <h2 className="text-base font-bold text-white truncate">
                Árbol de Diagnóstico y Soluciones
              </h2>
              <p className="text-[11px] text-slate-400 truncate">
                {deviceInfo ? deviceInfo.displayName : 'Diagnóstico guiado de hardware y software'}
              </p>
            </div>
          </div>
          {(selectedBranchId || selectedCase) && (
            <button
              onClick={resetTree}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors shrink-0"
              title="Volver al inicio"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Alertas detectadas en tiempo real desde la telemetría del teléfono */}
        {!selectedCase && autoAlerts.length > 0 && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3.5 space-y-2">
            <div className="flex items-center gap-2 text-amber-300 text-xs font-semibold">
              <Sparkles className="w-4 h-4" />
              Anomalías detectadas en tu telemetría actual
            </div>
            <div className="space-y-1.5">
              {autoAlerts.map((a, i) => (
                <button
                  key={i}
                  onClick={() => openCaseDirectly(a.branchId, a.caseCode)}
                  className="w-full text-left flex items-center justify-between gap-2 bg-[#0b0f19]/80 hover:bg-[#0b0f19] border border-amber-500/20 rounded-xl px-3 py-2 text-xs text-amber-100 transition-colors"
                >
                  <span>{a.label}</span>
                  <span className="text-[10px] text-amber-400 font-semibold shrink-0 flex items-center gap-0.5">
                    Ver solución <ChevronRight className="w-3.5 h-3.5" />
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* VISTA 1: Selección de rama + Buscador de síntomas */}
        {!activeBranch && !selectedCase && (
          <>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar síntoma (ej. batería, lento, wifi, pantalla, carga)…"
                className="w-full bg-[#131c2e] border border-slate-700/80 focus:border-emerald-500 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-slate-500 outline-none"
              />
            </div>

            {searchQuery.trim() ? (
              <div className="space-y-2">
                <p className="text-[11px] text-slate-400">
                  {searchResults.length} resultado{searchResults.length === 1 ? '' : 's'} para "{searchQuery}"
                </p>
                {searchResults.map(({ branch, diagCase }) => (
                  <button
                    key={diagCase.code}
                    onClick={() => openCaseDirectly(branch.id, diagCase.code)}
                    className="w-full text-left bg-[#131c2e] hover:bg-slate-800/80 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between gap-3 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-emerald-400">{diagCase.code}</span>
                        <span className="text-[10px] text-slate-400">· {branch.title}</span>
                      </div>
                      <p className="text-xs font-semibold text-white mt-0.5">{diagCase.symptom}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                  </button>
                ))}
                {searchResults.length === 0 && (
                  <div className="bg-[#131c2e] border border-slate-800 rounded-xl p-6 text-center text-xs text-slate-400">
                    No se encontraron síntomas exactos. Elige una categoría abajo para navegar el árbol guiado.
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {DIAGNOSTIC_TREE.map((branch) => {
                  const Icon = branch.icon;
                  return (
                    <button
                      key={branch.id}
                      onClick={() => setSelectedBranchId(branch.id)}
                      className={`text-left bg-[#131c2e] hover:bg-slate-800/70 border ${branch.border} rounded-2xl p-4 transition-all group`}
                    >
                      <div className="flex items-center justify-between">
                        <div className={`w-9 h-9 rounded-xl ${branch.bg} flex items-center justify-center`}>
                          <Icon className={`w-4 h-4 ${branch.color}`} />
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors" />
                      </div>
                      <h3 className="text-sm font-bold text-white mt-3">{branch.title}</h3>
                      <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">{branch.subtitle}</p>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* VISTA 2: Pregunta guiada de la rama seleccionada */}
        {activeBranch && !selectedCase && (
          <div className="bg-[#131c2e] border border-slate-800 rounded-2xl p-4 space-y-3">
            <button
              onClick={() => setSelectedBranchId(null)}
              className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Cambiar categoría
            </button>

            <div>
              <span className={`text-[10px] uppercase tracking-wider font-semibold ${activeBranch.color}`}>
                Paso 2 · {activeBranch.title}
              </span>
              <h3 className="text-sm font-bold text-white mt-1">{activeBranch.question}</h3>
            </div>

            <div className="space-y-2.5">
              {activeBranch.cases.map((c) => (
                <button
                  key={c.code}
                  onClick={() => {
                    setSelectedCase(c);
                    setSavedTicketId(null);
                    setSaveError('');
                  }}
                  className="w-full text-left bg-[#0b0f19] hover:bg-slate-900 border border-slate-800 hover:border-emerald-500/40 rounded-xl p-3.5 flex items-center justify-between gap-3 transition-all"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-cyan-400">{c.code}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                          c.severity === 'Crítica'
                            ? 'bg-rose-500/15 text-rose-400'
                            : c.severity === 'Alta'
                            ? 'bg-amber-500/15 text-amber-400'
                            : 'bg-cyan-500/15 text-cyan-400'
                        }`}
                      >
                        Prioridad {c.severity}
                      </span>
                    </div>
                    <p className="text-xs font-semibold text-white mt-1">{c.symptom}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* VISTA 3: Dictamen Técnico + Soluciones Paso a Paso + Ticket 3D */}
        {activeBranch && selectedCase && (
          <div className="bg-[#131c2e] border border-emerald-500/30 rounded-2xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setSelectedCase(null)}
                className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Otros síntomas
              </button>
              <span
                className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-full border ${
                  selectedCase.severity === 'Crítica'
                    ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                    : selectedCase.severity === 'Alta'
                    ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                    : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                }`}
              >
                <AlertTriangle className="w-3 h-3" /> Severidad {selectedCase.severity}
              </span>
            </div>

            <div className="bg-[#0b0f19] border border-slate-800 rounded-xl p-3.5 space-y-1.5">
              <p className="text-[10px] font-mono text-emerald-400 uppercase tracking-wider">
                Dictamen {selectedCase.code} · {selectedCase.category}
              </p>
              <h3 className="text-sm font-bold text-white">{selectedCase.symptom}</h3>
              <p className="text-xs text-slate-300 leading-relaxed">{selectedCase.diagnosis}</p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
                <Wrench className="w-4 h-4" /> Plan de Solución Paso a Paso
              </div>
              <ol className="space-y-2">
                {selectedCase.steps.map((step, idx) => (
                  <li
                    key={idx}
                    className="flex items-start gap-2.5 bg-[#0b0f19] border border-slate-800/90 rounded-xl p-3 text-xs text-slate-200 leading-relaxed"
                  >
                    <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5">
                      {idx + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>

            {savedTicketId && (
              <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-3 py-2 text-xs text-emerald-300">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>
                  Ticket registrado en nube: <strong className="font-mono">{savedTicketId}</strong>
                </span>
              </div>
            )}

            {saveError && (
              <p className="text-[11px] text-amber-400">{saveError}</p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              <button
                onClick={() => handleSaveAndOpen3D(false)}
                disabled={savingTicket}
                className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
              >
                <CloudUpload className="w-4 h-4 text-cyan-400" />
                {savingTicket ? 'Sincronizando…' : 'Guardar Ticket en Nube'}
              </button>
              <button
                onClick={() => handleSaveAndOpen3D(true)}
                disabled={savingTicket}
                className="py-2.5 px-3 rounded-xl bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-all disabled:opacity-50"
              >
                <Box className="w-4 h-4" />
                Ver Teléfono 3D con Falla
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
