/**
 * MobileAuthView.jsx — Pantalla de inicio de sesión y registro validado contra padrón UNMSM en Supabase.
 */

import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { POLITICA_PRIVACIDAD_TEXTO, VERSION_POLITICA } from '../utils/legalPolicy';
import {
  hashPassword,
  verifyPassword,
  checkLoginRateLimit,
  recordFailedLogin,
  resetLoginRateLimit,
  isHoneyCredential,
  triggerHoneytokenAlert,
  getDeviceFingerprint,
  saveSessionToken,
  callAuthOtp,
} from '../utils/security';
import {
  ShieldCheck,
  LogIn,
  UserPlus,
  Eye,
  EyeOff,
  FileText,
  X,
  CheckCircle2,
  AlertCircle,
  KeyRound,
  RefreshCw,
  Fingerprint,
} from 'lucide-react';
import {
  getBiometricStatus,
  enableBiometricLogin,
  authenticateBiometricLogin,
  disableBiometricLogin,
} from '../utils/biometric';

export default function MobileAuthView({ onAuthenticated, onGuestDemo, initialNotice = '' }) {
  const [mode, setMode] = useState('login');
  const [dni, setDni] = useState('');
  const [nick, setNick] = useState('');
  const [correo, setCorreo] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [aceptaPolitica, setAceptaPolitica] = useState(false);
  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(initialNotice || '');
  const [otpChallenge, setOtpChallenge] = useState(null);
  const [otpCode, setOtpCode] = useState('');
  const [bioStatus, setBioStatus] = useState({
    available: false,
    reason: 'web',
    hasSavedCredentials: false,
    nickname: '',
    dniMask: '',
  });
  const [saveBiometricOptIn, setSaveBiometricOptIn] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);

  useEffect(() => {
    let active = true;
    getBiometricStatus().then((st) => {
      if (active) setBioStatus(st);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (initialNotice) setSuccess(initialNotice);
  }, [initialNotice]);

  const maybeEnrollBiometric = async (userObj, cleanDni, cleanCorreo, passwordHash, enabledFlag) => {
    if (!enabledFlag || !bioStatus.available) return;
    try {
      const res = await enableBiometricLogin({
        dni: cleanDni,
        correo: cleanCorreo,
        password_hash: passwordHash,
        nickname: userObj?.nickname || 'Operador',
      });
      if (res?.ok) {
        const st = await getBiometricStatus();
        setBioStatus(st);
      }
    } catch {
      // No bloquear el inicio de sesión si el usuario canceló la huella
    }
  };

  const handleBiometricLogin = async () => {
    if (loading || bioBusy) return;
    setError('');
    setSuccess('');
    setBioBusy(true);
    try {
      const bio = await authenticateBiometricLogin();
      if (!bio?.ok) {
        if (bio?.invalidated) {
          const st = await getBiometricStatus();
          setBioStatus(st);
          setError(bio.error || 'Tu clave biométrica cambió. Inicia sesión con contraseña.');
        } else if (!bio?.cancelled && bio?.error) {
          setError(bio.error);
        }
        return;
      }

      const dev = await getDeviceFingerprint();
      const otpRes = await callAuthOtp({
        action: 'login_init',
        dni: bio.dni,
        correo: bio.correo,
        password_hash: bio.password_hash,
        device_hash: dev.deviceHash,
        device_label: dev.deviceLabel,
        plataforma: dev.plataforma,
      });

      if (otpRes.error_conexion) {
        setError(otpRes.error_conexion);
        return;
      }
      if (otpRes.ok && otpRes.requires_otp && otpRes.challenge_id) {
        resetLoginRateLimit();
        setOtpCode('');
        setOtpChallenge({
          challengeId: otpRes.challenge_id,
          maskedEmail: otpRes.masked_email || bio.correo,
          proposito: 'new_device',
          expLeft: Number(otpRes.expires_in_sec || 600),
          resendLeft: Number(otpRes.resend_cooldown_sec || 60),
          retryPayload: {
            action: 'login_init',
            dni: bio.dni,
            correo: bio.correo,
            password_hash: bio.password_hash,
            device_hash: dev.deviceHash,
            device_label: dev.deviceLabel,
            plataforma: dev.plataforma,
          },
        });
        return;
      }
      if (otpRes.ok && otpRes.session_token && otpRes.user) {
        resetLoginRateLimit();
        saveSessionToken(otpRes.session_token, dev.deviceHash);
        onAuthenticated(otpRes.user);
        return;
      }

      // Contraseña modificada o cuenta eliminada: limpiar bóveda biométrica obsoleta
      await disableBiometricLogin();
      const st = await getBiometricStatus();
      setBioStatus(st);
      setError('Tu contraseña cambió o el acceso anterior venció. Ingresa con contraseña para reactivar tu huella.');
    } catch (err) {
      setError(`Error biométrico: ${err?.message || 'Verifique internet'}`);
    } finally {
      setBioBusy(false);
    }
  };

  useEffect(() => {
    if (!otpChallenge) return undefined;
    const id = setInterval(() => {
      setOtpChallenge((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          expLeft: Math.max(0, prev.expLeft - 1),
          resendLeft: Math.max(0, prev.resendLeft - 1),
        };
      });
    }, 1000);
    return () => clearInterval(id);
  }, [Boolean(otpChallenge)]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    const cleanDni = dni.trim();
    const cleanCorreo = correo.trim();
    const cleanPass = password.trim();

    if (!cleanDni || !cleanCorreo || !cleanPass) {
      setError('Complete DNI, correo electrónico y contraseña.');
      return;
    }

    const rate = checkLoginRateLimit();
    if (!rate.allowed) {
      setError(`⏳ Demasiados intentos fallidos. Espere ${rate.waitSeconds} s.`);
      return;
    }

    if (isHoneyCredential(cleanDni, cleanCorreo)) {
      triggerHoneytokenAlert(
        'CREDENCIAL_SENUELO_LOGIN_MOVIL',
        `Intento de login en cuenta trampa DNI='${cleanDni}' correo='${cleanCorreo}'`
      );
      setError('Credenciales incorrectas o cuenta inexistente.');
      return;
    }

    setLoading(true);
    try {
      const hashedInput = await hashPassword(cleanDni, cleanPass);
      const dev = await getDeviceFingerprint();

      // 1. Intentar autenticación segura vía Edge Function auth-otp (sesión 15m + dispositivo confiable + OTP)
      const otpRes = await callAuthOtp({
        action: 'login_init',
        dni: cleanDni,
        correo: cleanCorreo,
        password_hash: hashedInput,
        device_hash: dev.deviceHash,
        device_label: dev.deviceLabel,
        plataforma: dev.plataforma,
      });

      if (!otpRes._missingFunction) {
        if (otpRes.error_conexion) {
          setError(otpRes.error_conexion);
          return;
        }
        if (otpRes.ok && otpRes.requires_otp && otpRes.challenge_id) {
          resetLoginRateLimit();
          setOtpCode('');
          setOtpChallenge({
            challengeId: otpRes.challenge_id,
            maskedEmail: otpRes.masked_email || cleanCorreo,
            proposito: 'new_device',
            expLeft: Number(otpRes.expires_in_sec || 600),
            resendLeft: Number(otpRes.resend_cooldown_sec || 60),
            pendingBiometric:
              saveBiometricOptIn && bioStatus.available
                ? { dni: cleanDni, correo: cleanCorreo, password_hash: hashedInput }
                : null,
            retryPayload: {
              action: 'login_init',
              dni: cleanDni,
              correo: cleanCorreo,
              password_hash: hashedInput,
              device_hash: dev.deviceHash,
              device_label: dev.deviceLabel,
              plataforma: dev.plataforma,
            },
          });
          return;
        }
        if (otpRes.ok && otpRes.session_token && otpRes.user) {
          resetLoginRateLimit();
          saveSessionToken(otpRes.session_token, dev.deviceHash);
          await maybeEnrollBiometric(otpRes.user, cleanDni, cleanCorreo, hashedInput, saveBiometricOptIn);
          onAuthenticated(otpRes.user);
          return;
        }
        const lock = recordFailedLogin(cleanDni, cleanCorreo);
        setError(
          lock.locked
            ? `⏳ Cuenta protegida contra fuerza bruta. Espere ${lock.waitSeconds} s.`
            : otpRes.error || 'Credenciales incorrectas o cuenta inexistente.'
        );
        return;
      }

      // 2. Respaldo RPC previo mientras se despliega la Edge Function auth-otp
      const { data: rpcData, error: rpcErr } = await supabase.rpc('autenticar_usuario', {
        p_dni: cleanDni,
        p_correo: cleanCorreo,
        p_password_hash: hashedInput,
      });

      if (rpcErr) {
        const msg = String(rpcErr.message || '').toLowerCase();
        const code = String(rpcErr.code || '').toUpperCase();
        const isMissingRpc =
          code === 'PGRST202' ||
          code === '42883' ||
          msg.includes('could not find the function') ||
          msg.includes('does not exist');
        if (!isMissingRpc) {
          throw rpcErr;
        }
      }

      if (!rpcErr && rpcData && typeof rpcData === 'object' && 'ok' in rpcData) {
        if (rpcData.ok) {
          resetLoginRateLimit();
          onAuthenticated({
            dni: cleanDni,
            correo: rpcData.correo || cleanCorreo,
            nickname: rpcData.nickname || 'Operador',
          });
          return;
        }
        const lock = recordFailedLogin(cleanDni, cleanCorreo);
        if (lock.locked) {
          setError(`⏳ Cuenta protegida contra fuerza bruta. Espere ${lock.waitSeconds} s.`);
        } else {
          setError('Credenciales incorrectas o cuenta inexistente.');
        }
        return;
      }

      // 2. Respaldo compatible mientras se aplica la migración SQL de RPC en Supabase
      const { data, error: dbErr } = await supabase
        .from('usuarios_app')
        .select('dni, correo, nickname, password_hash')
        .eq('dni', cleanDni)
        .limit(1);

      if (dbErr) throw dbErr;
      const user = data?.[0];
      const check = user
        ? await verifyPassword(cleanDni, cleanPass, user.password_hash)
        : { valid: false };

      if (user && user.correo === cleanCorreo && check.valid) {
        resetLoginRateLimit();
        onAuthenticated({
          dni: cleanDni,
          correo: user.correo,
          nickname: user.nickname || 'Operador',
        });
      } else {
        const lock = recordFailedLogin(cleanDni, cleanCorreo);
        if (lock.locked) {
          setError(`⏳ Cuenta protegida contra fuerza bruta. Espere ${lock.waitSeconds} s.`);
        } else {
          setError('Credenciales incorrectas o cuenta inexistente.');
        }
      }
    } catch (err) {
      setError(`Error de conexión: ${err?.message || 'Verifique internet'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    const cleanDni = dni.trim();
    const cleanNick = nick.trim();
    const cleanCorreo = correo.trim();
    const cleanPass = password.trim();

    if (!cleanDni || !cleanNick || !cleanCorreo || !cleanPass) {
      setError('Llene todos los campos requeridos.');
      return;
    }
    if (!aceptaPolitica) {
      setError('Debe leer y aceptar la Política de Privacidad y Términos antes de registrarse.');
      return;
    }

    if (isHoneyCredential(cleanDni, cleanCorreo)) {
      triggerHoneytokenAlert(
        'CREDENCIAL_SENUELO_REGISTRO_MOVIL',
        `Intento de registro con identidad trampa DNI='${cleanDni}' correo='${cleanCorreo}'`
      );
      setError('El DNI no figura en el padrón oficial público UNMSM.');
      return;
    }

    setLoading(true);
    try {
      const hashedPass = await hashPassword(cleanDni, cleanPass);
      const dev = await getDeviceFingerprint();

      // 1. Intentar registro protegido con verificación OTP al correo (Edge Function auth-otp)
      const otpReg = await callAuthOtp({
        action: 'register_init',
        dni: cleanDni,
        nickname: cleanNick,
        correo: cleanCorreo,
        password_hash: hashedPass,
        device_hash: dev.deviceHash,
        device_label: dev.deviceLabel,
        plataforma: dev.plataforma,
      });

      if (!otpReg._missingFunction) {
        if (otpReg.error_conexion) {
          setError(otpReg.error_conexion);
          return;
        }
        if (otpReg.ok && otpReg.challenge_id) {
          setOtpCode('');
          setOtpChallenge({
            challengeId: otpReg.challenge_id,
            maskedEmail: otpReg.masked_email || cleanCorreo,
            proposito: 'register',
            expLeft: Number(otpReg.expires_in_sec || 600),
            resendLeft: Number(otpReg.resend_cooldown_sec || 60),
            retryPayload: {
              action: 'register_init',
              dni: cleanDni,
              nickname: cleanNick,
              correo: cleanCorreo,
              password_hash: hashedPass,
              device_hash: dev.deviceHash,
              device_label: dev.deviceLabel,
              plataforma: dev.plataforma,
            },
          });
          return;
        }
        setError(otpReg.error || 'No se pudo iniciar la verificación de registro.');
        return;
      }

      // 2. Respaldo RPC previo mientras se despliega auth-otp
      const { data: rpcReg, error: rpcRegErr } = await supabase.rpc('registrar_usuario_seguro', {
        p_dni: cleanDni,
        p_nickname: cleanNick,
        p_correo: cleanCorreo,
        p_password_hash: hashedPass,
      });

      if (!rpcRegErr && rpcReg && typeof rpcReg === 'object' && 'ok' in rpcReg) {
        if (!rpcReg.ok) {
          setError(rpcReg.error || 'No se pudo completar el registro.');
          return;
        }
        setSuccess('Cuenta registrada exitosamente. Ahora puede iniciar sesión.');
        setMode('login');
        setPassword('');
        return;
      }

      // 2. Respaldo compatible mientras se aplica la migración SQL de RPC en Supabase
      const { data: padron, error: errPadron } = await supabase
        .from('padron_oficial')
        .select('dni, nombres_completos, carrera')
        .eq('dni', cleanDni)
        .limit(1);

      if (errPadron) throw errPadron;
      if (!padron || padron.length === 0) {
        setError('El DNI no figura en el padrón oficial público UNMSM.');
        return;
      }

      const { data: existing, error: errEx } = await supabase
        .from('usuarios_app')
        .select('dni')
        .eq('dni', cleanDni)
        .limit(1);

      if (errEx) throw errEx;
      if (existing && existing.length > 0) {
        setError('Este DNI ya tiene una cuenta registrada. Inicie sesión.');
        return;
      }

      const { error: errIns } = await supabase.from('usuarios_app').insert({
        dni: cleanDni,
        correo: cleanCorreo,
        password_hash: hashedPass,
        nickname: cleanNick,
      });

      if (errIns) throw errIns;

      setSuccess('Cuenta registrada exitosamente. Ahora puede iniciar sesión.');
      setMode('login');
      setPassword('');
    } catch (err) {
      setError(`Error al registrar: ${err?.message || 'Intente nuevamente'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotInit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    const cleanDni = dni.trim();
    const cleanCorreo = correo.trim();
    if (cleanDni.length < 8 || !cleanCorreo.includes('@')) {
      setError('Ingrese su DNI (8 dígitos) y correo registrado.');
      return;
    }
    setLoading(true);
    try {
      const dev = await getDeviceFingerprint();
      const res = await callAuthOtp({
        action: 'password_reset_init',
        dni: cleanDni,
        correo: cleanCorreo,
        device_hash: dev.deviceHash,
        device_label: dev.deviceLabel,
      });
      if (res.error_conexion) {
        setError(res.error_conexion);
        return;
      }
      if (res.ok && res.challenge_id) {
        setOtpCode('');
        setNewPassword('');
        setConfirmNewPassword('');
        setOtpChallenge({
          challengeId: res.challenge_id,
          maskedEmail: res.masked_email || cleanCorreo,
          proposito: 'password_reset',
          dni: cleanDni,
          expLeft: Number(res.expires_in_sec || 600),
          resendLeft: Number(res.resend_cooldown_sec || 60),
          retryPayload: {
            action: 'password_reset_init',
            dni: cleanDni,
            correo: cleanCorreo,
            device_hash: dev.deviceHash,
            device_label: dev.deviceLabel,
          },
        });
      } else {
        setError(res.error || 'No se pudo iniciar la recuperación.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    if (!otpChallenge) return;
    setError('');
    setSuccess('');
    const cleanCode = otpCode.trim();
    if (!/^\d{6}$/.test(cleanCode)) {
      setError('Ingrese exactamente 6 dígitos numéricos.');
      return;
    }
    if (otpChallenge.proposito === 'password_reset') {
      const p1 = newPassword.trim();
      const p2 = confirmNewPassword.trim();
      if (p1.length < 8) {
        setError('La nueva contraseña debe tener al menos 8 caracteres.');
        return;
      }
      if (p1 !== p2) {
        setError('Las contraseñas no coinciden.');
        return;
      }
      setLoading(true);
      try {
        const dev = await getDeviceFingerprint();
        const newHash = await hashPassword(otpChallenge.dni, p1);
        const res = await callAuthOtp({
          action: 'password_reset_verify',
          challenge_id: otpChallenge.challengeId,
          code: cleanCode,
          new_password_hash: newHash,
          device_hash: dev.deviceHash,
        });
        if (res.ok) {
          await disableBiometricLogin();
          getBiometricStatus().then(setBioStatus).catch(() => {});
          setOtpChallenge(null);
          setMode('login');
          setPassword('');
          setNewPassword('');
          setConfirmNewPassword('');
          setSuccess(
            'Contraseña restablecida con éxito. Todas las sesiones anteriores fueron cerradas; inicie sesión con su nueva clave.'
          );
          return;
        }
        setError(res.error || res.error_conexion || 'Código incorrecto o expirado.');
      } finally {
        setLoading(false);
      }
      return;
    }

    setLoading(true);
    try {
      const dev = await getDeviceFingerprint();
      const action = otpChallenge.proposito === 'register' ? 'register_verify' : 'login_verify_otp';
      const res = await callAuthOtp({
        action,
        challenge_id: otpChallenge.challengeId,
        code: cleanCode,
        device_hash: dev.deviceHash,
        device_label: dev.deviceLabel,
        plataforma: dev.plataforma,
      });
      if (res.ok && res.session_token && res.user) {
        saveSessionToken(res.session_token, dev.deviceHash);
        const pb = otpChallenge.pendingBiometric;
        if (pb) {
          await maybeEnrollBiometric(res.user, pb.dni, pb.correo, pb.password_hash, true);
        }
        setOtpChallenge(null);
        onAuthenticated(res.user);
        return;
      }
      setError(res.error || res.error_conexion || 'Código incorrecto o expirado.');
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (!otpChallenge || otpChallenge.resendLeft > 0 || loading) return;
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const res = await callAuthOtp(otpChallenge.retryPayload);
      if (res.ok && res.challenge_id) {
        setOtpChallenge((prev) =>
          prev
            ? {
                ...prev,
                challengeId: res.challenge_id,
                expLeft: Number(res.expires_in_sec || 600),
                resendLeft: Number(res.resend_cooldown_sec || 60),
              }
            : null
        );
        setSuccess(`Nuevo código enviado a ${otpChallenge.maskedEmail}.`);
      } else {
        setError(res.error || res.error_conexion || 'No se pudo reenviar el código.');
      }
    } finally {
      setLoading(false);
    }
  };

  if (otpChallenge) {
    const mm = String(Math.floor(otpChallenge.expLeft / 60)).padStart(2, '0');
    const ss = String(otpChallenge.expLeft % 60).padStart(2, '0');
    return (
      <div className="h-full w-full bg-[#090c12] text-slate-100 overflow-y-auto px-4 py-5 flex flex-col items-center">
        <div className="view-enter my-auto shrink-0 w-full max-w-md instrument-card rounded-2xl shadow-2xl overflow-hidden">
          <div className="bg-[#101521] p-5 border-b border-slate-800/80">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                <KeyRound className="w-4 h-4 text-emerald-400" />
              </div>
              <span className="text-xs font-semibold tracking-wider text-cyan-400 uppercase">
                Verificación de Seguridad
              </span>
            </div>
            <h1 className="text-lg font-semibold text-white">
              {otpChallenge.proposito === 'register'
                ? 'Confirma tu correo de registro'
                : otpChallenge.proposito === 'password_reset'
                ? 'Restablecer Contraseña'
                : 'Nuevo dispositivo detectado'}
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              {otpChallenge.proposito === 'password_reset' ? (
                <>Si los datos coinciden con una cuenta activa, enviamos un código de 6 dígitos a <strong className="text-amber-300">{otpChallenge.maskedEmail}</strong>.</>
              ) : (
                <>Enviamos un código de 6 dígitos a <strong className="text-cyan-300">{otpChallenge.maskedEmail}</strong>.</>
              )}
            </p>
          </div>

          <form onSubmit={handleVerifyOtp} className="p-5 space-y-4">
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                Código de 6 dígitos
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                autoFocus
                className="w-full bg-[#0f172a] border border-slate-700 focus:border-emerald-400 rounded-xl px-4 py-3 text-center font-mono text-2xl tracking-[0.45em] text-white outline-none transition-colors"
              />
              <p className="text-[11px] text-slate-400 mt-1.5 font-mono">
                {otpChallenge.expLeft > 0
                  ? `Expira en ${mm}:${ss} · Máximo 5 intentos`
                  : 'Código expirado. Solicite un reenvío.'}
              </p>
            </div>

            {otpChallenge.proposito === 'password_reset' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                    Nueva Contraseña (mín. 8 caracteres)
                  </label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-[#0f172a] border border-slate-700 focus:border-amber-400 rounded-xl px-3.5 py-2.5 text-sm text-white outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                    Confirmar Nueva Contraseña
                  </label>
                  <input
                    type="password"
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-[#0f172a] border border-slate-700 focus:border-amber-400 rounded-xl px-3.5 py-2.5 text-sm text-white outline-none"
                  />
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl p-3">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {success && (
              <div className="flex items-start gap-2 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{success}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || otpCode.length !== 6}
              className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#03160f] font-semibold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              <ShieldCheck className="w-4 h-4" />
              {loading
                ? 'Verificando código…'
                : otpChallenge.proposito === 'password_reset'
                ? 'Restablecer Contraseña'
                : 'Verificar y Entrar (Sesión 15 min)'}
            </button>

            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                disabled={loading || otpChallenge.resendLeft > 0}
                onClick={handleResendOtp}
                className="text-xs font-medium text-cyan-300 hover:text-cyan-200 disabled:text-slate-500 inline-flex items-center gap-1"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                {otpChallenge.resendLeft > 0
                  ? `Reenviar (${otpChallenge.resendLeft} s)`
                  : 'Reenviar código'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setOtpChallenge(null);
                  setError('');
                  setSuccess('');
                }}
                className="text-xs text-slate-400 hover:text-slate-200"
              >
                ← Cancelar
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-[#090c12] text-slate-100 overflow-y-auto px-4 py-5 flex flex-col items-center">
      <div className="view-enter my-auto shrink-0 w-full max-w-md instrument-card rounded-2xl shadow-2xl overflow-hidden">

        <div className="bg-[#101521] p-5 border-b border-slate-800/80">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
              </div>
              <span className="text-xs font-semibold tracking-wider text-cyan-400 uppercase">
                IndiServ Analytica
              </span>
            </div>
            <span className="text-[10px] font-medium px-2.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
              Android · Cloud BaaS
            </span>
          </div>
          <h1 className="text-lg font-semibold text-white">
            {mode === 'login'
              ? 'Portal de Seguridad Técnica'
              : mode === 'forgot'
              ? 'Recuperar Contraseña'
              : 'Registro de Operador'}
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            {mode === 'login'
              ? 'Autenticación para telemetría móvil, tickets y Gemelo Digital 3D.'
              : mode === 'forgot'
              ? 'Ingrese su DNI y correo registrado para recibir un código de recuperación por Brevo.'
              : 'Validación contra padrón oficial público UNMSM en Supabase.'}
          </p>
        </div>

        <form
          onSubmit={mode === 'login' ? handleLogin : mode === 'forgot' ? handleForgotInit : handleRegister}
          className="p-5 space-y-3.5"
        >
          {mode === 'login' && bioStatus.available && bioStatus.hasSavedCredentials && (
            <div className="space-y-2 pb-1">
              <button
                type="button"
                disabled={loading || bioBusy}
                onClick={handleBiometricLogin}
                className="w-full py-3 px-4 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/40 text-cyan-200 font-semibold text-sm flex items-center justify-center gap-2.5 transition-colors disabled:opacity-50"
              >
                <Fingerprint className="w-5 h-5 text-cyan-300" />
                {bioBusy
                  ? 'Verificando huella…'
                  : `Ingresar con Huella (${bioStatus.nickname || 'Operador'})`}
              </button>
              <div className="flex items-center gap-2 text-[10px] text-slate-500 uppercase tracking-wider">
                <div className="h-px flex-1 bg-slate-800" />
                <span>o con DNI y contraseña</span>
                <div className="h-px flex-1 bg-slate-800" />
              </div>
            </div>
          )}

          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
              DNI del Operador (8 dígitos)
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={dni}
              onChange={(e) => setDni(e.target.value)}
              placeholder="Ej. 75509123"
              className="w-full bg-[#0f172a] border border-slate-700 focus:border-cyan-400 rounded-xl px-3.5 py-2.5 text-sm text-white outline-none transition-colors"
            />
          </div>

          {mode === 'register' && (
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                Alias / Nickname Técnico
              </label>
              <input
                type="text"
                value={nick}
                onChange={(e) => setNick(e.target.value)}
                placeholder="Ej. op_sistemas"
                className="w-full bg-[#0f172a] border border-slate-700 focus:border-cyan-400 rounded-xl px-3.5 py-2.5 text-sm text-white outline-none transition-colors"
              />
            </div>
          )}

          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
              Correo Electrónico
            </label>
            <input
              type="email"
              value={correo}
              onChange={(e) => setCorreo(e.target.value)}
              placeholder="operador@indiserv.pe"
              className="w-full bg-[#0f172a] border border-slate-700 focus:border-cyan-400 rounded-xl px-3.5 py-2.5 text-sm text-white outline-none transition-colors"
            />
          </div>

          {mode !== 'forgot' && (
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                Contraseña
              </label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-[#0f172a] border border-slate-700 focus:border-cyan-400 rounded-xl px-3.5 py-2.5 pr-11 text-sm text-white outline-none transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}

          {mode === 'login' && bioStatus.available && !bioStatus.hasSavedCredentials && (
            <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-cyan-500/5 border border-cyan-500/20 text-xs text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={saveBiometricOptIn}
                onChange={(e) => setSaveBiometricOptIn(e.target.checked)}
                className="accent-cyan-400 w-4 h-4 rounded shrink-0"
              />
              <Fingerprint className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>Activar acceso rápido con huella digital en este teléfono</span>
            </label>
          )}

          {mode === 'register' && (
            <div className="flex items-start justify-between gap-2 pt-1 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
              <label className="flex items-start gap-2.5 text-xs text-slate-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={aceptaPolitica}
                  onChange={(e) => setAceptaPolitica(e.target.checked)}
                  className="mt-0.5 accent-emerald-500 w-4 h-4 rounded"
                />
                <span>Acepto la Política de Privacidad y Términos (Padrón UNMSM)</span>
              </label>
              <button
                type="button"
                onClick={() => setShowPolicyModal(true)}
                className="shrink-0 text-[11px] font-medium text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
              >
                <FileText className="w-3.5 h-3.5" /> Leer
              </button>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-xl p-3">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="flex items-start gap-2 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 rounded-xl p-3">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{success}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-[0.99] text-[#04140e] font-semibold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50"
          >
            {mode === 'login' ? (
              <LogIn className="w-4 h-4" />
            ) : mode === 'forgot' ? (
              <KeyRound className="w-4 h-4" />
            ) : (
              <UserPlus className="w-4 h-4" />
            )}
            {loading
              ? 'Verificando en Supabase…'
              : mode === 'login'
              ? 'Ingresar a IndiServ'
              : mode === 'forgot'
              ? 'Enviar Código de Recuperación'
              : 'Registrar Cuenta en la Nube'}
          </button>

          <button
            type="button"
            onClick={() => {
              setError('');
              setSuccess('');
              setMode(mode === 'login' ? 'register' : 'login');
            }}
            className="w-full py-2.5 rounded-xl bg-transparent hover:bg-slate-800/70 border border-slate-700 text-slate-300 text-xs font-medium transition-colors"
          >
            {mode === 'login' ? 'Crear Nueva Cuenta de Operador' : '← Volver al Inicio de Sesión'}
          </button>

          {mode === 'login' && (
            <button
              type="button"
              onClick={() => {
                setError('');
                setSuccess('');
                setMode('forgot');
              }}
              className="w-full py-2 text-xs font-medium text-amber-300 hover:text-amber-200 inline-flex items-center justify-center gap-1.5 transition-colors"
            >
              <KeyRound className="w-3.5 h-3.5" /> ¿Olvidaste tu contraseña?
            </button>
          )}

          {onGuestDemo && (
            <button
              type="button"
              onClick={onGuestDemo}
              className="w-full py-2 text-[11px] text-slate-500 hover:text-cyan-400 transition-colors"
            >
              Explorar Visor 3D / Escáner sin cuenta
            </button>
          )}
        </form>
      </div>

      {showPolicyModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
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
            <div className="p-4 bg-[#0f172a] border-t border-slate-800 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowPolicyModal(false)}
                className="px-4 py-2 rounded-lg text-xs text-slate-300 bg-slate-800 hover:bg-slate-700"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={() => {
                  setAceptaPolitica(true);
                  setShowPolicyModal(false);
                }}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-[#04140e] bg-emerald-500 hover:bg-emerald-400"
              >
                ✔ He leído y Acepto
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
