/**
 * hardwareCatalog.js
 * Motor de resolución comercial de dispositivos (teléfonos y tablets) y procesadores SoC estilo CPU-Z.
 * Combina propiedades nativas OEM, diccionario offline amplio, desambiguación GPU/MHz y caché localStorage.
 */

const CACHE_KEY = 'indiserv_hw_identity_cache_v1';

const DEVICE_MODEL_CATALOG = {

  'SM-S938': { name: 'Samsung Galaxy S25 Ultra', tablet: false },
  'SM-S936': { name: 'Samsung Galaxy S25+', tablet: false },
  'SM-S931': { name: 'Samsung Galaxy S25', tablet: false },
  'SM-S928': { name: 'Samsung Galaxy S24 Ultra', tablet: false },
  'SM-S926': { name: 'Samsung Galaxy S24+', tablet: false },
  'SM-S921': { name: 'Samsung Galaxy S24', tablet: false },
  'SM-S721': { name: 'Samsung Galaxy S24 FE', tablet: false },
  'SM-S918': { name: 'Samsung Galaxy S23 Ultra', tablet: false },
  'SM-S916': { name: 'Samsung Galaxy S23+', tablet: false },
  'SM-S911': { name: 'Samsung Galaxy S23', tablet: false },
  'SM-S711': { name: 'Samsung Galaxy S23 FE', tablet: false },
  'SM-S908': { name: 'Samsung Galaxy S22 Ultra', tablet: false },
  'SM-S906': { name: 'Samsung Galaxy S22+', tablet: false },
  'SM-S901': { name: 'Samsung Galaxy S22', tablet: false },
  'SM-G998': { name: 'Samsung Galaxy S21 Ultra', tablet: false },
  'SM-G991': { name: 'Samsung Galaxy S21', tablet: false },
  'SM-G990': { name: 'Samsung Galaxy S21 FE', tablet: false },
  'SM-F956': { name: 'Samsung Galaxy Z Fold6', tablet: true },
  'SM-F946': { name: 'Samsung Galaxy Z Fold5', tablet: true },
  'SM-F741': { name: 'Samsung Galaxy Z Flip6', tablet: false },
  'SM-F731': { name: 'Samsung Galaxy Z Flip5', tablet: false },

  'SM-A566': { name: 'Samsung Galaxy A56 5G', tablet: false },
  'SM-A556': { name: 'Samsung Galaxy A55 5G', tablet: false },
  'SM-A546': { name: 'Samsung Galaxy A54 5G', tablet: false },
  'SM-A536': { name: 'Samsung Galaxy A53 5G', tablet: false },
  'SM-A528': { name: 'Samsung Galaxy A52s 5G', tablet: false },
  'SM-A366': { name: 'Samsung Galaxy A36 5G', tablet: false },
  'SM-A356': { name: 'Samsung Galaxy A35 5G', tablet: false },
  'SM-A346': { name: 'Samsung Galaxy A34 5G', tablet: false },
  'SM-A256': { name: 'Samsung Galaxy A25 5G', tablet: false },
  'SM-A245': { name: 'Samsung Galaxy A24', tablet: false },
  'SM-A166': { name: 'Samsung Galaxy A16 5G', tablet: false },
  'SM-A165': { name: 'Samsung Galaxy A16', tablet: false },
  'SM-A156': { name: 'Samsung Galaxy A15 5G', tablet: false },
  'SM-A155': { name: 'Samsung Galaxy A15', tablet: false },
  'SM-A146': { name: 'Samsung Galaxy A14 5G', tablet: false },
  'SM-A145': { name: 'Samsung Galaxy A14', tablet: false },
  'SM-A057': { name: 'Samsung Galaxy A05s', tablet: false },
  'SM-A055': { name: 'Samsung Galaxy A05', tablet: false },
  'SM-M556': { name: 'Samsung Galaxy M55 5G', tablet: false },
  'SM-M546': { name: 'Samsung Galaxy M54 5G', tablet: false },
  'SM-M346': { name: 'Samsung Galaxy M34 5G', tablet: false },

  'SM-X920': { name: 'Samsung Galaxy Tab S10 Ultra', tablet: true },
  'SM-X820': { name: 'Samsung Galaxy Tab S10+', tablet: true },
  'SM-X910': { name: 'Samsung Galaxy Tab S9 Ultra', tablet: true },
  'SM-X810': { name: 'Samsung Galaxy Tab S9+', tablet: true },
  'SM-X710': { name: 'Samsung Galaxy Tab S9', tablet: true },
  'SM-X716': { name: 'Samsung Galaxy Tab S9 5G', tablet: true },
  'SM-X610': { name: 'Samsung Galaxy Tab S9 FE+', tablet: true },
  'SM-X510': { name: 'Samsung Galaxy Tab S9 FE', tablet: true },
  'SM-X516': { name: 'Samsung Galaxy Tab S9 FE 5G', tablet: true },
  'SM-X210': { name: 'Samsung Galaxy Tab A9+', tablet: true },
  'SM-X216': { name: 'Samsung Galaxy Tab A9+ 5G', tablet: true },
  'SM-X110': { name: 'Samsung Galaxy Tab A9', tablet: true },
  'SM-X115': { name: 'Samsung Galaxy Tab A9 LTE', tablet: true },
  'SM-X200': { name: 'Samsung Galaxy Tab A8', tablet: true },
  'SM-P613': { name: 'Samsung Galaxy Tab S6 Lite (2022)', tablet: true },
  'SM-P620': { name: 'Samsung Galaxy Tab S6 Lite (2024)', tablet: true },
  'SM-T220': { name: 'Samsung Galaxy Tab A7 Lite', tablet: true },
  'SM-T225': { name: 'Samsung Galaxy Tab A7 Lite LTE', tablet: true },

  '25010PN30': { name: 'Xiaomi 15 Ultra', tablet: false },
  '24129PN74': { name: 'Xiaomi 15', tablet: false },
  '24030PN60': { name: 'Xiaomi 14 Ultra', tablet: false },
  '23127PN0C': { name: 'Xiaomi 14', tablet: false },
  '24090RA29': { name: 'Redmi Note 14 Pro 5G', tablet: false },
  '24116RAC':  { name: 'Redmi Note 14 Pro 4G', tablet: false },
  '24117RN76': { name: 'Redmi Note 14 4G', tablet: false },
  '2312DRA50': { name: 'Redmi Note 13 Pro 5G', tablet: false },
  '23117RA68': { name: 'Redmi Note 13 Pro 4G', tablet: false },
  '23090RA98': { name: 'Redmi Note 13 Pro+ 5G', tablet: false },
  '23129RAA4': { name: 'Redmi Note 13 4G', tablet: false },
  '23124RA7E': { name: 'Redmi Note 13 4G', tablet: false },
  '23053RN02': { name: 'Redmi 12', tablet: false },
  '23076RN8D': { name: 'Redmi 13C', tablet: false },
  '24049RN28': { name: 'Redmi 13', tablet: false },
  '2412DPC0A': { name: 'POCO X7 Pro 5G', tablet: false },
  '2311DRK48': { name: 'POCO X6 Pro 5G', tablet: false },
  '23122PCD1': { name: 'POCO X6 5G', tablet: false },
  '24069PC21': { name: 'POCO F6', tablet: false },
  '23113RKC6': { name: 'POCO F6 Pro', tablet: false },
  '23043RP34': { name: 'Xiaomi Pad 6', tablet: true },
  '24091RPAD': { name: 'Xiaomi Pad 7', tablet: true },
  '23073RPBF': { name: 'Redmi Pad SE', tablet: true },
  '2405CRPFD': { name: 'Redmi Pad Pro', tablet: true },
  '22081283':  { name: 'Redmi Pad', tablet: true },

  'Pixel 9 Pro XL': { name: 'Google Pixel 9 Pro XL', tablet: false },
  'Pixel 9 Pro':    { name: 'Google Pixel 9 Pro', tablet: false },
  'Pixel 9':        { name: 'Google Pixel 9', tablet: false },
  'Pixel 8 Pro':    { name: 'Google Pixel 8 Pro', tablet: false },
  'Pixel 8a':       { name: 'Google Pixel 8a', tablet: false },
  'Pixel 8':        { name: 'Google Pixel 8', tablet: false },
  'Pixel 7 Pro':    { name: 'Google Pixel 7 Pro', tablet: false },
  'Pixel 7a':       { name: 'Google Pixel 7a', tablet: false },
  'Pixel 7':        { name: 'Google Pixel 7', tablet: false },
  'Pixel Tablet':   { name: 'Google Pixel Tablet', tablet: true },

  'XT2409': { name: 'Motorola Edge 50 Neo', tablet: false },
  'XT2403': { name: 'Motorola Edge 50 Pro', tablet: false },
  'XT2429': { name: 'Motorola Edge 50 Fusion', tablet: false },
  'XT2431': { name: 'Moto G85 5G', tablet: false },
  'XT2347': { name: 'Moto G84 5G', tablet: false },
  'XT2335': { name: 'Moto G54 5G', tablet: false },
  'XT2427': { name: 'Moto G55 5G', tablet: false },
  'TB310':  { name: 'Lenovo Tab M9', tablet: true },
  'TB328':  { name: 'Lenovo Tab M10 (3rd Gen)', tablet: true },
  'TB330':  { name: 'Lenovo Tab M11', tablet: true },
  'TB350':  { name: 'Lenovo Tab P11 (2nd Gen)', tablet: true },
  'TB370':  { name: 'Lenovo Tab P12', tablet: true },

  'REA-NX9':  { name: 'HONOR 90', tablet: false },
  'ELI-NX9':  { name: 'HONOR 200', tablet: false },
  'ALI-NX1':  { name: 'HONOR Magic6 Lite', tablet: false },
  'HEY-W09':  { name: 'HONOR Pad X9', tablet: true },
  'CPH2581':  { name: 'OnePlus 12', tablet: false },
  'CPH2609':  { name: 'OnePlus 12R', tablet: false },
  'CPH2653':  { name: 'OnePlus 13', tablet: false },
  'RMX3851':  { name: 'Realme GT 6', tablet: false },
};

