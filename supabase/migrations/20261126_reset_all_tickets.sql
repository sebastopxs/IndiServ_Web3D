-- =============================================================================
-- INDISERV ANALYTICA — REINICIO TOTAL DE TICKETS DE TODAS LAS CUENTAS
-- Ejecutar en: Supabase Dashboard -> SQL Editor -> New Query -> Run
--
-- Limpia todos los tickets de prueba acumulados en 'reportes_diagnostico'
-- y sus sugerencias asociadas en 'sugerencias_locales' (conservando las
-- alertas de seguridad 'HONEY-%' para trazabilidad defensiva).
-- NO borra cuentas de usuarios, padrón UNMSM ni dispositivos confiables.
-- =============================================================================

BEGIN;

DELETE FROM public.sugerencias_locales
 WHERE id_ticket NOT LIKE 'HONEY-%';

DELETE FROM public.reportes_diagnostico;

COMMIT;

-- Verificación rápida (debe mostrar 0 tickets restantes):
SELECT
    (SELECT count(*) FROM public.reportes_diagnostico) AS tickets_restantes,
    (SELECT count(*) FROM public.sugerencias_locales WHERE id_ticket NOT LIKE 'HONEY-%') AS sugerencias_restantes,
    (SELECT count(*) FROM public.usuarios_app) AS cuentas_conservadas;
