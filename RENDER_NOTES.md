# Despliegue en Render

## Variables de Entorno
Configura estas variables en el dashboard de Render (todas son opcionales, la app
funciona sin ninguna key porque usa exclusivamente modelos gratis de OpenRouter
free-tier y Pollinations, ver https://github.com/ClawLabsAI/free-ai-models):
- `OPENROUTER_FREE_ENABLED`: (opcional) Activa/desactiva la cascada de OpenRouter free, default: true
- `OPENROUTER_API_KEY`: (opcional) Sube el rate limit de OpenRouter (20 req/min sin key)
- `OPENROUTER_FREE_TIMEOUT`: (opcional) Timeout en ms, default: 60000
- `POLLINATIONS_TEXT_ENABLED_PRO`: (opcional) Activa el fallback final a Pollinations texto, default: true
- `POLLINATIONS_TEXT_API_TOKEN`: (opcional) Token gratis de Pollinations para desbloquear modelos "nectar"
- `GPT4FREE_ENABLED_PRO` / `GPT4FREE_URL`: (opcional) Puente g4f extra, solo para NewserPro/NewserAdmin
- `MONGODB_URI`: Tu conexión de MongoDB Atlas
- `MONGODB_DB_NAME`: (opcional) Nombre de la base de datos, default: biblia_ai
- `EMAIL_USER`: Tu correo de Gmail para enviar códigos de verificación
- `EMAIL_APP_PASSWORD`: Contraseña de aplicación de Gmail (NO tu contraseña normal)
- `RESEND_API_KEY`: (opcional) Clave de API de Resend como alternativa a SMTP
- `RESEND_FROM_EMAIL`: (opcional) Remitente a usar con Resend, ej: `Verbo AI <codigo@tudominio.com>`. Necesario para enviar a destinatarios distintos de tu propio correo (ver sección de Resend abajo)
- `BREVO_API_KEY`: (opcional, recomendado si NO tenés dominio propio) Clave de API de Brevo
- `BREVO_SENDER_EMAIL`: (opcional) Email verificado como remitente en Brevo (ej: tu Gmail). Si no lo configurás, se usa `EMAIL_USER`
- `APP_USER`: Usuario admin para login (ej: admin)
- `APP_PASS`: Contraseña para el usuario admin
- `AUTH_SECRET`: Secreto aleatorio largo para firmar cookies (genera uno con: openssl rand -base64 32)
- `JUDGE0_API_URL`: (opcional) URL base de Judge0 para la herramienta de ejecución de código de NewserAdvanced1.5. Default: `https://judge0-ce.p.rapidapi.com` (RapidAPI). Si tenés tu propia instancia de Judge0 CE (self-hosted), poné esa URL acá y dejá `JUDGE0_API_KEY` vacío.
- `JUDGE0_API_KEY`: Tu clave de RapidAPI (solo necesaria si usás la URL default de RapidAPI). Conseguila en https://rapidapi.com/judge0-official/api/judge0-ce

## Migración de Piston a Judge0
El sandbox de ejecución de código usaba la API pública de Piston (emkc.org), que
pasó a requerir whitelist obligatoria desde el 15/2/2026 y por eso empezó a
devolver `401` en cada ejecución. Se reemplazó por Judge0, que soporta dos modos:
1. **RapidAPI (recomendado para arrancar rápido)**: dejá `JUDGE0_API_URL` en su
   valor default y configurá `JUDGE0_API_KEY` con tu clave de RapidAPI. Tiene un
   plan gratuito con límite de peticiones por día/mes.
2. **Self-hosted**: si preferís no depender de un tercero, podés levantar tu
   propia instancia de Judge0 CE en un contenedor Docker (en Render o donde sea)
   y apuntar `JUDGE0_API_URL` a esa URL, sin necesidad de `JUDGE0_API_KEY`.

De paso se corrigió un bug donde el costo en créditos de las herramientas
(`web`, `code`) se cobraba completo aunque la herramienta fallara (por ejemplo,
cuando Piston tiraba 401). Ahora el costo se reserva por adelantado pero solo
se cobra lo que efectivamente se ejecutó con éxito; lo demás se reembolsa
automáticamente.

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

**IMPORTANTE - modo sandbox:** con solo el API key, tu cuenta de Resend
queda en modo de prueba y *solo* puede enviar correos a la dirección con la
que te registraste (en este caso `mmodcat@gmail.com`). Cualquier otro
destinatario va a fallar con `403 validation_error`. Para mandar códigos a
usuarios reales tenés que:
1. Ir a https://resend.com/domains y agregar un dominio propio (uno que ya
   tengas, ej. `tudominio.com`).
2. Cargar los registros DNS (SPF/DKIM) que Resend te indique, en el
   proveedor donde compraste el dominio.
3. Esperar a que el dominio quede verificado (puede tardar unos minutos a
   pocas horas).
4. En Render, agregar la variable `RESEND_FROM_EMAIL` con un remitente de
   ese dominio, ej: `Verbo AI <codigo@tudominio.com>`.

Si no tenés un dominio propio todavía, no hay atajo: Resend (y la mayoría
de proveedores transaccionales tipo SendGrid/Mailgun) exigen dominio
verificado para enviar a destinatarios arbitrarios. Mientras tanto podés
seguir probando el registro solo con `mmodcat@gmail.com`.

### Opción 3: Brevo API (recomendado si NO tenés dominio propio)
A diferencia de Resend, Brevo te deja mandar correos a cualquier
destinatario sin verificar un dominio — solo tenés que verificar tu propio
email de remitente (por ejemplo tu Gmail) con un código de 6 dígitos.
Gratis hasta 300 correos por día.

1. Andá a https://www.brevo.com/ y creá una cuenta gratis.
2. En el dashboard: Settings → Senders, Domains, IPs → Senders → Add a sender.
3. Poné tu email (ej: `mmodcat@gmail.com`) y verificalo con el código de 6
   dígitos que te llega a esa bandeja.
4. Andá a SMTP & API → API Keys → Generate a new API key. Copiá esa clave.
5. En Render, agregá las variables:
   - `BREVO_API_KEY`: la clave que generaste
   - `BREVO_SENDER_EMAIL`: el mismo email que verificaste como sender (ej:
     `mmodcat@gmail.com`)
6. El sistema va a usar Brevo automáticamente si SMTP y Resend fallan.

Este es el camino más simple si no querés comprar un dominio.

## Nota sobre SMTP en Render
Render puede bloquear conexiones SMTP salientes. El sistema tiene fallback automático:
- Primero intenta SMTP (Gmail)
- Si SMTP falla, usa Resend API
- Si Resend falla (o no está configurado), usa Brevo API
- Si los tres fallan, el login con Google funcionará en modo directo sin código

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
