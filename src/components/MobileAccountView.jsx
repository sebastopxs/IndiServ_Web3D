/**
 * MobileAccountView.jsx — Sección "Mi Cuenta" para Web3D y APK Android.
 * Permite gestionar foto de perfil (comprimida 192×192 <= 60 KB), cambiar contraseña
 * con doble factor OTP por Brevo, eliminar cuenta + tickets en cascada y revisar la Política v2.0.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  User,
  Camera,
  Trash2,
  KeyRound,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  FileText,
  X,
  LogIn,
  Laptop,
  Ticket,
  ChevronDown,
  ChevronRight,
  Lock,
  Fingerprint,
  Monitor,
  Smartphone,
  Globe,
  RefreshCw,
} from 'lucide-react';
import {
  callAuthOtp,
  getDeviceFingerprint,
  hashPassword,
  loadSessionToken,
  saveSessionToken,
} from '../utils/security';
import {
  getBiometricStatus,
  enableBiometricLogin,
  disableBiometricLogin,
  isNativeAndroid,
} from '../utils/biometric';
import { POLITICA_PRIVACIDAD_TEXTO, VERSION_POLITICA } from '../utils/legalPolicy';

/**
 * Recorta a 192×192 y comprime localmente a WebP/JPEG (<= 60 KB) antes de enviar a auth-otp.
 */
function compressAvatarFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith('image/')) {
      reject(new Error('Seleccione un archivo de imagen válido (PNG, JPEG o WebP).'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo seleccionado.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('No se pudo decodificar la imagen.'));
      img.onload = () => {
        const size = 192;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const minSide = Math.min(img.width, img.height);
        const sx = (img.width - minSide) / 2;
        const sy = (img.height - minSide) / 2;
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);

        const attempts = [
          ['image/webp', 0.82],
          ['image/webp', 0.68],
          ['image/jpeg', 0.8],
          ['image/jpeg', 0.62],
          ['image/jpeg', 0.45],
        ];
        for (const [mime, q] of attempts) {
          const uri = canvas.toDataURL(mime, q);
          if (!uri.startsWith(`data:${mime};base64,`)) continue;
          const approxBytes = Math.floor(((uri.length - uri.indexOf(',') - 1) * 3) / 4);
          if (approxBytes <= 60_000) {
            resolve(uri);
            return;
          }
        }
        reject(new Error('La imagen supera el límite de 60 KB tras compresión.'));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export default function MobileAccountView({
  user,
  onUserUpdated,
  onAccountDeleted,
  onSessionExpired,
  onRequestLogin,
}) {
  const fileInputRef = useRef(null);
  const [profileStats, setProfileStats] = useState({
    dispositivos_confiables: null,
    tickets_count: null,
  });
  const [showPolicyModal, setShowPolicyModal] = useState(false);
  // Secciones sensibles colapsadas por defecto (acordeón limpio en APK y Web)
  const [openSection, setOpenSection] = useState(null); // null | 'devices' | 'biometric' | 'password' | 'delete'
  const toggleSection = (key) => setOpenSection((prev) => (prev === key ? null : key));

  // Trusted devices state
  const [devices, setDevices] = useState([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [devicesBusyId, setDevicesBusyId] = useState('');
  const [devicesMsg, setDevicesMsg] = useState({ type: '', text: '' });

  // Biometric fingerprint state (solo APK Android)
  const nativeAndroid = isNativeAndroid();
  const [bioStatus, setBioStatus] = useState({
    available: false,
    reason: 'web',
    hasSavedCredentials: false,
    nickname: '',
    dniMask: '',
  });
  const [bioPwd, setBioPwd] = useState('');
  const [bioBusy, setBioBusy] = useState(false);
  const [bioMsg, setBioMsg] = useState({ type: '', text: '' });

  // Avatar state
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarMsg, setAvatarMsg] = useState({ type: '', text: '' });

  // Change password state
  const [curPwd, setCurPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [repPwd, setRepPwd] = useState('');
  const [pwdChallenge, setPwdChallenge] = useState(null);
  const [pwdOtp, setPwdOtp] = useState('');
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdMsg, setPwdMsg] = useState({ type: '', text: '' });

  // Delete account state
  const [delPwd, setDelPwd] = useState('');
  const [delConfirm, setDelConfirm] = useState('');
  const [delChallenge, setDelChallenge] = useState(null);
  const [delOtp, setDelOtp] = useState('');
  const [delBusy, setDelBusy] = useState(false);
  const [delMsg, setDelMsg] = useState({ type: '', text: '' });

  useEffect(() => {
    if (!user) return;
    const saved = loadSessionToken();
    if (!saved) return;
    let active = true;
    callAuthOtp({
      action: 'profile_get',
      session_token: saved.token,
      device_hash: saved.deviceHash,
    })
      .then((res) => {
        if (!active) return;
        if (res?.session_expired) {
          onSessionExpired?.();
          return;
        }
        if (res?.ok && res?.user) {
          setProfileStats({
            dispositivos_confiables: res.user.dispositivos_confiables ?? 0,
            tickets_count: res.user.tickets_count ?? 0,
          });
          onUserUpdated?.({
            nickname: res.user.nickname,
            correo: res.user.correo,
            avatar_data: res.user.avatar_data || null,
          });
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [user?.dni]);

  useEffect(() => {
    if (!nativeAndroid) return;
    let active = true;
    getBiometricStatus().then((st) => {
      if (active) setBioStatus(st);
    });
    return () => {
      active = false;
    };
  }, [nativeAndroid, user?.dni]);

  const loadTrustedDevices = async () => {
    const saved = loadSessionToken();
    if (!saved) {
      onSessionExpired?.();
      return;
    }
    setDevicesLoading(true);
    setDevicesMsg({ type: '', text: '' });
    try {
      const res = await callAuthOtp({
        action: 'devices_list',
        session_token: saved.token,
        device_hash: saved.deviceHash,
      });
      if (res?.session_expired) {
        onSessionExpired?.();
        return;
      }
      if (res?.ok) {
        const list = Array.isArray(res.devices) ? res.devices : [];
        setDevices(list);
        setProfileStats((prev) => ({ ...prev, dispositivos_confiables: list.length }));
      } else {
        setDevicesMsg({
          type: 'err',
          text: res?.error || res?.error_conexion || 'No se pudieron cargar los equipos confiables.',
        });
      }
    } finally {
      setDevicesLoading(false);
    }
  };

  useEffect(() => {
    if (openSection === 'devices' && user) {
      loadTrustedDevices();
    }
  }, [openSection, user?.dni]);

  const handleRevokeDevice = async (devItem) => {
    const saved = loadSessionToken();
    if (!saved || devicesBusyId) return;
    setDevicesBusyId(devItem.id);
    setDevicesMsg({ type: '', text: '' });
    try {
      const res = await callAuthOtp({
        action: 'device_revoke',
        session_token: saved.token,
        device_hash: saved.deviceHash,
        device_id: devItem.id,
      });
      if (res?.session_expired) {
        onSessionExpired?.();
        return;
      }
      if (res?.ok) {
        if (res.revoked_current) {
          await disableBiometricLogin();
          onSessionExpired?.();
          return;
        }
        setDevices((prev) => {
          const next = prev.filter((x) => x.id !== devItem.id);
          setProfileStats((ps) => ({ ...ps, dispositivos_confiables: next.length }));
          return next;
        });
        setDevicesMsg({
          type: 'ok',
          text: `Se quitó el acceso a ${res.device_label || devItem.device_label}.`,
        });
      } else {
        setDevicesMsg({
          type: 'err',
          text: res?.error || res?.error_conexion || 'No se pudo revocar el dispositivo.',
        });
      }
    } finally {
      setDevicesBusyId('');
    }
  };

  const handleEnableBiometric = async (e) => {
    e.preventDefault();
    if (!user?.dni || bioBusy) return;
    setBioMsg({ type: '', text: '' });
    const cleanPwd = bioPwd.trim();
    if (!cleanPwd) {
      setBioMsg({ type: 'err', text: 'Ingresa tu contraseña actual para vincular la huella.' });
      return;
    }
    setBioBusy(true);
    try {
      const dev = await getDeviceFingerprint();
      const hashed = await hashPassword(user.dni, cleanPwd);
      const check = await callAuthOtp({
        action: 'login_init',
        dni: user.dni,
        correo: user.correo,
        password_hash: hashed,
        device_hash: dev.deviceHash,
        device_label: dev.deviceLabel,
        plataforma: dev.plataforma,
      });
      if (check?.error_conexion) {
        setBioMsg({ type: 'err', text: check.error_conexion });
        return;
      }
      if (!check?.ok) {
        setBioMsg({ type: 'err', text: check?.error || 'Contraseña actual incorrecta.' });
        return;
      }
      if (check.session_token) {
        saveSessionToken(check.session_token, dev.deviceHash);
      }
      const bioRes = await enableBiometricLogin({
        dni: user.dni,
        correo: user.correo,
        password_hash: hashed,
        nickname: user.nickname || 'Operador',
      });
      if (bioRes?.ok) {
        setBioPwd('');
        const st = await getBiometricStatus();
        setBioStatus(st);
        setBioMsg({
          type: 'ok',
          text: 'Huella digital activada. La próxima vez podrás ingresar con un solo toque.',
        });
      } else if (!bioRes?.cancelled) {
        setBioMsg({ type: 'err', text: bioRes?.error || 'No se pudo activar la huella digital.' });
      }
    } finally {
      setBioBusy(false);
    }
  };

  const handleDisableBiometric = async () => {
    if (bioBusy) return;
    setBioBusy(true);
    setBioMsg({ type: '', text: '' });
    try {
      await disableBiometricLogin();
      const st = await getBiometricStatus();
      setBioStatus(st);
      setBioMsg({ type: 'ok', text: 'Acceso con huella digital desactivado en este teléfono.' });
    } finally {
      setBioBusy(false);
    }
  };

  const handleAvatarSelected = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const saved = loadSessionToken();
    if (!saved) {
      onSessionExpired?.();
      return;
    }
    setAvatarBusy(true);
    setAvatarMsg({ type: '', text: '' });
    try {
      const dataUri = await compressAvatarFile(file);
      const res = await callAuthOtp({
        action: 'profile_update_avatar',
        session_token: saved.token,
        device_hash: saved.deviceHash,
        avatar_data: dataUri,
      });
      if (res?.session_expired) {
        onSessionExpired?.();
        return;
      }
      if (res?.ok) {
        onUserUpdated?.({ avatar_data: res.avatar_data || null });
        setAvatarMsg({ type: 'ok', text: 'Foto de perfil actualizada correctamente.' });
      } else {
        setAvatarMsg({ type: 'err', text: res?.error || res?.error_conexion || 'No se pudo subir la foto.' });
      }
    } catch (err) {
      setAvatarMsg({ type: 'err', text: err?.message || 'Error al procesar imagen.' });
    } finally {
      setAvatarBusy(false);
    }
  };

  const handleRemoveAvatar = async () => {
    const saved = loadSessionToken();
    if (!saved) {
      onSessionExpired?.();
      return;
    }
    setAvatarBusy(true);
    setAvatarMsg({ type: '', text: '' });
    try {
      const res = await callAuthOtp({
        action: 'profile_update_avatar',
        session_token: saved.token,
        device_hash: saved.deviceHash,
        avatar_data: null,
      });
      if (res?.session_expired) {
        onSessionExpired?.();
        return;
      }
      if (res?.ok) {
        onUserUpdated?.({ avatar_data: null });
        setAvatarMsg({ type: 'ok', text: 'Foto de perfil retirada.' });
      } else {
        setAvatarMsg({ type: 'err', text: res?.error || 'No se pudo quitar la foto.' });
      }
    } finally {
      setAvatarBusy(false);
    }
  };

  const handlePwdInit = async (e) => {
    e.preventDefault();
    setPwdMsg({ type: '', text: '' });
    if (!curPwd.trim() || !newPwd.trim() || !repPwd.trim()) {
      setPwdMsg({ type: 'err', text: 'Complete todos los campos de contraseña.' });
      return;
    }
    if (newPwd.trim().length < 8) {
      setPwdMsg({ type: 'err', text: 'La nueva contraseña debe tener al menos 8 caracteres.' });
      return;
    }
    if (newPwd.trim() !== repPwd.trim()) {
      setPwdMsg({ type: 'err', text: 'Las nuevas contraseñas no coinciden.' });
      return;
    }
    if (curPwd.trim() === newPwd.trim()) {
      setPwdMsg({ type: 'err', text: 'La nueva contraseña debe ser diferente a la actual.' });
      return;
    }
    const saved = loadSessionToken();
    if (!saved) {
      onSessionExpired?.();
      return;
    }
    setPwdBusy(true);
    try {
      const dev = await getDeviceFingerprint();
      const [curHash, newHash] = await Promise.all([
        hashPassword(user.dni, curPwd.trim()),
        hashPassword(user.dni, newPwd.trim()),
      ]);
      const res = await callAuthOtp({
        action: 'password_change_init',
        session_token: saved.token,
        device_hash: saved.deviceHash,
        device_label: dev.deviceLabel,
        current_password_hash: curHash,
        new_password_hash: newHash,
      });
      if (res?.session_expired) {
        onSessionExpired?.();
        return;
      }
      if (res?.ok && res?.challenge_id) {
        setPwdChallenge({
          challengeId: res.challenge_id,
          maskedEmail: res.masked_email || user.correo,
        });
        setPwdOtp('');
        setPwdMsg({
          type: 'ok',
          text: `Código de 6 dígitos enviado a ${res.masked_email || user.correo}. Ingrésalo para confirmar.`,
        });
      } else {
        setPwdMsg({ type: 'err', text: res?.error || res?.error_conexion || 'No se pudo iniciar el cambio.' });
      }
    } finally {
      setPwdBusy(false);
    }
  };

  const handlePwdVerify = async (e) => {
    e.preventDefault();
    if (!pwdChallenge) return;
    setPwdMsg({ type: '', text: '' });
    if (!/^\d{6}$/.test(pwdOtp.trim())) {
      setPwdMsg({ type: 'err', text: 'Ingrese exactamente 6 dígitos numéricos.' });
      return;
    }
    const saved = loadSessionToken();
    if (!saved) {
      onSessionExpired?.();
      return;
    }
    setPwdBusy(true);
    try {
      const res = await callAuthOtp({
        action: 'password_change_verify',
        session_token: saved.token,
        device_hash: saved.deviceHash,
        challenge_id: pwdChallenge.challengeId,
        code: pwdOtp.trim(),
      });
      if (res?.session_expired) {
        onSessionExpired?.();
        return;
      }
      if (res?.ok) {
        await disableBiometricLogin();
        if (nativeAndroid) getBiometricStatus().then(setBioStatus).catch(() => {});
        setPwdChallenge(null);
        setCurPwd('');
        setNewPwd('');
        setRepPwd('');
        setPwdOtp('');
        setPwdMsg({
          type: 'ok',
          text: 'Contraseña actualizada. Se cerraron tus demás sesiones activas y enviamos un aviso a tu correo.',
        });
      } else {
        setPwdMsg({ type: 'err', text: res?.error || res?.error_conexion || 'Código incorrecto o expirado.' });
      }
    } finally {
      setPwdBusy(false);
    }
  };

  const handleDeleteInit = async (e) => {
    e.preventDefault();
    setDelMsg({ type: '', text: '' });
    if (!delPwd.trim()) {
      setDelMsg({ type: 'err', text: 'Ingrese su contraseña actual para continuar.' });
      return;
    }
    const conf = delConfirm.trim().toUpperCase();
    if (!['ELIMINAR', 'ELIMINAR MI CUENTA', String(user?.dni || '').toUpperCase()].includes(conf)) {
      setDelMsg({ type: 'err', text: 'Escriba ELIMINAR para habilitar la solicitud.' });
      return;
    }
    const saved = loadSessionToken();
    if (!saved) {
      onSessionExpired?.();
      return;
    }
    setDelBusy(true);
    try {
      const dev = await getDeviceFingerprint();
      const curHash = await hashPassword(user.dni, delPwd.trim());
      const res = await callAuthOtp({
        action: 'account_delete_init',
        session_token: saved.token,
        device_hash: saved.deviceHash,
        device_label: dev.deviceLabel,
        current_password_hash: curHash,
        confirm_text: conf,
      });
      if (res?.session_expired) {
        onSessionExpired?.();
        return;
      }
      if (res?.ok && res?.challenge_id) {
        setDelChallenge({
          challengeId: res.challenge_id,
          maskedEmail: res.masked_email || user.correo,
        });
        setDelOtp('');
        setDelMsg({
          type: 'ok',
          text: `Código IRREVERSIBLE enviado a ${res.masked_email || user.correo}. Ingrésalo abajo para borrar cuenta y tickets.`,
        });
      } else {
        setDelMsg({ type: 'err', text: res?.error || res?.error_conexion || 'No se pudo solicitar el borrado.' });
      }
    } finally {
      setDelBusy(false);
    }
  };

  const handleDeleteVerify = async (e) => {
    e.preventDefault();
    if (!delChallenge) return;
    setDelMsg({ type: '', text: '' });
    if (!/^\d{6}$/.test(delOtp.trim())) {
      setDelMsg({ type: 'err', text: 'Ingrese exactamente 6 dígitos numéricos.' });
      return;
    }
    const saved = loadSessionToken();
    if (!saved) {
      onSessionExpired?.();
      return;
    }
    setDelBusy(true);
    try {
      const res = await callAuthOtp({
        action: 'account_delete_verify',
        session_token: saved.token,
        device_hash: saved.deviceHash,
        challenge_id: delChallenge.challengeId,
        code: delOtp.trim(),
      });
      if (res?.session_expired) {
        onSessionExpired?.();
        return;
      }
      if (res?.ok) {
        await disableBiometricLogin();
        onAccountDeleted?.(res.tickets_eliminados ?? 0);
      } else {
        setDelMsg({ type: 'err', text: res?.error || res?.error_conexion || 'Código incorrecto o expirado.' });
      }
    } finally {
      setDelBusy(false);
    }
  };

  const initials = String(user?.nickname || user?.dni || 'OP').trim().slice(0, 2).toUpperCase();

  return (
    <div className="h-full overflow-y-auto bg-[#090c12] px-4 py-5 pb-24 md:pb-8">
      <div className="mx-auto w-full md:max-w-none xl:max-w-[1440px] space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-400">
              Identidad y Privacidad ARCO
            </p>
            <h1 className="text-xl font-semibold text-white">Mi Cuenta y Seguridad</h1>
          </div>
        </header>

        {!user ? (
          <div className="instrument-card rounded-2xl p-6 text-center space-y-3 max-w-lg mx-auto">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-cyan-500/12 border border-cyan-500/30 flex items-center justify-center">
              <User className="w-7 h-7 text-cyan-400" />
            </div>
            <h2 className="text-base font-semibold text-white">Modo Explorador sin Cuenta</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              Inicia sesión con tu cuenta verificada para subir tu foto de perfil, cambiar tu contraseña con OTP o gestionar tus datos personales.
            </p>
            {onRequestLogin && (
              <button
                type="button"
                onClick={onRequestLogin}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#03160f] font-semibold text-xs"
              >
                <LogIn className="w-4 h-4" /> Iniciar Sesión / Registrarse
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* COLUMNA IZQUIERDA: PERFIL Y FOTO */}
            <section className="lg:col-span-5 instrument-card rounded-2xl p-5 space-y-4">
              <div className="flex items-center gap-4">
                <div className="relative w-20 h-20 rounded-full overflow-hidden bg-[#192235] border-2 border-cyan-500/40 flex items-center justify-center shrink-0">
                  {user.avatar_data ? (
                    <img
                      src={user.avatar_data}
                      alt="Avatar de operador"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-xl font-bold text-cyan-300 font-mono">{initials}</span>
                  )}
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-white truncate">{user.nickname || 'Operador'}</h2>
                  <p className="text-xs text-cyan-300 truncate">{user.correo}</p>
                  <span className="inline-block mt-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/12 text-emerald-300 border border-emerald-500/25">
                    DNI {user.dni} · Sesión 15 min
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setOpenSection('devices')}
                  className="text-left bg-[#101521] hover:bg-[#141c2d] border border-slate-800 hover:border-cyan-500/40 rounded-xl p-3 transition-colors"
                >
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-400">
                    <Laptop className="w-3.5 h-3.5 text-cyan-400" /> Equipos Confiables
                  </div>
                  <p className="text-lg font-semibold text-white font-mono mt-1">
                    {profileStats.dispositivos_confiables ?? '—'}
                  </p>
                </button>
                <div className="bg-[#101521] border border-slate-800 rounded-xl p-3">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-400">
                    <Ticket className="w-3.5 h-3.5 text-emerald-400" /> Tickets Privados
                  </div>
                  <p className="text-lg font-semibold text-white font-mono mt-1">
                    {profileStats.tickets_count ?? '—'}
                  </p>
                </div>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleAvatarSelected}
                className="hidden"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={avatarBusy}
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 py-2.5 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#03160f] font-semibold text-xs inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  <Camera className="w-4 h-4" />
                  {avatarBusy ? 'Guardando…' : 'Subir / Cambiar Foto'}
                </button>
                {user.avatar_data && (
                  <button
                    type="button"
                    disabled={avatarBusy}
                    onClick={handleRemoveAvatar}
                    className="py-2.5 px-3 rounded-xl bg-[#192235] hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs inline-flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Quitar
                  </button>
                )}
              </div>

              {avatarMsg.text && (
                <div
                  className={`flex items-start gap-2 text-xs rounded-xl p-2.5 border ${
                    avatarMsg.type === 'ok'
                      ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25'
                      : 'text-rose-300 bg-rose-500/10 border-rose-500/25'
                  }`}
                >
                  {avatarMsg.type === 'ok' ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  )}
                  <span>{avatarMsg.text}</span>
                </div>
              )}

              <p className="text-[11px] text-slate-400 leading-relaxed bg-[#101521] border border-slate-800/80 rounded-xl p-3">
                La foto se comprime en tu dispositivo a 192×192 px (≤ 60 KB), se valida por firma binaria (magic bytes) en servidor y se elimina al instante si la retiras o borras tu cuenta.
              </p>
            </section>

            {/* COLUMNA DERECHA: MENÚ DESPLEGABLE DE SEGURIDAD Y PRIVACIDAD */}
            <div className="lg:col-span-7 space-y-3">
              <div className="flex items-center gap-2 px-1">
                <Lock className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Seguridad y Opciones Avanzadas
                </span>
              </div>

              {/* DESPLEGABLE 0A: EQUIPOS CONFIABLES */}
              <section className="instrument-card rounded-2xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleSection('devices')}
                  aria-expanded={openSection === 'devices'}
                  className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left hover:bg-white/[0.02]"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-cyan-500/12 border border-cyan-500/25 flex items-center justify-center shrink-0">
                      <Laptop className="w-4 h-4 text-cyan-400" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold text-white">Equipos Confiables</h2>
                      <p className="text-[11px] text-slate-400 truncate">
                        Ver dispositivos autorizados y quitar acceso al instante
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {profileStats.dispositivos_confiables != null && (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                        {profileStats.dispositivos_confiables}
                      </span>
                    )}
                    {openSection === 'devices' ? (
                      <ChevronDown className="w-4 h-4 text-cyan-400 shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                    )}
                  </div>
                </button>

                {openSection === 'devices' && (
                  <div className="px-5 pb-5 pt-2 border-t border-slate-800/80 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] text-slate-400">
                        Al quitar un equipo se cierran sus sesiones y pedirá código OTP si vuelve a ingresar.
                      </p>
                      <button
                        type="button"
                        disabled={devicesLoading}
                        onClick={loadTrustedDevices}
                        className="p-2 rounded-lg bg-[#101521] hover:bg-slate-800 border border-slate-700 text-cyan-300 shrink-0 disabled:opacity-50"
                        title="Actualizar lista"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${devicesLoading ? 'animate-spin' : ''}`} />
                      </button>
                    </div>

                    {devicesLoading && devices.length === 0 ? (
                      <p className="text-xs text-slate-400 py-3 text-center">Consultando equipos confiables…</p>
                    ) : devices.length === 0 ? (
                      <p className="text-xs text-slate-400 py-3 text-center">No hay equipos confiables registrados.</p>
                    ) : (
                      <div className="space-y-2">
                        {devices.map((dev) => {
                          const plat = String(dev.plataforma || 'desktop').toLowerCase();
                          const IconPlat = plat === 'android' ? Smartphone : plat === 'web' ? Globe : Monitor;
                          const usoFmt = dev.ultimo_uso
                            ? new Date(dev.ultimo_uso).toLocaleString('es-ES', {
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : 'Reciente';
                          return (
                            <div
                              key={dev.id}
                              className={`flex items-center justify-between gap-2.5 p-3 rounded-xl bg-[#101521] border ${
                                dev.is_current ? 'border-cyan-500/40' : 'border-slate-800'
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="w-8 h-8 rounded-lg bg-[#192235] border border-slate-700/80 flex items-center justify-center shrink-0">
                                  <IconPlat className="w-4 h-4 text-cyan-300" />
                                </div>
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="text-xs font-semibold text-white truncate">
                                      {dev.device_label}
                                    </span>
                                    {dev.is_current && (
                                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                                        Este equipo
                                      </span>
                                    )}
                                    {!dev.is_current && dev.sesion_activa && (
                                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                                        Activo
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[10px] text-slate-400 font-mono truncate">
                                    {plat.toUpperCase()} · Último uso: {usoFmt}
                                  </p>
                                </div>
                              </div>
                              <button
                                type="button"
                                disabled={Boolean(devicesBusyId)}
                                onClick={() => handleRevokeDevice(dev)}
                                className="px-2.5 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/35 text-rose-300 text-[11px] font-semibold shrink-0 disabled:opacity-50"
                              >
                                {devicesBusyId === dev.id ? '…' : 'Quitar'}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {devicesMsg.text && (
                      <div
                        className={`flex items-start gap-2 text-xs rounded-xl p-2.5 border ${
                          devicesMsg.type === 'ok'
                            ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25'
                            : 'text-rose-300 bg-rose-500/10 border-rose-500/25'
                        }`}
                      >
                        {devicesMsg.type === 'ok' ? (
                          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                        ) : (
                          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        )}
                        <span>{devicesMsg.text}</span>
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* DESPLEGABLE 0B: ACCESO CON HUELLA DIGITAL (SOLO ANDROID APK) */}
              {nativeAndroid && (
                <section className="instrument-card rounded-2xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleSection('biometric')}
                    aria-expanded={openSection === 'biometric'}
                    className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left hover:bg-white/[0.02]"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-emerald-500/12 border border-emerald-500/25 flex items-center justify-center shrink-0">
                        <Fingerprint className="w-4 h-4 text-emerald-400" />
                      </div>
                      <div className="min-w-0">
                        <h2 className="text-sm font-semibold text-white">Acceso con Huella Digital</h2>
                        <p className="text-[11px] text-slate-400 truncate">
                          Autoguardado de sesión cifrado en AndroidKeyStore
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                          bioStatus.hasSavedCredentials
                            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}
                      >
                        {bioStatus.hasSavedCredentials ? 'Activo' : 'Inactivo'}
                      </span>
                      {openSection === 'biometric' ? (
                        <ChevronDown className="w-4 h-4 text-emerald-400 shrink-0" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                      )}
                    </div>
                  </button>

                  {openSection === 'biometric' && (
                    <div className="px-5 pb-5 pt-2 border-t border-slate-800/80 space-y-3">
                      {!bioStatus.available ? (
                        <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-xl p-3">
                          Configura al menos una huella digital en los Ajustes de seguridad de tu teléfono Android para activar el acceso rápido.
                        </p>
                      ) : bioStatus.hasSavedCredentials ? (
                        <div className="space-y-3">
                          <p className="text-xs text-slate-300 leading-relaxed bg-[#101521] border border-emerald-500/25 rounded-xl p-3">
                            Tu acceso biométrico está activo y cifrado con AES-256-GCM en el chip de seguridad de este teléfono ({bioStatus.dniMask || user.dni}). Si cambias tu contraseña o quitas este equipo, se desactivará automáticamente.
                          </p>
                          <button
                            type="button"
                            disabled={bioBusy}
                            onClick={handleDisableBiometric}
                            className="w-full py-2.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/35 text-rose-300 font-semibold text-xs disabled:opacity-50"
                          >
                            {bioBusy ? 'Desactivando…' : 'Desactivar Acceso con Huella Digital'}
                          </button>
                        </div>
                      ) : (
                        <form onSubmit={handleEnableBiometric} className="space-y-2.5">
                          <p className="text-[11px] text-slate-400 leading-relaxed">
                            Ingresa tu contraseña actual una sola vez y confirma tu huella para entrar en segundos sin escribir tus datos cada vez que expire la sesión de 15 minutos.
                          </p>
                          <div className="flex gap-2">
                            <input
                              type="password"
                              value={bioPwd}
                              onChange={(e) => setBioPwd(e.target.value)}
                              placeholder="Tu contraseña actual"
                              className="flex-1 bg-[#0f172a] border border-slate-700 focus:border-emerald-400 rounded-xl px-3 py-2 text-xs text-white outline-none"
                            />
                            <button
                              type="submit"
                              disabled={bioBusy}
                              className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#03160f] font-semibold text-xs inline-flex items-center gap-1.5 shrink-0 disabled:opacity-50"
                            >
                              <Fingerprint className="w-4 h-4" />
                              {bioBusy ? 'Verificando…' : 'Activar'}
                            </button>
                          </div>
                        </form>
                      )}

                      {bioMsg.text && (
                        <div
                          className={`flex items-start gap-2 text-xs rounded-xl p-2.5 border ${
                            bioMsg.type === 'ok'
                              ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25'
                              : 'text-rose-300 bg-rose-500/10 border-rose-500/25'
                          }`}
                        >
                          {bioMsg.type === 'ok' ? (
                            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                          ) : (
                            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                          )}
                          <span>{bioMsg.text}</span>
                        </div>
                      )}
                    </div>
                  )}
                </section>
              )}

              {/* DESPLEGABLE 1: CAMBIAR CONTRASEÑA */}
              <section className="instrument-card rounded-2xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleSection('password')}
                  aria-expanded={openSection === 'password'}
                  className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left hover:bg-white/[0.02]"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-cyan-500/12 border border-cyan-500/25 flex items-center justify-center shrink-0">
                      <KeyRound className="w-4 h-4 text-cyan-400" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold text-white">Cambiar Contraseña</h2>
                      <p className="text-[11px] text-slate-400 truncate">
                        Doble factor OTP por correo · Cierra otras sesiones activas
                      </p>
                    </div>
                  </div>
                  {openSection === 'password' ? (
                    <ChevronDown className="w-4 h-4 text-cyan-400 shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                  )}
                </button>

                {openSection === 'password' && (
                  <div className="px-5 pb-5 pt-2 border-t border-slate-800/80 space-y-3.5">
                    <form onSubmit={handlePwdInit} className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <input
                        type="password"
                        value={curPwd}
                        onChange={(e) => setCurPwd(e.target.value)}
                        placeholder="Contraseña actual"
                        className="bg-[#0f172a] border border-slate-700 focus:border-cyan-400 rounded-xl px-3 py-2 text-xs text-white outline-none"
                      />
                      <input
                        type="password"
                        value={newPwd}
                        onChange={(e) => setNewPwd(e.target.value)}
                        placeholder="Nueva (mín. 8)"
                        className="bg-[#0f172a] border border-slate-700 focus:border-cyan-400 rounded-xl px-3 py-2 text-xs text-white outline-none"
                      />
                      <input
                        type="password"
                        value={repPwd}
                        onChange={(e) => setRepPwd(e.target.value)}
                        placeholder="Confirmar nueva"
                        className="bg-[#0f172a] border border-slate-700 focus:border-cyan-400 rounded-xl px-3 py-2 text-xs text-white outline-none"
                      />
                      <button
                        type="submit"
                        disabled={pwdBusy}
                        className="sm:col-span-3 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                      >
                        <ShieldCheck className="w-4 h-4" />
                        {pwdBusy && !pwdChallenge ? 'Validando y enviando OTP…' : 'Paso 1: Enviar Código OTP al Correo'}
                      </button>
                    </form>

                    {pwdChallenge && (
                      <form onSubmit={handlePwdVerify} className="bg-[#101521] border border-cyan-500/30 rounded-xl p-3.5 space-y-2.5">
                        <p className="text-[11px] text-cyan-300 font-medium">
                          Paso 2: Ingresa el código de 6 dígitos enviado a {pwdChallenge.maskedEmail}
                        </p>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            inputMode="numeric"
                            maxLength={6}
                            value={pwdOtp}
                            onChange={(e) => setPwdOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            placeholder="000000"
                            className="w-36 bg-[#090c12] border border-slate-700 focus:border-emerald-400 rounded-xl px-3 py-2 text-center font-mono text-base tracking-[0.3em] text-white outline-none"
                          />
                          <button
                            type="submit"
                            disabled={pwdBusy || pwdOtp.length !== 6}
                            className="flex-1 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#03160f] font-semibold text-xs disabled:opacity-50"
                          >
                            {pwdBusy ? 'Verificando…' : 'Confirmar Cambio de Contraseña'}
                          </button>
                        </div>
                      </form>
                    )}

                    {pwdMsg.text && (
                      <div
                        className={`flex items-start gap-2 text-xs rounded-xl p-2.5 border ${
                          pwdMsg.type === 'ok'
                            ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25'
                            : 'text-rose-300 bg-rose-500/10 border-rose-500/25'
                        }`}
                      >
                        {pwdMsg.type === 'ok' ? (
                          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                        ) : (
                          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        )}
                        <span>{pwdMsg.text}</span>
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* ACCESO DIRECTO: POLÍTICA DE PRIVACIDAD */}
              <button
                type="button"
                onClick={() => setShowPolicyModal(true)}
                className="w-full instrument-card rounded-2xl px-5 py-4 flex items-center justify-between gap-3 text-left hover:bg-white/[0.02]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-emerald-500/12 border border-emerald-500/25 flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-white">Política de Privacidad y Derechos ARCO</h2>
                    <p className="text-[11px] text-slate-400 truncate">
                      {VERSION_POLITICA} · Ley N.° 29733 y manejo de datos
                    </p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
              </button>

              {/* DESPLEGABLE 2: ZONA DE PELIGRO — ELIMINAR CUENTA (OCULTO POR DEFECTO) */}
              <section
                className={`rounded-2xl overflow-hidden border transition-colors ${
                  openSection === 'delete'
                    ? 'bg-[#1b0f14] border-rose-500/45'
                    : 'instrument-card border-rose-500/20'
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleSection('delete')}
                  aria-expanded={openSection === 'delete'}
                  className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left hover:bg-rose-500/[0.04]"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-rose-500/12 border border-rose-500/30 flex items-center justify-center shrink-0">
                      <AlertTriangle className="w-4 h-4 text-rose-400" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold text-rose-300">Eliminar Cuenta Permanentemente</h2>
                      <p className="text-[11px] text-slate-400 truncate">
                        Zona de peligro · Borra perfil, sesiones y todos tus tickets
                      </p>
                    </div>
                  </div>
                  {openSection === 'delete' ? (
                    <ChevronDown className="w-4 h-4 text-rose-400 shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                  )}
                </button>

                {openSection === 'delete' && (
                  <div className="px-5 pb-5 pt-2 border-t border-rose-500/25 space-y-3.5">
                    <p className="text-[11px] text-rose-200/85 leading-relaxed bg-rose-950/40 border border-rose-500/25 rounded-xl p-3">
                      Acción irreversible (Derecho ARCO): borrará permanentemente tu cuenta, tu foto de perfil, tus dispositivos confiables, sesiones activas y <strong>todos tus tickets de diagnóstico y sugerencias</strong>.
                    </p>

                    <form onSubmit={handleDeleteInit} className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <input
                        type="password"
                        value={delPwd}
                        onChange={(e) => setDelPwd(e.target.value)}
                        placeholder="Contraseña actual"
                        className="bg-[#0f172a] border border-rose-900/70 focus:border-rose-400 rounded-xl px-3 py-2 text-xs text-white outline-none"
                      />
                      <input
                        type="text"
                        value={delConfirm}
                        onChange={(e) => setDelConfirm(e.target.value)}
                        placeholder="Escriba ELIMINAR para confirmar"
                        className="bg-[#0f172a] border border-rose-900/70 focus:border-rose-400 rounded-xl px-3 py-2 text-xs text-white outline-none"
                      />
                      <button
                        type="submit"
                        disabled={delBusy}
                        className="sm:col-span-2 py-2.5 rounded-xl bg-rose-700/85 hover:bg-rose-600 text-white font-semibold text-xs inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                      >
                        <Trash2 className="w-4 h-4" />
                        {delBusy && !delChallenge
                          ? 'Enviando código OTP de confirmación…'
                          : 'Paso 1: Solicitar Código OTP de Eliminación'}
                      </button>
                    </form>

                    {delChallenge && (
                      <form onSubmit={handleDeleteVerify} className="bg-[#12090d] border border-rose-500/45 rounded-xl p-3.5 space-y-2.5">
                        <p className="text-[11px] text-rose-300 font-medium">
                          Paso 2: Ingresa el código irreversible enviado a {delChallenge.maskedEmail}
                        </p>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            inputMode="numeric"
                            maxLength={6}
                            value={delOtp}
                            onChange={(e) => setDelOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            placeholder="000000"
                            className="w-36 bg-[#090c12] border border-rose-500/50 focus:border-rose-400 rounded-xl px-3 py-2 text-center font-mono text-base tracking-[0.3em] text-white outline-none"
                          />
                          <button
                            type="submit"
                            disabled={delBusy || delOtp.length !== 6}
                            className="flex-1 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs disabled:opacity-50"
                          >
                            {delBusy ? 'Eliminando…' : 'Eliminar Cuenta y Tickets'}
                          </button>
                        </div>
                      </form>
                    )}

                    {delMsg.text && (
                      <div
                        className={`flex items-start gap-2 text-xs rounded-xl p-2.5 border ${
                          delMsg.type === 'ok'
                            ? 'text-amber-300 bg-amber-500/10 border-amber-500/25'
                            : 'text-rose-300 bg-rose-500/10 border-rose-500/25'
                        }`}
                      >
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>{delMsg.text}</span>
                      </div>
                    )}
                  </div>
                )}
              </section>
            </div>
          </div>
        )}
      </div>

      {showPolicyModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="w-full max-w-lg max-h-[85vh] bg-[#131c2e] border border-slate-700 rounded-2xl flex flex-col overflow-hidden shadow-2xl">
            <div className="px-5 py-4 bg-[#0f172a] border-b border-slate-800 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-cyan-400">
                  Política de Privacidad y Términos de Uso
                </h2>
                <p className="text-[10px] text-slate-400">{VERSION_POLITICA}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowPolicyModal(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto flex-1">
              <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-300">
                {POLITICA_PRIVACIDAD_TEXTO}
              </pre>
            </div>
            <div className="p-4 bg-[#0f172a] border-t border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() => setShowPolicyModal(false)}
                className="px-4 py-2 rounded-lg text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