const SOC_CATALOG = [

  { match: /\b(sm8750|sun)\b/i,               name: 'Qualcomm Snapdragon 8 Elite',      vendor: 'Qualcomm' },
  { match: /\b(sm8650|pineapple)\b/i,         name: 'Qualcomm Snapdragon 8 Gen 3',      vendor: 'Qualcomm' },
  { match: /\b(sm8635|cliffs)\b/i,            name: 'Qualcomm Snapdragon 8s Gen 3',     vendor: 'Qualcomm' },
  { match: /\b(sm8550|kalama)\b/i,            name: 'Qualcomm Snapdragon 8 Gen 2',      vendor: 'Qualcomm' },
  { match: /\b(sm8475|cape)\b/i,              name: 'Qualcomm Snapdragon 8+ Gen 1',     vendor: 'Qualcomm' },
  { match: /\b(sm8450|taro)\b/i,              name: 'Qualcomm Snapdragon 8 Gen 1',      vendor: 'Qualcomm' },
  { match: /\b(sm8350|lahaina)\b/i,           name: 'Qualcomm Snapdragon 888',          vendor: 'Qualcomm' },
  { match: /\b(sm8250|kona)\b/i,              name: 'Qualcomm Snapdragon 865 / 870',    vendor: 'Qualcomm' },
  { match: /\b(sm8150|msmnile)\b/i,           name: 'Qualcomm Snapdragon 855',          vendor: 'Qualcomm' },

  { match: /\b(sm7675)\b/i,                   name: 'Qualcomm Snapdragon 7+ Gen 3',     vendor: 'Qualcomm' },
  { match: /\b(sm7550|crow)\b/i,              name: 'Qualcomm Snapdragon 7 Gen 3',      vendor: 'Qualcomm' },
  { match: /\b(sm7475)\b/i,                   name: 'Qualcomm Snapdragon 7+ Gen 2',     vendor: 'Qualcomm' },
  { match: /\b(sm7450)\b/i,                   name: 'Qualcomm Snapdragon 7 Gen 1',      vendor: 'Qualcomm' },
  { match: /\b(sm7435|parrot)\b/i,            name: 'Qualcomm Snapdragon 7s Gen 2',     vendor: 'Qualcomm' },
  { match: /\b(sm7325|yupik)\b/i,             name: 'Qualcomm Snapdragon 778G',         vendor: 'Qualcomm' },
  { match: /\b(sm7225|lito)\b/i,              name: 'Qualcomm Snapdragon 750G',         vendor: 'Qualcomm' },
  { match: /\b(sm7150|sm6150)\b/i,            name: 'Qualcomm Snapdragon 732G / 730',   vendor: 'Qualcomm' },
  { match: /\b(sm6450)\b/i,                   name: 'Qualcomm Snapdragon 6 Gen 1',      vendor: 'Qualcomm' },
  { match: /\b(sm6375|holi)\b/i,              name: 'Qualcomm Snapdragon 695 5G',       vendor: 'Qualcomm' },
  { match: /\b(sm6225|khaje|bengal)\b/i,      name: 'Qualcomm Snapdragon 680 / 685',    vendor: 'Qualcomm' },
  { match: /\b(sm6115|trinket)\b/i,           name: 'Qualcomm Snapdragon 662 / 665',    vendor: 'Qualcomm' },
  { match: /\b(sm4450)\b/i,                   name: 'Qualcomm Snapdragon 4 Gen 2',      vendor: 'Qualcomm' },
  { match: /\b(sm4375)\b/i,                   name: 'Qualcomm Snapdragon 4 Gen 1',      vendor: 'Qualcomm' },
  { match: /\b(sm4350)\b/i,                   name: 'Qualcomm Snapdragon 480 5G',       vendor: 'Qualcomm' },

  { match: /\b(mt6991)\b/i,                   name: 'MediaTek Dimensity 9400',          vendor: 'MediaTek' },
  { match: /\b(mt6989)\b/i,                   name: 'MediaTek Dimensity 9300',          vendor: 'MediaTek' },
  { match: /\b(mt6985)\b/i,                   name: 'MediaTek Dimensity 9200',          vendor: 'MediaTek' },
  { match: /\b(mt6983)\b/i,                   name: 'MediaTek Dimensity 9000',          vendor: 'MediaTek' },
  { match: /\b(mt6897)\b/i,                   name: 'MediaTek Dimensity 8300 Ultra',    vendor: 'MediaTek' },
  { match: /\b(mt6895)\b/i,                   name: 'MediaTek Dimensity 8100 / 8200',   vendor: 'MediaTek' },
  { match: /\b(mt6893)\b/i,                   name: 'MediaTek Dimensity 1200 / 1300',   vendor: 'MediaTek' },
  { match: /\b(mt6886)\b/i,                   name: 'MediaTek Dimensity 7200',          vendor: 'MediaTek' },
  { match: /\b(mt6878)\b/i,                   name: 'MediaTek Dimensity 7300',          vendor: 'MediaTek' },
  { match: /\b(mt6877)\b/i,                   name: 'MediaTek Dimensity 7050 / 1080',   vendor: 'MediaTek' },
  { match: /\b(mt6855)\b/i,                   name: 'MediaTek Dimensity 7020 / 930',    vendor: 'MediaTek' },
  { match: /\b(mt6835)\b/i,                   name: 'MediaTek Dimensity 6100+ / 6300',  vendor: 'MediaTek' },
  { match: /\b(mt6833)\b/i,                   name: 'MediaTek Dimensity 6020 / 700',    vendor: 'MediaTek' },

  { match: /\b(mt6789|mt8781)\b/i,            name: 'MediaTek Helio G99 / G100',        vendor: 'MediaTek' },
  { match: /\b(mt6785)\b/i,                   name: 'MediaTek Helio G90T / G95',        vendor: 'MediaTek' },
  { match: /\b(mt6781)\b/i,                   name: 'MediaTek Helio G96',               vendor: 'MediaTek' },
  { match: /\b(mt6769)\b/i,                   name: 'MediaTek Helio G80 / G85 / G88',   vendor: 'MediaTek' },
  { match: /\b(mt6768)\b/i,                   name: 'MediaTek Helio G85 / G88',         vendor: 'MediaTek' },
  { match: /\b(mt6765)\b/i,                   name: 'MediaTek Helio G35 / G37 / P35',   vendor: 'MediaTek' },
  { match: /\b(mt6762)\b/i,                   name: 'MediaTek Helio P22 / G25',         vendor: 'MediaTek' },

  { match: /\b(s5e9945|exynos\s*2400)\b/i,    name: 'Samsung Exynos 2400',              vendor: 'Samsung' },
  { match: /\b(s5e9925|exynos\s*2200)\b/i,    name: 'Samsung Exynos 2200',              vendor: 'Samsung' },
  { match: /\b(exynos\s*2100|s5e9840)\b/i,    name: 'Samsung Exynos 2100',              vendor: 'Samsung' },
  { match: /\b(s5e8845|exynos\s*1480)\b/i,    name: 'Samsung Exynos 1480',              vendor: 'Samsung' },
  { match: /\b(s5e8835|exynos\s*1380)\b/i,    name: 'Samsung Exynos 1380',              vendor: 'Samsung' },
  { match: /\b(s5e8535|exynos\s*1330)\b/i,    name: 'Samsung Exynos 1330',              vendor: 'Samsung' },
  { match: /\b(s5e8825|exynos\s*1280)\b/i,    name: 'Samsung Exynos 1280',              vendor: 'Samsung' },
  { match: /\b(exynos\s*9611|universal9611)\b/i, name: 'Samsung Exynos 9611',           vendor: 'Samsung' },
  { match: /\b(exynos\s*850|s5e3830)\b/i,     name: 'Samsung Exynos 850',               vendor: 'Samsung' },

  { match: /\b(zumapro|tensor\s*g4)\b/i,      name: 'Google Tensor G4',                 vendor: 'Google' },
  { match: /\b(zuma|tensor\s*g3)\b/i,         name: 'Google Tensor G3',                 vendor: 'Google' },
  { match: /\b(gs201|cloudripper|tensor\s*g2)\b/i, name: 'Google Tensor G2',            vendor: 'Google' },
  { match: /\b(gs101|whitechapel|tensor)\b/i, name: 'Google Tensor',                    vendor: 'Google' },

  { match: /\b(ums9620|t760)\b/i,             name: 'UNISOC Tiger T760',                vendor: 'UNISOC' },
  { match: /\b(ums9230|t606)\b/i,             name: 'UNISOC Tiger T606 / T616',         vendor: 'UNISOC' },
  { match: /\b(ums512|t618|t610)\b/i,         name: 'UNISOC Tiger T610 / T618',         vendor: 'UNISOC' },
  { match: /\b(sc9863a)\b/i,                  name: 'UNISOC SC9863A',                   vendor: 'UNISOC' },

  { match: /\b(kirin\s*9000|hi36a0)\b/i,      name: 'HiSilicon Kirin 9000',             vendor: 'HiSilicon' },
  { match: /\b(kirin\s*990|hi3690)\b/i,       name: 'HiSilicon Kirin 990',              vendor: 'HiSilicon' },
  { match: /\b(kirin\s*980|hi3680)\b/i,       name: 'HiSilicon Kirin 980',              vendor: 'HiSilicon' },
  { match: /\b(kirin\s*710|hi6260)\b/i,       name: 'HiSilicon Kirin 710',              vendor: 'HiSilicon' },
];

