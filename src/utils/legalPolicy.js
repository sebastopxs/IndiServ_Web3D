export const VERSION_POLITICA = 'v2.0 — Noviembre 2026';

export const POLITICA_PRIVACIDAD_TEXTO = `POLÍTICA DE PRIVACIDAD Y TÉRMINOS Y CONDICIONES DE USO
IndiServ Analytica — Plataforma Móvil, Diagnóstico y Gemelo Digital 3D
Versión: ${VERSION_POLITICA}

Al registrarse, iniciar sesión o utilizar IndiServ Analytica ("el Software"), usted ("el Usuario") declara haber leído, comprendido y aceptado íntegramente las siguientes condiciones.

1. NATURALEZA Y FINALIDAD DEL SOFTWARE
IndiServ Analytica es un software técnico y académico orientado a la lectura de telemetría de hardware, diagnóstico asistido, pruebas controladas de rendimiento de CPU y visualización interactiva mediante un Gemelo Digital 3D en la nube.

2. ORIGEN PÚBLICO DE LOS DATOS DEL PADRÓN DE VERIFICACIÓN (UNMSM)
El Usuario reconoce y acepta expresamente que los datos de validación académica utilizados para verificar el registro de operadores (DNI, código de estudiante, nombres completos y carrera/especialidad) provienen del PADRÓN OFICIAL PÚBLICO DE LA UNIVERSIDAD NACIONAL MAYOR DE SAN MARCOS (UNMSM), fuente institucional de acceso público.

De conformidad con la Ley N.° 29733 (Ley de Protección de Datos Personales del Perú) y su Reglamento (D.S. N.° 003-2013-JUS), dichos datos se emplean exclusivamente para validación de identidad y control de acceso académico dentro del Software. Nunca se venden ni ceden a terceros con fines comerciales o publicitarios.

3. INFORMACIÓN RECOPILADA Y EXCLUSIÓN DE ARCHIVOS PRIVADOS
El Software recopila únicamente:
• Datos de cuenta de operador: DNI, alias/nickname, correo electrónico, hash criptográfico de contraseña y, de forma estrictamente opcional, una foto de perfil (avatar comprimido de hasta 192×192 px) cargada voluntariamente desde "Mi Cuenta".
• Datos de seguridad de sesión: huella técnica del dispositivo (device_hash), tokens de sesión temporales de 15 minutos y firmas HMAC de códigos OTP.
• Telemetría técnica del dispositivo (modelo, sistema operativo, núcleos lógicos, memoria aproximada, batería, GPU WebGL, pantalla y estado de red) o de tickets de PC/Laptop consultados.

El Software NO recopila ni accede a su galería completa, contactos, SMS, ubicación GPS, documentos personales, historial de navegación, contraseñas del sistema ni información bancaria (solo procesa la imagen individual de avatar cuando el Usuario decide subirla voluntariamente).

4. SEGURIDAD DE ACCESO, OTP POR CORREO Y VISOR 3D (SUPABASE / VERCEL)
Los tickets de diagnóstico (id_ticket) y sus especificaciones técnicas se almacenan en Supabase para habilitar la flota privada y el Gemelo Digital 3D. El Usuario asume la responsabilidad de decidir con quién comparte un enlace público (?ticket=...).

Para proteger las cuentas se utilizan códigos OTP de 6 dígitos enviados vía Brevo (expiran en 10 minutos, máximo 5 intentos) en registro, accesos desde nuevos dispositivos, cambio o recuperación de contraseña y eliminación de cuenta, junto con sesiones controladas en servidor de 15 minutos y correos de alerta ante cambios críticos.

5. MICRO-BENCHMARK DE CPU Y EXENCIÓN DE RESPONSABILIDAD
La prueba de rendimiento de CPU ejecuta cálculos controlados en Web Workers para evaluar la estabilidad del procesador. Su uso es voluntario, cancelable en cualquier momento y de carácter estrictamente técnico-orientativo. Los autores no asumen responsabilidad por daños preexistentes ni manipulación física del equipo.

6. DERECHOS ARCO (LEY N.° 29733) — AUTOGESTIÓN EN "MI CUENTA"
El Usuario ejerce directamente y en tiempo real sus derechos de Acceso, Rectificación, Cancelación y Oposición (ARCO) desde la sección "Mi Cuenta":
• Acceso: revisar sus datos de operador, dispositivos de confianza y reportes privados.
• Rectificación: cambiar o eliminar su foto de perfil y actualizar o recuperar su contraseña mediante verificación OTP por correo.
• Cancelación (Eliminación Irreversible): eliminar su cuenta permanentemente tras confirmar su contraseña actual y un código OTP. Esta operación borra de inmediato en servidor el perfil, avatar, sesiones activas, dispositivos de confianza, códigos OTP y todos los tickets de diagnóstico y sugerencias asociados a su DNI.

7. ACEPTACIÓN EXPRESA
Al marcar la casilla de aceptación durante el registro o continuar utilizando la plataforma, el Usuario otorga su consentimiento libre, previo, expreso e informado con todas las cláusulas de esta Política de Privacidad y Términos de Uso (v2.0).`;
