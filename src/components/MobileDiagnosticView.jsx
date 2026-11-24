/**
 * MobileDiagnosticView.jsx — Sistema Experto Móvil Pro (8 ramas, 28 casos clínicos,
 * asistente interactivo Sí/No paso a paso, diagnóstico multisíntoma, auto-triaje en vivo,
 * checklist interactivo de reparación y sincronización con Reporte Global 3D en Supabase).
 */

import React, { useMemo, useState } from 'react';
import { recordMobileEvent } from '../utils/cloudHistory';
import {
  Stethoscope, BatteryWarning, Cpu, HardDrive, MonitorPlay, Wifi, ShieldAlert,
  ChevronRight, ArrowLeft, Search, CheckCircle2, AlertTriangle, Wrench,
  Box, CloudUpload, RotateCcw, Sparkles, Volume2, Droplets, ListChecks,
  GitBranch, Layers, CheckSquare, Square, Activity,
} from 'lucide-react';

const DIAGNOSTIC_TREE = [
  {
    id: 'bateria',
    title: 'Batería y Energía',
    subtitle: 'Drenaje, carga lenta, apagones o celda hinchada',
    icon: BatteryWarning,
    color: 'text-amber-400',
    border: 'border-amber-500/25',
    bg: 'bg-amber-500/10',
    componentKey: 'Fuente de Poder',
    wizard: [
      {
        q: '¿El equipo se apaga bruscamente con >15% de carga o notas la carcasa abultada/muy caliente (>42°C)?',
        yesCase: 'MOB-BAT-03',
        noNext: 1,
      },
      {
        q: '¿El problema ocurre principalmente al conectar el cargador (carga muy lenta, intermitente o no activa carga rápida)?',
        yesCase: 'MOB-BAT-02',
        noNext: 2,
      },
      {
        q: '¿El porcentaje de batería se queda congelado o salta de golpe (ej. de 40% a 5%)?',
        yesCase: 'MOB-BAT-04',
        noCase: 'MOB-BAT-01',
      },
    ],
    cases: [
      {
        code: 'MOB-BAT-01',
        symptom: 'La batería se descarga muy rápido (drenaje excesivo)',
        severity: 'Alta',
        hwPct: 35,
        category: 'Batería / Energía',
        diagnosis: 'Drenaje acelerado por procesos en segundo plano (wakelocks), tasa de 120 Hz constante o desgaste químico Li-ion.',
        steps: [
          'Abre Ajustes → Batería y restringe apps que consuman >15% en segundo plano.',
          'Activa Modo Oscuro y baja temporalmente a 60 Hz en pantallas OLED/AMOLED (ahorra hasta 25%).',
          'Desactiva búsqueda constante de Bluetooth/Wi-Fi y 5G en zonas de baja señal.',
          'Si la celda supera los 500 ciclos o baja del 80% de capacidad real, programa cambio de batería.',
        ],
      },
      {
        code: 'MOB-BAT-02',
        symptom: 'Carga muy lenta, intermitente o no activa carga rápida',
        severity: 'Media',
        hwPct: 60,
        category: 'Puerto USB-C / PMIC',
        diagnosis: 'Resistencia elevada en puerto USB-C por pelusa/óxido, cable defectuoso o fallo de negociación USB-PD.',
        steps: [
          'Limpia el puerto USB-C suavemente con aire comprimido o un palillo no metálico.',
          'Prueba con otro cable certificado USB-PD y verifica en "Equipo" que figure "Cargador AC" (no USB).',
          'Revisa la corriente en mA: menos de 500 mA en AC indica cable dañado o pines CC sulfatados.',
          'Si falla con 2 cargadores originales, requiere revisión física del flex de carga / IC PMIC.',
        ],
      },
      {
        code: 'MOB-BAT-03',
        symptom: 'Batería muy caliente (>40°C), abultamiento o apagones repentinos',
        severity: 'Crítica',
        hwPct: 85,
        category: 'Térmica / Celda Batería',
        diagnosis: 'Caída de voltaje bajo carga (voltage sag) por alta resistencia interna o celda Li-ion en degradación crítica.',
        steps: [
          'Desconecta el cargador inmediatamente y retira la funda si la temperatura supera 42°C.',
          'Si la tapa trasera está levantada o hinchada, NO cargues el equipo y apágalo de inmediato.',
          'Verifica el voltaje en telemetría: <3.50 V con >20% de carga confirma celda agotada.',
          'Haz respaldo inmediato y solicita reemplazo de batería en laboratorio técnico.',
        ],
      },
      {
        code: 'MOB-BAT-04',
        symptom: 'Porcentaje de batería congelado o saltos bruscos de carga',
        severity: 'Media',
        hwPct: 45,
        category: 'Calibración Fuel-Gauge / BMS',
        diagnosis: 'Descalibración del circuito medidor de carga (Fuel Gauge) o lectura errónea del BMS de la celda.',
        steps: [
          'Carga el equipo al 100% continuo y déjalo 20 minutos adicionales encendido.',
          'Reinicia el teléfono (manteniendo encendido/bajar volumen 10 s si es necesario).',
          'Úsalo normalmente hasta bajar al 10% y vuelve a cargar al 100% sin interrupciones.',
          'Si los saltos persisten tras 2 ciclos, el flex de batería o BMS interno está defectuoso.',
        ],
      },
    ],
  },
  {
    id: 'rendimiento',
    title: 'Térmica y Rendimiento (SoC)',
    subtitle: 'Sobrecalentamiento, caídas de FPS, lag o reinicios',
    icon: Cpu,
    color: 'text-cyan-400',
    border: 'border-cyan-500/25',
    bg: 'bg-cyan-500/10',
    componentKey: 'Procesador/Refrigeración',
    wizard: [
      {
        q: '¿El equipo se reinicia solo, entra en bootloop o se congela por completo?',
        yesCase: 'MOB-CPU-03',
        noNext: 1,
      },
      {
        q: '¿El sobrecalentamiento ocurre incluso en reposo o dentro del bolsillo sin abrir juegos?',
        yesCase: 'MOB-CPU-04',
        noNext: 2,
      },
      {
        q: '¿Notas caídas fuertes de FPS tras 5–10 minutos de juego o grabación de video?',
        yesCase: 'MOB-CPU-01',
        noCase: 'MOB-CPU-02',
      },
    ],
    cases: [
      {
        code: 'MOB-CPU-01',
        symptom: 'Sobrecalentamiento y caída de FPS en juegos o cámara 4K',
        severity: 'Alta',
        hwPct: 40,
        category: 'Thermal Throttling SoC',
        diagnosis: 'Estrangulamiento térmico (Thermal Throttling): el SoC baja frecuencias para proteger el silicio.',
        steps: [
          'Abre la pestaña "Cuidado" y ejecuta una sesión guiada de enfriamiento de 60 segundos.',
          'Retira carcasas gruesas durante cargas pesadas y no juegues conectado a carga rápida.',
          'Baja el brillo a <70% y ajusta gráficos a Medio/60 FPS en sesiones largas.',
          'Ejecuta el Micro-Stress Test CPU para comprobar si el puntaje se estabiliza al enfriar.',
        ],
      },
      {
        code: 'MOB-CPU-02',
        symptom: 'Sistema lento, animaciones con tirones o respuesta tardía',
        severity: 'Media',
        hwPct: 20,
        category: 'Planificador CPU / SO',
        diagnosis: 'Saturación de hilos por procesos residentes, caché acumulada o almacenamiento >85%.',
        steps: [
          'Reinicia el dispositivo completamente para limpiar procesos zombis del kernel.',
          'Asegura al menos 15% de espacio libre en almacenamiento interno.',
          'Desinstala apps duplicadas de "optimización" o antivirus redundantes.',
          'En Opciones de Desarrollador, reduce las escalas de animación a 0.5x.',
        ],
      },
      {
        code: 'MOB-CPU-03',
        symptom: 'Reinicios aleatorios, bootloop o pantallas congeladas',
        severity: 'Crítica',
        hwPct: 65,
        category: 'Kernel / Placa Lógica',
        diagnosis: 'Kernel panic por corrupción de actualización, app nativa defectuosa o fallo de alimentación del SoC.',
        steps: [
          'Arranca en Modo Seguro de Android (mantén pulsado "Apagar" en el menú de energía).',
          'Si en Modo Seguro es estable, desinstala las últimas 3 aplicaciones instaladas.',
          'Limpia la partición de caché desde Recovery (no borra tus fotos ni archivos).',
          'Si se reinicia incluso en Modo Seguro, respalda tus datos y evalúa placa lógica/PMIC.',
        ],
      },
      {
        code: 'MOB-CPU-04',
        symptom: 'Se calienta en reposo o en el bolsillo sin usar apps',
        severity: 'Alta',
        hwPct: 30,
        category: 'Proceso Desbocado / Módem',
        diagnosis: 'Bucle de sincronización en segundo plano, indexación trabada o módem buscando señal al 100% de potencia.',
        steps: [
          'Abre la pestaña "Cuidado" → Top Apps Activas para detectar qué app mantiene CPU despierta.',
          'Activa Modo Avión durante 3 minutos: si se enfría rápido, el culpable es mala cobertura 4G/5G o Wi-Fi.',
          'Fuerza la detención y borra caché de la app que encabece el consumo en Ajustes → Batería.',
          'Actualiza Servicios de Google Play y reinicia el terminal.',
        ],
      },
    ],
  },
  {
    id: 'memoria',
    title: 'RAM y Almacenamiento',
    subtitle: 'Espacio lleno, apps que se cierran o archivos dañados',
    icon: HardDrive,
    color: 'text-emerald-400',
    border: 'border-emerald-500/25',
    bg: 'bg-emerald-500/10',
    componentKey: 'Almacenamiento',
    wizard: [
      {
        q: '¿El almacenamiento interno supera el 85% ocupado o te avisa "Espacio insuficiente"?',
        yesCase: 'MOB-MEM-01',
        noNext: 1,
      },
      {
        q: '¿Las fotos/archivos aparecen corruptos o Play Store falla al instalar/actualizar apps?',
        yesCase: 'MOB-MEM-03',
        noCase: 'MOB-MEM-02',
      },
    ],
    cases: [
      {
        code: 'MOB-MEM-01',
        symptom: 'Almacenamiento interno casi lleno (>85%) y lentitud general',
        severity: 'Alta',
        hwPct: 20,
        category: 'Almacenamiento UFS/eMMC',
        diagnosis: 'Sin espacio libre para caché SLC y wear-leveling, la velocidad de escritura flash cae drásticamente.',
        steps: [
          'Usa la pestaña "Cuidado" → Escáner de Descargas para eliminar instaladores y videos duplicados.',
          'Vacía la papelera de Galería y limpia caché de WhatsApp, Telegram y TikTok.',
          'Mantén siempre al menos 15% a 20% de almacenamiento libre.',
          'Comprueba el nuevo porcentaje de espacio libre en la pestaña "Equipo".',
        ],
      },
      {
        code: 'MOB-MEM-02',
        symptom: 'Apps que se cierran o recargan solas al cambiar de ventana',
        severity: 'Media',
        hwPct: 15,
        category: 'Memoria RAM / LMKD',
        diagnosis: 'El gestor LMKD (Low Memory Killer) cierra apps en segundo plano por alta presión de RAM o ahorro agresivo.',
        steps: [
          'Verifica uso de RAM en "Equipo": si supera 85% en reposo, desactiva apps con inicio automático.',
          'Configura las apps que necesitas abiertas como "Sin restricciones" en Ajustes → Batería.',
          'Activa Extensión de RAM / RAM Plus (2–4 GB) solo si cuentas con >20% de espacio UFS libre.',
          'Reduce widgets pesados y fondos animados.',
        ],
      },
      {
        code: 'MOB-MEM-03',
        symptom: 'Archivos corruptos, errores al guardar o Play Store bloqueada',
        severity: 'Alta',
        hwPct: 50,
        category: 'Sistema de Archivos / Flash',
        diagnosis: 'Caché corrupta de Play Store, permisos rotos o desgaste avanzado de bloques NAND flash.',
        steps: [
          'Borra caché y datos de "Google Play Store" y "Servicios de Google Play" y reinicia.',
          'Verifica permisos de almacenamiento de la app afectada.',
          'Si fallan archivos de cámara o galería local, respalda de inmediato: puede ser fallo físico de memoria UFS/eMMC.',
        ],
      },
    ],
  },
  {
    id: 'pantalla',
    title: 'Pantalla, Táctil y GPU',
    subtitle: 'Ghost touch, líneas OLED, pantalla negra o fallos 3D',
    icon: MonitorPlay,
    color: 'text-blue-400',
    border: 'border-blue-500/25',
    bg: 'bg-blue-500/10',
    componentKey: 'Tarjeta Gráfica',
    wizard: [
      {
        q: '¿La pantalla está totalmente negra aunque el equipo vibra o recibe llamadas?',
        yesCase: 'MOB-DSP-04',
        noNext: 1,
      },
      {
        q: '¿Ves líneas verticales verdes/rosas, manchas moradas o parpadeo constante?',
        yesCase: 'MOB-DSP-02',
        noNext: 2,
      },
      {
        q: '¿El táctil se presiona solo (ghost touch) o hay franjas que no responden?',
        yesCase: 'MOB-DSP-01',
        noCase: 'MOB-DSP-03',
      },
    ],
    cases: [
      {
        code: 'MOB-DSP-01',
        symptom: 'Toques fantasma (ghost touch) o zonas que no responden',
        severity: 'Alta',
        hwPct: 65,
        category: 'Digitalizador Táctil',
        diagnosis: 'Interferencia capacitiva por cargador sin filtro, mica dañada o fallo del flex digitalizador.',
        steps: [
          'Desconecta el cargador: cargadores genéricos inducen ruido eléctrico directo al táctil.',
          'Retira vidrios templados agrietados y limpia la superficie de humedad o grasa.',
          'Activa "Mostrar toques" en Opciones de Desarrollador para verificar si hay franjas muertas fijas.',
          'Si una zona nunca responde tras reiniciar, requiere reemplazo del módulo de pantalla.',
        ],
      },
      {
        code: 'MOB-DSP-02',
        symptom: 'Líneas verdes/rosas, parpadeo severo o quemado OLED',
        severity: 'Crítica',
        hwPct: 92,
        category: 'Panel OLED/LCD / Flex COF',
        diagnosis: 'Daño físico en el flex COF del panel o microfractura interna de la matriz OLED/LCD.',
        steps: [
          'Toma una captura de pantalla y mírala en otro equipo: si la línea NO sale en la captura, es fallo físico del panel.',
          'Prueba alternar entre 60 Hz y 120 Hz y desactivar "Brillo adaptable" para descartar PWM.',
          'Respalda tus datos antes de que la mancha o línea se extienda y cotiza cambio de pantalla original.',
        ],
      },
      {
        code: 'MOB-DSP-03',
        symptom: 'Artefactos gráficos, parpadeos en video o cierres en apps 3D',
        severity: 'Media',
        hwPct: 25,
        category: 'GPU / Vulkan / WebGL',
        diagnosis: 'Caché de shaders corrupta, WebView desactualizado o sobrecalentamiento de GPU.',
        steps: [
          'Actualiza "Android System WebView" y Google Chrome desde Play Store.',
          'Borra la caché del juego o app afectada para recompilar shaders desde cero.',
          'Desactiva superposiciones experimentales en Opciones de Desarrollador.',
        ],
      },
      {
        code: 'MOB-DSP-04',
        symptom: 'Pantalla negra pero el teléfono vibra o suena al recibir llamadas',
        severity: 'Crítica',
        hwPct: 80,
        category: 'Backlight / Conector Display',
        diagnosis: 'Bloqueo del driver de video, conector FPC de pantalla desconectado por golpe o fallo de backlight.',
        steps: [
          'Realiza reinicio forzado manteniendo Encendido + Bajar Volumen durante 12–15 segundos.',
          'Ilumina la pantalla con una linterna en ángulo: si ves la imagen muy oscura al fondo, falló el backlight.',
          'Si tras reinicio forzado sigue negra con sonido, requiere revisión de conector FPC / módulo display.',
        ],
      },
    ],
  },
  {
    id: 'conectividad',
    title: 'Conectividad, Red y GPS',
    subtitle: 'Wi-Fi, 4G/5G, Bluetooth, GPS o NFC inestables',
    icon: Wifi,
    color: 'text-violet-400',
    border: 'border-violet-500/25',
    bg: 'bg-violet-500/10',
    componentKey: 'Placa Base',
    wizard: [
      {
        q: '¿El problema es con datos móviles 4G/5G, llamadas o tarjeta SIM?',
        yesCase: 'MOB-NET-02',
        noNext: 1,
      },
      {
        q: '¿El problema es con audífonos/relojes Bluetooth?',
        yesCase: 'MOB-NET-03',
        noNext: 2,
      },
      {
        q: '¿El GPS marca ubicaciones erróneas o el NFC no lee tarjetas/pagos?',
        yesCase: 'MOB-NET-04',
        noCase: 'MOB-NET-01',
      },
    ],
    cases: [
      {
        code: 'MOB-NET-01',
        symptom: 'Wi-Fi se desconecta solo o navega extremadamente lento',
        severity: 'Media',
        hwPct: 20,
        category: 'Módulo Wi-Fi / DNS',
        diagnosis: 'Saturación en banda 2.4 GHz, lease DHCP corrupto o servidor DNS lento.',
        steps: [
          'Olvida la red Wi-Fi y conéctate a la banda 5 GHz si estás cerca del router.',
          'Configura DNS Privado en Ajustes → Red: `dns.google` o `one.one.one.one`.',
          'Desactiva temporalmente VPNs o proxies activos.',
          'Si falla en todos los routers, ejecuta "Restablecer ajustes de Wi-Fi, datos y Bluetooth".',
        ],
      },
      {
        code: 'MOB-NET-02',
        symptom: 'Sin señal móvil, llamadas cortadas o 4G/5G intermitente',
        severity: 'Alta',
        hwPct: 45,
        category: 'Módem Celular / SIM',
        diagnosis: 'SIM oxidada, APN desconfigurado o conmutación inestable entre antenas 5G y 4G.',
        steps: [
          'Activa Modo Avión 20 segundos y desactívalo para forzar registro en torre celular.',
          'Extrae la SIM, limpia los contactos suavemente y prueba otra SIM para descartar bandeja.',
          'Cambia el modo de red preferido temporalmente a "4G/LTE" si el 5G fluctúa.',
          'Verifica marcando `*#06#` que el IMEI aparezca válido y no "Desconocido".',
        ],
      },
      {
        code: 'MOB-NET-03',
        symptom: 'Bluetooth entrecortado o no empareja accesorios',
        severity: 'Media',
        hwPct: 25,
        category: 'Bluetooth / Códecs',
        diagnosis: 'Interferencia 2.4 GHz, perfil de emparejamiento corrupto o códec de audio incompatible (LDAC/aptX).',
        steps: [
          'Desvincula el accesorio, reinicia ambos dispositivos y vuelve a emparejar.',
          'Prueba cambiar el códec de audio a AAC o SBC si el audio se corta a distancia.',
          'Ejecuta "Restablecer ajustes de red y Bluetooth" si falla con múltiples dispositivos.',
        ],
      },
      {
        code: 'MOB-NET-04',
        symptom: 'GPS impreciso en mapas o NFC no responde al pagar',
        severity: 'Media',
        hwPct: 40,
        category: 'Antena GNSS / NFC',
        diagnosis: 'Ahorro de batería restringiendo ubicación en segundo plano, brújula descalibrada o funda metálica bloqueando NFC.',
        steps: [
          'Activa "Precisión de ubicación de Google" (Wi-Fi + Bluetooth scanning).',
          'Calibra la brújula moviendo el teléfono en figura de "8" en Google Maps.',
          'Para NFC, retira fundas con imanes/anillos metálicos y verifica la app de pago predeterminada.',
        ],
      },
    ],
  },
  {
    id: 'multimedia',
    title: 'Audio, Cámaras y Biometría',
    subtitle: 'Micrófono, altavoz, enfoque de cámara o lector de huellas',
    icon: Volume2,
    color: 'text-pink-400',
    border: 'border-pink-500/25',
    bg: 'bg-pink-500/10',
    componentKey: 'Placa Base',
    wizard: [
      {
        q: '¿La cámara sale borrosa, vibra con zumbido o muestra "Error de cámara"?',
        yesCase: 'MOB-AUD-02',
        noNext: 1,
      },
      {
        q: '¿El lector de huellas o desbloqueo facial dejó de reconocer o desapareció de Ajustes?',
        yesCase: 'MOB-AUD-03',
        noNext: 2,
      },
      {
        q: '¿La pantalla no se apaga (o queda negra) al acercar el teléfono al oído en llamadas?',
        yesCase: 'MOB-AUD-04',
        noCase: 'MOB-AUD-01',
      },
    ],
    cases: [
      {
        code: 'MOB-AUD-01',
        symptom: 'Micrófono bajo, no te escuchan o altavoz distorsionado',
        severity: 'Media',
        hwPct: 55,
        category: 'Audio / Malla Acústica',
        diagnosis: 'Rejilla acústica obstruida por polvo/pelusa, audio desviado por Bluetooth o membrana dañada.',
        steps: [
          'Comprueba que el audio no esté saliendo por un dispositivo Bluetooth conectado.',
          'Graba una nota de voz de prueba: si falla solo en llamadas/WhatsApp, revisa permisos de micrófono.',
          'Limpia suavemente la malla del altavoz y orificio del micrófono con cepillo seco suave (nunca agujas).',
        ],
      },
      {
        code: 'MOB-AUD-02',
        symptom: 'Cámara desenfocada, vibrando (OIS) o error al abrir',
        severity: 'Alta',
        hwPct: 70,
        category: 'Módulo Cámara / OIS',
        diagnosis: 'Estabilizador óptico (OIS) afectado por vibración/golpes, caché de cámara bloqueada o lente sucia.',
        steps: [
          'Limpia el cristal de las lentes y retira protectores de cámara plásticos que arruinan el enfoque láser.',
          'Borra caché y datos de la app "Cámara" y reinicia el teléfono.',
          'Si escuchas un zumbido mecánico continuo al enfocar, el motor OIS está dañado y requiere cambio de módulo.',
        ],
      },
      {
        code: 'MOB-AUD-03',
        symptom: 'Lector de huella digital o FaceID lento o inoperativo',
        severity: 'Media',
        hwPct: 50,
        category: 'Biometría / Sensor Óptico',
        diagnosis: 'Protector de pantalla muy grueso (en lectores bajo pantalla), dedo húmedo o flex biométrico desconectado.',
        steps: [
          'Elimina las huellas actuales y vuelve a registrarlas con el protector ya colocado.',
          'Activa "Sensibilidad táctil" en Ajustes → Pantalla si usas vidrio templado.',
          'Si la opción de Huella desapareció del menú de Seguridad, el flex del sensor está desconectado o dañado.',
        ],
      },
      {
        code: 'MOB-AUD-04',
        symptom: 'Sensor de proximidad falla en llamadas o audios de WhatsApp',
        severity: 'Baja',
        hwPct: 35,
        category: 'Sensor Proximidad',
        diagnosis: 'Mica opaca cubriendo la zona superior del auricular o calibración desajustada.',
        steps: [
          'Verifica que el vidrio templado o suciedad no tape el borde superior junto a la cámara frontal.',
          'Reinicia el teléfono y prueba una llamada cubriendo la parte superior con la mano.',
        ],
      },
    ],
  },
  {
    id: 'seguridad',
    title: 'Seguridad, Malware e Integridad',
    subtitle: 'Publicidad intrusiva, root, bootloader o sospecha de clon',
    icon: ShieldAlert,
    color: 'text-rose-400',
    border: 'border-rose-500/25',
    bg: 'bg-rose-500/10',
    componentKey: 'Placa Base',
    wizard: [
      {
        q: '¿Te aparecen anuncios pop-up de pantalla completa incluso fuera del navegador?',
        yesCase: 'MOB-SEC-01',
        noNext: 1,
      },
      {
        q: '¿Sospechas que el equipo tiene piezas/especificaciones falsas o es un clon?',
        yesCase: 'MOB-SEC-03',
        noCase: 'MOB-SEC-02',
      },
    ],
    cases: [
      {
        code: 'MOB-SEC-01',
        symptom: 'Anuncios emergentes invasivos, redirecciones o apps sospechosas',
        severity: 'Alta',
        hwPct: 0,
        category: 'Seguridad / Adware',
        diagnosis: 'App de terceros con permiso "Mostrar sobre otras apps" o notificaciones abusivas del navegador.',
        steps: [
          'Abre Ajustes → Aplicaciones → Acceso especial → "Mostrar sobre otras apps" y revoca apps desconocidas.',
          'Revisa la lista de aplicaciones buscando apps sin ícono o con nombre en blanco al final de la lista.',
          'En Chrome → Configuración → Notificaciones, bloquea sitios desconocidos que envían spam.',
          'Ejecuta un análisis con Google Play Protect y cambia contraseñas críticas si hubo riesgo.',
        ],
      },
      {
        code: 'MOB-SEC-02',
        symptom: 'Apps bancarias bloqueadas, Bootloader desbloqueado o Root',
        severity: 'Alta',
        hwPct: 5,
        category: 'Integridad Play Integrity / Boot',
        diagnosis: 'Bootloader desbloqueado, ROM personalizada (test-keys) o binarios su/Magisk detectados por Play Integrity.',
        steps: [
          'Verifica en "Equipo" los indicadores de Integridad: Tags (`release-keys`), Boot (`green`) y Root (`No`).',
          'Si compraste el teléfono usado con bootloader abierto, flashea el firmware oficial original del fabricante.',
          'No instales APKs bancarios modificados ni otorgues permisos de Accesibilidad a apps no verificadas.',
        ],
      },
      {
        code: 'MOB-SEC-03',
        symptom: 'Sospecha de teléfono clonado o especificaciones falsas',
        severity: 'Crítica',
        hwPct: 80,
        category: 'Auditoría de Hardware / Autenticidad',
        diagnosis: 'Discrepancia entre el modelo comercial impreso y el SoC, RAM real, resolución o firma de firmware.',
        steps: [
          'Ejecuta el botón "Auditar con IA" en la pestaña "Equipo" para contrastar SoC, RAM y resolución real.',
          'Comprueba que el SoC real no sea un chip antiguo de 4 núcleos disfrazado de gama alta.',
          'Verifica el IMEI (`*#06#`) contra la caja y el portal oficial de tu operadora/fabricante.',
        ],
      },
    ],
  },
  {
    id: 'emergencia',
    title: 'Emergencia: Agua y Golpes',
    subtitle: 'Protocolo crítico ante líquidos, humedad o caídas',
    icon: Droplets,
    color: 'text-sky-400',
    border: 'border-sky-500/25',
    bg: 'bg-sky-500/10',
    componentKey: 'Fuente de Poder',
    wizard: [
      {
        q: '¿El dispositivo tuvo contacto con agua, lluvia o muestra aviso "Humedad en el puerto USB"?',
        yesCase: 'MOB-EMG-01',
        noCase: 'MOB-EMG-02',
      },
    ],
    cases: [
      {
        code: 'MOB-EMG-01',
        symptom: 'Contacto con líquidos o alerta de humedad en puerto USB-C',
        severity: 'Crítica',
        hwPct: 95,
        category: 'Protocolo Daño por Líquido',
        diagnosis: 'Riesgo inminente de cortocircuito y sulfatación galvánica en placa madre si circula corriente.',
        steps: [
          'NO conectes el cargador bajo ningún motivo y apaga el equipo si entró líquido al interior.',
          'Seca el exterior con paño absorbente y sacude suavemente con el puerto USB hacia abajo.',
          'NUNCA uses secadora de cabello caliente ni arroz (el polvo de almidón y calor dañan sellos y conectores).',
          'Deja secar en ambiente ventilado 24 horas (o con bolsas de gel de sílice) y lleva a limpieza ultrasónica con alcohol isopropílico.',
        ],
      },
      {
        code: 'MOB-EMG-02',
        symptom: 'Caída fuerte: cristal astillado, marco doblado o fallo tras golpe',
        severity: 'Alta',
        hwPct: 90,
        category: 'Daño Estructural / Post-Impacto',
        diagnosis: 'Posible desconexión de flex internos (batería, cámara, antena) o fisura en pantalla/chasis.',
        steps: [
          'Realiza respaldo inmediato de tus datos mientras la pantalla y el táctil sigan respondiendo.',
          'Comprueba cámara, carga, señal Wi-Fi/SIM y temperatura de batería tras el golpe.',
          'Si el chasis se dobló cerca de la batería, no intentes enderezarlo a la fuerza (riesgo de perforar la celda Li-ion).',
        ],
      },
    ],
  },
];

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
    <div className="h-full w-full overflow-y-auto bg-[#090c12] text-slate-100 p-4 pb-24">
      <div className="max-w-3xl mx-auto space-y-4">
        {/* Encabezado */}
        <div className="instrument-card rounded-2xl p-4 space-y-3">
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
            <div className="grid grid-cols-3 gap-1.5 bg-[#101521] p-1 rounded-xl border border-slate-800/90">
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
            <div className="space-y-2">
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
            <div className="space-y-2">
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

            <div className="space-y-3">
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
          <div className="view-enter grid grid-cols-1 sm:grid-cols-2 gap-3">
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
