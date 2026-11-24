/**
 * deviceAuditFallback.js
 * Respaldo heurístico local + diccionario de códigos comerciales comunes
 * para garantizar que el botón de verificación responda incluso si la
 * Supabase Edge Function 'analizar-dispositivo-ia' aún no se ha desplegado.
 */

const MODEL_CATALOG = {

  'SM-S938': { name: 'Samsung Galaxy S25 Ultra', year: '2025' },
  'SM-S936': { name: 'Samsung Galaxy S25+', year: '2025' },
  'SM-S931': { name: 'Samsung Galaxy S25', year: '2025' },
  'SM-S928': { name: 'Samsung Galaxy S24 Ultra', year: '2024' },
  'SM-S926': { name: 'Samsung Galaxy S24+', year: '2024' },
  'SM-S921': { name: 'Samsung Galaxy S24', year: '2024' },
  'SM-S721': { name: 'Samsung Galaxy S24 FE', year: '2024' },
  'SM-S918': { name: 'Samsung Galaxy S23 Ultra', year: '2023' },
  'SM-S916': { name: 'Samsung Galaxy S23+', year: '2023' },
  'SM-S911': { name: 'Samsung Galaxy S23', year: '2023' },
  'SM-S711': { name: 'Samsung Galaxy S23 FE', year: '2023' },
  'SM-S908': { name: 'Samsung Galaxy S22 Ultra', year: '2022' },
  'SM-S901': { name: 'Samsung Galaxy S22', year: '2022' },
  'SM-A566': { name: 'Samsung Galaxy A56 5G', year: '2025' },
  'SM-A556': { name: 'Samsung Galaxy A55 5G', year: '2024' },
  'SM-A546': { name: 'Samsung Galaxy A54 5G', year: '2023' },
  'SM-A536': { name: 'Samsung Galaxy A53 5G', year: '2022' },
  'SM-A366': { name: 'Samsung Galaxy A36 5G', year: '2025' },
  'SM-A356': { name: 'Samsung Galaxy A35 5G', year: '2024' },
  'SM-A346': { name: 'Samsung Galaxy A34 5G', year: '2023' },
  'SM-A256': { name: 'Samsung Galaxy A25 5G', year: '2023' },
  'SM-A155': { name: 'Samsung Galaxy A15', year: '2023' },
  'SM-A156': { name: 'Samsung Galaxy A15 5G', year: '2023' },

  '25010PN30': { name: 'Xiaomi 15 Ultra', year: '2025' },
  '24129PN74': { name: 'Xiaomi 15', year: '2025' },
  '24090RA29': { name: 'Redmi Note 14 Pro 5G', year: '2024' },
  '24117RN76': { name: 'Redmi Note 14 4G', year: '2025' },
  '2312DRA50': { name: 'Redmi Note 13 Pro 5G', year: '2024' },
  '23117RA68': { name: 'Redmi Note 13 Pro 4G', year: '2024' },
  '23129RAA4': { name: 'Redmi Note 13 4G', year: '2024' },
  '23124RA7E': { name: 'Redmi Note 13 4G', year: '2024' },
  '23053RN02': { name: 'Redmi 12', year: '2023' },
  '23076RN8D': { name: 'Redmi 13C', year: '2023' },
  '2311DRK48': { name: 'POCO X6 Pro 5G', year: '2024' },
  '23122PCD1': { name: 'POCO X6 5G', year: '2024' },
  '2412DPC0A': { name: 'POCO X7 Pro 5G', year: '2025' },
  '24069PC21': { name: 'POCO F6', year: '2024' },
  '23113RKC6': { name: 'POCO F6 Pro', year: '2024' },

  'Pixel 9 Pro': { name: 'Google Pixel 9 Pro', year: '2024' },
  'Pixel 9': { name: 'Google Pixel 9', year: '2024' },
  'Pixel 8 Pro': { name: 'Google Pixel 8 Pro', year: '2023' },
  'Pixel 8': { name: 'Google Pixel 8', year: '2023' },
};

function lookupCommercialName(info) {
  const rawModel = (info.model || '').toUpperCase();
  for (const [prefix, entry] of Object.entries(MODEL_CATALOG)) {
    if (rawModel.startsWith(prefix.toUpperCase())) {
      return entry;
    }
  }
  return {
    name: info.displayName || `${info.manufacturer || ''} ${info.model || 'Dispositivo'}`.trim(),
    year: 'No catalogado localmente',
  };
}

export function runLocalDeviceAudit(info) {
  const catalogMatch = lookupCommercialName(info);
  const boot = (info.verifiedBootState || 'unknown').toLowerCase();
  const isModified =
    Boolean(info.isRooted) ||
    boot === 'orange' ||
    (info.buildTags || '').toLowerCase().includes('test-keys');
  const isEmulator = Boolean(info.isEmulator);

  const claimsFlagship = /ultra|s25|s24|s23|iphone|pro max/i.test(`${catalogMatch.name} ${info.model || ''}`);
  const suspiciousSpecs = claimsFlagship && info.ramTotalGb != null && info.ramTotalGb <= 3;

  let veredicto = 'Original Coherente';
  if (isEmulator || suspiciousSpecs) veredicto = 'Sospecha de Clon / Alteración';
  else if (isModified) veredicto = 'Software/Bootloader Modificado';

  return {
    origen: 'local-heuristica',
    nombre_comercial: catalogMatch.name,
    anio_lanzamiento: catalogMatch.year,
    veredicto,
    confianza_pct: suspiciousSpecs || isEmulator ? 90 : 80,
    resumen: suspiciousSpecs
      ? `El modelo reportado (${catalogMatch.name}) no coincide con la memoria RAM real detectada (${info.ramTotalGb} GB). Posible clon o firmware falsificado.`
      : isModified
      ? `Identificado como ${catalogMatch.name}, pero el sistema presenta señales de modificación (bootloader ${info.verifiedBootState || 'desbloqueado'}, root o firma test-keys).`
      : `Identificado como ${catalogMatch.name}. Los componentes reportados (${info.cpuName}, ${info.ramTotalGb ?? '?'} GB RAM, ${info.storageTotalGb ?? '?'} GB) son coherentes con el sistema.`,
    componentes: [
      {
        parte: 'Procesador / SoC',
        estado: isEmulator ? 'Alerta' : 'Coherente',
        detalle: `${info.cpuName || 'SoC ARM'} · ${info.cpuCores} núcleos · ABI ${info.cpuArch}`,
      },
      {
        parte: 'RAM y Almacenamiento',
        estado: suspiciousSpecs ? 'Alerta' : 'Coherente',
        detalle: `${info.ramTotalGb ?? 'N/D'} GB RAM · ${info.storageTotalGb ?? 'N/D'} GB internos`,
      },
      {
        parte: 'Pantalla y GPU',
        estado: 'Coherente',
        detalle: `${info.gpu || 'GPU WebGL'} · ${info.screenRes || 'N/D'}`,
      },
      {
        parte: 'Integridad de Sistema',
        estado: isModified || isEmulator ? 'Alerta' : 'Coherente',
        detalle: `Tags: ${info.buildTags || 'N/D'} · Boot: ${info.verifiedBootState || 'N/D'} · Root: ${info.isRooted ? 'Sí' : 'No'}`,
      },
    ],
    nota_fisica:
      'La auditoría valida el hardware reportado por Android y la integridad del firmware. Repuestos físicos genéricos con idénticas especificaciones eléctricas no son distinguibles por software.',
  };
}
