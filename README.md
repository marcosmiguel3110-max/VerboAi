# Verbo AI

Chat web con tematica biblica, potenciado por Groq (modelo `openai/gpt-oss-20b`),
con memoria persistente en disco y soporte para analizar imagenes.

## ⚠️ Importante sobre tu API key

Pegaste tu API key de Groq directamente en el chat. Por seguridad:

1. Ya quedo guardada en el archivo `.env` (no se sube a git gracias al `.gitignore`).
2. **Te recomiendo regenerar esa key** en https://console.groq.com/keys, ya que
   quedo expuesta en esta conversacion. Genera una nueva y reemplazala en `.env`.
3. Nunca pongas la key directamente en el HTML/JS del navegador: por eso el
   servidor (`server.js`) es quien habla con Groq, y el navegador nunca ve la key.

## Estructura

```
biblia-ai/
├── server.js          # Backend Express: llama a Groq, guarda memoria
├── package.json
├── .env               # Tu API key (no compartir)
├── public/
│   ├── index.html
│   ├── style.css
│   └── script.js
└── memory/
    └── historial.json # Aqui se guarda toda la conversacion (memoria)
```

## Instalacion

```bash
cd biblia-ai
npm install
npm start
```

Luego abre: http://localhost:3000

## Notas sobre el modelo y las imagenes

- El modelo configurado es `openai/gpt-oss-20b` via Groq (variable `GROQ_MODEL` en `.env`).
- Este modelo es principalmente de texto/razonamiento. Si al enviar una imagen
  el servidor responde con un error de Groq indicando que el modelo no admite
  imagenes, cambia `GROQ_MODEL` en `.env` por un modelo con vision disponible
  en tu cuenta de Groq (por ejemplo alguno de la familia Llama con "vision"),
  y reinicia el servidor.

## Memoria

Toda la conversacion (usuario + respuestas) se guarda en
`memory/historial.json` dentro de la carpeta del proyecto. Se carga
automaticamente al abrir la pagina. Puedes borrarla con el boton
"Borrar memoria" en la barra lateral.

## Personalizacion

- Colores: variables CSS al inicio de `public/style.css` (`:root`).
- Icono/logo: SVG dentro de `public/index.html` (clase `.logo`), es una cruz,
  puedes cambiarlo por otro icono biblico (paloma, pez, arca, etc).
- Sitios permitidos (redes): edita la seccion `.redes-iconos` en `index.html`.
