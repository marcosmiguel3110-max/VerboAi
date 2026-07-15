# Despliegue en Render

## Variables de Entorno
Configura estas variables en el dashboard de Render:
- `GROQ_API_KEY`: Tu clave de API de Groq
- `GROQ_MODEL`: (opcional) Modelo de texto, default: openai/gpt-oss-20b
- `GROQ_MODEL_VISION`: (opcional) Modelo de visión, default: meta-llama/llama-4-scout-17b-16e-instruct
- `MONGODB_URI`: Tu conexión de MongoDB Atlas
- `MONGODB_DB_NAME`: (opcional) Nombre de la base de datos, default: biblia_ai
- `EMAIL_USER`: Tu correo de Gmail para enviar códigos de verificación
- `EMAIL_APP_PASSWORD`: Contraseña de aplicación de Gmail (NO tu contraseña normal)
- `RESEND_API_KEY`: (opcional) Clave de API de Resend como alternativa a SMTP
- `APP_USER`: Usuario admin para login (ej: admin)
- `APP_PASS`: Contraseña para el usuario admin
- `AUTH_SECRET`: Secreto aleatorio largo para firmar cookies (genera uno con: openssl rand -base64 32)

## Configuración de Email
Tienes dos opciones para enviar correos:

### Opción 1: Gmail SMTP (puede fallar en Render)
1. Ve a https://myaccount.google.com/security
2. Activa "Verificación en dos pasos"
3. Ve a "Contraseñas de aplicación"
4. Crea una nueva contraseña de aplicación para "Correo"
5. Usa esa contraseña en `EMAIL_APP_PASSWORD`

### Opción 2: Resend API (recomendado para Render)
1. Ve a https://resend.com/
2. Regístrate y obtén tu API key
3. Configura `RESEND_API_KEY` en Render
4. El sistema usará Resend automáticamente si SMTP falla

## Nota sobre SMTP en Render
Render puede bloquear conexiones SMTP salientes. El sistema tiene fallback automático:
- Primero intenta SMTP (Gmail)
- Si SMTP falla, usa Resend API
- Si ambos fallan, el login con Google funcionará en modo directo sin código

## Persistencia con MongoDB (ya integrada)
La app ahora guarda todo (historial de chats, usuarios y progreso de lectura
de la Biblia) en MongoDB, ademas de los archivos locales de `memory/`. Para
activarlo, configura en Render:
- `MONGODB_URI`: tu cadena de conexion de MongoDB Atlas (ej: `mongodb+srv://usuario:clave@cluster.mongodb.net/?appName=Cluster0`)
- `MONGODB_DB_NAME`: (opcional) nombre de la base de datos, default: `biblia_ai`

Como funciona:
- Cada escritura (nuevo mensaje, nuevo usuario, progreso de lectura) se guarda
  primero en el archivo local y luego se espeja en MongoDB en segundo plano.
- Al arrancar, el servidor se conecta a MongoDB y "hidrata" los archivos
  locales con lo ultimo guardado ahi, asi que aunque Render borre el disco en
  cada deploy o reinicio, los datos reales sobreviven en la base de datos.
- Si `MONGODB_URI` no esta configurada o Mongo no responde, la app sigue
  funcionando igual que antes (solo con archivos locales), sin romperse.

## Limitaciones sin MongoDB
Si no configuras `MONGODB_URI`, Render usa un sistema de archivos efímero:
- El directorio `memory/` se perderá cada vez que el servicio se reinicia
- El historial de chat y el progreso de lectura de la Biblia NO serán persistentes

## Nota de Deploy
Última actualización: Código actualizado desde zip. Integración con MongoDB Atlas para persistencia de datos. Fallback a Resend API implementado para solucionar bloqueos SMTP en Render.