function looksLikeRawModelCode(str) {
  if (!str) return true;
  const s = str.trim();
  if (s.length < 3) return true;
  if (/^(unknown|android|generic|dispositivo|equipo móvil)$/i.test(s)) return true;

  if (/^(SM-[A-Z]\d{3,4}[A-Z0-9]*|\d{5,7}[A-Z0-9]{2,6}|XT\d{4}[A-Z0-9-]*|CPH\d{4}|RMX\d{4}|M\d{4}[A-Z0-9]+|TB\d{3}[A-Z0-9]*)$/i.test(s)) {
    return true;
  }
  return false;
}

export function buildDeviceFingerprint(hw) {
  return [
    hw?.manufacturer || '',
    hw?.model || '',
    hw?.socCodename || hw?.socModel || hw?.hardwarePlatform || '',
  ]
    .join('|')
    .toLowerCase()
    .trim();
}

export function getCachedAiIdentity(fingerprintKey) {
  if (!fingerprintKey || typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw);
    return map?.[fingerprintKey] || null;
  } catch {
    return null;
  }
}

export function saveCachedAiIdentity(fingerprintKey, data) {
  if (!fingerprintKey || !data || typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[fingerprintKey] = {
      commercialName: data.commercialName || null,
      commercialSoc: data.commercialSoc || null,
      updatedAt: Date.now(),
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(map));
  } catch {

  }
}

