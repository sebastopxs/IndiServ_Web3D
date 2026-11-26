/**
 * security.js — Criptografía WebCrypto, Rate-Limiting y Motor de Honeytokens (Web + Android APK)
 */

import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';
import { supabase } from '../supabaseClient.js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://pvrfnvrxaxulcxacdino.supabase.co';
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_G7D4dhh3Q2LWzgRnzRRa9A_4ngZ5FiW';
const DEVICE_ID_STORAGE_KEY = '__indiserv_dev_id_v1';
const SESSION_STORAGE_KEY = '__indiserv_session_v1';

const HASH_PREFIX = 'indiserv_v1$';
const HASH_SALT_NAMESPACE = 'INDISERV_SALT_2026';

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

export async function hashPassword(dni, password) {
  const cleanDni = String(dni || '').trim();
  const cleanPass = String(password || '');
  if (cleanPass.startsWith(HASH_PREFIX)) return cleanPass;

  const raw = `${HASH_SALT_NAMESPACE}::${cleanDni}::${cleanPass}`;
  const enc = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${HASH_PREFIX}${hex}`;
}

export async function verifyPassword(dni, plainPassword, storedHash) {
  if (!storedHash || !plainPassword) return { valid: false, needsMigration: false };
  const expected = await hashPassword(dni, plainPassword);
  if (storedHash.startsWith(HASH_PREFIX)) {
    return { valid: storedHash === expected, needsMigration: false };
  }
  const legacyValid = storedHash === plainPassword;
  return { valid: legacyValid, needsMigration: legacyValid };
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

export function saveSessionToken(token, deviceHash) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ token: String(token), deviceHash: String(deviceHash) })
    );
  } catch {
    // Ignore storage errors
  }
}

export function loadSessionToken() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
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
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    // Ignore
  }
}

export async function callAuthOtp(payload) {
  const url = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/auth-otp`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
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
