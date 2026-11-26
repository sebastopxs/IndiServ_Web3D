-- =============================================================================
-- INDISERV ANALYTICA — GESTIÓN DE DISPOSITIVOS CONFIABLES (LISTAR Y REVOCAR)
-- Ejecutar en: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- =============================================================================

BEGIN;

-- 1. LISTAR DISPOSITIVOS CONFIABLES ACTIVOS DE UN USUARIO (SOLO SERVICE_ROLE)
CREATE OR REPLACE FUNCTION public.listar_dispositivos_confiables(p_dni text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_clean_dni text := btrim(COALESCE(p_dni, ''));
    v_items jsonb := '[]'::jsonb;
BEGIN
    IF v_clean_dni = '' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'DNI inválido.');
    END IF;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', d.id,
                'device_hash', d.device_hash,
                'device_label', d.device_label,
                'plataforma', d.plataforma,
                'verificado_en', d.verificado_en,
                'ultimo_uso', d.ultimo_uso,
                'sesion_activa', EXISTS (
                    SELECT 1
                      FROM public.sesiones_activas s
                     WHERE btrim(s.dni) = v_clean_dni
                       AND s.device_hash = d.device_hash
                       AND s.revocada = false
                       AND s.expira_en > now()
                )
            )
            ORDER BY d.ultimo_uso DESC
        ),
        '[]'::jsonb
    )
    INTO v_items
    FROM public.dispositivos_confiables d
    WHERE btrim(d.dni) = v_clean_dni
      AND d.revocado = false;

    RETURN jsonb_build_object(
        'ok', true,
        'devices', v_items
    );
END;
$$;

-- 2. REVOCAR UN DISPOSITIVO CONFIABLE Y TODAS SUS SESIONES ACTIVAS (SOLO SERVICE_ROLE)
CREATE OR REPLACE FUNCTION public.revocar_dispositivo_confiable(
    p_dni text,
    p_device_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_clean_dni text := btrim(COALESCE(p_dni, ''));
    v_hash text;
    v_label text;
BEGIN
    SELECT d.device_hash, d.device_label
      INTO v_hash, v_label
      FROM public.dispositivos_confiables d
     WHERE d.id = p_device_id
       AND btrim(d.dni) = v_clean_dni
       AND d.revocado = false
     FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Dispositivo no encontrado o ya revocado.');
    END IF;

    UPDATE public.dispositivos_confiables
       SET revocado = true
     WHERE id = p_device_id;

    UPDATE public.sesiones_activas
       SET revocada = true
     WHERE btrim(dni) = v_clean_dni
       AND device_hash = v_hash
       AND revocada = false;

    RETURN jsonb_build_object(
        'ok', true,
        'revoked_device_hash', v_hash,
        'device_label', COALESCE(v_label, 'Dispositivo')
    );
END;
$$;

-- 3. RESTRINGIR EJECUCIÓN EXCLUSIVAMENTE A SERVICE_ROLE
REVOKE ALL ON FUNCTION public.listar_dispositivos_confiables(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revocar_dispositivo_confiable(text, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.listar_dispositivos_confiables(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.revocar_dispositivo_confiable(text, uuid) TO service_role;

COMMIT;
