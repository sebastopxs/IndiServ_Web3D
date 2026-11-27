/**
 * api/auth-proxy.js — Vercel Serverless Function (Same-Origin HttpOnly Cookie Session Proxy)
 *
 * Mantiene el session_token exclusivamente en una cookie HttpOnly + Secure + SameSite=Strict
 * (__Host-indiserv_sess) inaccesible para JavaScript/XSS en el navegador web.
 * Aplica Cache-Control: no-store, validación exacta de Origin HTTPS y rate-limit por visitante.
 */

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  'https://pvrfnvrxaxulcxacdino.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  'sb_publishable_G7D4dhh3Q2LWzgRnzRRa9A_4ngZ5FiW';

const COOKIE_NAME = '__Host-indiserv_sess';
const PROXY_SECRET = String(process.env.VERCEL_PROXY_SECRET || '').trim();
const VISITOR_WINDOW_MS = 60_000;
const VISITOR_MAX_HITS = 30;
const RESET_WINDOW_MS = 3_600_000;
const RESET_MAX_HITS = 6;
const PUB_TKT_MAX_HITS = 15;
const HONEY_MAX_HITS = 5;
// Guardia rápida por visitante en borde respaldada por rate_limits persistente en PostgreSQL (Supabase auth-otp)
const visitorHits = new Map();

function getVisitorIp(req) {
  const raw =
    String(req.headers['x-vercel-forwarded-for'] || '').split(',')[0].trim() ||
    String(req.headers['x-real-ip'] || '').trim() ||
    'visitor';
  return /^[0-9a-fA-F:.]{3,64}$/.test(raw) ? raw : 'visitor';
}

function consumeBucket(key, windowMs, maxHits) {
  const now = Date.now();
  const prev = (visitorHits.get(key) || []).filter((t) => now - t < windowMs);
  if (prev.length >= maxHits) {
    visitorHits.set(key, prev);
    return false;
  }
  prev.push(now);
  visitorHits.set(key, prev);
  if (visitorHits.size > 1500) {
    for (const [k, arr] of visitorHits.entries()) {
      if (!arr.length || now - arr[arr.length - 1] >= RESET_WINDOW_MS) visitorHits.delete(k);
    }
  }
  return true;
}

const ALLOWED_HOSTS = new Set(
  [
    'indiserv-web3d.vercel.app',
    String(process.env.VERCEL_URL || '').trim().toLowerCase(),
    String(process.env.VERCEL_BRANCH_URL || '').trim().toLowerCase(),
    String(process.env.VERCEL_PROJECT_PRODUCTION_URL || '').trim().toLowerCase(),
    ...String(process.env.ALLOWED_PROXY_HOSTS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase()),
  ].filter(Boolean)
);

function parseCookies(cookieHeader) {
  const map = {};
  if (!cookieHeader) return map;
  for (const part of String(cookieHeader).split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    map[k] = decodeURIComponent(v);
  }
  return map;
}

