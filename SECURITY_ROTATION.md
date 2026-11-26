# Runbook de Rotación de Secretos y Pines TLS — IndiServ Analytica

Guía operativa para rotar secretos y renovar pines criptográficos sin caída de servicio.

---

## 1. Renovación de Pines SPKI Android (`network_security_config.xml`)

El workflow automático [security_pin_monitor.yml](.github/workflows/security_pin_monitor.yml) verifica **cada lunes** que los pines de `android/app/src/main/res/xml/network_security_config.xml` coincidan con la cadena TLS viva de Supabase y Vercel, y falla en rojo cuando falten menos de **90 días** para el vencimiento (`expiration="2027-12-31"`).

Para renovar antes del vencimiento:
1. Extraer los nuevos pines SPKI de CA intermedia + raíz:
   ```bash
   python -c "import ssl,socket,base64,hashlib; from cryptography import x509; from cryptography.hazmat.primitives import serialization
   for h in ('pvrfnvrxaxulcxacdino.supabase.co','indiserv-web3d.vercel.app'):
     with socket.create_connection((h,443),10) as s:
       with ssl.create_default_context().wrap_socket(s,server_hostname=h) as ss:
         for i,d in enumerate(ss.get_verified_chain()):
           c=x509.load_der_x509_certificate(d); p=base64.b64encode(hashlib.sha256(c.public_key().public_bytes(serialization.Encoding.DER,serialization.PublicFormat.SubjectPublicKeyInfo)).digest()).decode()
           print(h,i,c.subject.rfc4514_string(),c.not_valid_after_utc.date(),p)"
   ```
2. Actualizar `<pin-set expiration="YYYY-MM-DD">` en `android/app/src/main/res/xml/network_security_config.xml` manteniendo al menos 1 pin de respaldo de raíz.
3. Hacer `push` a `main` para publicar el nuevo `IndiServ_Analytica.apk` en GitHub Releases.

---

## 2. Rotación de Secretos en Supabase Edge Functions

Ubicación: **Supabase Dashboard → Edge Functions → Secrets** (o `npx supabase secrets set KEY=VAL --project-ref pvrfnvrxaxulcxacdino`).

| Secreto | Periodicidad recomendada | Impacto al rotar |
|---|---|---|
| `BREVO_API_KEY` | Cada 180 días o ante incidente | Cero caída: crear nueva key en Brevo, actualizar secret, revocar la antigua. |
| `GEMINI_API_KEY` | Cada 180 días o ante incidente | Cero caída: generar nueva key en Google AI Studio, actualizar secret, borrar la anterior. |
| `ADMIN_DNIS` | Bajo demanda | Lista CSV de DNIs con permiso para consultar alertas Honeytoken. |
| `OTP_PEPPER` | Solo ante compromiso confirmado | ⚠️ `OTP_PEPPER` participa en los hashes PBKDF2 de `usuarios_app` y HMAC de `codigos_otp`. Si se rota por incidente, los usuarios deberán usar *"¿Olvidaste tu contraseña?"* (recuperación por correo Brevo) para re-generar su hash bajo el nuevo pepper. |

---

## 3. Respaldo del Keystore Release de Android

Los 4 secretos (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`) viven en **GitHub → Settings → Secrets and variables → Actions**.
* Conservar una copia cifrada offline del archivo `.jks` y sus contraseñas fuera del repositorio: perder el keystore impide actualizar instalaciones existentes del APK sin desinstalar primero.
