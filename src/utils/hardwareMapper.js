/**
 * hardwareMapper.js
 * Mapeo de telemetría real de Supabase / IndiServ Analytica a perfil 3D.
 * Reconoce columnas reales ('cpu', 'gpu', 'ram', 'refrigeracion') para clasificación de modelos.
 */

const GPU_TIERS = {
  high: [
    '5090', '5080', '4090', '4080', '3090', '3080', 'titan', 'rx 7900', 'rx 6900',
    'a6000', 'a5000', 'quadro rtx', 'w7900',
  ],
  mid: [
    '5070', '5060', '4070', '4060', '3070', '3060', 'rx 7800', 'rx 7700', 'rx 6800',
    'rx 6700', 'a4000', 'a2000', 'w6600',
  ],
};

const COOLER_TYPES = {
  aio: [
    'aio', 'liquid', 'líquida', 'liquida', 'kraken', 'capellix', 'corsair h',
    'arctic liquid', 'galahad', 'ryzen 9', 'i9', 'threadripper',
  ],
  tower: [
    'tower', 'torre', 'noctua', 'hyper 212', 'dark rock', 'assassin',
    'u12', 'd15', 'ak620', 'fuma', 'ryzen 7', 'i7', 'ryzen 5', 'i5',
  ],
};

export function classifyGpu(gpuName) {
  if (!gpuName) return null;
  const n = gpuName.toLowerCase();
  if (GPU_TIERS.high.some((k) => n.includes(k))) return '/models/archetypes/gpu_3fans.glb';
  if (GPU_TIERS.mid.some((k) => n.includes(k))) return '/models/archetypes/gpu_2fans.glb';
  return '/models/archetypes/gpu_1fan.glb';
}

export function classifyCooler(coolerName, cpuName) {
  const combined = `${coolerName || ''} ${cpuName || ''}`.toLowerCase();
  if (COOLER_TYPES.aio.some((k) => combined.includes(k))) return '/models/archetypes/cooler_aio.glb';
  if (COOLER_TYPES.tower.some((k) => combined.includes(k))) return '/models/archetypes/cooler_tower.glb';
  return '/models/archetypes/cooler_stock.glb';
}

/**
 * @param {object} telemetry  Datos reales desde Supabase ('reportes_diagnostico') o fallback
 * @returns {object}          Perfil 3D y componentes mapeados
 */