function buildSetCookie(value, maxAgeSec) {
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSec}`;
}

function checkVisitorRateLimit(ip, action) {
  if (!consumeBucket(`all:${ip}`, VISITOR_WINDOW_MS, VISITOR_MAX_HITS)) {
    return false;
  }
  if (action === 'password_reset_init') {
    return consumeBucket(`reset:${ip}`, RESET_WINDOW_MS, RESET_MAX_HITS);
  }
  if (action === 'ticket_get_public') {
    return consumeBucket(`pub:${ip}`, VISITOR_WINDOW_MS, PUB_TKT_MAX_HITS);
  }
  if (action === 'honey_alert') {
    return consumeBucket(`honey:${ip}`, VISITOR_WINDOW_MS, HONEY_MAX_HITS);
  }
  return true;
}

export default async function handler(req, res) {
  // Nunca cachear respuestas autenticadas ni tokens en navegador o proxies
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Vary', 'Origin, Cookie');

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Método no permitido.' });
    return;
  }

  const origin = String(req.headers.origin || '').trim().toLowerCase();
  const host = String(req.headers.host || '').trim().toLowerCase();
  const fetchSite = String(req.headers['sec-fetch-site'] || '').trim().toLowerCase();

  // Validación estricta de Host en lista blanca + Origin HTTPS exacto (anti-CSRF / anti-Host-injection)
  if (!host || !ALLOWED_HOSTS.has(host) || !origin || origin !== `https://${host}`) {
    res.status(403).json({ ok: false, error: 'Origen HTTPS no autorizado.' });
    return;
  }
  if (fetchSite && fetchSite !== 'same-origin') {
    res.status(403).json({ ok: false, error: 'Solicitud cross-site bloqueada.' });
    return;
  }

  let payload = req.body;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      res.status(400).json({ ok: false, error: 'JSON inválido.' });
      return;
    }
  }
  if (!payload || typeof payload !== 'object') {
    res.status(400).json({ ok: false, error: 'Payload inválido.' });
    return;
  }

  const visitorIp = getVisitorIp(req);
  const action = String(payload.action || '').trim();
  if (!checkVisitorRateLimit(visitorIp, action)) {
    res.status(429).json({ ok: false, error: 'Demasiadas solicitudes desde tu conexión. Espera 60 s.' });
    return;
  }

  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = String(cookies[COOKIE_NAME] || '').trim();

  // Inyectar session_token desde la cookie HttpOnly si el cliente no envía uno explícito
  const outbound = { ...payload };
  if (cookieToken && (!outbound.session_token || outbound.session_token === '__HTTPONLY_COOKIE__')) {
    outbound.session_token = cookieToken;
  } else if (outbound.session_token === '__HTTPONLY_COOKIE__') {
    delete outbound.session_token;
  }

  const baseSupabase = SUPABASE_URL.replace(/\/$/, '');
  let upstreamUrl = `${baseSupabase}/functions/v1/${action === 'ai_audit' ? 'analizar-dispositivo-ia' : 'auth-otp'}`;
  let upstreamBody = outbound;
  const upstreamHeaders = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    Origin: origin,
  };

  if (action === 'oauth_check_dni') {
    upstreamUrl = `${baseSupabase}/rest/v1/rpc/verificar_dni_pre_oauth`;
    upstreamBody = { p_dni: String(outbound.dni || '').trim() };
  } else if (action === 'oauth_sync') {
    const oauthTok = String(outbound.oauth_access_token || '').trim();
    if (!oauthTok) {
      res.status(400).json({ ok: false, error: 'Token OAuth requerido.' });
      return;
    }
    upstreamUrl = `${baseSupabase}/rest/v1/rpc/oauth_sync_operador`;
    upstreamHeaders.Authorization = `Bearer ${oauthTok}`;
    upstreamBody = {
      p_dni: outbound.p_dni ? String(outbound.p_dni).trim() : null,
      p_nickname: outbound.p_nickname ? String(outbound.p_nickname).trim() : null,
      p_device_hash: outbound.p_device_hash ? String(outbound.p_device_hash).trim() : null,
      p_device_label: outbound.p_device_label ? String(outbound.p_device_label).trim() : null,
    };
  } else if (PROXY_SECRET.length >= 16 && visitorIp !== 'visitor') {
    // Reenviar la IP real verificada del visitante autenticado por secreto compartido Vercel <-> Supabase
    upstreamHeaders['x-proxy-secret'] = PROXY_SECRET;
    upstreamHeaders['x-indiserv-client-ip'] = visitorIp;
  }

  try {
    const upstreamResp = await fetch(upstreamUrl, {
      method: 'POST',
      headers: upstreamHeaders,
      body: JSON.stringify(upstreamBody),
    });

    const data = await upstreamResp.json().catch(() => ({ ok: false, error: `HTTP ${upstreamResp.status}` }));

    const shouldClear =
      action === 'session_logout' ||
      (action === 'account_delete_verify' && data?.ok) ||
      (action === 'device_revoke' && data?.ok && data?.revoked_current) ||
      Boolean(data?.session_expired) ||
      (action === 'session_validate' && !data?.ok);

    if (data && typeof data === 'object' && typeof data.session_token === 'string' && data.session_token.length >= 32) {
      res.setHeader('Set-Cookie', buildSetCookie(data.session_token, 900));
      const sanitized = { ...data, cookie_session: true };
      sanitized.session_token = '__HTTPONLY_COOKIE__';
      res.status(upstreamResp.status).json(sanitized);
      return;
    }

    if (shouldClear) {
      res.setHeader('Set-Cookie', buildSetCookie('', 0));
    }

    res.status(upstreamResp.status).json(data);
  } catch (err) {
    res.status(502).json({
      ok: false,
      error_conexion: `Error de conexión en proxy seguro: ${err?.message || 'Verifique internet'}`,
    });
  }
}
