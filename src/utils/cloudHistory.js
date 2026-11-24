import { supabase } from '../supabaseClient';
import { generateSecureTicketId } from './security';

/**
 * Registra automáticamente un reporte global completo de diagnóstico/escaneo/test móvil
 * en 'reportes_diagnostico' vinculado exclusivamente a specs_json.owner_dni.
 */
export async function recordMobileEvent({
  user,
  deviceInfo,
  tipoEvento = 'Escaneo Android',
  prefix = 'MOB',
  diagnostico = '',
  solucion = '',
  healthScore = 92,
  extraErrors = [],
}) {
  const ownerDni = user?.dni ? String(user.dni).trim() : '';
  if (!ownerDni || !deviceInfo) return null;

  const ticketId = generateSecureTicketId(ownerDni, prefix);

  const cpuLabel = deviceInfo.cpuName
    ? `${deviceInfo.cpuName} (${deviceInfo.cpuCores || 8} núcleos · ${deviceInfo.cpuArch || 'arm64-v8a'})`
    : 'SoC Móvil ARM64';
  const ramLabel = deviceInfo.ramTotalGb
    ? `${deviceInfo.ramTotalGb} GB LPDDR (${deviceInfo.ramUsedPct ?? 0}% uso)`
    : 'RAM Móvil';
  const gpuLabel = deviceInfo.gpu || 'GPU Móvil WebGL';
  const storageLabel = deviceInfo.storageTotalGb
    ? `${deviceInfo.storageTotalGb} GB UFS (${deviceInfo.storageAvailGb ?? '?'} GB libres)`
    : 'Almacenamiento Interno';
  const boardLabel = deviceInfo.displayName
    ? `${deviceInfo.displayName}${deviceInfo.board ? ` (Placa ${deviceInfo.board})` : ''}`
    : 'Smartphone Android';
  const batteryLabel = deviceInfo.batteryPct != null
    ? `Batería ${deviceInfo.batteryPct}% · ${deviceInfo.batteryHealth || 'Estándar'}${deviceInfo.batteryTempC != null ? ` · ${deviceInfo.batteryTempC}°C` : ''}`
    : 'Batería Li-ion';

  const autoErrors = [...(Array.isArray(extraErrors) ? extraErrors : [])];
  if (deviceInfo.batteryTempC != null && deviceInfo.batteryTempC >= 40) {
    autoErrors.push({
      severidad: deviceInfo.batteryTempC >= 44 ? 'critica' : 'alta',
      area: 'Térmica / Batería',
      mensaje: `Temperatura de batería elevada (${deviceInfo.batteryTempC}°C).`,
    });
  }
  if (deviceInfo.ramUsedPct != null && deviceInfo.ramUsedPct >= 85) {
    autoErrors.push({
      severidad: 'media',
      area: 'RAM',
      mensaje: `Alta presión de memoria RAM (${deviceInfo.ramUsedPct}% en uso).`,
    });
  }
  if (deviceInfo.storageUsedPct != null && deviceInfo.storageUsedPct >= 85) {
    autoErrors.push({
      severidad: deviceInfo.storageUsedPct >= 93 ? 'critica' : 'alta',
      area: 'Almacenamiento',
      mensaje: `Almacenamiento interno al ${deviceInfo.storageUsedPct}% (${deviceInfo.storageAvailGb ?? '?'} GB libres).`,
    });
  }
  if (deviceInfo.isRooted || deviceInfo.verifiedBootState === 'orange' || deviceInfo.verifiedBootState === 'red') {
    autoErrors.push({
      severidad: 'alta',
      area: 'Integridad SO',
      mensaje: `Firmware/Bootloader alterado (Root: ${deviceInfo.isRooted ? 'Sí' : 'No'} · Boot: ${deviceInfo.verifiedBootState || 'N/D'}).`,
    });
  }

  const specsJson = {
    tipo_equipo: deviceInfo.isTablet ? 'tablet' : 'phone',
    tipo_evento: tipoEvento,
    owner_dni: ownerDni,
    owner_nick: user?.nickname || null,
    modelo_comercial: deviceInfo.displayName || 'Smartphone Android',
    modelo_codigo: deviceInfo.model || null,
    equipo_fabricante: deviceInfo.manufacturer || deviceInfo.brand || null,
    mb_fabricante: deviceInfo.manufacturer || deviceInfo.brand || null,
    mb_modelo: deviceInfo.board || deviceInfo.deviceCode || null,
    so: {
      nombre: deviceInfo.os || 'Android',
      build: deviceInfo.securityPatch ? `Parche ${deviceInfo.securityPatch}` : (deviceInfo.buildTags || 'Oficial'),
      uptime: null,
    },
    integridad: {
      verified_boot: deviceInfo.verifiedBootState || 'unknown',
      is_rooted: Boolean(deviceInfo.isRooted),
      is_emulator: Boolean(deviceInfo.isEmulator),
      build_tags: deviceInfo.buildTags || 'release-keys',
      security_patch: deviceInfo.securityPatch || null,
    },
    bateria: {
      porcentaje: deviceInfo.batteryPct ?? null,
      salud: deviceInfo.batteryHealth || 'Estándar',
      temperatura_c: deviceInfo.batteryTempC ?? null,
      voltaje_mv: deviceInfo.batteryVoltageMv ?? null,
      tecnologia: deviceInfo.batteryTechnology || 'Li-ion',
      fuente: deviceInfo.batteryPlugged || 'Desconectado',
    },
    pantalla: deviceInfo.screenRes || 'N/D',
    errores_detectados: autoErrors,
  };

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
        health_score: Math.max(0, Math.min(100, Math.round(healthScore))),
        diagnostico: diagnostico || `${tipoEvento} — ${boardLabel}`,
        solucion: solucion || 'Evento registrado automáticamente en el historial privado de la cuenta.',
        specs_json: specsJson,
      },
      { onConflict: 'id_ticket' }
    );
    if (error) {
      console.warn('[cloudHistory] Error registrando evento:', error.message);
      return null;
    }
    return ticketId;
  } catch {
    return null;
  }
}
