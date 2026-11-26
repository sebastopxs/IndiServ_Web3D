-- =============================================================================
-- INDISERV ANALYTICA — AUDITORÍA RONDA 4: TTL/ROTACIÓN DE SHARE TOKEN Y PURGA
-- Cierra en base de datos:
--   #4 Expiración (72 h) y rotación/revocación bajo demanda de share_token (#st=)
--   #7 Purga segura de registros expirados en codigos_otp, sesiones_activas y rate_limits
-- Ejecutar en: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- =============================================================================

BEGIN;

-- 1. COLUMNA DE EXPIRACIÓN PARA ENLACES COMPARTIDOS (72 HORAS POR DEFECTO)
ALTER TABLE public.reportes_diagnostico
    ADD COLUMN IF NOT EXISTS share_token_expira_en timestamptz NOT NULL DEFAULT (now() + interval '72 hours');

UPDATE public.reportes_diagnostico
   SET share_token_expira_en = now() + interval '72 hours'
 WHERE share_token_expira_en IS NULL;

-- 2. ACTUALIZAR guardar_ticket_seguro PARA RENOVAR VIGENCIA DE 72 H DEL SHARE TOKEN
CREATE OR REPLACE FUNCTION public.guardar_ticket_seguro(
    p_dni text,
    p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_clean_dni text := btrim(COALESCE(p_dni, ''));
    v_id text := btrim(COALESCE(p_payload->>'id_ticket', ''));
    v_existing_owner text;
    v_share_token text;
    v_share_exp timestamptz;
    v_specs jsonb;
BEGIN
    IF v_clean_dni = '' OR length(v_id) < 6 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Ticket inválido.');
    END IF;

    SELECT specs_json->>'owner_dni'
      INTO v_existing_owner
      FROM public.reportes_diagnostico
     WHERE id_ticket = v_id;

    IF v_existing_owner IS NOT NULL AND btrim(v_existing_owner) <> v_clean_dni THEN
        RETURN jsonb_build_object('ok', false, 'error', 'No autorizado para sobrescribir este ticket.');
    END IF;

    v_specs := COALESCE(p_payload->'specs_json', '{}'::jsonb) || jsonb_build_object('owner_dni', v_clean_dni);

    INSERT INTO public.reportes_diagnostico (
        id_ticket, cpu, ram, gpu, almacenamiento, placa_base,
        refrigeracion, health_score, diagnostico, solucion, specs_json,
        share_token_expira_en
    )
    VALUES (
        v_id,
        LEFT(COALESCE(p_payload->>'cpu', 'N/D'), 200),
        LEFT(COALESCE(p_payload->>'ram', 'N/D'), 200),
        LEFT(COALESCE(p_payload->>'gpu', 'N/D'), 200),
        LEFT(COALESCE(p_payload->>'almacenamiento', 'N/D'), 200),
        LEFT(COALESCE(p_payload->>'placa_base', 'N/D'), 200),
        LEFT(COALESCE(p_payload->>'refrigeracion', 'N/D'), 200),
        GREATEST(0, LEAST(100, COALESCE((p_payload->>'health_score')::integer, 90))),
        LEFT(COALESCE(p_payload->>'diagnostico', ''), 2000),
        LEFT(COALESCE(p_payload->>'solucion', ''), 12000),
        v_specs,
        now() + interval '72 hours'
    )
    ON CONFLICT (id_ticket) DO UPDATE SET
        cpu = EXCLUDED.cpu,
        ram = EXCLUDED.ram,
        gpu = EXCLUDED.gpu,
        almacenamiento = EXCLUDED.almacenamiento,
        placa_base = EXCLUDED.placa_base,
        refrigeracion = EXCLUDED.refrigeracion,
        health_score = EXCLUDED.health_score,
        diagnostico = EXCLUDED.diagnostico,
        solucion = EXCLUDED.solucion,
        specs_json = EXCLUDED.specs_json,
        share_token_expira_en = now() + interval '72 hours'
    RETURNING share_token, share_token_expira_en INTO v_share_token, v_share_exp;

    RETURN jsonb_build_object(
        'ok', true,
        'id_ticket', v_id,
        'share_token', v_share_token,
        'share_token_expira_en', v_share_exp
    );
END;
$$;

-- 3. ACTUALIZAR listar_tickets_seguro PARA EXPONER VIGENCIA DEL SHARE TOKEN AL DUEÑO
CREATE OR REPLACE FUNCTION public.listar_tickets_seguro(
    p_dni text,
    p_limite integer DEFAULT 120
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_clean_dni text := btrim(COALESCE(p_dni, ''));
    v_lim integer := GREATEST(1, LEAST(200, COALESCE(p_limite, 120)));
    v_rows jsonb := '[]'::jsonb;
BEGIN
    SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)
      INTO v_rows
      FROM (
          SELECT id_ticket, share_token, share_token_expira_en, cpu, placa_base,
                 health_score, diagnostico, fecha_creacion, specs_json
            FROM public.reportes_diagnostico
           WHERE specs_json->>'owner_dni' = v_clean_dni
           ORDER BY fecha_creacion DESC
           LIMIT v_lim
      ) t;

    RETURN jsonb_build_object('ok', true, 'tickets', v_rows);
END;
$$;

-- 4. CONSULTA DE TICKET PROTEGIDA: EXIGE share_token VIGENTE (< 72 h) O SESIÓN DEL DUEÑO
CREATE OR REPLACE FUNCTION public.consultar_ticket_publico(
    p_ticket_id text,
    p_share_token text DEFAULT NULL,
    p_viewer_dni text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id text := btrim(COALESCE(p_ticket_id, ''));
    v_st text := btrim(COALESCE(p_share_token, ''));
    v_dni text := btrim(COALESCE(p_viewer_dni, ''));
    v_row RECORD;
BEGIN
    IF length(v_id) < 6 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'ID de ticket inválido.');
    END IF;

    SELECT id_ticket, cpu, ram, gpu, almacenamiento, placa_base, refrigeracion,
           health_score, diagnostico, solucion, fecha_creacion,
           share_token, share_token_expira_en,
           specs_json->>'owner_dni' AS owner_dni,
           (COALESCE(specs_json, '{}'::jsonb) - 'owner_dni') AS specs_json
      INTO v_row
      FROM public.reportes_diagnostico
     WHERE id_ticket = v_id
     LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Ticket no encontrado.');
    END IF;

    IF NOT (
        (v_st <> '' AND v_row.share_token = v_st AND v_row.share_token_expira_en > now())
        OR (v_dni <> '' AND btrim(COALESCE(v_row.owner_dni, '')) = v_dni)
    ) THEN
        IF v_st <> '' AND v_row.share_token = v_st AND v_row.share_token_expira_en <= now() THEN
            RETURN jsonb_build_object('ok', false, 'error', 'El enlace compartido ha expirado. Solicita uno nuevo al propietario.');
        END IF;
        RETURN jsonb_build_object('ok', false, 'error', 'Se requiere enlace autorizado vigente (share_token) o sesión del propietario.');
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'ticket', jsonb_build_object(
            'id_ticket', v_row.id_ticket,
            'cpu', v_row.cpu,
            'ram', v_row.ram,
            'gpu', v_row.gpu,
            'almacenamiento', v_row.almacenamiento,
            'placa_base', v_row.placa_base,
            'refrigeracion', v_row.refrigeracion,
            'health_score', v_row.health_score,
            'diagnostico', v_row.diagnostico,
            'solucion', v_row.solucion,
            'fecha_creacion', v_row.fecha_creacion,
            'specs_json', v_row.specs_json
        )
    );
