-- =============================================================================
-- INDISERV ANALYTICA — MI CUENTA (AVATAR), CAMBIO/RECUPERACIÓN DE CONTRASEÑA
-- Y ELIMINACIÓN TOTAL DE CUENTA + TICKETS EN CASCADA
-- Ejecutar en: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- =============================================================================

BEGIN;

-- 1. COLUMNA DE FOTO DE PERFIL COMPACTA (DATA URI WEBP/JPEG <= 75 KB)
ALTER TABLE public.usuarios_app
    ADD COLUMN IF NOT EXISTS avatar_data text;

-- 2. AMPLIAR PROPÓSITOS PERMITIDOS EN codigos_otp
ALTER TABLE public.codigos_otp
    DROP CONSTRAINT IF EXISTS codigos_otp_proposito_check;

ALTER TABLE public.codigos_otp
    ADD CONSTRAINT codigos_otp_proposito_check
    CHECK (proposito IN ('register', 'new_device', 'password_change', 'password_reset', 'account_delete'));

-- 3. ACTUALIZAR validar_sesion_15m PARA DEVOLVER TAMBIÉN avatar_data
CREATE OR REPLACE FUNCTION public.validar_sesion_15m(
    p_token_hash text,
    p_device_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rec RECORD;
    v_rem integer;
BEGIN
    SELECT s.dni,
           s.expira_en,
           u.correo,
           u.nickname,
           u.avatar_data
      INTO v_rec
      FROM public.sesiones_activas s
      JOIN public.usuarios_app u
        ON btrim(u.dni) = btrim(s.dni)
      JOIN public.dispositivos_confiables d
        ON btrim(d.dni) = btrim(s.dni)
       AND d.device_hash = s.device_hash
       AND d.revocado = false
     WHERE s.token_hash = p_token_hash
       AND s.device_hash = p_device_hash
       AND s.revocada = false
       AND s.expira_en > now()
     LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false);
    END IF;

    v_rem := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_rec.expira_en - now())))::integer);

    UPDATE public.dispositivos_confiables
       SET ultimo_uso = now()
     WHERE btrim(dni) = btrim(v_rec.dni)
       AND device_hash = p_device_hash;

    RETURN jsonb_build_object(
        'ok', true,
        'dni', btrim(v_rec.dni),
        'correo', btrim(v_rec.correo),
        'nickname', COALESCE(v_rec.nickname, 'Operador'),
        'avatar_data', v_rec.avatar_data,
        'expira_en', v_rec.expira_en,
        'remaining_sec', v_rem
    );
END;
$$;

