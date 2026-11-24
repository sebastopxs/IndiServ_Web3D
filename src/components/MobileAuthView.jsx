/**
 * MobileAuthView.jsx — Pantalla de inicio de sesión y registro validado contra padrón UNMSM en Supabase.
 */

import React, { useState } from 'react';
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
} from '../utils/security';
import { ShieldCheck, LogIn, UserPlus, Eye, EyeOff, FileText, X, CheckCircle2, AlertCircle } from 'lucide-react';

export default function MobileAuthView({ onAuthenticated, onGuestDemo }) {
  const [mode, setMode] = useState('login');
  const [dni, setDni] = useState('');
  const [nick, setNick] = useState('');
  const [correo, setCorreo] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [aceptaPolitica, setAceptaPolitica] = useState(false);
  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

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

      // 1. Intentar autenticación segura del lado del servidor (RPC SECURITY DEFINER)
      const { data: rpcData, error: rpcErr } = await supabase.rpc('autenticar_usuario', {
        p_dni: cleanDni,
        p_correo: cleanCorreo,
        p_password_hash: hashedInput,
      });

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

      // 1. Intentar registro atómico del lado del servidor (RPC SECURITY DEFINER)
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

  return (
    <div className="min-h-screen w-full bg-[#0b0f19] text-zinc-100 flex flex-col items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-md bg-[#131c2e] border border-slate-700/60 rounded-2xl shadow-2xl overflow-hidden">

        <div className="bg-[#0f172a] p-5 border-b border-slate-800">
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
            {mode === 'login' ? 'Portal de Seguridad Técnica' : 'Registro de Operador'}
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            {mode === 'login'
              ? 'Autenticación para telemetría móvil, tickets y Gemelo Digital 3D.'
              : 'Validación contra padrón oficial público UNMSM en Supabase.'}
          </p>
        </div>

        <form onSubmit={mode === 'login' ? handleLogin : handleRegister} className="p-5 space-y-3.5">
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
            {mode === 'login' ? <LogIn className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
            {loading
              ? 'Verificando en Supabase…'
              : mode === 'login'
              ? 'Ingresar a IndiServ'
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
