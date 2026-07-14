# Despliegue en Render

## Variables de Entorno
Configura estas variables en el dashboard de Render:
- `GROQ_API_KEY`: Tu clave de API de Groq
- `GROQ_MODEL`: (opcional) Modelo de texto, default: openai/gpt-oss-20b
- `GROQ_MODEL_VISION`: (opcional) Modelo de visión, default: meta-llama/llama-4-scout-17b-16e-instruct
- `EMAIL_USER`: Tu correo de Gmail para enviar códigos de verificación
- `EMAIL_APP_PASSWORD`: Contraseña de aplicación de Gmail (NO tu contraseña normal)
- `APP_USER`: Usuario admin para login (ej: admin)
- `APP_PASS`: Contraseña para el usuario admin
- `AUTH_SECRET`: Secreto aleatorio largo para firmar cookies (genera uno con: openssl rand -base64 32)

## Configuración de Gmail para Email
Para que el envío de correos funcione en Render:
1. Ve a https://myaccount.google.com/security
2. Activa "Verificación en dos pasos"
3. Ve a "Contraseñas de aplicación"
4. Crea una nueva contraseña de aplicación para "Correo"
5. Usa esa contraseña en `EMAIL_APP_PASSWORD`

## Nota sobre SMTP en Render
Render puede bloquear conexiones SMTP salientes. Si el envío de correos falla, el login con Google funcionará en modo directo sin código de verificación (si EMAIL_USER/EMAIL_APP_PASSWORD no están configurados).

## Limitaciones Importantes
Render usa un sistema de archivos efímero. Esto significa:
- El directorio `memory/` se perderá cada vez que el servicio se reinicia
- El historial de chat y el progreso de lectura de la Biblia NO serán persistentes
- Para persistencia real, necesitarías integrar una base de datos externa (PostgreSQL, MongoDB, etc.)

## Solución Temporal
La app funcionará correctamente en Render, pero los datos se perderán al reiniciar el servicio.
Para una solución de producción, considera:
1. Usar PostgreSQL de Render para persistencia
2. Usar Redis para caché temporal
3. Migrar el almacenamiento de archivos a una base de datos

## Nota de Deploy
Última actualización: Configuración SMTP optimizada con timeouts reducidos para respuestas más rápidas.
