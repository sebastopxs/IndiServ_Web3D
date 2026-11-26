-- =============================================================================
-- INDISERV ANALYTICA — AUDITORÍA RONDA 2: CIERRE INTEGRAL DE 7 HALLAZGOS
-- Cierra en base de datos:
--   #1 RBAC estricto en alertas Honeytoken (rol 'admin' en usuarios_app)
--   #2 BOLA residual en sugerencias_locales (owner_dni + validación de propiedad)
--   #3 Cierre definitivo de hashes legacy indiserv_v1$ en registro/cambio de clave
-- Ejecutar en: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- =============================================================================

BEGIN;

-- 1. ROL RBAC EN usuarios_app ('operator' por defecto, 'admin' explícito)
ALTER TABLE public.usuarios_app
    ADD COLUMN IF NOT EXISTS rol text NOT NULL DEFAULT 'operator';

ALTER TABLE public.usuarios_app
    DROP CONSTRAINT IF EXISTS usuarios_app_rol_check;

ALTER TABLE public.usuarios_app
    ADD CONSTRAINT usuarios_app_rol_check
    CHECK (rol IN ('operator', 'admin'));

-- 2. COLUMNA owner_dni EN sugerencias_locales PARA PROPIEDAD ESTRICTA Y BORRADO ARCO
ALTER TABLE public.sugerencias_locales
    ADD COLUMN IF NOT EXISTS owner_dni text;

CREATE INDEX IF NOT EXISTS idx_sugerencias_owner_dni
    ON public.sugerencias_locales (owner_dni);

-- 3. ACTUALIZAR validar_sesion_15m Y obtener_perfil_cuenta PARA DEVOLVER rol
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
           u.avatar_data,
           COALESCE(u.rol, 'operator') AS rol
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
        'rol', v_rec.rol,
        'expira_en', v_rec.expira_en,
        'remaining_sec', v_rem
    );
END;
$$;

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
           avatar_data,
           COALESCE(rol, 'operator') AS rol
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
        'rol', v_user.rol,
        'dispositivos_confiables', v_devices,
        'tickets_count', v_tickets
    );
END;
$$;

