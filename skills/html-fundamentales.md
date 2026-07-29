# Skill: Fundamentos de HTML (evitar errores comunes)

Esta skill aplica a CASI TODO lo que generás en Verbo Code, porque casi
cualquier proyecto tiene un index.html. Los errores más comunes que se ven
en código generado por IA no son de lógica, son de estructura HTML básica —
esta lista existe para no cometerlos.

- Doctype y estructura obligatoria: `<!DOCTYPE html>` primero, siempre.
  `<html lang="es">` (o el idioma que corresponda) con `<head>` y `<body>`
  bien formados. Dentro de `<head>`: `<meta charset="UTF-8">` PRIMERO (antes
  que cualquier otro meta o title, si no el navegador puede re-interpretar
  caracteres ya parseados) y `<meta name="viewport" content="width=device-width, initial-scale=1.0">`
  siempre que el proyecto deba verse bien en mobile (casi siempre).

- Cierre de etiquetas: TODAS las etiquetas que no son de auto-cierre
  (`<img>`, `<br>`, `<input>`, `<hr>`, `<meta>`, `<link>`) necesitan su
  cierre. Un `<div>` sin `</div>` correspondiente rompe silenciosamente el
  layout de todo lo que viene después (el navegador intenta recuperarse pero
  el resultado casi nunca es el esperado). Contá mentalmente apertura/cierre
  en estructuras anidadas antes de dar por terminado un archivo.

- Anidación válida (esto rompe renderizado si se ignora):
  - `<p>` no puede contener otro `<p>`, ni `<div>`, ni `<ul>`/`<ol>` — el
    navegador cierra el `<p>` solo apenas encuentra un bloque adentro,
    dejando el HTML resultante distinto al que escribiste.
  - `<a>` no puede contener otro `<a>` ni elementos interactivos anidados
    (`<button>` dentro de `<a>`, etc).
  - `<button>` no puede contener `<a>`, `<input>`, ni otro `<button>`.
  - `<table>` necesita `<tr>` con `<td>`/`<th>` — nunca texto o `<div>`
    sueltos directo dentro de `<table>` o `<tr>`.
  - `<ul>`/`<ol>` solo pueden tener `<li>` como hijo directo (nada de texto
    o `<div>` suelto ahí adentro).
  - `<select>` solo puede tener `<option>`/`<optgroup>` como hijos directos.

- Atributos que se olvidan seguido y rompen accesibilidad o funcionalidad:
  - `<img>` siempre con `alt` (aunque sea `alt=""` si es puramente
    decorativa) y, si conocés las dimensiones, `width`/`height` (evita salto
    de layout al cargar).
  - `<label>` asociado a su input con `for`/`id` correspondientes, o el
    input anidado directo adentro del label — un input sin label asociado
    es un error de accesibilidad común.
  - `<button>` siempre con `type` explícito (`type="button"` si no es un
    submit — si no, dentro de un `<form>` un botón sin type actúa como
    submit por default y puede enviar el formulario sin querer).
  - IDs únicos: nunca repetir un mismo `id` en dos elementos del mismo
    documento (rompe `getElementById`, formularios, y accesibilidad).

- Formularios: cada `<input>`/`<textarea>`/`<select>` dentro de un `<form>`
  necesita `name` si su valor se va a mandar/leer. `<form>` con
  `onsubmit="return false;"` (o `event.preventDefault()` en JS) cuando el
  submit se maneja con JavaScript, si no la página recarga sola.

- Referencias a archivos: los `<link rel="stylesheet" href="...">` y
  `<script src="...">` tienen que apuntar EXACTAMENTE al nombre de archivo
  que se creó con FILE_CREATE (mismo case, misma extensión, misma carpeta si
  hay subcarpetas) — un typo acá dejar todo sin estilos o sin lógica en
  silencio, sin ningún error visible para el usuario.

- Comillas: usar comillas dobles consistentemente en atributos
  (`class="algo"`, no `class='algo'` mezclado con dobles en el mismo
  archivo) — no rompe el HTML pero genera diffs innecesarios y es más fácil
  de leer.

- IDs y clases que el JS espera: si vas a manipular un elemento por
  `document.getElementById('x')` o `querySelector('.y')` desde el JS,
  asegurate de que el HTML tenga exactamente ese `id`/`class` — un mismatch
  entre el nombre usado en el HTML y el que se busca en JS es de los errores
  más comunes y silenciosos (no tira excepción hasta que se intenta usar el
  elemento, y a veces ni eso).