export function resolveCommercialDeviceName(hw = {}) {
  const manufacturer = (hw.manufacturer || '').trim();
  const brand = (hw.brand || '').trim();
  const modelCode = (hw.model || '').trim();
  const marketName = (hw.marketName || '').trim();
  const deviceNameSetting = (hw.deviceNameSetting || '').trim();

  const upperCode = modelCode.toUpperCase();
  let catalogHit = null;
  for (const [prefix, entry] of Object.entries(DEVICE_MODEL_CATALOG)) {
    if (upperCode === prefix.toUpperCase() || upperCode.startsWith(prefix.toUpperCase())) {
      catalogHit = entry;
      break;
    }
  }

  let isTablet = Boolean(hw.isTablet || catalogHit?.tablet);
  if (!isTablet && /\b(tab|pad|tablet|fold)\b|^SM-[XTP]\d{3}|^TB\d{3}/i.test(`${marketName} ${modelCode}`)) {
    isTablet = true;
  }

  let commercialName = '';
  let resolvedFromCatalog = false;

  if (marketName && !looksLikeRawModelCode(marketName)) {
    commercialName = marketName;
    resolvedFromCatalog = true;
  }

  else if (catalogHit) {
    commercialName = catalogHit.name;
    resolvedFromCatalog = true;
  }

  else {
    const cached = getCachedAiIdentity(buildDeviceFingerprint(hw));
    if (cached?.commercialName && !looksLikeRawModelCode(cached.commercialName)) {
      commercialName = cached.commercialName;
      resolvedFromCatalog = true;
    }
  }

  if (!commercialName && deviceNameSetting && !looksLikeRawModelCode(deviceNameSetting) && !/^my\s|^mi\s/i.test(deviceNameSetting)) {
    commercialName = deviceNameSetting;
    resolvedFromCatalog = true;
  }

  if (!commercialName) {
    const brandPrefix = brand && brand.toLowerCase() !== manufacturer.toLowerCase()
      ? `${manufacturer} ${brand}`.trim()
      : manufacturer;
    commercialName = `${brandPrefix} ${modelCode}`.trim() || 'Dispositivo Android';
  }

  return {
    commercialName,
    modelCode: modelCode || 'N/D',
    isTablet,
    deviceFormLabel: isTablet ? 'Tablet Android' : 'Teléfono Android',
    resolvedFromCatalog,
  };
}

