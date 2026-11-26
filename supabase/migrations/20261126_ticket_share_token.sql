-- =============================================================================
-- INDISERV ANALYTICA — SHARE TOKEN CRIPTOGRÁFICO DE 128 BITS PARA VISOR 3D
-- Evita enumeración o acceso a tickets públicos sin enlace compartido válido o sesión del dueño.
-- Ejecutar en: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- =============================================================================

BEGIN;

-- 1. COLUMNA share_token ALEATORIO DE 128 BITS (32 HEX) POR TICKET
ALTER TABLE public.reportes_diagnostico
    ADD COLUMN IF NOT EXISTS share_token text NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex');

UPDATE public.reportes_diagnostico
   SET share_token = encode(gen_random_bytes(16), 'hex')
 WHERE share_token IS NULL OR length(btrim(share_token)) < 16;

-- 2. ACTUALIZAR guardar_ticket_seguro PARA DEVOLVER EL share_token DEL TICKET
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
        refrigeracion, health_score, diagnostico, solucion, specs_json
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
        v_specs
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
        specs_json = EXCLUDED.specs_json
    RETURNING share_token INTO v_share_token;

    RETURN jsonb_build_object('ok', true, 'id_ticket', v_id, 'share_token', v_share_token);
END;
$$;

-- 3. ACTUALIZAR listar_tickets_seguro PARA INCLUIR share_token DEL PROPIETARIO
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
          SELECT id_ticket, share_token, cpu, placa_base, health_score, diagnostico, fecha_creacion, specs_json
            FROM public.reportes_diagnostico
           WHERE specs_json->>'owner_dni' = v_clean_dni
           ORDER BY fecha_creacion DESC
           LIMIT v_lim
      ) t;

    RETURN jsonb_build_object('ok', true, 'tickets', v_rows);
END;
$$;

-- 4. CONSULTA DE TICKET PROTEGIDA: EXIGE share_token DE 128 BITS O SESIÓN DEL PROPIETARIO
DROP FUNCTION IF EXISTS public.consultar_ticket_publico(text);

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
           share_token,
           specs_json->>'owner_dni' AS owner_dni,
           (COALESCE(specs_json, '{}'::jsonb) - 'owner_dni') AS specs_json
      INTO v_row
      FROM public.reportes_diagnostico
     WHERE id_ticket = v_id
     LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Ticket no encontrado.');
    END IF;

    -- Autorizar solo si el share_token coincide exactamente O si el usuario autenticado es el propietario
    IF NOT (
        (v_st <> '' AND v_row.share_token = v_st)
        OR (v_dni <> '' AND btrim(COALESCE(v_row.owner_dni, '')) = v_dni)
    ) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Se requiere enlace autorizado (share_token) o sesión del propietario.');
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

REVOKE ALL ON FUNCTION public.guardar_ticket_seguro(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.listar_tickets_seguro(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consultar_ticket_publico(text, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.guardar_ticket_seguro(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.listar_tickets_seguro(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.consultar_ticket_publico(text, text, text) TO service_role;

COMMIT;
