import { supabase } from '../supabaseClient';
import { generateSecureTicketId } from './security';

/**
 * Registra automáticamente un evento de diagnóstico/escaneo/test móvil en
 * 'reportes_diagnostico' vinculado exclusivamente a specs_json.owner_dni.
 * Si no hay sesión iniciada (user?.dni), no escribe nada en la nube.
 */
export async function recordMobileEvent({
  user,
  deviceInfo,
  tipoEvento = 'Escaneo Android',
  prefix = 'MOB',
  diagnostico = '',
  solucion = '',
  healthScore = 92,
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
    ? `${deviceInfo.displayName}${deviceInfo.board ? ` (${deviceInfo.board})` : ''}`
    : 'Smartphone Android';
  const batteryLabel = deviceInfo.batteryPct != null
    ? `Batería ${deviceInfo.batteryPct}% · ${deviceInfo.batteryHealth || 'Estándar'}${deviceInfo.batteryTempC != null ? ` · ${deviceInfo.batteryTempC}°C` : ''}`
    : 'Batería Li-ion';

  const specsJson = {
    tipo_equipo: 'phone',
    tipo_evento: tipoEvento,
    owner_dni: ownerDni,
    owner_nick: user?.nickname || null,
    modelo_comercial: deviceInfo.displayName || 'Smartphone Android',
    so: deviceInfo.os || 'Android',
    bateria: {
      porcentaje: deviceInfo.batteryPct ?? null,
      salud: deviceInfo.batteryHealth || 'Estándar',
      temperatura_c: deviceInfo.batteryTempC ?? null,
      voltaje_mv: deviceInfo.batteryVoltageMv ?? null,
      tecnologia: deviceInfo.batteryTechnology || 'Li-ion',
      fuente: deviceInfo.batteryPlugged || 'Desconectado',
    },
    pantalla: deviceInfo.screenRes || 'N/D',
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
