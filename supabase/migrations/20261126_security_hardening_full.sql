-- =============================================================================
-- INDISERV ANALYTICA — BLINDAJE INTEGRAL DE SEGURIDAD (OWASP API TOP 10)
-- Cierra:
--   1. BOLA / acceso anon directo sobre reportes_diagnostico y sugerencias_locales
--   2. Enumeración del padrón vía verificar_padron_dni pública
--   3. Soporte PBKDF2-HMAC-SHA256 en servidor (indiserv_pbkdf2$) + retrocompatibilidad
--   4. Token biométrico rotativo por dispositivo (sin almacenar password_hash en móvil)
--   5. Rate-limit y lockout de login persistentes en PostgreSQL (inmunes a cold starts)
-- Ejecutar en: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- =============================================================================

BEGIN;

-- 1. CERRAR ENUMERACIÓN PÚBLICA DEL PADRÓN (SOLO SERVICE_ROLE)
REVOKE ALL ON FUNCTION public.verificar_padron_dni(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verificar_padron_dni(text) TO service_role;

-- 2. REVOCAR ACCESO DIRECTO ANON / AUTHENTICATED A REPORTES Y SUGERENCIAS
DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN
        SELECT policyname, tablename
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('reportes_diagnostico', 'sugerencias_locales')
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
    END LOOP;
END $$;

REVOKE ALL ON TABLE public.reportes_diagnostico FROM anon, authenticated;
REVOKE ALL ON TABLE public.sugerencias_locales FROM anon, authenticated;

-- 3. COLUMNA DE TOKEN BIOMÉTRICO ROTATIVO EN dispositivos_confiables
ALTER TABLE public.dispositivos_confiables
    ADD COLUMN IF NOT EXISTS biometric_token_hash text;

-- 4. TABLA DE RATE-LIMITING Y LOCKOUT PERSISTENTE (SOLO SERVICE_ROLE)
CREATE TABLE IF NOT EXISTS public.rate_limits (
    key text PRIMARY KEY,
    hits integer NOT NULL DEFAULT 1,
    window_start timestamptz NOT NULL DEFAULT now(),
    locked_until timestamptz
);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rate_limits FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.consumir_rate_limit(
    p_key text,
    p_window_sec integer DEFAULT 60,
    p_max_hits integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row public.rate_limits%ROWTYPE;
    v_now timestamptz := now();
    v_wait integer;
BEGIN
    SELECT * INTO v_row FROM public.rate_limits WHERE key = p_key FOR UPDATE;

    IF NOT FOUND THEN
        INSERT INTO public.rate_limits (key, hits, window_start, locked_until)
        VALUES (p_key, 1, v_now, NULL);
        RETURN jsonb_build_object('allowed', true, 'remaining', GREATEST(0, p_max_hits - 1));
    END IF;

    IF v_row.locked_until IS NOT NULL AND v_row.locked_until > v_now THEN
        v_wait := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_row.locked_until - v_now)))::integer);
        RETURN jsonb_build_object('allowed', false, 'wait_sec', v_wait);
    END IF;

    IF v_now - v_row.window_start >= make_interval(secs => p_window_sec) THEN
        UPDATE public.rate_limits
           SET hits = 1, window_start = v_now, locked_until = NULL
         WHERE key = p_key;
        RETURN jsonb_build_object('allowed', true, 'remaining', GREATEST(0, p_max_hits - 1));
    END IF;

    IF v_row.hits >= p_max_hits THEN
        v_wait := GREATEST(1, CEIL(p_window_sec - EXTRACT(EPOCH FROM (v_now - v_row.window_start)))::integer);
        RETURN jsonb_build_object('allowed', false, 'wait_sec', v_wait);
    END IF;

    UPDATE public.rate_limits
       SET hits = hits + 1
     WHERE key = p_key;

    RETURN jsonb_build_object('allowed', true, 'remaining', GREATEST(0, p_max_hits - (v_row.hits + 1)));
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_fallo_login(
    p_key text,
    p_max_intentos integer DEFAULT 5,
    p_lock_sec integer DEFAULT 120
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row public.rate_limits%ROWTYPE;
    v_now timestamptz := now();
    v_next integer;
BEGIN
    SELECT * INTO v_row FROM public.rate_limits WHERE key = p_key FOR UPDATE;

    IF NOT FOUND THEN
        INSERT INTO public.rate_limits (key, hits, window_start, locked_until)
        VALUES (p_key, 1, v_now, NULL);
        RETURN jsonb_build_object('locked', false, 'attempts', 1);
    END IF;

    IF v_now - v_row.window_start >= interval '10 minutes' THEN
        v_next := 1;
    ELSE
        v_next := v_row.hits + 1;
    END IF;

    IF v_next >= p_max_intentos THEN
        UPDATE public.rate_limits
           SET hits = 0,
               window_start = v_now,
               locked_until = v_now + make_interval(secs => p_lock_sec)
         WHERE key = p_key;
        RETURN jsonb_build_object('locked', true, 'wait_sec', p_lock_sec);
    END IF;

    UPDATE public.rate_limits
       SET hits = v_next,
           window_start = CASE WHEN v_next = 1 THEN v_now ELSE window_start END
     WHERE key = p_key;

    RETURN jsonb_build_object('locked', false, 'attempts', v_next);
END;
$$;

CREATE OR REPLACE FUNCTION public.verificar_lockout_login(p_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_lock timestamptz;
    v_wait integer;
BEGIN
    SELECT locked_until INTO v_lock FROM public.rate_limits WHERE key = p_key;
    IF v_lock IS NOT NULL AND v_lock > now() THEN
        v_wait := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_lock - now())))::integer);
        RETURN jsonb_build_object('locked', true, 'wait_sec', v_wait);
    END IF;
    RETURN jsonb_build_object('locked', false, 'wait_sec', 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.limpiar_fallos_login(p_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    DELETE FROM public.rate_limits WHERE key = p_key;
END;
$$;

-- 5. ACTUALIZAR REGISTRO Y CAMBIO DE CONTRASEÑA PARA ACEPTAR PBKDF2 EN SERVIDOR
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

    IF v_clean_hash NOT LIKE 'indiserv_pbkdf2$%' AND v_clean_hash NOT LIKE 'indiserv_v1$%' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Formato criptográfico de contraseña inválido.');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.padron_oficial WHERE dni = v_clean_dni) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'El DNI no figura en el padrón oficial público UNMSM.');
    END IF;

    IF EXISTS (SELECT 1 FROM public.usuarios_app WHERE dni = v_clean_dni) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Este DNI ya tiene una cuenta registrada. Inicie sesión.');
    END IF;

    INSERT INTO public.usuarios_app (dni, nickname, correo, password_hash)
    VALUES (v_clean_dni, v_clean_nick, v_clean_correo, v_clean_hash);

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
    IF p_new_password_hash IS NULL
       OR (left(p_new_password_hash, 16) <> 'indiserv_pbkdf2$' AND left(p_new_password_hash, 12) <> 'indiserv_v1$') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Formato de hash de contraseña inválido.');
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

    -- Invalidar todos los tokens biométricos al cambiar contraseña
    UPDATE public.dispositivos_confiables
       SET biometric_token_hash = NULL,
           revocado = CASE WHEN p_revocar_dispositivos THEN true ELSE revocado END
     WHERE btrim(dni) = v_clean_dni;

    RETURN jsonb_build_object('ok', true);
END;
$$;

-- Actualizar revocar_dispositivo_confiable para limpiar también biometric_token_hash
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
       SET revocado = true,
           biometric_token_hash = NULL
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

-- 6. RPCs DE TOKEN BIOMÉTRICO ROTATIVO (SOLO SERVICE_ROLE)
CREATE OR REPLACE FUNCTION public.emitir_token_biometrico(
    p_dni text,
    p_device_hash text,
    p_bio_token_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.dispositivos_confiables
       SET biometric_token_hash = p_bio_token_hash,
           ultimo_uso = now()
     WHERE btrim(dni) = btrim(p_dni)
       AND device_hash = p_device_hash
       AND revocado = false;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Dispositivo no autorizado.');
    END IF;

    RETURN jsonb_build_object('ok', true);
END;
$$;

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
           u.avatar_data
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
        'avatar_data', v_rec.avatar_data
    );
END;
$$;

-- 7. RPCs SEGURAS DE TICKETS Y SUGERENCIAS (ELIMINANDO BOLA / ACCESO ANON)
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
        specs_json = EXCLUDED.specs_json;

    RETURN jsonb_build_object('ok', true, 'id_ticket', v_id);
END;
$$;

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
          SELECT id_ticket, cpu, placa_base, health_score, diagnostico, fecha_creacion, specs_json
            FROM public.reportes_diagnostico
           WHERE specs_json->>'owner_dni' = v_clean_dni
           ORDER BY fecha_creacion DESC
           LIMIT v_lim
      ) t;

    RETURN jsonb_build_object('ok', true, 'tickets', v_rows);
END;
$$;

-- Consulta pública de 1 ticket exacto para el Visor 3D (NUNCA expone owner_dni ni permite listar)
CREATE OR REPLACE FUNCTION public.consultar_ticket_publico(p_ticket_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id text := btrim(COALESCE(p_ticket_id, ''));
    v_row RECORD;
BEGIN
    IF length(v_id) < 6 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'ID de ticket inválido.');
    END IF;

    SELECT id_ticket, cpu, ram, gpu, almacenamiento, placa_base, refrigeracion,
           health_score, diagnostico, solucion, fecha_creacion,
           (COALESCE(specs_json, '{}'::jsonb) - 'owner_dni') AS specs_json
      INTO v_row
      FROM public.reportes_diagnostico
     WHERE id_ticket = v_id
     LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Ticket no encontrado.');
    END IF;

    RETURN jsonb_build_object('ok', true, 'ticket', to_jsonb(v_row));
END;
$$;

CREATE OR REPLACE FUNCTION public.guardar_sugerencia_segura(
    p_id_ticket text,
    p_sugerencia text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id text := btrim(COALESCE(p_id_ticket, ''));
    v_txt text := LEFT(COALESCE(p_sugerencia, ''), 8000);
BEGIN
    IF length(v_id) < 6 OR v_txt = '' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Sugerencia inválida.');
    END IF;

    INSERT INTO public.sugerencias_locales (id_ticket, sugerencia)
    VALUES (v_id, v_txt)
    ON CONFLICT (id_ticket) DO UPDATE SET sugerencia = EXCLUDED.sugerencia;

    RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.listar_alertas_honeytoken_seguro(p_limite integer DEFAULT 15)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_lim integer := GREATEST(1, LEAST(50, COALESCE(p_limite, 15)));
    v_rows jsonb := '[]'::jsonb;
BEGIN
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

-- 8. RESTRINGIR TODAS LAS NUEVAS FUNCIONES EXCLUSIVAMENTE A SERVICE_ROLE
REVOKE ALL ON FUNCTION public.consumir_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.registrar_fallo_login(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verificar_lockout_login(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.limpiar_fallos_login(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.registrar_usuario_seguro(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.actualizar_password_seguro(text, text, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revocar_dispositivo_confiable(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.emitir_token_biometrico(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consumir_y_rotar_token_biometrico(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guardar_ticket_seguro(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.listar_tickets_seguro(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consultar_ticket_publico(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guardar_sugerencia_segura(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.listar_alertas_honeytoken_seguro(integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.consumir_rate_limit(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.registrar_fallo_login(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.verificar_lockout_login(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.limpiar_fallos_login(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.registrar_usuario_seguro(text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.actualizar_password_seguro(text, text, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.revocar_dispositivo_confiable(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.emitir_token_biometrico(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.consumir_y_rotar_token_biometrico(text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.guardar_ticket_seguro(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.listar_tickets_seguro(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.consultar_ticket_publico(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.guardar_sugerencia_segura(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.listar_alertas_honeytoken_seguro(integer) TO service_role;

COMMIT;
