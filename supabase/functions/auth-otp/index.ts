/**
 * Supabase Edge Function: auth-otp
 * ============================================================================
 * Orquestador único de autenticación y cuenta segura de IndiServ Analytica:
 *  - register_init          : Valida padrón UNMSM + envía OTP 6 dígitos vía Brevo
 *  - register_verify        : Consumo atómico FOR UPDATE + crea cuenta + dispositivo + sesión 15m
 *  - login_init             : Valida credenciales; si dispositivo confiable -> sesión 15m;
 *                             si dispositivo nuevo -> envía OTP al correo registrado
 *  - login_verify_otp       : Verifica OTP atómico + registra dispositivo confiable + sesión 15m
 *  - session_validate       : Valida token opaco 256-bit ligado a device_hash (reloj PostgreSQL)
 *  - session_logout         : Revoca sesión inmediatamente en PostgreSQL
 *  - profile_get            : Consulta perfil activo (avatar, dispositivos, tickets)
 *  - profile_update_avatar  : Valida magic bytes (PNG/JPEG/WebP <= 75 KB) y guarda avatar
 *  - password_change_init   : Valida contraseña actual en sesión + envía OTP Brevo
 *  - password_change_verify : Consume OTP + actualiza contraseña + revoca otras sesiones + alerta
 *  - password_reset_init    : Recuperación desde Login (DNI + correo + anti-enumeración + OTP Brevo)
 *  - password_reset_verify  : Consume OTP + nueva clave + revoca 100% sesiones y dispositivos + alerta
 *  - account_delete_init    : Valida clave actual + confirmación + envía OTP de borrado total
 *  - account_delete_verify  : Consume OTP + borrado atómico en cascada (cuenta + tickets + sesiones)
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

const MAX_REQ_PER_IP_MIN = 45;
const MAX_OTP_PER_HOUR_DNI = 5;
const OTP_RESEND_COOLDOWN_SEC = 60;
const MAX_BODY_BYTES = 8 * 1024;
const MAX_TICKET_BODY_BYTES = 64 * 1024;
const MAX_AVATAR_BODY_BYTES = 120 * 1024;
const MAX_AVATAR_DECODED_BYTES = 75_000;
const PBKDF2_ITERATIONS = 210_000;
const LEGACY_SALT_NAMESPACE = "INDISERV_SALT_2026";

const HONEY_DNIS = new Set(["00000000", "99999999", "12345678", "87654321", "11111111", "admin", "root"]);
const HONEY_EMAILS = new Set([
  "admin@indiserv.pe",
  "root@indiserv.pe",
  "soporte@indiserv.pe",
  "security@indiserv.pe",
  "administrator@indiserv.pe",
  "admin@unmsm.edu.pe",
]);

function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return true; // Desktop Python / Android nativo sin cabecera Origin
  return ALLOWED_ORIGINS.has(origin.trim());
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
  // Prioriza cabeceras inyectadas por el proxy de borde (sin aceptar x-forwarded-for falsificable)
  return (
    req.headers.get("cf-connecting-ip")?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    "edge-anon"
  );
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function computeLegacyV1Hash(dni: string, plainPassword: string): Promise<string> {
  const raw = `${LEGACY_SALT_NAMESPACE}::${dni.trim()}::${plainPassword}`;
  return `indiserv_v1$${await sha256Hex(raw)}`;
}

async function hashPasswordPbkdf2(secretInput: string, pepper: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const keyMat = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`${pepper}::${secretInput}`),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMat,
    256
  );
  return `indiserv_pbkdf2$${PBKDF2_ITERATIONS}$${toHex(salt)}$${toHex(bits)}`;
}

async function verifyPasswordPbkdf2(secretInput: string, stored: string, pepper: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "indiserv_pbkdf2") return false;
  const iterations = Number(parts[1]);
  const saltHex = parts[2];
  const expectedHex = parts[3];
  if (!Number.isFinite(iterations) || iterations < 50_000 || iterations > 1_000_000) return false;
  if (!/^[a-f0-9]{16,64}$/i.test(saltHex) || !/^[a-f0-9]{64}$/i.test(expectedHex)) return false;

  const keyMat = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`${pepper}::${secretInput}`),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: fromHex(saltHex), iterations, hash: "SHA-256" },
    keyMat,
    256
  );
  return timingSafeEqualStr(toHex(bits), expectedHex.toLowerCase());
}

/**
 * Verifica credenciales contra usuarios_app soportando PBKDF2 en servidor y migrando
 * transparentemente cuentas legacy (indiserv_v1$) a PBKDF2 en su primer login válido.
 */
