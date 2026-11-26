/**
 * api/auth-proxy.js — Vercel Serverless Function (Same-Origin HttpOnly Cookie Session Proxy)
 *
 * Mantiene el session_token exclusivamente en una cookie HttpOnly + Secure + SameSite=Strict
 * (__Host-indiserv_sess) inaccesible para JavaScript/XSS en el navegador web.
 * Inyecta session_token del lado servidor al llamar a Supabase Edge Functions (auth-otp y analizar-dispositivo-ia).
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Método no permitido.' });
    return;
  }

  const origin = String(req.headers.origin || '').trim();
  const host = String(req.headers.host || '').trim();
  if (origin && host && !origin.endsWith(`://${host}`)) {
    res.status(403).json({ ok: false, error: 'Origen no autorizado.' });
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

  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = String(cookies[COOKIE_NAME] || '').trim();
  const action = String(payload.action || '').trim();

  // Inyectar session_token desde la cookie HttpOnly si el cliente no envía uno explícito
  const outbound = { ...payload };
  if (cookieToken && (!outbound.session_token || outbound.session_token === '__HTTPONLY_COOKIE__')) {
    outbound.session_token = cookieToken;
  } else if (outbound.session_token === '__HTTPONLY_COOKIE__') {
    delete outbound.session_token;
  }

  const targetFn = action === 'ai_audit' ? 'analizar-dispositivo-ia' : 'auth-otp';
  const upstreamUrl = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/${targetFn}`;

  try {
    const upstreamResp = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Origin: origin || `https://${host || 'indiserv-web3d.vercel.app'}`,
      },
      body: JSON.stringify(outbound),
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