export function resolveCommercialSocName(hw = {}) {
  const candidates = [
    hw.socModel,
    hw.chipName,
    hw.socCodename,
    hw.cpuName,
    hw.hardwarePlatform,
    hw.board,
    hw.hardwareCode,
  ]
    .filter(Boolean)
    .join(' ');

  const gpu = (hw.gpu || '').toLowerCase();
  const maxFreqMhz = Number(hw.cpuMaxFreqMhz) || 0;
  const factoryCode = (hw.socCodename || hw.socModel || hw.chipName || hw.hardwarePlatform || hw.hardwareCode || '').trim();

  if (/\b(snapdragon|dimensity|helio|exynos\s*\d{3,4}|tensor\s*g?\d?|kirin\s*\d{3,4}|tiger\s*t\d{3})\b/i.test(candidates)) {
    const vendor = /snapdragon/i.test(candidates)
      ? 'Qualcomm'
      : /dimensity|helio/i.test(candidates)
      ? 'MediaTek'
      : /exynos/i.test(candidates)
      ? 'Samsung'
      : /tensor/i.test(candidates)
      ? 'Google'
      : /kirin/i.test(candidates)
      ? 'HiSilicon'
      : 'UNISOC';
    const cleanExisting = (hw.cpuName || candidates).trim();
    return {
      commercialSoc: cleanExisting,
      factoryCode: factoryCode || cleanExisting,
      vendor,
      resolvedFromCatalog: true,
    };
  }

  for (const entry of SOC_CATALOG) {
    if (entry.match.test(candidates)) {
      let resolvedName = entry.name;

      if (/\bmt6768\b/i.test(candidates) && gpu.includes('mali-g52')) {
        resolvedName = maxFreqMhz >= 2000 ? 'MediaTek Helio G85 / G88' : 'MediaTek Helio G80';
      } else if (/\bsm6225\b/i.test(candidates) && maxFreqMhz >= 2700) {
        resolvedName = 'Qualcomm Snapdragon 685';
      } else if (/\bsm6225\b/i.test(candidates) && maxFreqMhz > 0 && maxFreqMhz < 2600) {
        resolvedName = 'Qualcomm Snapdragon 680';
      }

      return {
        commercialSoc: resolvedName,
        factoryCode: factoryCode || hw.cpuName || 'ARM64',
        vendor: entry.vendor,
        resolvedFromCatalog: true,
      };
    }
  }

  const cached = getCachedAiIdentity(buildDeviceFingerprint(hw));
  if (cached?.commercialSoc) {
    return {
      commercialSoc: cached.commercialSoc,
      factoryCode: factoryCode || hw.cpuName || 'ARM64',
      vendor: 'ARM',
      resolvedFromCatalog: true,
    };
  }

  if (gpu.includes('adreno')) {
    const m = gpu.match(/adreno[^0-9]*(\d{3})/i);
    return {
      commercialSoc: m ? `Qualcomm Snapdragon (Adreno ${m[1]})` : 'Qualcomm Snapdragon',
      factoryCode: factoryCode || hw.cpuName || 'Qualcomm',
      vendor: 'Qualcomm',
      resolvedFromCatalog: false,
    };
  }
  if (gpu.includes('xclipse')) {
    return {
      commercialSoc: 'Samsung Exynos (GPU AMD Xclipse)',
      factoryCode: factoryCode || hw.cpuName || 'Exynos',
      vendor: 'Samsung',
      resolvedFromCatalog: false,
    };
  }

  return {
    commercialSoc: hw.cpuName || `Procesador ARM (${hw.cpuCores || 8} núcleos)`,
    factoryCode: factoryCode || hw.cpuArch || 'arm64-v8a',
    vendor: hw.socManufacturer || 'ARM',
    resolvedFromCatalog: false,
  };
}
