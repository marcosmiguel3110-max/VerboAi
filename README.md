# Verbo AI

Chat web con tematica biblica, potenciado 100% por modelos gratuitos (OpenRouter
free-tier + Pollinations texto, ver https://github.com/ClawLabsAI/free-ai-models),
con memoria persistente en disco y soporte para analizar imagenes.

## Estructura

```
biblia-ai/
├── server.js          # Backend Express: llama a los modelos gratis, guarda memoria
├── package.json
├── .env               # Config (no compartir si tenes tokens opcionales)
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

- Cada tier (NewserLite, NewserLiteCompact, NewserAdvanced, NewserAdvanced1.5, NewserPro, NewserAdmin)
  usa una cascada de modelos gratis de OpenRouter (":free") y, si todos fallan,
  Pollinations texto como ultimo recurso. No hace falta ninguna API key para que
  funcione (aunque `OPENROUTER_API_KEY` es opcional y da mas rate limit).
- NewserLiteCompact es igual a NewserLite (mismos modelos), pero con un techo de tokens ~17%
  mas bajo por respuesta: mas economico y mas rapido para consultas cortas de alto volumen.
- Los modelos de vision tambien son gratis (ej. `nvidia/nemotron-nano-12b-v2-vl:free`).
  Si un modelo de vision especifico deja de estar disponible, la cascada prueba el
  siguiente automaticamente; podes ajustar la lista en `MODELOS_DISPONIBLES` dentro
  de `server.js`.

## Panel de admin

Las cuentas administradoras (por defecto `marcos.miguel.3110@gmail.com`) tienen una seccion
"Administradores" dentro del panel "Codes" (icono en la barra lateral) donde pueden agregar o
quitar otros administradores por su cuenta de Gmail. Se guarda al instante en
`memory/admins.json` (sin redeploy), y la cuenta principal nunca se puede quitar por error.

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
