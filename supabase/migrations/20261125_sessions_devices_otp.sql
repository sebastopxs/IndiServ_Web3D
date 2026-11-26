-- =============================================================================
-- INDISERV ANALYTICA — SESIONES DE 15 MIN, DISPOSITIVOS CONFIABLES Y OTP SEGURO
-- Ejecutar en: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- =============================================================================

BEGIN;

-- 1. TABLA DE DISPOSITIVOS CONFIABLES POR USUARIO
CREATE TABLE IF NOT EXISTS public.dispositivos_confiables (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dni text NOT NULL REFERENCES public.usuarios_app(dni) ON DELETE CASCADE,
    device_hash text NOT NULL,
    device_label text NOT NULL DEFAULT 'Dispositivo Desconocido',
    plataforma text NOT NULL DEFAULT 'desktop' CHECK (plataforma IN ('desktop', 'android', 'web')),
    verificado_en timestamptz NOT NULL DEFAULT now(),
    ultimo_uso timestamptz NOT NULL DEFAULT now(),
    revocado boolean NOT NULL DEFAULT false,
    CONSTRAINT uq_dispositivo_dni_hash UNIQUE (dni, device_hash)
);

CREATE INDEX IF NOT EXISTS idx_dispositivos_dni_hash
    ON public.dispositivos_confiables (dni, device_hash);

-- 2. TABLA DE DESAFÍOS OTP DE 6 DÍGITOS (SOLO ALMACENA HMAC-SHA256, NUNCA EL CÓDIGO)
CREATE TABLE IF NOT EXISTS public.codigos_otp (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dni text NOT NULL,
    correo text NOT NULL,
    proposito text NOT NULL CHECK (proposito IN ('register', 'new_device')),
    device_hash text NOT NULL,
    code_hmac text NOT NULL,
    payload_pendiente jsonb,
    intentos integer NOT NULL DEFAULT 0,
    max_intentos integer NOT NULL DEFAULT 5,
    usado boolean NOT NULL DEFAULT false,
    usado_en timestamptz,
    expira_en timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
    creado_en timestamptz NOT NULL DEFAULT now(),
    ip_origen text
);

CREATE INDEX IF NOT EXISTS idx_codigos_otp_dni_creado
    ON public.codigos_otp (dni, creado_en DESC);