export function mapTelemetryTo3DProfile(telemetry) {
  if (!telemetry) return null;

  const components = telemetry.components || {};

  // GPU: evaluar columna 'gpu' o propiedad de componente
  const gpuRaw = telemetry.gpu || components['Tarjeta Gráfica']?.specs || '';
  const hasDiscreteGpu = gpuRaw && !gpuRaw.toLowerCase().includes('integrada');
  const gpuFile = hasDiscreteGpu ? classifyGpu(gpuRaw) : null;

  // CPU y Cooler: evaluar columnas 'cpu' y 'refrigeracion' o componentes
  const cpuRaw = telemetry.cpu || components['Procesador/Refrigeración']?.specs || '';
  const coolerRaw = telemetry.refrigeracion || components['Procesador/Refrigeración']?.cooler_type || '';
  const coolerFile = classifyCooler(coolerRaw, cpuRaw);

  // RAM: evaluar columna 'ram' para número de ranuras ocupadas
  const ramRaw = telemetry.ram || components['Memoria RAM']?.specs || '';
  let ramSlots = 2;
  if (ramRaw.includes('4 ranuras') || ramRaw.includes('4 ×') || ramRaw.includes('4x')) {
    ramSlots = 4;
  } else if (ramRaw.includes('1 ranura') || ramRaw.includes('1 ×') || ramRaw.includes('1x')) {
    ramSlots = 1;
  } else if (telemetry.specs_json?.ram?.ranuras) {
    ramSlots = telemetry.specs_json.ram.ranuras;
  }

  const ramFile = '/models/archetypes/ram_dimm.glb';
  const mbFile = '/models/archetypes/motherboard_atx.glb';

  // Tipo de equipo ('phone' | 'laptop' | 'desktop') desde specs_json con inferencia de respaldo para tickets previos
  const explicitTipo = (
    telemetry.specs_json?.tipo_equipo ||
    telemetry.tipo_equipo ||
    ''
  )
    .toString()
    .trim()
    .toLowerCase();

  let tipoEquipo = 'desktop';
  if (explicitTipo === 'phone' || explicitTipo === 'smartphone' || explicitTipo === 'mobile') {
    tipoEquipo = 'phone';
  } else if (explicitTipo === 'laptop' || explicitTipo === 'desktop') {
    tipoEquipo = explicitTipo;
  } else {
    const hwFingerprint = `${telemetry.cpu || ''} ${telemetry.gpu || ''} ${telemetry.placa_base || ''} ${telemetry.ram || ''} ${telemetry.almacenamiento || ''}`.toLowerCase();
    const hasPhoneSignature =
      hwFingerprint.includes('android') ||
      hwFingerprint.includes('snapdragon') ||
      hwFingerprint.includes('adreno') ||
      hwFingerprint.includes('mali-') ||
      hwFingerprint.includes('dimensity') ||
      hwFingerprint.includes('exynos') ||
      hwFingerprint.includes('kirin') ||
      hwFingerprint.includes('tensor') ||
      hwFingerprint.includes('sm-s') ||
      hwFingerprint.includes('sm-a') ||
      hwFingerprint.includes('redmi') ||
      hwFingerprint.includes('poco') ||
      hwFingerprint.includes('arm64-v8a') ||
      /\bufs\s*[234]\./i.test(hwFingerprint);

    const hasMobileSignature =
      hwFingerprint.includes('laptop') ||
      hwFingerprint.includes('notebook') ||
      hwFingerprint.includes('portable') ||
      hwFingerprint.includes('mobile') ||
      hwFingerprint.includes('lnvnb') ||
      hwFingerprint.includes('fa506') ||
      hwFingerprint.includes('fx505') ||
      hwFingerprint.includes('fx506') ||
      hwFingerprint.includes('fa507') ||
      hwFingerprint.includes('gu603') ||
      hwFingerprint.includes('g513') ||
      hwFingerprint.includes('sodimm') ||
      hwFingerprint.includes('so-dimm') ||
      hwFingerprint.includes('lpddr') ||
      /\b\d{4,5}(?:hs|hx|h|u|g[1-7])\b/i.test(hwFingerprint);

    if (hasPhoneSignature) {
      tipoEquipo = 'phone';
    } else if (hasMobileSignature) {
      tipoEquipo = 'laptop';
    }
  }

  const isPhone = tipoEquipo === 'phone';
  const isLaptop = tipoEquipo === 'laptop';
  const modelFile = isPhone
    ? '/models/phone-opt.glb'
    : isLaptop
    ? '/models/laptop-opt.glb'
    : '/models/pc-opt.glb';
  const chassisFile = isPhone
    ? '/models/phone-opt.glb'
    : isLaptop
    ? '/models/laptop-opt.glb'
    : '/models/archetypes/chassis_mid_tower.glb';

  const mbDiag = components['Placa Base'] || { specs: telemetry.placa_base || 'Placa Base ATX' };
  const cpuDiag = components['Procesador/Refrigeración'] || { specs: cpuRaw, cooler_type: coolerRaw };
  const gpuDiag = components['Tarjeta Gráfica'] || { specs: gpuRaw };
  const ramDiag = components['Memoria RAM'] || { specs: ramRaw, populated_slots: ramSlots };
  const storageDiag = components['Almacenamiento'] || { specs: telemetry.almacenamiento || 'Almacenamiento' };
  const psuDiag = components['Fuente de Poder'] || { specs: 'Fuente de Poder (PSU)' };

  return {
    ticket_id: telemetry.id_ticket || telemetry.ticket_id,
    scan_date: telemetry.scan_date,
    system_status: telemetry.system_status,
    base_specs: telemetry.base_specs,
    tipo_equipo: tipoEquipo,
    model_file: modelFile,
    cpu: telemetry.cpu,
    ram: telemetry.ram,
    gpu: telemetry.gpu,
    almacenamiento: telemetry.almacenamiento,
    diagnostico: telemetry.diagnostico,
    solucion: telemetry.solucion,

    // 3D Assembly Manifest
    parts: {
      chassis: { file: chassisFile, position: [0, 0, 0], explodedOffset: [0, 0, 0], meta: {} },
      motherboard: { file: mbFile, position: [0, 0, 0], explodedOffset: [0, 0, -3], meta: mbDiag },
      cpu: { file: coolerFile, position: [0, 2.5, 0.5], explodedOffset: [0, 5, 3], meta: cpuDiag },
      gpu: { file: gpuFile, position: [0, -1, 2], explodedOffset: [0, -4, 6], meta: gpuDiag },
      ram: Array.from({ length: ramSlots }, (_, i) => ({
        file: ramFile,
        position: [1.5 + i * 0.5, 2, 0.3],
        explodedOffset: [1.5 + i * 0.5, 5 + i, 3],
        meta: ramDiag,
      })),
      storage: { file: null, position: [3, -2, 0], explodedOffset: [6, -2, 0], meta: storageDiag },
      psu: { file: null, position: [0, -4, 0], explodedOffset: [0, -8, 0], meta: psuDiag },
    },

    components,
  };
}