END;
$$;

-- 5. ROTACIÓN / REVOCACIÓN INMEDIATA DE SHARE TOKEN POR EL PROPIETARIO
CREATE OR REPLACE FUNCTION public.rotar_share_token_seguro(
    p_dni text,
    p_ticket_id text,
    p_ttl_hours integer DEFAULT 72
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_clean_dni text := btrim(COALESCE(p_dni, ''));
    v_id text := btrim(COALESCE(p_ticket_id, ''));
    v_ttl integer := GREATEST(1, LEAST(168, COALESCE(p_ttl_hours, 72)));
    v_new_token text;
    v_new_exp timestamptz;
BEGIN
    IF v_clean_dni = '' OR length(v_id) < 6 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Parámetros inválidos.');
    END IF;

    UPDATE public.reportes_diagnostico
       SET share_token = encode(gen_random_bytes(16), 'hex'),
           share_token_expira_en = now() + make_interval(hours => v_ttl)
     WHERE id_ticket = v_id
       AND btrim(COALESCE(specs_json->>'owner_dni', '')) = v_clean_dni
    RETURNING share_token, share_token_expira_en INTO v_new_token, v_new_exp;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'forbidden', true, 'error', 'Ticket no encontrado o no autorizado.');
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'id_ticket', v_id,
        'share_token', v_new_token,
        'share_token_expira_en', v_new_exp
    );
END;
$$;

-- 6. PURGA DE REGISTROS EXPIRADOS (OTP, SESIONES, RATE LIMITS)
CREATE OR REPLACE FUNCTION public.purgar_registros_expirados()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_otp integer := 0;
    v_sess integer := 0;
    v_rl integer := 0;
BEGIN
    DELETE FROM public.codigos_otp
     WHERE expira_en < now() - interval '1 day'
        OR (usado = true AND creado_en < now() - interval '1 day');
    GET DIAGNOSTICS v_otp = ROW_COUNT;

    DELETE FROM public.sesiones_activas
     WHERE expira_en < now() - interval '1 day'
        OR (revocada = true AND creada_en < now() - interval '1 day');
    GET DIAGNOSTICS v_sess = ROW_COUNT;

    DELETE FROM public.rate_limits
     WHERE window_start < now() - interval '24 hours'
       AND (locked_until IS NULL OR locked_until < now());
    GET DIAGNOSTICS v_rl = ROW_COUNT;

    RETURN jsonb_build_object('ok', true, 'otp_deleted', v_otp, 'sessions_deleted', v_sess, 'rate_limits_deleted', v_rl);
END;
$$;

-- 7. RESTRINGIR TODAS LAS FUNCIONES EXCLUSIVAMENTE A SERVICE_ROLE
REVOKE ALL ON FUNCTION public.guardar_ticket_seguro(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.listar_tickets_seguro(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consultar_ticket_publico(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rotar_share_token_seguro(text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purgar_registros_expirados() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.guardar_ticket_seguro(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.listar_tickets_seguro(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.consultar_ticket_publico(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rotar_share_token_seguro(text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.purgar_registros_expirados() TO service_role;

-- 8. PROGRAMAR PURGA DIARIA AUTOMÁTICA SI pg_cron ESTÁ HABILITADO
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.schedule(
            'indiserv_purgar_registros_expirados',
            '15 4 * * *',
            'SELECT public.purgar_registros_expirados();'
        );
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

COMMIT;
