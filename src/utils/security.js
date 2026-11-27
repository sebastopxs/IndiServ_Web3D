/**
 * security.js — Criptografía WebCrypto, Rate-Limiting y Motor de Honeytokens (Web + Android APK)
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import { Device } from '@capacitor/device';
import { supabase } from '../supabaseClient.js';

const SessionVault = registerPlugin('SessionVault');
let _nativeSessionCache = null;

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://pvrfnvrxaxulcxacdino.supabase.co';
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_G7D4dhh3Q2LWzgRnzRRa9A_4ngZ5FiW';
const DEVICE_ID_STORAGE_KEY = '__indiserv_dev_id_v1';
const SESSION_STORAGE_KEY = '__indiserv_session_v1';

export const HONEY_DNIS = new Set(['00000000', '99999999', '12345678', '87654321', '11111111', 'admin', 'root']);
export const HONEY_EMAILS = new Set([
  'admin@indiserv.pe',
  'root@indiserv.pe',
  'soporte@indiserv.pe',
  'security@indiserv.pe',
  'administrator@indiserv.pe',
  'admin@unmsm.edu.pe',
]);
export const HONEY_TICKETS = new Set([
  '0000-ADMIN-ROOT',
  'TKT-ADMIN-MASTER',
  'TKT-BACKUP-DB',
  '9999-TICKET-0000',
]);

const AUTH_GUARD_STORAGE_KEY = '__indiserv_auth_guard_v1';
let failedAttempts = [];
let lockoutUntilMs = 0;

function loadAuthGuardState() {
  try {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(AUTH_GUARD_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.attempts)) {
      failedAttempts = parsed.attempts.filter((n) => typeof n === 'number');
    }
    if (typeof parsed?.lockoutUntilMs === 'number') {
      lockoutUntilMs = parsed.lockoutUntilMs;
    }
  } catch {
    // Fallback a memoria si localStorage está bloqueado
  }
}

function saveAuthGuardState() {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(
      AUTH_GUARD_STORAGE_KEY,
      JSON.stringify({ attempts: failedAttempts, lockoutUntilMs })
    );
  } catch {
    // Fallback silencioso
  }
}

loadAuthGuardState();

function randomHex(bytesLen = 4) {
  const arr = new Uint8Array(bytesLen);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < bytesLen; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

export function generateSecureTicketId(dniOrPrefix, tag = 'MOB') {
  const clean = String(dniOrPrefix || '').trim();
  const pref = clean.length >= 4 ? clean.slice(0, 4) : 'MOB';
  return `${pref}-${tag}-${randomHex(8)}`;
}

export function checkLoginRateLimit() {
  loadAuthGuardState();
  const now = Date.now();
  if (now < lockoutUntilMs) {
    return { allowed: false, waitSeconds: Math.max(1, Math.ceil((lockoutUntilMs - now) / 1000)) };
  }
  return { allowed: true, waitSeconds: 0 };
}

export function recordFailedLogin(dni, correo) {
  loadAuthGuardState();
  const now = Date.now();
  failedAttempts = failedAttempts.filter((t) => now - t < 300_000);
  failedAttempts.push(now);
  if (failedAttempts.length >= 5) {
    lockoutUntilMs = now + 60_000;
    failedAttempts = [];
    saveAuthGuardState();
    triggerHoneytokenAlert('FUERZA_BRUTA_LOGIN', `5 intentos fallidos sobre DNI='${dni}' correo='${correo}'`);
    return { locked: true, waitSeconds: 60 };
  }
  saveAuthGuardState();
  return { locked: false, waitSeconds: 0 };
}

export function resetLoginRateLimit() {
  failedAttempts = [];
  lockoutUntilMs = 0;
  saveAuthGuardState();
}

export function isHoneyCredential(dni, correo = '') {
  const d = String(dni || '').trim().toLowerCase();
  const c = String(correo || '').trim().toLowerCase();
  if (HONEY_DNIS.has(d) || HONEY_EMAILS.has(c)) return true;
  if (['canary', 'honeypot', "' or ", '1=1', 'union select'].some((k) => d.includes(k) || c.includes(k))) {
    return true;
  }
  return false;
}

export function isHoneyTicket(ticketId) {
  const t = String(ticketId || '').trim().toUpperCase();
  if (HONEY_TICKETS.has(t)) return true;
  const low = t.toLowerCase();
  if (["' or ", '1=1', 'union select', '<script', '../', 'admin-root'].some((k) => low.includes(k))) {
    return true;
  }
  return false;
}

export async function triggerHoneytokenAlert(tipo, detalle) {
  const alertId = `HONEY-${randomHex(4)}`;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 110) : 'Web/Android';
  try {
    await callAuthOtp({
      action: 'honey_alert',
      tipo: String(tipo || 'ALERTA').slice(0, 80),
      detalle: `${String(detalle || '').slice(0, 180)} | UA: ${ua}`,
    });
  } catch {
    // Silencioso para no alertar al atacante
  }
  return alertId;
}

export async function fetchHoneytokenAlerts(limit = 15) {
  try {
    const saved = loadSessionToken();
    if (!saved) return [];
    const res = await callAuthOtp({
      action: 'honeytokens_list',
      session_token: saved.token,
      device_hash: saved.deviceHash,
      limit,
    });
    return res?.ok && Array.isArray(res.alerts) ? res.alerts : [];
  } catch {
    return [];
  }
}

export function installBrowserConsoleHoneypot() {
  if (typeof window === 'undefined' || window.__indiservHoneypotInstalled) return;
  window.__indiservHoneypotInstalled = true;

  try {
    Object.defineProperty(window, '__INDISERV_ADMIN_VAULT__', {
      configurable: true,
      get() {
        triggerHoneytokenAlert('DEVTOOLS_CONSOLE_TRAP', 'Acceso a window.__INDISERV_ADMIN_VAULT__ desde consola DevTools');
        return {
          status: 'LOCKED_CANARY',
          masterKey: 'ag_canary_9f8e7d6c5b4a3f2e1d0c',
          adminAccount: 'admin@indiserv.pe',
        };
      },
    });

    window.dumpAllUsers = function () {
      triggerHoneytokenAlert('DEVTOOLS_DUMP_USERS', 'Invocación de window.dumpAllUsers() desde consola DevTools');
      return 'Access Denied — Incident logged (D3-DUC)';
    };
  } catch {
    // Ignore in strict environments
  }
}

async function sha256Hex(raw) {
  const enc = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function getDeviceFingerprint() {
  let isNative = false;
  try {
    isNative = Capacitor.isNativePlatform();
  } catch {
    isNative = false;
  }

  let stableId = '';
  let deviceLabel = 'Web · Navegador';
  const plataforma = isNative ? 'android' : 'web';

  if (isNative) {
    try {
      const [idRes, infoRes] = await Promise.all([Device.getId(), Device.getInfo()]);
      stableId = String(idRes?.identifier || '').trim();
      const model = infoRes?.model || infoRes?.name || 'Android';
      const manuf = infoRes?.manufacturer || '';
      deviceLabel = `Android · ${`${manuf} ${model}`.trim().slice(0, 36)}`;
    } catch {
      // Fallback a UUID local persistente
    }
  }

  if (!stableId) {
    try {
      stableId = localStorage.getItem(DEVICE_ID_STORAGE_KEY) || '';
      if (!stableId) {
        stableId =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `web-${randomHex(8)}`;
        localStorage.setItem(DEVICE_ID_STORAGE_KEY, stableId);
      }
    } catch {
      stableId = `ephemeral-${randomHex(8)}`;
    }
    if (!isNative && typeof navigator !== 'undefined') {
      const ua = navigator.userAgent || '';
      const browser = ua.includes('Edg')
        ? 'Edge'
        : ua.includes('Chrome')
        ? 'Chrome'
        : ua.includes('Firefox')
        ? 'Firefox'
        : ua.includes('Safari')
        ? 'Safari'
        : 'Web';
      deviceLabel = `Web · ${browser}`;
    }
  }

  const deviceHash = await sha256Hex(`INDISERV_DEV_V1::${plataforma}::${stableId}`);
  return { deviceHash, deviceLabel, plataforma };
}

function isNativeAndroidPlatform() {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch {
    return false;
  }
}

function getSessionStorageBackend() {
  try {
    // Nunca persistir session_token en localStorage (ni en Web ni en Android APK)
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
    if (isNativeAndroidPlatform()) {
      return null; // En Android APK se usa exclusivamente SessionVault (AndroidKeyStore AES-256-GCM)
    }
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  }
}

export async function hydrateNativeSession() {
  if (!isNativeAndroidPlatform()) {
    return loadSessionToken();
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
    const res = await SessionVault.loadSession();
    if (res?.ok && res?.token && res?.deviceHash) {
      _nativeSessionCache = { token: String(res.token), deviceHash: String(res.deviceHash) };
      return _nativeSessionCache;
    }
  } catch {
    // Bóveda vacía o no disponible
  }
  _nativeSessionCache = null;
  return null;
}

const CUSTOM_COOKIE_PROXY_HOSTS = new Set(
  String(import.meta.env.VITE_COOKIE_PROXY_HOSTS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

export function isVercelCookieMode() {
  try {
    if (Capacitor.isNativePlatform()) return false;
    if (typeof window === 'undefined') return false;
    if (String(import.meta.env.VITE_USE_COOKIE_PROXY || '').toLowerCase() === 'false') return false;
    const h = String(window.location?.hostname || '').toLowerCase();
    if (window.location?.protocol !== 'https:' || !h || h === 'localhost' || h === '127.0.0.1') {
      return false;
    }
    return (
      String(import.meta.env.VITE_USE_COOKIE_PROXY || '').toLowerCase() === 'true' ||
      h.endsWith('.vercel.app') ||
      CUSTOM_COOKIE_PROXY_HOSTS.has(h)
    );
  } catch {
    return false;
  }
}

export function saveSessionToken(token, deviceHash) {
  try {
    const cleanTok = String(token || '').trim();
    const cleanDev = String(deviceHash || '').trim();
    if (!cleanTok || !cleanDev) return;

    if (isNativeAndroidPlatform()) {
      _nativeSessionCache = { token: cleanTok, deviceHash: cleanDev };
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(SESSION_STORAGE_KEY);
      }
      SessionVault.saveSession({ token: cleanTok, deviceHash: cleanDev }).catch(() => {});
      return;
    }

    const store = getSessionStorageBackend();
    if (!store) return;
    // En producción Web (Vercel), el token real vive en cookie HttpOnly inaccesible a JS
    const storedTok = isVercelCookieMode() ? '__HTTPONLY_COOKIE__' : cleanTok;
    store.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ token: storedTok, deviceHash: cleanDev })
    );
  } catch {
    // Ignore storage errors
  }
}

export function loadSessionToken() {
  try {
    if (isNativeAndroidPlatform()) {
      return _nativeSessionCache;
    }
    const store = getSessionStorageBackend();
    if (!store) return null;
    const raw = store.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.token && parsed?.deviceHash) {
      return { token: String(parsed.token), deviceHash: String(parsed.deviceHash) };
    }
  } catch {
    // Ignore malformed JSON
  }
  return null;
}

export function clearSessionToken() {
  try {
    _nativeSessionCache = null;
    if (isNativeAndroidPlatform()) {
      SessionVault.clearSession().catch(() => {});
    }
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    // Ignore
  }
}

export async function callAuthOtp(payload) {
  const useProxy = isVercelCookieMode();
  const url = useProxy ? '/api/auth-proxy' : `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/auth-otp`;
  const headers = useProxy
    ? { 'Content-Type': 'application/json' }
    : {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      };
  try {
    const resp = await fetch(url, {
      method: 'POST',
      credentials: useProxy ? 'same-origin' : 'omit',
      headers,
      body: JSON.stringify(payload),
    });
    const parsed = await resp.json().catch(() => ({ ok: false, error: `HTTP ${resp.status}` }));
    return {
      ...parsed,
      _httpStatus: resp.status,
      _missingFunction: resp.status === 404,
    };
  } catch (err) {
    return {
      ok: false,
      error_conexion: `Error de conexión: ${err?.message || 'Verifique internet'}`,
    };
  }
}

export async function callAiAudit(telemetry) {
  const saved = loadSessionToken();
  if (!saved) return { error: 'unauthenticated', data: null };
  if (isVercelCookieMode()) {
    const res = await callAuthOtp({
      action: 'ai_audit',
      telemetry,
      device_hash: saved.deviceHash,
    });
    if (res && !res.error && !res.error_conexion && res.nombre_comercial) {
      return { data: res, error: null };
    }
    return { data: null, error: res?.error || res?.error_conexion || 'ai_failed' };
  }
  const { data, error } = await supabase.functions.invoke('analizar-dispositivo-ia', {
    body: {
      telemetry,
      session_token: saved.token,
      device_hash: saved.deviceHash,
    },
  });
  return { data, error };
}

const OAUTH_PKCE_STORAGE_KEY = '__indiserv_oauth_pkce_v1';
export const ANDROID_OAUTH_REDIRECT_URI = 'com.indiserv.analytica://auth-callback';

function base64UrlEncodeBytes(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function generatePkcePair() {
  const raw = new Uint8Array(36);
  crypto.getRandomValues(raw);
  const verifier = base64UrlEncodeBytes(raw);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = base64UrlEncodeBytes(new Uint8Array(digest));
  return { verifier, challenge };
}

export function savePendingOAuthState(data) {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(OAUTH_PKCE_STORAGE_KEY, JSON.stringify({ ...data, ts: Date.now() }));
    }
  } catch {
    // Ignore
  }
}

export function loadPendingOAuthState() {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const raw = sessionStorage.getItem(OAUTH_PKCE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.ts && Date.now() - parsed.ts > 600_000) {
      sessionStorage.removeItem(OAUTH_PKCE_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function cancelPendingSocialOAuth() {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(OAUTH_PKCE_STORAGE_KEY);
    }
  } catch {
    // Ignore
  }
}

export async function verifyDniPreOAuth(dni) {
  const cleanDni = String(dni || '').trim();
  if (!/^\d{8}$/.test(cleanDni)) {
    return {
      ok: false,
      existe: false,
      error: 'Ingrese primero su DNI de 8 dígitos numéricos antes de continuar con Google o GitHub.',
    };
  }
  if (isHoneyCredential(cleanDni, '')) {
    triggerHoneytokenAlert(
      'CREDENCIAL_SENUELO_PRE_OAUTH_MOVIL',
      `Intento pre-OAuth con DNI señuelo '${cleanDni}'`
    );
    return { ok: false, existe: false, error: 'El DNI ingresado no se encuentra registrado en Supabase.' };
  }

  try {
    if (isVercelCookieMode()) {
      const res = await callAuthOtp({ action: 'oauth_check_dni', dni: cleanDni });
      if (res?.error_conexion) return { ok: false, error: res.error_conexion };
      const existe = Boolean(res?.existe || res?.en_padron || res?.ya_registrado);
      return existe
        ? { ok: true, existe: true }
        : { ok: false, existe: false, error: `El DNI ${cleanDni} no figura en la base de datos de Supabase.` };
    }

    const base = SUPABASE_URL.replace(/\/$/, '');
    const resp = await fetch(`${base}/rest/v1/rpc/verificar_dni_pre_oauth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ p_dni: cleanDni }),
    });
    if (!resp.ok) {
      return {
        ok: false,
        error: 'No se pudo verificar el DNI en Supabase (verifique supabase_oauth_setup.sql).',
      };
    }
    const data = await resp.json();
    const existe = Boolean(data?.existe || data?.en_padron || data?.ya_registrado);
    if (!existe) {
      return {
        ok: false,
        existe: false,
        error: `El DNI ${cleanDni} no figura en la base de datos de Supabase (padrón oficial).`,
      };
    }
    return { ok: true, existe: true };
  } catch (err) {
    return { ok: false, error: `Error de red verificando DNI: ${err?.message || 'Verifique internet'}` };
  }
}

export async function checkOAuthProviderEnabled(provider) {
  const prov = String(provider || '').trim().toLowerCase();
  const label = prov === 'google' ? 'Google' : 'GitHub';
  try {
    const resp = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/auth/v1/settings`, {
      headers: { apikey: SUPABASE_ANON_KEY, Accept: 'application/json' },
    });
    if (!resp.ok) return { ok: true, habilitado: true };
    const data = await resp.json();
    if (data?.external && data.external[prov] === false) {
      return {
        ok: false,
        habilitado: false,
        error: `El proveedor ${label} no está habilitado en Supabase (Authentication → Providers → ${label}).`,
      };
    }
    return { ok: true, habilitado: true };
  } catch {
    return { ok: true, habilitado: true };
  }
}

export async function startSocialOAuthFlow(provider, dni) {
  const prov = String(provider || '').trim().toLowerCase();
  if (prov !== 'google' && prov !== 'github') {
    return { ok: false, error: 'Proveedor OAuth no soportado.' };
  }

  const dniChk = await verifyDniPreOAuth(dni);
  if (!dniChk.ok) return dniChk;

  const provChk = await checkOAuthProviderEnabled(prov);
  if (!provChk.ok) return provChk;

  const { verifier, challenge } = await generatePkcePair();
  const isAndroid = isNativeAndroidPlatform();
  const redirectTo = isAndroid
    ? ANDROID_OAUTH_REDIRECT_URI
    : `${window.location.origin}${window.location.pathname}`;

  savePendingOAuthState({ dni: String(dni).trim(), verifier, provider: prov });

  const params = new URLSearchParams({
    provider: prov,
    redirect_to: redirectTo,
    code_challenge: challenge,
    code_challenge_method: 's256',
  });
  if (prov === 'google') params.set('prompt', 'select_account');

  const authUrl = `${SUPABASE_URL.replace(/\/$/, '')}/auth/v1/authorize?${params.toString()}`;

  if (isAndroid) {
    const res = await SessionVault.openExternalAuthUrl({ url: authUrl });
    if (!res?.ok) {
      cancelPendingSocialOAuth();
      return { ok: false, error: res?.error || 'No se pudo abrir el navegador seguro en Android.' };
    }
    return { ok: true, waitingExternalBrowser: true };
  }

  window.location.assign(authUrl);
  return { ok: true, redirectingWeb: true };
}

export async function consumeAndroidPendingOAuthUrl() {
  if (!isNativeAndroidPlatform()) return '';
  try {
    const res = await SessionVault.consumePendingOAuthUrl();
    return res?.ok && res?.url ? String(res.url) : '';
  } catch {
    return '';
  }
}

export async function completeSocialOAuthCallback(rawCallbackUrl, explicitDni = '') {
  const pending = loadPendingOAuthState();
  const targetUrl = String(rawCallbackUrl || '').trim();
  if (!targetUrl) return null;

  let qsParams;
  let hashParams;
  try {
    const u = new URL(targetUrl);
    qsParams = u.searchParams;
    hashParams = new URLSearchParams(u.hash ? u.hash.slice(1) : '');
  } catch {
    return null;
  }

  const err = qsParams.get('error') || hashParams.get('error') || '';
  const errDesc = qsParams.get('error_description') || hashParams.get('error_description') || '';
  const code = qsParams.get('code') || hashParams.get('code') || '';
  let accessToken = qsParams.get('access_token') || hashParams.get('access_token') || '';

  if (!err && !code && !accessToken) {
    return null;
  }

  if (!isNativeAndroidPlatform() && typeof window !== 'undefined' && window.history?.replaceState) {
    window.history.replaceState(null, '', window.location.pathname);
  }

  if (err) {
    cancelPendingSocialOAuth();
    return { ok: false, error: errDesc || err || 'Autorización OAuth cancelada.' };
  }

  const base = SUPABASE_URL.replace(/\/$/, '');
  let userObj = null;

  try {
    if (code) {
      const verifier = String(pending?.verifier || '').trim();
      if (!verifier) {
        cancelPendingSocialOAuth();
        return { ok: false, error: 'La sesión PKCE expiró. Inicie nuevamente con su DNI.' };
      }
      const tokResp = await fetch(`${base}/auth/v1/token?grant_type=pkce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
      });
      const tokJson = await tokResp.json().catch(() => ({}));
      if (!tokResp.ok || !tokJson?.access_token) {
        cancelPendingSocialOAuth();
        return {
          ok: false,
          error: tokJson?.msg || tokJson?.error_description || 'No se pudo canjear el código OAuth.',
        };
      }
      accessToken = String(tokJson.access_token);
      userObj = tokJson.user || null;
    }

    if (!userObj && accessToken) {
      const uResp = await fetch(`${base}/auth/v1/user`, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
      });
      if (uResp.ok) userObj = await uResp.json();
    }

    const meta = userObj?.user_metadata || {};
    const email = String(userObj?.email || meta.email || '').trim().toLowerCase();
    const nickname = String(
      meta.full_name || meta.name || meta.preferred_username || meta.user_name || email.split('@')[0] || 'Operador'
    )
      .trim()
      .slice(0, 40);

    const dniToSync = String(explicitDni || pending?.dni || '').trim();
    const dev = await getDeviceFingerprint();

    let syncData;
    if (isVercelCookieMode()) {
      syncData = await callAuthOtp({
        action: 'oauth_sync',
        oauth_access_token: accessToken,
        p_dni: dniToSync || null,
        p_nickname: nickname,
        p_device_hash: dev.deviceHash,
        p_device_label: dev.deviceLabel,
      });
    } else {
      const syncResp = await fetch(`${base}/rest/v1/rpc/oauth_sync_operador`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          p_dni: dniToSync || null,
          p_nickname: nickname,
          p_device_hash: dev.deviceHash,
          p_device_label: dev.deviceLabel,
        }),
      });
      syncData = await syncResp.json().catch(() => ({ ok: false, error: `HTTP ${syncResp.status}` }));
    }

    cancelPendingSocialOAuth();

    if (syncData?.ok && syncData?.status === 'needs_dni') {
      return {
        ok: true,
        needsDni: true,
        oauthAccessToken: accessToken,
        correo: email,
        nickname,
        provider: pending?.provider || 'google',
      };
    }

    if (syncData?.ok && syncData?.status === 'authenticated' && syncData?.user) {
      if (syncData.session_token) {
        saveSessionToken(syncData.session_token, dev.deviceHash);
      }
      return {
        ok: true,
        authenticated: true,
        user: syncData.user,
        sessionToken: syncData.session_token || '',
        deviceHash: dev.deviceHash,
      };
    }

    return {
      ok: false,
      error: syncData?.error || syncData?.error_conexion || 'No se pudo vincular la cuenta social con el DNI.',
    };
  } catch (err) {
    cancelPendingSocialOAuth();
    return { ok: false, error: `Error completando OAuth: ${err?.message || 'Verifique internet'}` };
  }
}
