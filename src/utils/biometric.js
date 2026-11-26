/**
 * biometric.js — Puente JavaScript hacia BiometricAuthPlugin nativo de Android.
 * En Web/Escritorio responde de forma segura { available: false } sin errores.
 */

import { Capacitor, registerPlugin } from '@capacitor/core';

const BiometricAuth = registerPlugin('BiometricAuth');

export function isNativeAndroid() {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch {
    return false;
  }
}

export async function getBiometricStatus() {
  if (!isNativeAndroid()) {
    return { available: false, reason: 'web', hasSavedCredentials: false, nickname: '', dniMask: '' };
  }
  try {
    const res = await BiometricAuth.getStatus();
    return {
      available: Boolean(res?.available),
      reason: String(res?.reason || 'unavailable'),
      hasSavedCredentials: Boolean(res?.hasSavedCredentials),
      nickname: String(res?.nickname || ''),
      dniMask: String(res?.dniMask || ''),
    };
  } catch {
    return { available: false, reason: 'plugin_error', hasSavedCredentials: false, nickname: '', dniMask: '' };
  }
}

export async function enableBiometricLogin({ dni, correo, password_hash, nickname }) {
  if (!isNativeAndroid()) {
    return { ok: false, error: 'Solo disponible en la aplicación Android.' };
  }
  try {
    return await BiometricAuth.enableBiometric({
      dni: String(dni || '').trim(),
      correo: String(correo || '').trim(),
      password_hash: String(password_hash || '').trim(),
      nickname: String(nickname || 'Operador').trim(),
    });
  } catch (err) {
    return { ok: false, error: err?.message || 'No se pudo activar la huella digital.' };
  }
}

export async function authenticateBiometricLogin() {
  if (!isNativeAndroid()) {
    return { ok: false, error: 'Solo disponible en la aplicación Android.' };
  }
  try {
    return await BiometricAuth.authenticate();
  } catch (err) {
    return { ok: false, error: err?.message || 'No se pudo verificar tu huella digital.' };
  }
}

export async function disableBiometricLogin() {
  if (!isNativeAndroid()) {
    return { ok: true };
  }
  try {
    return await BiometricAuth.disableBiometric();
  } catch {
    return { ok: false };
  }
}