-- 4. OBTENER PERFIL Y ESTADÍSTICAS DE CUENTA (SOLO SERVICE_ROLE)
CREATE OR REPLACE FUNCTION public.obtener_perfil_cuenta(p_dni text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user RECORD;
    v_devices integer := 0;
    v_tickets integer := 0;
BEGIN
    SELECT btrim(dni) AS dni,
           btrim(correo) AS correo,
           COALESCE(nickname, 'Operador') AS nickname,
           avatar_data
      INTO v_user
      FROM public.usuarios_app
     WHERE btrim(dni) = btrim(p_dni)
     LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Cuenta no encontrada.');
    END IF;

    SELECT count(*)::integer
      INTO v_devices
      FROM public.dispositivos_confiables
     WHERE btrim(dni) = v_user.dni
       AND revocado = false;

    SELECT count(*)::integer
      INTO v_tickets
      FROM public.reportes_diagnostico
     WHERE specs_json->>'owner_dni' = v_user.dni;

    RETURN jsonb_build_object(
        'ok', true,
        'dni', v_user.dni,
        'correo', v_user.correo,
        'nickname', v_user.nickname,
        'avatar_data', v_user.avatar_data,
        'dispositivos_confiables', v_devices,
        'tickets_count', v_tickets
    );
END;
$$;

-- 5. ACTUALIZAR O ELIMINAR AVATAR DE PERFIL (SOLO SERVICE_ROLE)
CREATE OR REPLACE FUNCTION public.actualizar_avatar_usuario(
    p_dni text,
    p_avatar_data text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.usuarios_app
       SET avatar_data = NULLIF(btrim(COALESCE(p_avatar_data, '')), '')
     WHERE btrim(dni) = btrim(p_dni);

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Cuenta no encontrada.');
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'avatar_data', NULLIF(btrim(COALESCE(p_avatar_data, '')), '')
    );
END;
$$;

-- 6. ACTUALIZAR CONTRASEÑA Y REVOCAR SESIONES / DISPOSITIVOS (SOLO SERVICE_ROLE)
CREATE OR REPLACE FUNCTION public.actualizar_password_seguro(
    p_dni text,
    p_new_password_hash text,
    p_keep_token_hash text DEFAULT NULL,
    p_revocar_dispositivos boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_clean_dni text := btrim(p_dni);
BEGIN
    IF p_new_password_hash IS NULL OR left(p_new_password_hash, 12) <> 'indiserv_v1$' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Formato de hash de contraseña inválido.');
    END IF;

    UPDATE public.usuarios_app
       SET password_hash = p_new_password_hash
     WHERE btrim(dni) = v_clean_dni;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Cuenta no encontrada.');
    END IF;

    -- Revocar sesiones activas (todas si p_keep_token_hash es NULL, o las demás si se conserva la actual)
    UPDATE public.sesiones_activas
       SET revocada = true
     WHERE btrim(dni) = v_clean_dni
       AND revocada = false
       AND (p_keep_token_hash IS NULL OR token_hash <> p_keep_token_hash);

    -- En recuperación desde Login, revocar dispositivos confiables previos para expulsar accesos antiguos
    IF p_revocar_dispositivos THEN
        UPDATE public.dispositivos_confiables
           SET revocado = true
         WHERE btrim(dni) = v_clean_dni
           AND revocado = false;
    END IF;

    RETURN jsonb_build_object('ok', true);
END;
$$;

-- 7. ELIMINACIÓN TOTAL E IRREVERSIBLE DE CUENTA + TICKETS + SUGERENCIAS (DERECHO ARCO)
CREATE OR REPLACE FUNCTION public.eliminar_cuenta_completa(p_dni text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_clean_dni text := btrim(p_dni);
    v_ticket_ids text[];
    v_tickets_deleted integer := 0;
BEGIN
    SELECT COALESCE(array_agg(id_ticket), ARRAY[]::text[])
      INTO v_ticket_ids
      FROM public.reportes_diagnostico
     WHERE specs_json->>'owner_dni' = v_clean_dni;

    IF array_length(v_ticket_ids, 1) IS NOT NULL THEN
        DELETE FROM public.sugerencias_locales
         WHERE id_ticket = ANY(v_ticket_ids);
    END IF;

    DELETE FROM public.reportes_diagnostico
     WHERE specs_json->>'owner_dni' = v_clean_dni;
    GET DIAGNOSTICS v_tickets_deleted = ROW_COUNT;

    DELETE FROM public.codigos_otp
     WHERE btrim(dni) = v_clean_dni;

    DELETE FROM public.sesiones_activas
     WHERE btrim(dni) = v_clean_dni;

    DELETE FROM public.dispositivos_confiables
     WHERE btrim(dni) = v_clean_dni;

    DELETE FROM public.usuarios_app
     WHERE btrim(dni) = v_clean_dni;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Cuenta no encontrada.');
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'tickets_eliminados', v_tickets_deleted
    );
END;
$$;

-- 8. RESTRINGIR TODAS LAS FUNCIONES EXCLUSIVAMENTE A SERVICE_ROLE
REVOKE ALL ON FUNCTION public.validar_sesion_15m(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.obtener_perfil_cuenta(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.actualizar_avatar_usuario(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.actualizar_password_seguro(text, text, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.eliminar_cuenta_completa(text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.validar_sesion_15m(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.obtener_perfil_cuenta(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.actualizar_avatar_usuario(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.actualizar_password_seguro(text, text, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.eliminar_cuenta_completa(text) TO service_role;

COMMIT;