async function verifyUserCredentialsAndMigrate(
  // deno-lint-ignore no-explicit-any
  admin: any,
  dni: string,
  correo: string,
  plainPassword: string,
  clientLegacyHash: string,
  pepper: string
): Promise<{ ok: true; dni: string; correo: string; nickname: string; avatar_data: string | null } | { ok: false }> {
  const cleanDni = dni.trim();
  const cleanCorreo = correo.trim().toLowerCase();
  const { data: user, error } = await admin
    .from("usuarios_app")
    .select("dni, correo, nickname, password_hash, avatar_data")
    .eq("dni", cleanDni)
    .maybeSingle();

  if (error || !user) return { ok: false };
  if (String(user.correo || "").trim().toLowerCase() !== cleanCorreo) return { ok: false };

  const stored = String(user.password_hash || "").trim();
  let matched = false;
  let needsUpgrade = false;
  let upgradeSecret = plainPassword || clientLegacyHash;

  if (stored.startsWith("indiserv_pbkdf2$")) {
    if (plainPassword) {
      matched = await verifyPasswordPbkdf2(plainPassword, stored, pepper);
      if (!matched) {
        const legacyCompat = await computeLegacyV1Hash(cleanDni, plainPassword);
        matched = await verifyPasswordPbkdf2(legacyCompat, stored, pepper);
        if (matched) {
          // Re-hash limpio directamente sobre plainPassword
          needsUpgrade = true;
          upgradeSecret = plainPassword;
        }
      }
    } else if (clientLegacyHash) {
      matched = await verifyPasswordPbkdf2(clientLegacyHash, stored, pepper);
    }
  } else if (stored.startsWith("indiserv_v1$")) {
    const candidateV1 = plainPassword ? await computeLegacyV1Hash(cleanDni, plainPassword) : clientLegacyHash;
    if (candidateV1 && timingSafeEqualStr(stored, candidateV1)) {
      matched = true;
      needsUpgrade = true;
      upgradeSecret = plainPassword || candidateV1;
    }
  }

  if (!matched) return { ok: false };

  if (needsUpgrade && upgradeSecret && pepper) {
    try {
      const upgradedHash = await hashPasswordPbkdf2(upgradeSecret, pepper);
      await admin.from("usuarios_app").update({ password_hash: upgradedHash }).eq("dni", cleanDni);
    } catch {
      // No bloquear login si falla la migración oportunista
    }
  }

  return {
    ok: true,
    dni: String(user.dni).trim(),
    correo: String(user.correo).trim(),
    nickname: String(user.nickname || "Operador").trim(),
    avatar_data: user.avatar_data || null,
  };
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

type OtpPurpose = "register" | "new_device" | "password_change" | "password_reset" | "account_delete";

function validateAvatarDataUri(raw: unknown): { ok: boolean; value?: string | null; error?: string } {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  const str = String(raw).trim();
  if (!str) return { ok: true, value: null };

  const match = /^data:image\/(webp|jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(str);
  if (!match) {
    return { ok: false, error: "Formato de imagen no permitido. Use PNG, JPEG o WebP." };
  }
  const kind = match[1];
  const b64 = match[2];
  const approxBytes = Math.floor((b64.length * 3) / 4);
  if (approxBytes <= 0 || approxBytes > MAX_AVATAR_DECODED_BYTES) {
    return { ok: false, error: "La imagen supera el límite seguro de 75 KB tras compresión." };
  }

  let bytes: Uint8Array;
  try {
    const bin = atob(b64);
    if (bin.length < 12 || bin.length > MAX_AVATAR_DECODED_BYTES) {
      return { ok: false, error: "Tamaño de imagen fuera de rango permitido." };
    }
    bytes = new Uint8Array(Math.min(bin.length, 16));
    for (let i = 0; i < bytes.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return { ok: false, error: "Base64 de imagen inválido." };
  }

  const isPng =
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isWebp =
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;

  if (
    (kind === "png" && !isPng) ||
    (kind === "jpeg" && !isJpeg) ||
    (kind === "webp" && !isWebp)
  ) {
    return { ok: false, error: "La firma binaria (magic bytes) no coincide con una imagen válida." };
  }

  return { ok: true, value: str };
}

async function requireActiveSession(
  // deno-lint-ignore no-explicit-any
  admin: any,
  // deno-lint-ignore no-explicit-any
  body: any
): Promise<
  | {
      ok: true;
      dni: string;
      correo: string;
      nickname: string;
      avatar_data: string | null;
      tokenHash: string;
      deviceHash: string;
    }
  | { ok: false }
> {
  const token = String(body?.session_token || "").trim();
  const deviceHash = String(body?.device_hash || "").trim();
  if (!token || !isValidDeviceHash(deviceHash)) return { ok: false };
  const tokenHash = await sha256Hex(token);
  const { data, error } = await admin.rpc("validar_sesion_15m", {
    p_token_hash: tokenHash,
    p_device_hash: deviceHash,
  });
  if (error || !data?.ok) return { ok: false };
  return {
    ok: true,
    dni: String(data.dni).trim(),
    correo: String(data.correo).trim(),
    nickname: String(data.nickname || "Operador").trim(),
    avatar_data: data.avatar_data || null,
    tokenHash,
    deviceHash,
  };
}

async function sendBrevoHtmlEmail(params: {
  toEmail: string;
  subject: string;
  htmlContent: string;
}): Promise<{ ok: boolean; error?: string }> {
  const apiKey = Deno.env.get("BREVO_API_KEY")?.trim();
  const senderEmail = Deno.env.get("BREVO_SENDER_EMAIL")?.trim();
  if (!apiKey || !senderEmail) {
    return {
      ok: false,
      error: "Servicio de correo no configurado en el servidor (BREVO_API_KEY / BREVO_SENDER_EMAIL).",
    };
  }
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
        subject: params.subject,
        htmlContent: params.htmlContent,
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

async function sendBrevoOtpEmail(params: {
  toEmail: string;
  code: string;
  proposito: OtpPurpose;
  deviceLabel: string;
}): Promise<{ ok: boolean; error?: string }> {
  const safeDev = params.deviceLabel.replace(/[<>&]/g, "");
  const copyMap: Record<OtpPurpose, { subject: string; heading: string; intro: string; accent: string }> = {
    register: {
      subject: `IndiServ Analytica — Código de verificación de registro: ${params.code}`,
      heading: "Confirma tu registro en IndiServ Analytica",
      intro: "Ingresa este código de 6 dígitos para verificar tu correo y activar tu cuenta:",
      accent: "#34d399",
    },
    new_device: {
      subject: `IndiServ Analytica — Código de acceso en nuevo dispositivo: ${params.code}`,
      heading: "Nuevo inicio de sesión detectado",
      intro: `Detectamos un intento de inicio de sesión desde un dispositivo nuevo (<strong>${safeDev}</strong>). Si fuiste tú, ingresa este código para marcarlo como confiable:`,
      accent: "#22d3ee",
    },
    password_change: {
      subject: `IndiServ Analytica — Código para cambiar tu contraseña: ${params.code}`,
      heading: "Confirmación de cambio de contraseña",
      intro: `Solicitaste cambiar la contraseña de tu cuenta desde <strong>${safeDev}</strong>. Ingresa este código de 6 dígitos para confirmar el cambio:`,
      accent: "#34d399",
    },
    password_reset: {
      subject: `IndiServ Analytica — Código de recuperación de contraseña: ${params.code}`,
      heading: "Recuperación de contraseña solicitada",
      intro: `Recibimos una solicitud para restablecer tu contraseña desde <strong>${safeDev}</strong>. Si fuiste tú, ingresa este código para definir una nueva contraseña:`,
      accent: "#f59e0b",
    },
    account_delete: {
      subject: `IndiServ Analytica — Código IRREVERSIBLE de eliminación de cuenta: ${params.code}`,
      heading: "⚠️ Confirmación de eliminación permanente de cuenta",
      intro: `Solicitaste <strong>eliminar permanentemente</strong> tu cuenta, tu perfil y <strong>todos tus tickets de diagnóstico</strong> desde <strong>${safeDev}</strong>. Esta acción no se puede deshacer:`,
      accent: "#ef4444",
    },
  };

  const c = copyMap[params.proposito];
  const htmlContent = `
    <div style="font-family:Segoe UI,Arial,sans-serif;background:#090c12;color:#e2e8f0;padding:28px;border-radius:12px;max-width:520px;margin:0 auto;">
      <p style="color:${c.accent};font-size:12px;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 8px 0;">INDISERV ANALYTICA · SEGURIDAD</p>
      <h2 style="color:#ffffff;margin:0 0 12px 0;font-size:20px;">${c.heading}</h2>
      <p style="color:#cbd5e1;font-size:14px;line-height:1.5;margin:0 0 20px 0;">${c.intro}</p>
      <div style="background:#101521;border:1px solid ${c.accent}55;border-radius:10px;padding:18px;text-align:center;margin-bottom:20px;">
        <span style="font-family:Consolas,monospace;font-size:32px;font-weight:700;letter-spacing:8px;color:${c.accent};">${params.code}</span>
      </div>
      <p style="color:#94a3b8;font-size:12px;line-height:1.5;margin:0;">
        Este código expira en <strong>10 minutos</strong> y permite un máximo de <strong>5 intentos</strong>.
        Nunca compartas este código. Si no realizaste esta solicitud, ignora este mensaje y revisa la seguridad de tu cuenta.
      </p>
    </div>
  `;

  return sendBrevoHtmlEmail({ toEmail: params.toEmail, subject: c.subject, htmlContent });
}

async function sendBrevoSecurityNotice(params: {
  toEmail: string;
  titulo: string;
  detalle: string;
  accent?: string;
}): Promise<void> {
  const accent = params.accent || "#22d3ee";
  const htmlContent = `
    <div style="font-family:Segoe UI,Arial,sans-serif;background:#090c12;color:#e2e8f0;padding:28px;border-radius:12px;max-width:520px;margin:0 auto;">
      <p style="color:${accent};font-size:12px;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 8px 0;">INDISERV ANALYTICA · ALERTA DE SEGURIDAD</p>
      <h2 style="color:#ffffff;margin:0 0 12px 0;font-size:20px;">${params.titulo}</h2>
      <p style="color:#cbd5e1;font-size:14px;line-height:1.5;margin:0 0 16px 0;">${params.detalle}</p>
      <p style="color:#94a3b8;font-size:12px;line-height:1.5;margin:0;">
        Fecha UTC: ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC.
      </p>
    </div>
  `;
  await sendBrevoHtmlEmail({
    toEmail: params.toEmail,
    subject: `IndiServ Analytica — ${params.titulo}`,
    htmlContent,
  }).catch(() => {});
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

  const rawText = await req.text();
  if (rawText.length > MAX_AVATAR_BODY_BYTES) {
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

  const action = String(body?.action || "").trim();
  const maxAllowedBytes =
    action === "profile_update_avatar"
      ? MAX_AVATAR_BODY_BYTES
      : action === "tickets_upsert" || action === "suggestion_save"
      ? MAX_TICKET_BODY_BYTES
      : MAX_BODY_BYTES;
  if (rawText.length > maxAllowedBytes) {
    return new Response(JSON.stringify({ ok: false, error: "Payload demasiado grande." }), {
      status: 413,
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

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  // Rate-limit persistente en PostgreSQL (inmune a cold starts)
  const { data: rlIp } = await admin.rpc("consumir_rate_limit", {
    p_key: `ip:${ip}`,
    p_window_sec: 60,
    p_max_hits: MAX_REQ_PER_IP_MIN,
  });
  if (rlIp && rlIp.allowed === false) {
    return json({ ok: false, error: `Demasiadas solicitudes. Espera ${rlIp.wait_sec || 60} s.` }, 429);
  }

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
        user: {
          dni: data.dni,
          correo: data.correo,
          nickname: data.nickname,
          avatar_data: data.avatar_data || null,
        },
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

    // -------------------------------------------------------------------------
    // 2B. PROFILE GET (Consulta perfil, avatar y conteo de dispositivos/tickets)
    // -------------------------------------------------------------------------
    if (action === "profile_get") {
      const sess = await requireActiveSession(admin, body);
      if (!sess.ok) {
        return json({ ok: false, session_expired: true, error: "Sesión expirada. Vuelva a iniciar sesión." }, 401);
      }
      const { data: prof, error: profErr } = await admin.rpc("obtener_perfil_cuenta", {
        p_dni: sess.dni,
      });
      if (profErr || !prof?.ok) {
        return json({ ok: false, error: prof?.error || "No se pudo cargar el perfil." }, 500);
      }
      return json({
        ok: true,
        user: {
          dni: prof.dni,
          correo: prof.correo,
          nickname: prof.nickname,
          avatar_data: prof.avatar_data || null,
          dispositivos_confiables: prof.dispositivos_confiables ?? 0,
          tickets_count: prof.tickets_count ?? 0,
        },
      });
    }

    // -------------------------------------------------------------------------
    // 2C. PROFILE UPDATE AVATAR (Valida magic bytes PNG/JPEG/WebP <= 75 KB)
    // -------------------------------------------------------------------------
    if (action === "profile_update_avatar") {
      const sess = await requireActiveSession(admin, body);
      if (!sess.ok) {
        return json({ ok: false, session_expired: true, error: "Sesión expirada. Vuelva a iniciar sesión." }, 401);
      }
      const check = validateAvatarDataUri(body?.avatar_data);
      if (!check.ok) {
        return json({ ok: false, error: check.error }, 400);
      }
      const { data: upd, error: updErr } = await admin.rpc("actualizar_avatar_usuario", {
        p_dni: sess.dni,
        p_avatar_data: check.value ?? null,
      });
      if (updErr || !upd?.ok) {
        return json({ ok: false, error: upd?.error || "No se pudo actualizar la foto de perfil." }, 500);
      }
      return json({ ok: true, avatar_data: upd.avatar_data || null });
    }

    // -------------------------------------------------------------------------
    // 2D. DEVICES LIST (Lista equipos confiables activos sin exponer device_hash)
    // -------------------------------------------------------------------------
    if (action === "devices_list") {
      const sess = await requireActiveSession(admin, body);
      if (!sess.ok) {
        return json({ ok: false, session_expired: true, error: "Sesión expirada. Vuelva a iniciar sesión." }, 401);
      }
      const { data: devRes, error: devErr } = await admin.rpc("listar_dispositivos_confiables", {
        p_dni: sess.dni,
      });
      if (devErr || !devRes?.ok) {
        return json({ ok: false, error: devRes?.error || "No se pudieron consultar los equipos confiables." }, 500);
      }
      // deno-lint-ignore no-explicit-any
      const rawList = Array.isArray(devRes.devices) ? devRes.devices : [];
      // deno-lint-ignore no-explicit-any
      const devices = rawList.map((d: any) => ({
        id: String(d.id || ""),
        device_label: String(d.device_label || "Dispositivo"),
        plataforma: String(d.plataforma || "desktop"),
        verificado_en: d.verificado_en || null,
        ultimo_uso: d.ultimo_uso || null,
        sesion_activa: Boolean(d.sesion_activa),
        is_current: String(d.device_hash || "") === sess.deviceHash,
      }));
      return json({ ok: true, devices });
    }

    // -------------------------------------------------------------------------
    // 2E. DEVICE REVOKE (Revoca equipo confiable y cierra sus sesiones activas)
    // -------------------------------------------------------------------------
    if (action === "device_revoke") {
      const sess = await requireActiveSession(admin, body);
      if (!sess.ok) {
        return json({ ok: false, session_expired: true, error: "Sesión expirada. Vuelva a iniciar sesión." }, 401);
      }
      const deviceId = String(body?.device_id || "").trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deviceId)) {
        return json({ ok: false, error: "Identificador de dispositivo inválido." }, 400);
      }
      const { data: revRes, error: revErr } = await admin.rpc("revocar_dispositivo_confiable", {
        p_dni: sess.dni,
        p_device_id: deviceId,
      });
      if (revErr || !revRes?.ok) {
        return json({ ok: false, error: revRes?.error || "No se pudo revocar el dispositivo." }, 400);
      }
      const revokedCurrent = String(revRes.revoked_device_hash || "") === sess.deviceHash;
      const devLabel = String(revRes.device_label || "Dispositivo");
      await sendBrevoSecurityNotice({
        toEmail: sess.correo,
        titulo: "Equipo confiable revocado",
        detalle: `Se revocó el acceso del equipo <strong>${devLabel.replace(/[<>&]/g, "")}</strong> y se cerraron sus sesiones activas. Si vuelve a iniciar sesión desde ese equipo se solicitará un nuevo código OTP.`,
        accent: "#f59e0b",
      });
      return json({
        ok: true,
        revoked_current: revokedCurrent,
        device_label: devLabel,
      });
    }

    // -------------------------------------------------------------------------
    // 2F. TICKETS UPSERT / LIST / PUBLIC GET / SUGGESTIONS / HONEYTOKENS (BOLA-FREE)
    // -------------------------------------------------------------------------
    if (action === "tickets_upsert") {
      const sess = await requireActiveSession(admin, body);
      if (!sess.ok) {
        return json({ ok: false, session_expired: true, error: "Sesión expirada. Vuelva a iniciar sesión." }, 401);
      }
      const payload = body?.ticket;
      if (!payload || typeof payload !== "object") {
        return json({ ok: false, error: "Payload de ticket inválido." }, 400);
      }
      const { data: res, error } = await admin.rpc("guardar_ticket_seguro", {
        p_dni: sess.dni,
        p_payload: payload,
      });
      if (error || !res?.ok) {
        return json({ ok: false, error: res?.error || "No se pudo guardar el ticket." }, 400);
      }
      return json({ ok: true, id_ticket: res.id_ticket });
    }

    if (action === "tickets_list") {
      const sess = await requireActiveSession(admin, body);
      if (!sess.ok) {
        return json({ ok: false, session_expired: true, error: "Sesión expirada. Vuelva a iniciar sesión." }, 401);
      }
      const limite = Math.max(1, Math.min(200, Number(body?.limit || 120)));
      const { data: res, error } = await admin.rpc("listar_tickets_seguro", {
        p_dni: sess.dni,
        p_limite: limite,
      });
      if (error || !res?.ok) {
        return json({ ok: false, error: "No se pudieron consultar tus tickets." }, 500);
      }
      return json({ ok: true, tickets: res.tickets || [] });
    }

    if (action === "ticket_get_public") {
      const { data: rlPub } = await admin.rpc("consumir_rate_limit", {
        p_key: `pub_tkt:${ip}`,
        p_window_sec: 60,
        p_max_hits: 15,
      });
      if (rlPub && rlPub.allowed === false) {
        return json({ ok: false, error: `Demasiadas consultas. Espera ${rlPub.wait_sec || 60} s.` }, 429);
      }
      const ticketId = String(body?.ticket_id || "").trim();
      if (!/^[A-Za-z0-9_-]{6,48}$/.test(ticketId)) {
        return json({ ok: false, error: "ID de ticket inválido." }, 400);
      }
      const { data: res, error } = await admin.rpc("consultar_ticket_publico", {
        p_ticket_id: ticketId,
      });
      if (error || !res?.ok) {
        return json({ ok: false, error: res?.error || "Ticket no encontrado." }, 404);
      }
      return json({ ok: true, ticket: res.ticket });
    }

    if (action === "suggestion_save") {
      const sess = await requireActiveSession(admin, body);
      if (!sess.ok) {
        return json({ ok: false, session_expired: true, error: "Sesión expirada." }, 401);
      }
      const idTicket = String(body?.id_ticket || "").trim();
      const sugerencia = String(body?.sugerencia || "").trim();
      if (idTicket.length < 6 || !sugerencia) {
        return json({ ok: false, error: "Sugerencia inválida." }, 400);
      }
      const { data: res, error } = await admin.rpc("guardar_sugerencia_segura", {
        p_id_ticket: idTicket,
        p_sugerencia: sugerencia,
      });
      if (error || !res?.ok) {
        return json({ ok: false, error: res?.error || "No se pudo guardar la sugerencia." }, 400);
      }
      return json({ ok: true });
    }

    if (action === "honeytokens_list") {
      const sess = await requireActiveSession(admin, body);
      if (!sess.ok) {
        return json({ ok: false, session_expired: true, error: "Sesión expirada." }, 401);
      }
      const limite = Math.max(1, Math.min(50, Number(body?.limit || 15)));
      const { data: res, error } = await admin.rpc("listar_alertas_honeytoken_seguro", {
        p_limite: limite,
      });
      if (error || !res?.ok) {
        return json({ ok: false, alerts: [] });
      }
      return json({ ok: true, alerts: res.alerts || [] });
    }

    if (action === "honey_alert") {
      const { data: rlHoney } = await admin.rpc("consumir_rate_limit", {
        p_key: `honey:${ip}`,
        p_window_sec: 60,
        p_max_hits: 5,
      });
      if (rlHoney && rlHoney.allowed === false) {
        return json({ ok: true }); // Silencioso para no informar al atacante
      }
      const tipo = String(body?.tipo || "ALERTA").trim().slice(0, 80);
      const detalle = String(body?.detalle || "").trim().slice(0, 300);
      await logHoneyAlert(admin, tipo, detalle, ip);
      return json({ ok: true });
    }

    // Migración única de cuentas legacy (indiserv_v1$) a PBKDF2-210k autenticada con x-admin-pepper
    if (action === "admin_migrate_legacy_hashes") {
      const provided = String(req.headers.get("x-admin-pepper") || "").trim();
      if (!otpPepper || !provided || !timingSafeEqualStr(provided, otpPepper)) {
        return json({ ok: false, error: "No autorizado." }, 401);
      }
      const { data: legacyRows, error: qErr } = await admin
        .from("usuarios_app")
        .select("dni, password_hash")
        .like("password_hash", "indiserv_v1$%")
        .limit(200);
      if (qErr) {
        return json({ ok: false, error: "Error consultando cuentas legacy." }, 500);
      }
      let migrated = 0;
      for (const row of legacyRows || []) {
        const oldHash = String(row.password_hash || "").trim();
        if (!oldHash.startsWith("indiserv_v1$")) continue;
        const wrapped = await hashPasswordPbkdf2(oldHash, otpPepper);
        const { error: uErr } = await admin
          .from("usuarios_app")
          .update({ password_hash: wrapped })
          .eq("dni", row.dni);
        if (!uErr) migrated += 1;
      }
      return json({ ok: true, migrated });
    }

    // -------------------------------------------------------------------------
    // 2G. BIOMETRIC ENROLL & ROTATING TOKEN LOGIN (CERO PASS-THE-HASH)
    // -------------------------------------------------------------------------
    if (action === "biometric_enroll") {
      const sess = await requireActiveSession(admin, body);
      if (!sess.ok) {
        return json({ ok: false, session_expired: true, error: "Sesión expirada." }, 401);
      }
      const bioToken = generateSessionToken256();
      const bioHash = await sha256Hex(bioToken);
      const { data: res, error } = await admin.rpc("emitir_token_biometrico", {
        p_dni: sess.dni,
        p_device_hash: sess.deviceHash,
        p_bio_token_hash: bioHash,
      });
      if (error || !res?.ok) {
        return json({ ok: false, error: res?.error || "No se pudo emitir el token biométrico." }, 400);
      }
      return json({ ok: true, biometric_token: bioToken });
    }

    if (action === "biometric_login") {
      const dni = String(body?.dni || "").trim();
      const bioToken = String(body?.biometric_token || "").trim();
      const deviceHash = String(body?.device_hash || "").trim();
      if (dni.length < 8 || !/^[a-fA-F0-9]{64}$/.test(bioToken) || !isValidDeviceHash(deviceHash)) {
        return json({ ok: false, error: "Token biométrico inválido." }, 400);
      }
      const oldHash = await sha256Hex(bioToken);
      const nextBioToken = generateSessionToken256();
      const nextBioHash = await sha256Hex(nextBioToken);

      const { data: res, error } = await admin.rpc("consumir_y_rotar_token_biometrico", {
        p_dni: dni,
        p_device_hash: deviceHash,
        p_old_bio_hash: oldHash,
        p_new_bio_hash: nextBioHash,
      });
      if (error || !res?.ok) {
        return json({
          ok: false,
          revoked: true,
          error: "El acceso biométrico fue revocado o expiró. Inicia sesión con tu contraseña.",
        }, 401);
      }

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
        new_biometric_token: nextBioToken,
        expires_at: sess?.expira_en,
        user: {
          dni: res.dni,
          correo: res.correo,
          nickname: res.nickname || "Operador",
          avatar_data: res.avatar_data || null,
        },
      });
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
      const plainPassword = String(body?.password || "").trim();
      const legacyHash = String(body?.password_hash || "").trim();
      const deviceHash = String(body?.device_hash || "").trim();
      const deviceLabel = String(body?.device_label || "Dispositivo").trim().slice(0, 80);

      const hasValidSecret = plainPassword.length >= 8 || legacyHash.startsWith("indiserv_v1$");
      if (
        dni.length < 8 ||
        !nickname ||
        !correo.includes("@") ||
        !hasValidSecret ||
        !isValidDeviceHash(deviceHash)
      ) {
        return json({ ok: false, error: "Datos de registro inválidos o contraseña menor a 8 caracteres." }, 400);
      }
      const passwordHash = await hashPasswordPbkdf2(plainPassword || legacyHash, otpPepper);

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
      const plainPassword = String(body?.password || "").trim();
      const legacyHash = String(body?.password_hash || "").trim();
      const deviceHash = String(body?.device_hash || "").trim();
      const deviceLabel = String(body?.device_label || "Dispositivo").trim().slice(0, 80);

      if (!dni || !correo || (!plainPassword && !legacyHash) || !isValidDeviceHash(deviceHash)) {
        return json({ ok: false, error: "Complete DNI, correo y contraseña." }, 400);
      }

      if (isHoney(dni, correo)) {
        await logHoneyAlert(admin, "CREDENCIAL_SENUELO_LOGIN_OTP", `DNI='${dni}' correo='${correo}'`, ip);
        return json({ ok: false, error: "Credenciales incorrectas o cuenta inexistente." });
      }

      const lockKey = `login_fail:${dni}`;
      const { data: lockCheck } = await admin.rpc("verificar_lockout_login", { p_key: lockKey });
      if (lockCheck?.locked) {
        return json(
          {
            ok: false,
            locked: true,
            wait_sec: lockCheck.wait_sec || 60,
            error: `Cuenta protegida por demasiados intentos fallidos. Espera ${lockCheck.wait_sec || 60} s.`,
          },
          429
        );
      }

      const authData = await verifyUserCredentialsAndMigrate(
        admin,
        dni,
        correo,
        plainPassword,
        legacyHash,
        otpPepper
      );

      if (!authData.ok) {
        const { data: failRes } = await admin.rpc("registrar_fallo_login", {
          p_key: lockKey,
          p_max_intentos: 5,
          p_lock_sec: 120,
        });
        if (failRes?.locked) {
          await logHoneyAlert(admin, "FUERZA_BRUTA_LOGIN_SERVER", `5 fallos sobre DNI='${dni}'`, ip);
          return json(
            {
              ok: false,
              locked: true,
              wait_sec: failRes.wait_sec || 120,
              error: `Demasiados intentos fallidos. Espera ${failRes.wait_sec || 120} s.`,
            },
            429
          );
        }
        return json({ ok: false, error: "Credenciales incorrectas o cuenta inexistente." });
      }

      await admin.rpc("limpiar_fallos_login", { p_key: lockKey });

      const verifiedDni = authData.dni;
      const verifiedCorreo = authData.correo;
      const verifiedNick = authData.nickname;

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
        const { data: avRow } = await admin
          .from("usuarios_app")
          .select("avatar_data")
          .eq("dni", verifiedDni)
          .maybeSingle();
        return json({
          ok: true,
          requires_otp: false,
          session_token: sessionToken,
          expires_at: sess?.expira_en,
          user: {
            dni: verifiedDni,
            correo: verifiedCorreo,
            nickname: verifiedNick,
            avatar_data: avRow?.avatar_data || null,
          },
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
      const { data: avRow } = await admin
        .from("usuarios_app")
        .select("avatar_data")
        .eq("dni", res.dni)
        .maybeSingle();

      return json({
        ok: true,
        session_token: sessionToken,
        expires_at: sess?.expira_en,
        user: {
          dni: res.dni,
          correo: res.correo,
          nickname: res.payload_pendiente?.nickname || "Operador",
          avatar_data: avRow?.avatar_data || null,
        },
      });
    }

    // -------------------------------------------------------------------------
    // 7. PASSWORD CHANGE INIT (Dentro de Mi Cuenta: clave actual + OTP Brevo)
    // -------------------------------------------------------------------------
    if (action === "password_change_init") {
      const sess = await requireActiveSession(admin, body);
      if (!sess.ok) {
        return json({ ok: false, session_expired: true, error: "Sesión expirada. Vuelva a iniciar sesión." }, 401);
      }
      const curPlain = String(body?.current_password || "").trim();
      const newPlain = String(body?.new_password || "").trim();
      const currentHash = String(body?.current_password_hash || "").trim();
      const legacyNewHash = String(body?.new_password_hash || "").trim();
      const deviceLabel = String(body?.device_label || "Dispositivo").trim().slice(0, 80);

      const hasCur = Boolean(curPlain || currentHash);
      const hasNew = newPlain.length >= 8 || legacyNewHash.startsWith("indiserv_v1$");
      if (!hasCur || !hasNew) {
        return json({ ok: false, error: "Complete la contraseña actual y una nueva contraseña (mín. 8 caracteres)." }, 400);
      }
      if ((curPlain && newPlain && curPlain === newPlain) || (currentHash && legacyNewHash && currentHash === legacyNewHash)) {
        return json({ ok: false, error: "La nueva contraseña debe ser diferente a la actual." }, 400);
      }

      const authCheck = await verifyUserCredentialsAndMigrate(
        admin,
        sess.dni,
        sess.correo,
        curPlain,
        currentHash,
        otpPepper
      );
      if (!authCheck.ok) {
        return json({ ok: false, error: "La contraseña actual es incorrecta." });
      }
      const newHash = await hashPasswordPbkdf2(newPlain || legacyNewHash, otpPepper);

      const lim = await checkDniOtpLimits(admin, sess.dni);
      if (!lim.allowed) {
        return json({ ok: false, error: lim.error, wait_sec: lim.waitSec || 0 }, 429);
      }

      await admin
        .from("codigos_otp")
        .update({ usado: true })
        .eq("dni", sess.dni)
        .eq("proposito", "password_change")
        .eq("usado", false);

      const challengeId = crypto.randomUUID();
      const code = generateOtp6();
      const codeHmac = await computeOtpHmac(otpPepper, challengeId, sess.dni, "password_change", code);

      const { error: insErr } = await admin.from("codigos_otp").insert({
        id: challengeId,
        dni: sess.dni,
        correo: sess.correo,
        proposito: "password_change",
        device_hash: sess.deviceHash,
        code_hmac: codeHmac,
        payload_pendiente: { new_password_hash: newHash },
        ip_origen: ip,
      });
      if (insErr) {
        return json({ ok: false, error: "Error interno creando verificación OTP." }, 500);
      }

      const mail = await sendBrevoOtpEmail({
        toEmail: sess.correo,
        code,
        proposito: "password_change",
        deviceLabel,
      });
      if (!mail.ok) {
        await admin.from("codigos_otp").delete().eq("id", challengeId);
        return json({ ok: false, error: mail.error || "No se pudo enviar el código OTP." }, 502);
      }

      return json({
        ok: true,
        challenge_id: challengeId,
        masked_email: maskEmail(sess.correo),
        expires_in_sec: 600,
        resend_cooldown_sec: OTP_RESEND_COOLDOWN_SEC,
      });
    }

    // -------------------------------------------------------------------------
    // 8. PASSWORD CHANGE VERIFY (Consume OTP + actualiza + revoca otras sesiones)
    // -------------------------------------------------------------------------
    if (action === "password_change_verify") {
      const sess = await requireActiveSession(admin, body);
      if (!sess.ok) {
        return json({ ok: false, session_expired: true, error: "Sesión expirada. Vuelva a iniciar sesión." }, 401);
      }
      const challengeId = String(body?.challenge_id || "").trim();
      const code = String(body?.code || "").trim();
      if (!challengeId || !/^\d{6}$/.test(code)) {
        return json({ ok: false, error: "Ingrese un código válido de 6 dígitos." }, 400);
      }

      const { data: meta } = await admin
        .from("codigos_otp")
        .select("dni, proposito")
        .eq("id", challengeId)
        .maybeSingle();

      if (!meta || meta.proposito !== "password_change" || String(meta.dni).trim() !== sess.dni) {
        return json({ ok: false, error: "Código inválido o expirado." });
      }

      const codeHmac = await computeOtpHmac(otpPepper, challengeId, sess.dni, "password_change", code);
      const { data: res, error: rpcErr } = await admin.rpc("consumir_otp_atomico", {
        p_challenge_id: challengeId,
        p_device_hash: sess.deviceHash,
        p_code_hmac: codeHmac,
      });
      if (rpcErr || !res?.ok) {
        if (res?.reason === "locked") {
          await logHoneyAlert(admin, "FUERZA_BRUTA_OTP_CAMBIO_CLAVE", `5 intentos fallidos DNI='${sess.dni}'`, ip);
          return json({ ok: false, locked: true, error: "Código bloqueado por 5 intentos fallidos. Solicite uno nuevo." });
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

      const newHash = String(res.payload_pendiente?.new_password_hash || "").trim();
      const { data: upd, error: updErr } = await admin.rpc("actualizar_password_seguro", {
        p_dni: sess.dni,
        p_new_password_hash: newHash,
        p_keep_token_hash: sess.tokenHash,
        p_revocar_dispositivos: false,
      });
      if (updErr || !upd?.ok) {
        return json({ ok: false, error: upd?.error || "No se pudo actualizar la contraseña." }, 500);
      }

      await sendBrevoSecurityNotice({
        toEmail: sess.correo,
        titulo: "Tu contraseña ha sido actualizada",
        detalle:
          "Tu contraseña de IndiServ Analytica se actualizó correctamente y se cerraron todas las demás sesiones activas. Si no realizaste este cambio, utiliza '¿Olvidaste tu contraseña?' de inmediato.",
        accent: "#34d399",
      });

      return json({ ok: true });
    }

    // -------------------------------------------------------------------------
    // 9. PASSWORD RESET INIT (Desde Login: DNI + correo + anti-enumeración + OTP)
    // -------------------------------------------------------------------------
    if (action === "password_reset_init") {
      const dni = String(body?.dni || "").trim();
      const correo = String(body?.correo || "").trim().toLowerCase();
      const deviceHash = String(body?.device_hash || "").trim();
      const deviceLabel = String(body?.device_label || "Dispositivo").trim().slice(0, 80);

      if (dni.length < 8 || !correo.includes("@") || !isValidDeviceHash(deviceHash)) {
        return json({ ok: false, error: "Ingrese su DNI (8 dígitos) y correo registrado." }, 400);
      }

      const neutralReply = {
        ok: true,
        challenge_id: crypto.randomUUID(),
        masked_email: maskEmail(correo),
        expires_in_sec: 600,
        resend_cooldown_sec: OTP_RESEND_COOLDOWN_SEC,
        neutral: true,
      };

      if (isHoney(dni, correo)) {
        await logHoneyAlert(admin, "CREDENCIAL_SENUELO_RESET_CLAVE", `DNI='${dni}' correo='${correo}'`, ip);
        return json(neutralReply);
      }

      const lim = await checkDniOtpLimits(admin, dni);
      if (!lim.allowed) {
        return json({ ok: false, error: lim.error, wait_sec: lim.waitSec || 0 }, 429);
      }

      const { data: foundUser } = await admin
        .from("usuarios_app")
        .select("dni, correo")
        .eq("dni", dni)
        .maybeSingle();

      if (!foundUser || String(foundUser.correo || "").trim().toLowerCase() !== correo) {
        // Respuesta neutra anti-enumeración (forma idéntica al éxito)
        return json(neutralReply);
      }

      await admin
        .from("codigos_otp")
        .update({ usado: true })
        .eq("dni", dni)
        .eq("proposito", "password_reset")
        .eq("usado", false);

      const challengeId = crypto.randomUUID();
      const code = generateOtp6();
      const codeHmac = await computeOtpHmac(otpPepper, challengeId, dni, "password_reset", code);

      const { error: insErr } = await admin.from("codigos_otp").insert({
        id: challengeId,
        dni,
        correo: String(foundUser.correo).trim(),
        proposito: "password_reset",
        device_hash: deviceHash,
        code_hmac: codeHmac,
        payload_pendiente: { reset_from: deviceLabel },
        ip_origen: ip,
      });
      if (insErr) {
        return json({ ok: false, error: "Error interno iniciando recuperación." }, 500);
      }

      const mail = await sendBrevoOtpEmail({
        toEmail: String(foundUser.correo).trim(),
        code,
        proposito: "password_reset",
        deviceLabel,
      });
      if (!mail.ok) {
        await admin.from("codigos_otp").delete().eq("id", challengeId);
        return json({ ok: false, error: mail.error || "No se pudo enviar el correo de recuperación." }, 502);
      }

      return json({
        ok: true,
        challenge_id: challengeId,
        masked_email: maskEmail(String(foundUser.correo).trim()),
        expires_in_sec: 600,
        resend_cooldown_sec: OTP_RESEND_COOLDOWN_SEC,
        neutral: true,
      });
    }

    // -------------------------------------------------------------------------
    // 10. PASSWORD RESET VERIFY (OTP + nueva clave + revoca 100% sesiones/equipos)
    // -------------------------------------------------------------------------
    if (action === "password_reset_verify") {
      const challengeId = String(body?.challenge_id || "").trim();
      const code = String(body?.code || "").trim();
      const newPlain = String(body?.new_password || "").trim();
      const legacyNewHash = String(body?.new_password_hash || "").trim();
      const deviceHash = String(body?.device_hash || "").trim();

      if (
        !challengeId ||
        !/^\d{6}$/.test(code) ||
        (newPlain.length < 8 && !legacyNewHash.startsWith("indiserv_v1$")) ||
        !isValidDeviceHash(deviceHash)
      ) {
        return json({ ok: false, error: "Ingrese el código de 6 dígitos y una nueva contraseña válida (mín. 8 caracteres)." }, 400);
      }
      const newPasswordHash = await hashPasswordPbkdf2(newPlain || legacyNewHash, otpPepper);

      const { data: meta } = await admin
        .from("codigos_otp")
        .select("dni, proposito")
        .eq("id", challengeId)
        .maybeSingle();

      if (!meta || meta.proposito !== "password_reset") {
        return json({ ok: false, error: "Código incorrecto o expirado." });
      }

      const codeHmac = await computeOtpHmac(otpPepper, challengeId, meta.dni, "password_reset", code);
      const { data: res, error: rpcErr } = await admin.rpc("consumir_otp_atomico", {
        p_challenge_id: challengeId,
        p_device_hash: deviceHash,
        p_code_hmac: codeHmac,
      });
      if (rpcErr || !res?.ok) {
        if (res?.reason === "locked") {
          await logHoneyAlert(admin, "FUERZA_BRUTA_OTP_RESET", `5 intentos fallidos DNI='${res.dni || meta.dni}'`, ip);
          return json({ ok: false, locked: true, error: "Código bloqueado por 5 intentos fallidos. Solicite uno nuevo." });
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

      const { data: upd, error: updErr } = await admin.rpc("actualizar_password_seguro", {
        p_dni: res.dni,
        p_new_password_hash: newPasswordHash,
        p_keep_token_hash: null,
        p_revocar_dispositivos: true,
      });
      if (updErr || !upd?.ok) {
        return json({ ok: false, error: upd?.error || "No se pudo restablecer la contraseña." }, 500);
      }

      await sendBrevoSecurityNotice({
        toEmail: res.correo,
        titulo: "Tu contraseña fue restablecida",
        detalle:
          "Se restableció la contraseña de tu cuenta de IndiServ Analytica mediante recuperación por correo. Por seguridad, todas las sesiones activas y dispositivos de confianza previos fueron revocados.",
        accent: "#f59e0b",
      });

      return json({ ok: true });
    }

    // -------------------------------------------------------------------------
    // 11. ACCOUNT DELETE INIT (Clave actual + frase ELIMINAR + OTP Brevo)
    // -------------------------------------------------------------------------
    if (action === "account_delete_init") {
      const sess = await requireActiveSession(admin, body);
      if (!sess.ok) {
        return json({ ok: false, session_expired: true, error: "Sesión expirada. Vuelva a iniciar sesión." }, 401);
      }
      const curPlain = String(body?.current_password || "").trim();
      const currentHash = String(body?.current_password_hash || "").trim();
      const confirmText = String(body?.confirm_text || "").trim().toUpperCase();
      const deviceLabel = String(body?.device_label || "Dispositivo").trim().slice(0, 80);

      if (!curPlain && !currentHash) {
        return json({ ok: false, error: "Ingrese su contraseña actual para confirmar." }, 400);
      }
      if (!["ELIMINAR", "ELIMINAR MI CUENTA", sess.dni.toUpperCase()].includes(confirmText)) {
        return json({ ok: false, error: "Escriba ELIMINAR para confirmar la eliminación permanente." }, 400);
      }

      const authCheck = await verifyUserCredentialsAndMigrate(
        admin,
        sess.dni,
        sess.correo,
        curPlain,
        currentHash,
        otpPepper
      );
      if (!authCheck.ok) {
        return json({ ok: false, error: "La contraseña actual es incorrecta." });
      }

      const lim = await checkDniOtpLimits(admin, sess.dni);
      if (!lim.allowed) {
        return json({ ok: false, error: lim.error, wait_sec: lim.waitSec || 0 }, 429);
      }

      await admin
        .from("codigos_otp")
        .update({ usado: true })
        .eq("dni", sess.dni)
        .eq("proposito", "account_delete")
        .eq("usado", false);

      const challengeId = crypto.randomUUID();
      const code = generateOtp6();
      const codeHmac = await computeOtpHmac(otpPepper, challengeId, sess.dni, "account_delete", code);

      const { error: insErr } = await admin.from("codigos_otp").insert({
        id: challengeId,
        dni: sess.dni,
        correo: sess.correo,
        proposito: "account_delete",
        device_hash: sess.deviceHash,
        code_hmac: codeHmac,
        payload_pendiente: { confirmed: true },
        ip_origen: ip,
      });
      if (insErr) {
        return json({ ok: false, error: "Error interno creando verificación de borrado." }, 500);
      }

      const mail = await sendBrevoOtpEmail({
        toEmail: sess.correo,
        code,
        proposito: "account_delete",
        deviceLabel,
      });
      if (!mail.ok) {
        await admin.from("codigos_otp").delete().eq("id", challengeId);
        return json({ ok: false, error: mail.error || "No se pudo enviar el código de confirmación." }, 502);
      }

      return json({
        ok: true,
        challenge_id: challengeId,
        masked_email: maskEmail(sess.correo),
        expires_in_sec: 600,
        resend_cooldown_sec: OTP_RESEND_COOLDOWN_SEC,
      });
    }

    // -------------------------------------------------------------------------
    // 12. ACCOUNT DELETE VERIFY (Consume OTP + borrado total en cascada)
    // -------------------------------------------------------------------------
    if (action === "account_delete_verify") {
      const sess = await requireActiveSession(admin, body);
      if (!sess.ok) {
        return json({ ok: false, session_expired: true, error: "Sesión expirada. Vuelva a iniciar sesión." }, 401);
      }
      const challengeId = String(body?.challenge_id || "").trim();
      const code = String(body?.code || "").trim();
      if (!challengeId || !/^\d{6}$/.test(code)) {
        return json({ ok: false, error: "Ingrese un código válido de 6 dígitos." }, 400);
      }

      const { data: meta } = await admin
        .from("codigos_otp")
        .select("dni, proposito")
        .eq("id", challengeId)
        .maybeSingle();

      if (!meta || meta.proposito !== "account_delete" || String(meta.dni).trim() !== sess.dni) {
        return json({ ok: false, error: "Código inválido o expirado." });
      }

      const codeHmac = await computeOtpHmac(otpPepper, challengeId, sess.dni, "account_delete", code);
      const { data: res, error: rpcErr } = await admin.rpc("consumir_otp_atomico", {
        p_challenge_id: challengeId,
        p_device_hash: sess.deviceHash,
        p_code_hmac: codeHmac,
      });
      if (rpcErr || !res?.ok) {
        if (res?.reason === "locked") {
          await logHoneyAlert(admin, "FUERZA_BRUTA_OTP_ELIMINAR", `5 intentos fallidos DNI='${sess.dni}'`, ip);
          return json({ ok: false, locked: true, error: "Código bloqueado por 5 intentos fallidos." });
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

      const { data: delRes, error: delErr } = await admin.rpc("eliminar_cuenta_completa", {
        p_dni: sess.dni,
      });
      if (delErr || !delRes?.ok) {
        return json({ ok: false, error: delRes?.error || "No se pudo completar la eliminación de cuenta." }, 500);
      }

      await sendBrevoSecurityNotice({
        toEmail: sess.correo,
        titulo: "Tu cuenta ha sido eliminada permanentemente",
        detalle: `Conforme a tu derecho de cancelación (Ley N.° 29733), tu cuenta DNI ${sess.dni}, tus dispositivos de confianza, sesiones activas y ${delRes.tickets_eliminados ?? 0} ticket(s) de diagnóstico fueron eliminados permanentemente de IndiServ Analytica.`,
        accent: "#ef4444",
      });

      return json({
        ok: true,
        tickets_eliminados: delRes.tickets_eliminados ?? 0,
      });
    }

    return json({ ok: false, error: `Acción no soportada: ${action}` }, 400);
  } catch (err) {
    console.error("[auth-otp] unhandled error:", err);
    return json({ ok: false, error: "Error interno en el servicio de autenticación." }, 500);
  }
});
