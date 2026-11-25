/**
 * Supabase Edge Function: auth-otp
 * ============================================================================
 * Orquestador único de autenticación segura de IndiServ Analytica:
 *  - register_init     : Valida padrón UNMSM + envía OTP 6 dígitos vía Brevo
 *  - register_verify   : Consumo atómico FOR UPDATE + crea cuenta + dispositivo + sesión 15m
 *  - login_init        : Valida credenciales; si dispositivo confiable -> sesión 15m;
 *                        si dispositivo nuevo -> envía OTP al correo registrado
 *  - login_verify_otp  : Verifica OTP atómico + registra dispositivo confiable + sesión 15m
 *  - session_validate  : Valida token opaco 256-bit ligado a device_hash (reloj PostgreSQL)
 *  - session_logout    : Revoca sesión inmediatamente en PostgreSQL
 *
 * Secretos requeridos en Supabase Edge Functions -> Secrets:
 *   BREVO_API_KEY       : API Key v3 de Brevo (plan gratuito 300/día, 300/hora)
 *   BREVO_SENDER_EMAIL  : Correo remitente verificado en Brevo
 *   OTP_PEPPER          : Clave secreta larga para firmar HMAC-SHA256 de OTPs
 * (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY son inyectados automáticamente por Supabase).
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://indiserv-web3d.vercel.app",
  "https://localhost",
  "http://localhost",
  "capacitor://localhost",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
]);
const VERCEL_PREVIEW_REGEX = /^https:\/\/indiserv-web3d(-[a-z0-9-]+)?\.vercel\.app$/i;

const RATE_WINDOW_MS = 60_000;
const MAX_REQ_PER_IP_MIN = 30;
const MAX_OTP_PER_HOUR_DNI = 5;
const OTP_RESEND_COOLDOWN_SEC = 60;
const MAX_BODY_BYTES = 8 * 1024;

const HONEY_DNIS = new Set(["00000000", "99999999", "12345678", "87654321", "11111111", "admin", "root"]);
const HONEY_EMAILS = new Set([
  "admin@indiserv.pe",
  "root@indiserv.pe",
  "soporte@indiserv.pe",
  "security@indiserv.pe",
  "administrator@indiserv.pe",
  "admin@unmsm.edu.pe",
]);

const ipHits = new Map<string, number[]>();

function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return true; // Desktop Python / Android nativo sin cabecera Origin
  const clean = origin.trim();
  return ALLOWED_ORIGINS.has(clean) || VERCEL_PREVIEW_REGEX.test(clean);
}

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  const allowedOrigin =
    origin && isOriginAllowed(origin) ? origin : "https://indiserv-web3d.vercel.app";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function getClientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("cf-connecting-ip") ||
    "anon"
  );
}

function checkIpRateLimit(ip: string): boolean {
  const now = Date.now();
  const prev = (ipHits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (prev.length >= MAX_REQ_PER_IP_MIN) {
    ipHits.set(ip, prev);
    return false;
  }
  prev.push(now);
  ipHits.set(ip, prev);
  return true;
}

function isHoney(dni: string, correo = ""): boolean {
  const d = dni.trim().toLowerCase();
  const c = correo.trim().toLowerCase();
  if (HONEY_DNIS.has(d) || HONEY_EMAILS.has(c)) return true;
  return ["canary", "honeypot", "' or ", "1=1", "union select"].some(
    (tok) => d.includes(tok) || c.includes(tok)
  );
}

function toHex(buf: ArrayBuffer | Uint8Array): string {
  const arr = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return toHex(digest);
}

export async function computeOtpHmac(
  pepper: string,
  challengeId: string,
  dni: string,
  proposito: string,
  code: string
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const msg = `${challengeId}:${dni.trim()}:${proposito}:${code.trim()}`;
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return toHex(sig);
}

export function generateOtp6(): string {
  // Rejection sampling para distribución uniforme exacta en [0, 999999]
  const limit = Math.floor(0xffffffff / 1_000_000) * 1_000_000;
  const buf = new Uint32Array(1);
  let val = 0;
  do {
    crypto.getRandomValues(buf);
    val = buf[0];
  } while (val >= limit);
  return String(val % 1_000_000).padStart(6, "0");
}

export function generateSessionToken256(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return toHex(buf);
}

export function maskEmail(email: string): string {
  const [local, domain] = String(email || "").trim().split("@");
  if (!local || !domain) return "***";
  const visible = local.length <= 2 ? local[0] : local.slice(0, 2);
  return `${visible}***@${domain}`;
}

function sanitizePlatform(p: unknown): "desktop" | "android" | "web" {
  const s = String(p || "desktop").toLowerCase().trim();
  if (s === "android" || s === "web") return s;
  return "desktop";
}

function isValidDeviceHash(h: unknown): h is string {
  return typeof h === "string" && /^[a-fA-F0-9]{32,128}$/.test(h.trim());
}

async function logHoneyAlert(
  // deno-lint-ignore no-explicit-any
  admin: any,
  tipo: string,
  detalle: string,
  ip: string
) {
  try {
    const id = `HONEY-OTP-${generateSessionToken256().slice(0, 8).toUpperCase()}`;
    await admin.from("sugerencias_locales").insert({
      id_ticket: id,
      sugerencia: `[ALERTA-HONEYTOKEN] ${tipo} | ${detalle} | IP: ${ip}`,
    });
  } catch {
    // Nunca interrumpir flujo principal por fallo de logging
  }
}

async function sendBrevoOtpEmail(params: {
  toEmail: string;
  code: string;
  proposito: "register" | "new_device";
  deviceLabel: string;
}): Promise<{ ok: boolean; error?: string }> {
  const apiKey = Deno.env.get("BREVO_API_KEY")?.trim();
  const senderEmail = Deno.env.get("BREVO_SENDER_EMAIL")?.trim();
  if (!apiKey || !senderEmail) {
    return {
      ok: false,
      error: "Servicio de correo no configurado en el servidor (BREVO_API_KEY / BREVO_SENDER_EMAIL).",
    };
  }

  const isReg = params.proposito === "register";
  const subject = isReg
    ? `IndiServ Analytica — Código de verificación de registro: ${params.code}`
    : `IndiServ Analytica — Código de acceso en nuevo dispositivo: ${params.code}`;

  const heading = isReg
    ? "Confirma tu registro en IndiServ Analytica"
    : "Nuevo inicio de sesión detectado";

  const intro = isReg
    ? "Ingresa este código de 6 dígitos para verificar tu correo y activar tu cuenta:"
    : `Detectamos un intento de inicio de sesión desde un dispositivo nuevo (<strong>${params.deviceLabel.replace(/[<>&]/g, "")}</strong>). Si fuiste tú, ingresa este código para marcarlo como confiable:`;

  const htmlContent = `
    <div style="font-family:Segoe UI,Arial,sans-serif;background:#090c12;color:#e2e8f0;padding:28px;border-radius:12px;max-width:520px;margin:0 auto;">
      <p style="color:#34d399;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 8px 0;">INDISERV ANALYTICA · SEGURIDAD</p>
      <h2 style="color:#ffffff;margin:0 0 12px 0;font-size:20px;">${heading}</h2>
      <p style="color:#cbd5e1;font-size:14px;line-height:1.5;margin:0 0 20px 0;">${intro}</p>
      <div style="background:#101521;border:1px solid #34d39955;border-radius:10px;padding:18px;text-align:center;margin-bottom:20px;">
        <span style="font-family:Consolas,monospace;font-size:32px;font-weight:700;letter-spacing:8px;color:#34d399;">${params.code}</span>
      </div>
      <p style="color:#94a3b8;font-size:12px;line-height:1.5;margin:0;">
        Este código expira en <strong>10 minutos</strong> y permite un máximo de <strong>5 intentos</strong>.
        Nunca compartas este código. Si no solicitaste este acceso, cambia tu contraseña de inmediato.
      </p>
    </div>
  `;

  try {
    const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        sender: { name: "IndiServ Analytica", email: senderEmail },
        to: [{ email: params.toEmail }],
        subject,
        htmlContent,
      }),
    });

    if (!resp.ok) {
      const errTxt = await resp.text().catch(() => "");
      console.error("[auth-otp] Brevo error:", resp.status, errTxt.slice(0, 200));
      return { ok: false, error: `Error al enviar correo (HTTP ${resp.status}).` };
    }
    return { ok: true };
  } catch (err) {
    console.error("[auth-otp] Brevo fetch exception:", err);
    return { ok: false, error: "Error de red al contactar el servicio de correo." };
  }
}

async function checkDniOtpLimits(
  // deno-lint-ignore no-explicit-any
  admin: any,
  dni: string
): Promise<{ allowed: boolean; waitSec?: number; error?: string }> {
  const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
  const { data: recent, error } = await admin
    .from("codigos_otp")
    .select("creado_en")
    .eq("dni", dni)
    .gte("creado_en", oneHourAgo)
    .order("creado_en", { ascending: false });

  if (error) return { allowed: true };
  const rows = recent || [];
  if (rows.length >= MAX_OTP_PER_HOUR_DNI) {
    return {
      allowed: false,
      error: "Límite de códigos por hora alcanzado (máx. 5/h). Intenta más tarde.",
    };
  }
  if (rows.length > 0) {
    const lastMs = new Date(rows[0].creado_en).getTime();
    const diffSec = Math.floor((Date.now() - lastMs) / 1000);
    if (diffSec < OTP_RESEND_COOLDOWN_SEC) {
      return {
        allowed: false,
        waitSec: OTP_RESEND_COOLDOWN_SEC - diffSec,
        error: `Espera ${OTP_RESEND_COOLDOWN_SEC - diffSec} s antes de solicitar otro código.`,
      };
    }
  }
  return { allowed: true };
}

Deno.serve(async (req: Request) => {
  const cors = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    if (!isOriginAllowed(req.headers.get("origin"))) {
      return new Response("Forbidden", { status: 403 });
    }
    return new Response("ok", { headers: cors });
  }

  if (!isOriginAllowed(req.headers.get("origin"))) {
    return new Response(JSON.stringify({ ok: false, error: "Origen no autorizado." }), {
      status: 403,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Método no permitido." }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const ip = getClientIp(req);
  if (!checkIpRateLimit(ip)) {
    return new Response(
      JSON.stringify({ ok: false, error: "Demasiadas solicitudes. Espera 1 minuto." }),
      { status: 429, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }

  const rawText = await req.text();
  if (rawText.length > MAX_BODY_BYTES) {
    return new Response(JSON.stringify({ ok: false, error: "Payload demasiado grande." }), {
      status: 413,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // deno-lint-ignore no-explicit-any
  let body: any;
  try {
    body = JSON.parse(rawText);
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "JSON inválido." }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const otpPepper = Deno.env.get("OTP_PEPPER")?.trim();

  if (!supabaseUrl || !serviceKey) {
    return new Response(
      JSON.stringify({ ok: false, error: "Configuración interna de Supabase incompleta." }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const action = String(body?.action || "").trim();
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  try {
    // -------------------------------------------------------------------------
    // 1. SESSION VALIDATE (15 min en reloj PostgreSQL + device_hash)
    // -------------------------------------------------------------------------
    if (action === "session_validate") {
      const token = String(body?.session_token || "").trim();
      const deviceHash = String(body?.device_hash || "").trim();
      if (!token || !isValidDeviceHash(deviceHash)) {
        return json({ ok: false });
      }
      const tokenHash = await sha256Hex(token);
      const { data, error } = await admin.rpc("validar_sesion_15m", {
        p_token_hash: tokenHash,
        p_device_hash: deviceHash,
      });
      if (error || !data?.ok) return json({ ok: false });
      return json({
        ok: true,
        user: { dni: data.dni, correo: data.correo, nickname: data.nickname },
        expires_at: data.expira_en,
        remaining_sec: data.remaining_sec,
      });
    }

    // -------------------------------------------------------------------------
    // 2. SESSION LOGOUT (Revocación inmediata en BD)
    // -------------------------------------------------------------------------
    if (action === "session_logout") {
      const token = String(body?.session_token || "").trim();
      const deviceHash = String(body?.device_hash || "").trim();
      if (token && isValidDeviceHash(deviceHash)) {
        const tokenHash = await sha256Hex(token);
        await admin.rpc("revocar_sesion_15m", {
          p_token_hash: tokenHash,
          p_device_hash: deviceHash,
        });
      }
      return json({ ok: true });
    }

    if (!otpPepper || otpPepper.length < 16) {
      return json(
        { ok: false, error: "Secreto OTP_PEPPER no configurado en Supabase Secrets." },
        500
      );
    }

    // -------------------------------------------------------------------------
    // 3. REGISTER INIT (Valida padrón + envía OTP 6 dígitos al correo)
    // -------------------------------------------------------------------------
    if (action === "register_init") {
      const dni = String(body?.dni || "").trim();
      const nickname = String(body?.nickname || "").trim();
      const correo = String(body?.correo || "").trim().toLowerCase();
      const passwordHash = String(body?.password_hash || "").trim();
      const deviceHash = String(body?.device_hash || "").trim();
      const deviceLabel = String(body?.device_label || "Dispositivo").trim().slice(0, 80);

      if (
        dni.length < 8 ||
        !nickname ||
        !correo.includes("@") ||
        !passwordHash.startsWith("indiserv_v1$") ||
        !isValidDeviceHash(deviceHash)
      ) {
        return json({ ok: false, error: "Datos de registro inválidos o incompletos." }, 400);
      }

      if (isHoney(dni, correo)) {
        await logHoneyAlert(admin, "CREDENCIAL_SENUELO_REGISTRO_OTP", `DNI='${dni}' correo='${correo}'`, ip);
        return json({ ok: false, error: "El DNI no figura en el padrón oficial público UNMSM." });
      }

      const { data: padron } = await admin.rpc("verificar_padron_dni", { p_dni: dni });
      if (!padron?.existe) {
        return json({ ok: false, error: "El DNI no figura en el padrón oficial público UNMSM." });
      }
      if (padron?.ya_registrado) {
        return json({ ok: false, error: "Este DNI ya tiene una cuenta registrada. Inicie sesión." });
      }

      const lim = await checkDniOtpLimits(admin, dni);
      if (!lim.allowed) {
        return json({ ok: false, error: lim.error, wait_sec: lim.waitSec || 0 }, 429);
      }

      // Invalidar desafíos previos de registro sin usar
      await admin
        .from("codigos_otp")
        .update({ usado: true })
        .eq("dni", dni)
        .eq("proposito", "register")
        .eq("usado", false);

      const challengeId = crypto.randomUUID();
      const code = generateOtp6();
      const codeHmac = await computeOtpHmac(otpPepper, challengeId, dni, "register", code);

      const { error: insErr } = await admin.from("codigos_otp").insert({
        id: challengeId,
        dni,
        correo,
        proposito: "register",
        device_hash: deviceHash,
        code_hmac: codeHmac,
        payload_pendiente: { nickname, password_hash: passwordHash },
        ip_origen: ip,
      });
      if (insErr) {
        console.error("[auth-otp] insert register otp:", insErr);
        return json({ ok: false, error: "Error interno creando desafío OTP." }, 500);
      }

      const mail = await sendBrevoOtpEmail({
        toEmail: correo,
        code,
        proposito: "register",
        deviceLabel,
      });
      if (!mail.ok) {
        // Rollback del desafío para no quemar cooldown ni dejar fila colgando
        await admin.from("codigos_otp").delete().eq("id", challengeId);
        return json({ ok: false, error: mail.error || "No se pudo enviar el correo." }, 502);
      }

      return json({
        ok: true,
        challenge_id: challengeId,
        masked_email: maskEmail(correo),
        expires_in_sec: 600,
        resend_cooldown_sec: OTP_RESEND_COOLDOWN_SEC,
      });
    }

    // -------------------------------------------------------------------------
    // 4. REGISTER VERIFY (Consumo atómico + crea usuario + dispositivo + sesión 15m)
    // -------------------------------------------------------------------------
    if (action === "register_verify") {
      const challengeId = String(body?.challenge_id || "").trim();
      const code = String(body?.code || "").trim();
      const deviceHash = String(body?.device_hash || "").trim();
      const deviceLabel = String(body?.device_label || "Dispositivo").trim().slice(0, 80);
      const plataforma = sanitizePlatform(body?.plataforma);

      if (!challengeId || !/^\d{6}$/.test(code) || !isValidDeviceHash(deviceHash)) {
        return json({ ok: false, error: "Ingrese un código válido de 6 dígitos." }, 400);
      }

      const { data: meta } = await admin
        .from("codigos_otp")
        .select("dni, proposito")
        .eq("id", challengeId)
        .maybeSingle();

      if (!meta || meta.proposito !== "register") {
        return json({ ok: false, error: "Código inválido o expirado." });
      }

      const codeHmac = await computeOtpHmac(otpPepper, challengeId, meta.dni, "register", code);
      const { data: res, error: rpcErr } = await admin.rpc("consumir_otp_atomico", {
        p_challenge_id: challengeId,
        p_device_hash: deviceHash,
        p_code_hmac: codeHmac,
      });

      if (rpcErr || !res?.ok) {
        if (res?.reason === "locked") {
          await logHoneyAlert(
            admin,
            "FUERZA_BRUTA_OTP_REGISTRO",
            `5 intentos fallidos OTP registro DNI='${res.dni || meta.dni}'`,
            ip
          );
          return json({
            ok: false,
            locked: true,
            error: "Código invalidado por 5 intentos fallidos. Solicite uno nuevo.",
          });
        }
        if (res?.reason === "expired") {
          return json({ ok: false, expired: true, error: "El código expiró. Solicite uno nuevo." });
        }
        return json({
          ok: false,
          attempts_left: res?.attempts_left,
          error:
            typeof res?.attempts_left === "number"
              ? `Código incorrecto. Quedan ${res.attempts_left} intento(s).`
              : "Código inválido o ya utilizado.",
        });
      }

      const pending = res.payload_pendiente || {};
      const { data: regData, error: regErr } = await admin.rpc("registrar_usuario_seguro", {
        p_dni: res.dni,
        p_nickname: pending.nickname,
        p_correo: res.correo,
        p_password_hash: pending.password_hash,
      });

      if (regErr || !regData?.ok) {
        return json({
          ok: false,
          error: regData?.error || "No se pudo completar el registro del usuario.",
        });
      }

      await admin.from("dispositivos_confiables").upsert(
        {
          dni: res.dni,
          device_hash: deviceHash,
          device_label: deviceLabel,
          plataforma,
          revocado: false,
          ultimo_uso: new Date().toISOString(),
        },
        { onConflict: "dni,device_hash" }
      );

      const sessionToken = generateSessionToken256();
      const tokenHash = await sha256Hex(sessionToken);
      const { data: sess } = await admin.rpc("emitir_sesion_15m", {
        p_dni: res.dni,
        p_device_hash: deviceHash,
        p_token_hash: tokenHash,
      });

      return json({
        ok: true,
        session_token: sessionToken,
        expires_at: sess?.expira_en,
        user: {
          dni: res.dni,
          correo: res.correo,
          nickname: pending.nickname || "Operador",
        },
      });
    }

    // -------------------------------------------------------------------------
    // 5. LOGIN INIT (Dispositivo confiable -> sesión 15m; Nuevo -> OTP por correo)
    // -------------------------------------------------------------------------
    if (action === "login_init") {
      const dni = String(body?.dni || "").trim();
      const correo = String(body?.correo || "").trim().toLowerCase();
      const passwordHash = String(body?.password_hash || "").trim();
      const deviceHash = String(body?.device_hash || "").trim();
      const deviceLabel = String(body?.device_label || "Dispositivo").trim().slice(0, 80);

      if (!dni || !correo || !passwordHash || !isValidDeviceHash(deviceHash)) {
        return json({ ok: false, error: "Complete DNI, correo y contraseña." }, 400);
      }

      if (isHoney(dni, correo)) {
        await logHoneyAlert(admin, "CREDENCIAL_SENUELO_LOGIN_OTP", `DNI='${dni}' correo='${correo}'`, ip);
        return json({ ok: false, error: "Credenciales incorrectas o cuenta inexistente." });
      }

      const { data: authData, error: authErr } = await admin.rpc("autenticar_usuario", {
        p_dni: dni,
        p_correo: correo,
        p_password_hash: passwordHash,
      });

      if (authErr || !authData?.ok) {
        return json({ ok: false, error: "Credenciales incorrectas o cuenta inexistente." });
      }

      const verifiedDni = String(authData.dni).trim();
      const verifiedCorreo = String(authData.correo).trim();
      const verifiedNick = String(authData.nickname || "Operador").trim();

      // Revisar si el dispositivo ya es confiable para este usuario
      const { data: trusted } = await admin
        .from("dispositivos_confiables")
        .select("id")
        .eq("dni", verifiedDni)
        .eq("device_hash", deviceHash)
        .eq("revocado", false)
        .maybeSingle();

      if (trusted?.id) {
        const sessionToken = generateSessionToken256();
        const tokenHash = await sha256Hex(sessionToken);
        const { data: sess } = await admin.rpc("emitir_sesion_15m", {
          p_dni: verifiedDni,
          p_device_hash: deviceHash,
          p_token_hash: tokenHash,
        });
        return json({
          ok: true,
          requires_otp: false,
          session_token: sessionToken,
          expires_at: sess?.expira_en,
          user: { dni: verifiedDni, correo: verifiedCorreo, nickname: verifiedNick },
        });
      }

      // Dispositivo nuevo: exigir verificación OTP al correo registrado en usuarios_app
      const lim = await checkDniOtpLimits(admin, verifiedDni);
      if (!lim.allowed) {
        return json({ ok: false, error: lim.error, wait_sec: lim.waitSec || 0 }, 429);
      }

      await admin
        .from("codigos_otp")
        .update({ usado: true })
        .eq("dni", verifiedDni)
        .eq("proposito", "new_device")
        .eq("usado", false);

      const challengeId = crypto.randomUUID();
      const code = generateOtp6();
      const codeHmac = await computeOtpHmac(otpPepper, challengeId, verifiedDni, "new_device", code);

      const { error: insErr } = await admin.from("codigos_otp").insert({
        id: challengeId,
        dni: verifiedDni,
        correo: verifiedCorreo,
        proposito: "new_device",
        device_hash: deviceHash,
        code_hmac: codeHmac,
        payload_pendiente: { nickname: verifiedNick },
        ip_origen: ip,
      });
      if (insErr) {
        return json({ ok: false, error: "Error interno creando verificación de dispositivo." }, 500);
      }

      const mail = await sendBrevoOtpEmail({
        toEmail: verifiedCorreo,
        code,
        proposito: "new_device",
        deviceLabel,
      });
      if (!mail.ok) {
        await admin.from("codigos_otp").delete().eq("id", challengeId);
        return json({ ok: false, error: mail.error || "No se pudo enviar el código al correo." }, 502);
      }

      return json({
        ok: true,
        requires_otp: true,
        challenge_id: challengeId,
        masked_email: maskEmail(verifiedCorreo),
        expires_in_sec: 600,
        resend_cooldown_sec: OTP_RESEND_COOLDOWN_SEC,
      });
    }

    // -------------------------------------------------------------------------
    // 6. LOGIN VERIFY OTP (Valida OTP + registra dispositivo confiable + sesión 15m)
    // -------------------------------------------------------------------------
    if (action === "login_verify_otp") {
      const challengeId = String(body?.challenge_id || "").trim();
      const code = String(body?.code || "").trim();
      const deviceHash = String(body?.device_hash || "").trim();
      const deviceLabel = String(body?.device_label || "Dispositivo").trim().slice(0, 80);
      const plataforma = sanitizePlatform(body?.plataforma);

      if (!challengeId || !/^\d{6}$/.test(code) || !isValidDeviceHash(deviceHash)) {
        return json({ ok: false, error: "Ingrese un código válido de 6 dígitos." }, 400);
      }

      const { data: meta } = await admin
        .from("codigos_otp")
        .select("dni, proposito")
        .eq("id", challengeId)
        .maybeSingle();

      if (!meta || meta.proposito !== "new_device") {
        return json({ ok: false, error: "Código inválido o expirado." });
      }

      const codeHmac = await computeOtpHmac(otpPepper, challengeId, meta.dni, "new_device", code);
      const { data: res, error: rpcErr } = await admin.rpc("consumir_otp_atomico", {
        p_challenge_id: challengeId,
        p_device_hash: deviceHash,
        p_code_hmac: codeHmac,
      });

      if (rpcErr || !res?.ok) {
        if (res?.reason === "locked") {
          await logHoneyAlert(
            admin,
            "FUERZA_BRUTA_OTP_DISPOSITIVO",
            `5 intentos fallidos OTP nuevo dispositivo DNI='${res.dni || meta.dni}'`,
            ip
          );
          return json({
            ok: false,
            locked: true,
            error: "Código invalidado por 5 intentos fallidos. Vuelva a iniciar sesión.",
          });
        }
        if (res?.reason === "expired") {
          return json({ ok: false, expired: true, error: "El código expiró. Vuelva a iniciar sesión." });
        }
        return json({
          ok: false,
          attempts_left: res?.attempts_left,
          error:
            typeof res?.attempts_left === "number"
              ? `Código incorrecto. Quedan ${res.attempts_left} intento(s).`
              : "Código inválido o ya utilizado.",
        });
      }

      await admin.from("dispositivos_confiables").upsert(
        {
          dni: res.dni,
          device_hash: deviceHash,
          device_label: deviceLabel,
          plataforma,
          revocado: false,
          ultimo_uso: new Date().toISOString(),
        },
        { onConflict: "dni,device_hash" }
      );

      const sessionToken = generateSessionToken256();
      const tokenHash = await sha256Hex(sessionToken);
      const { data: sess } = await admin.rpc("emitir_sesion_15m", {
        p_dni: res.dni,
        p_device_hash: deviceHash,
        p_token_hash: tokenHash,
      });

      return json({
        ok: true,
        session_token: sessionToken,
        expires_at: sess?.expira_en,
        user: {
          dni: res.dni,
          correo: res.correo,
          nickname: res.payload_pendiente?.nickname || "Operador",
        },
      });
    }

    return json({ ok: false, error: `Acción no soportada: ${action}` }, 400);
  } catch (err) {
    console.error("[auth-otp] unhandled error:", err);
    return json({ ok: false, error: "Error interno en el servicio de autenticación." }, 500);
  }
});