-- 3. TABLA DE SESIONES ACTIVAS DE 15 MINUTOS (SOLO ALMACENA SHA-256 DEL TOKEN)
CREATE TABLE IF NOT EXISTS public.sesiones_activas (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dni text NOT NULL REFERENCES public.usuarios_app(dni) ON DELETE CASCADE,
    device_hash text NOT NULL,
    token_hash text NOT NULL UNIQUE,
    creada_en timestamptz NOT NULL DEFAULT now(),
    expira_en timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
    revocada boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_sesiones_token_hash
    ON public.sesiones_activas (token_hash);

CREATE INDEX IF NOT EXISTS idx_sesiones_dni_expira
    ON public.sesiones_activas (dni, expira_en DESC);

-- 4. RLS ESTRICTO: CERO POLÍTICAS PARA ANON / AUTHENTICATED (SOLO SERVICE_ROLE)
ALTER TABLE public.dispositivos_confiables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.codigos_otp ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sesiones_activas ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.dispositivos_confiables FROM anon, authenticated;
REVOKE ALL ON TABLE public.codigos_otp FROM anon, authenticated;
REVOKE ALL ON TABLE public.sesiones_activas FROM anon, authenticated;

-- 5. CERRAR BYPASS DIRECTO POR POSTGREST SOBRE REGISTRO Y LOGIN SIN OTP
REVOKE ALL ON FUNCTION public.autenticar_usuario(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.registrar_usuario_seguro(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.autenticar_usuario(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.registrar_usuario_seguro(text, text, text, text) TO service_role;

-- 6. FUNCIÓN ATÓMICA ANTI-CARRERA (SELECT ... FOR UPDATE) PARA CONSUMIR OTP
CREATE OR REPLACE FUNCTION public.consumir_otp_atomico(
    p_challenge_id uuid,
    p_device_hash text,
    p_code_hmac text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row public.codigos_otp%ROWTYPE;
    v_next_attempts integer;
BEGIN
    SELECT *
      INTO v_row
      FROM public.codigos_otp
     WHERE id = p_challenge_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
    END IF;

    IF v_row.usado THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'already_used');
    END IF;

    IF now() >= v_row.expira_en THEN
        UPDATE public.codigos_otp
           SET usado = true
         WHERE id = p_challenge_id;
        RETURN jsonb_build_object('ok', false, 'reason', 'expired');
    END IF;

    IF v_row.device_hash <> p_device_hash THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'device_mismatch');
    END IF;

    IF v_row.intentos >= v_row.max_intentos THEN
        UPDATE public.codigos_otp
           SET usado = true
         WHERE id = p_challenge_id;
        RETURN jsonb_build_object(
            'ok', false,
            'reason', 'locked',
            'dni', v_row.dni,
            'correo', v_row.correo
        );
    END IF;

    IF v_row.code_hmac <> p_code_hmac THEN
        v_next_attempts := v_row.intentos + 1;
        IF v_next_attempts >= v_row.max_intentos THEN
            UPDATE public.codigos_otp
               SET intentos = v_next_attempts,
                   usado = true
             WHERE id = p_challenge_id;
            RETURN jsonb_build_object(
                'ok', false,
                'reason', 'locked',
                'attempts_left', 0,
                'dni', v_row.dni,
                'correo', v_row.correo
            );
        ELSE
            UPDATE public.codigos_otp
               SET intentos = v_next_attempts
             WHERE id = p_challenge_id;
            RETURN jsonb_build_object(
                'ok', false,
                'reason', 'invalid_code',
                'attempts_left', v_row.max_intentos - v_next_attempts
            );
        END IF;
    END IF;

    -- Código válido: consumir de forma atómica en la misma transacción
    UPDATE public.codigos_otp
       SET usado = true,
           usado_en = now()
     WHERE id = p_challenge_id;

    RETURN jsonb_build_object(
        'ok', true,
        'dni', v_row.dni,
        'correo', v_row.correo,
        'proposito', v_row.proposito,
        'payload_pendiente', v_row.payload_pendiente
    );
END;
$$;

-- 7. EMISIÓN DE SESIÓN DE 15 MINUTOS EN RELOJ DEL SERVIDOR
CREATE OR REPLACE FUNCTION public.emitir_sesion_15m(
    p_dni text,
    p_device_hash text,
    p_token_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_expira timestamptz := now() + interval '15 minutes';
BEGIN
    -- Limpieza oportunista de sesiones viejas del mismo dispositivo
    UPDATE public.sesiones_activas
       SET revocada = true
     WHERE dni = p_dni
       AND device_hash = p_device_hash
       AND revocada = false;

    INSERT INTO public.sesiones_activas (dni, device_hash, token_hash, expira_en)
    VALUES (p_dni, p_device_hash, p_token_hash, v_expira);

    UPDATE public.dispositivos_confiables
       SET ultimo_uso = now()
     WHERE dni = p_dni
       AND device_hash = p_device_hash
       AND revocado = false;

    RETURN jsonb_build_object(
        'ok', true,
        'expira_en', v_expira,
        'ttl_sec', 900
    );
END;
$$;

-- 8. VALIDACIÓN ESTRICTA DE SESIÓN DE 15 MINUTOS (BOUND A DEVICE_HASH)
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
           u.nickname
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
        'expira_en', v_rec.expira_en,
        'remaining_sec', v_rem
    );
END;
$$;

-- 9. REVOCACIÓN INMEDIATA AL CERRAR SESIÓN
CREATE OR REPLACE FUNCTION public.revocar_sesion_15m(
    p_token_hash text,
    p_device_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.sesiones_activas
       SET revocada = true
     WHERE token_hash = p_token_hash
       AND device_hash = p_device_hash;

    RETURN jsonb_build_object('ok', true);
END;
$$;

-- RESTRINGIR TODAS LAS NUEVAS FUNCIONES EXCLUSIVAMENTE A SERVICE_ROLE
REVOKE ALL ON FUNCTION public.consumir_otp_atomico(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.emitir_sesion_15m(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validar_sesion_15m(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revocar_sesion_15m(text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.consumir_otp_atomico(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.emitir_sesion_15m(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.validar_sesion_15m(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.revocar_sesion_15m(text, text) TO service_role;

COMMIT;