-- 4. ACTUALIZAR consumir_y_rotar_token_biometrico PARA DEVOLVER rol
CREATE OR REPLACE FUNCTION public.consumir_y_rotar_token_biometrico(
    p_dni text,
    p_device_hash text,
    p_old_bio_hash text,
    p_new_bio_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rec RECORD;
BEGIN
    SELECT d.id,
           btrim(u.dni) AS dni,
           btrim(u.correo) AS correo,
           COALESCE(u.nickname, 'Operador') AS nickname,
           u.avatar_data,
           COALESCE(u.rol, 'operator') AS rol
      INTO v_rec
      FROM public.dispositivos_confiables d
      JOIN public.usuarios_app u
        ON btrim(u.dni) = btrim(d.dni)
     WHERE btrim(d.dni) = btrim(p_dni)
       AND d.device_hash = p_device_hash
       AND d.revocado = false
       AND d.biometric_token_hash = p_old_bio_hash
     FOR UPDATE OF d;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Token biométrico inválido o revocado.');
    END IF;

    UPDATE public.dispositivos_confiables
       SET biometric_token_hash = p_new_bio_hash,
           ultimo_uso = now()
     WHERE id = v_rec.id;

    RETURN jsonb_build_object(
        'ok', true,
        'dni', v_rec.dni,
        'correo', v_rec.correo,
        'nickname', v_rec.nickname,
        'avatar_data', v_rec.avatar_data,
        'rol', v_rec.rol
    );
END;
$$;

-- 5. HALLAZGO #1: RESTRINGIR listar_alertas_honeytoken_seguro EXCLUSIVAMENTE A ADMINS
DROP FUNCTION IF EXISTS public.listar_alertas_honeytoken_seguro(integer);

CREATE OR REPLACE FUNCTION public.listar_alertas_honeytoken_seguro(
    p_dni text,
    p_limite integer DEFAULT 15,
    p_allow_env_admin boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_clean_dni text := btrim(COALESCE(p_dni, ''));
    v_lim integer := GREATEST(1, LEAST(50, COALESCE(p_limite, 15)));
    v_is_admin boolean := false;
    v_rows jsonb := '[]'::jsonb;
BEGIN
    IF v_clean_dni = '' THEN
        RETURN jsonb_build_object('ok', false, 'forbidden', true, 'error', 'No autorizado.');
    END IF;

    IF p_allow_env_admin THEN
        v_is_admin := true;
    ELSE
        SELECT EXISTS (
            SELECT 1
              FROM public.usuarios_app
             WHERE btrim(dni) = v_clean_dni
               AND rol = 'admin'
        ) INTO v_is_admin;
    END IF;

    IF NOT v_is_admin THEN
        RETURN jsonb_build_object(
            'ok', false,
            'forbidden', true,
            'error', 'Acceso exclusivo para administradores de seguridad.'
        );
    END IF;

    SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)
      INTO v_rows
      FROM (
          SELECT id_ticket, sugerencia
            FROM public.sugerencias_locales
           WHERE id_ticket LIKE 'HONEY-%'
           ORDER BY id_ticket DESC
           LIMIT v_lim
      ) t;

    RETURN jsonb_build_object('ok', true, 'alerts', v_rows);
END;
$$;

-- 6. HALLAZGO #2: CERRAR BOLA EN guardar_sugerencia_segura (PROPIEDAD + ANTI-HONEY)
DROP FUNCTION IF EXISTS public.guardar_sugerencia_segura(text, text);

CREATE OR REPLACE FUNCTION public.guardar_sugerencia_segura(
    p_dni text,
    p_id_ticket text,
    p_sugerencia text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_clean_dni text := btrim(COALESCE(p_dni, ''));
    v_id text := btrim(COALESCE(p_id_ticket, ''));
    v_txt text := LEFT(btrim(COALESCE(p_sugerencia, '')), 8000);
    v_existing_owner text;
    v_sug_exists boolean := false;
    v_ticket_owner text;
BEGIN
    IF v_clean_dni = '' OR length(v_id) < 6 OR v_txt = '' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Sugerencia inválida.');
    END IF;

    -- Bloquear cualquier intento de sobrescribir o inyectar alertas Honeytoken
    IF upper(v_id) LIKE 'HONEY-%' THEN
        RETURN jsonb_build_object('ok', false, 'forbidden', true, 'error', 'Identificador reservado del sistema.');
    END IF;

    SELECT true, owner_dni
      INTO v_sug_exists, v_existing_owner
      FROM public.sugerencias_locales
     WHERE id_ticket = v_id
     LIMIT 1;

    -- Si la sugerencia ya existe, solo su propietario registrado puede actualizarla
    IF v_sug_exists THEN
        IF v_existing_owner IS NULL OR btrim(v_existing_owner) <> v_clean_dni THEN
            RETURN jsonb_build_object(
                'ok', false,
                'forbidden', true,
                'error', 'No autorizado para modificar esta sugerencia.'
            );
        END IF;
    END IF;

    -- Si NO es una sugerencia libre de buzón (SUG-* / *-SUG-*), validar propiedad del ticket padre
    IF upper(v_id) NOT LIKE 'SUG-%' AND upper(v_id) NOT LIKE '%-SUG-%' THEN
        SELECT specs_json->>'owner_dni'
          INTO v_ticket_owner
          FROM public.reportes_diagnostico
         WHERE id_ticket = v_id
         LIMIT 1;

        IF v_ticket_owner IS NULL OR btrim(v_ticket_owner) <> v_clean_dni THEN
            RETURN jsonb_build_object(
                'ok', false,
                'forbidden', true,
                'error', 'No autorizado para asociar notas a un ticket que no le pertenece.'
            );
        END IF;
    END IF;

    INSERT INTO public.sugerencias_locales (id_ticket, sugerencia, owner_dni)
    VALUES (v_id, v_txt, v_clean_dni)
    ON CONFLICT (id_ticket) DO UPDATE
        SET sugerencia = EXCLUDED.sugerencia,
            owner_dni = v_clean_dni;

    RETURN jsonb_build_object('ok', true);
END;
$$;

-- 7. ACTUALIZAR eliminar_cuenta_completa PARA BORRAR TAMBIÉN SUGERENCIAS DE BUZÓN PROPIAS
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

    DELETE FROM public.sugerencias_locales
     WHERE btrim(COALESCE(owner_dni, '')) = v_clean_dni;

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

-- 8. HALLAZGO #3: EXIGIR EXCLUSIVAMENTE PBKDF2 EN REGISTRO Y CAMBIO DE CONTRASEÑA
CREATE OR REPLACE FUNCTION public.registrar_usuario_seguro(
    p_dni text,
    p_nickname text,
    p_correo text,
    p_password_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_clean_dni text := btrim(COALESCE(p_dni, ''));
    v_clean_nick text := btrim(COALESCE(p_nickname, ''));
    v_clean_correo text := btrim(COALESCE(p_correo, ''));
    v_clean_hash text := btrim(COALESCE(p_password_hash, ''));
BEGIN
    IF length(v_clean_dni) < 8 OR v_clean_nick = '' OR v_clean_correo = '' OR v_clean_hash = '' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Datos de registro incompletos.');
    END IF;

    IF v_clean_hash NOT LIKE 'indiserv_pbkdf2$%' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Se requiere hash PBKDF2-HMAC-SHA256 generado en servidor.');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.padron_oficial WHERE dni = v_clean_dni) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'El DNI no figura en el padrón oficial público UNMSM.');
    END IF;

    IF EXISTS (SELECT 1 FROM public.usuarios_app WHERE dni = v_clean_dni) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Este DNI ya tiene una cuenta registrada. Inicie sesión.');
    END IF;

    INSERT INTO public.usuarios_app (dni, nickname, correo, password_hash, rol)
    VALUES (v_clean_dni, v_clean_nick, v_clean_correo, v_clean_hash, 'operator');

    RETURN jsonb_build_object('ok', true);
END;
$$;

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
    IF p_new_password_hash IS NULL OR left(p_new_password_hash, 16) <> 'indiserv_pbkdf2$' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Formato criptográfico PBKDF2 requerido.');
    END IF;

    UPDATE public.usuarios_app
       SET password_hash = p_new_password_hash
     WHERE btrim(dni) = v_clean_dni;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Cuenta no encontrada.');
    END IF;

    UPDATE public.sesiones_activas
       SET revocada = true
     WHERE btrim(dni) = v_clean_dni
       AND revocada = false
       AND (p_keep_token_hash IS NULL OR token_hash <> p_keep_token_hash);

    UPDATE public.dispositivos_confiables
       SET biometric_token_hash = NULL,
           revocado = CASE WHEN p_revocar_dispositivos THEN true ELSE revocado END
     WHERE btrim(dni) = v_clean_dni;

    RETURN jsonb_build_object('ok', true);
END;
$$;

-- 9. RESTRINGIR TODAS LAS FUNCIONES EXCLUSIVAMENTE A SERVICE_ROLE
REVOKE ALL ON FUNCTION public.validar_sesion_15m(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.obtener_perfil_cuenta(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consumir_y_rotar_token_biometrico(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.listar_alertas_honeytoken_seguro(text, integer, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guardar_sugerencia_segura(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.eliminar_cuenta_completa(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.registrar_usuario_seguro(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.actualizar_password_seguro(text, text, text, boolean) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.validar_sesion_15m(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.obtener_perfil_cuenta(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.consumir_y_rotar_token_biometrico(text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.listar_alertas_honeytoken_seguro(text, integer, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.guardar_sugerencia_segura(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.eliminar_cuenta_completa(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.registrar_usuario_seguro(text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.actualizar_password_seguro(text, text, text, boolean) TO service_role;

COMMIT;
