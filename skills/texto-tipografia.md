# Skill: Texto, tipografía y formularios

Trigger: el usuario pide texto animado, títulos llamativos, efecto máquina de
escribir, contadores numéricos, marquee/scroll de texto, o cualquier
formulario/input con validación de texto.

- Jerarquía tipográfica clara: un tamaño/peso para título, otro para
  subtítulo, otro para cuerpo — nunca todo el mismo `font-size`. Usá `clamp()`
  en CSS para que el texto escale con el viewport sin media queries a mano
  para cada tamaño (ej: `font-size: clamp(1.5rem, 4vw, 3rem)`).
- Efecto máquina de escribir (typewriter): revelar caracter por caracter con
  `setInterval`/`requestAnimationFrame`, nunca cortar a mitad de una entidad
  HTML o emoji multi-byte (iterar con `[...texto]` para respetar caracteres
  Unicode compuestos, no `texto[i]`). Cursor parpadeante con CSS
  `animation`, no JS.
- Contadores numéricos (score, stats, countdown): animar con
  `requestAnimationFrame` interpolando el valor con easing (nunca `setInterval`
  actualizando de a 1 en 1 si el rango es grande, se ve entrecortado), y
  formatear el número final (separadores de miles, decimales fijos) recién al
  renderizar, no en cada frame intermedio.
- Texto que se ve recortado o desborda: `overflow-wrap: break-word` +
  `text-overflow: ellipsis` con `white-space: nowrap` y `overflow: hidden`
  cuando corresponda una sola línea; nunca dejar que el texto rompa el layout.
- Formularios: validación en tiempo real (`input` event, no solo `submit`)
  con mensaje de error específico (no genérico "campo inválido"), asociar
  cada error a su campo con `aria-describedby`, y nunca bloquear el envío sin
  mostrar por qué. Placeholder no reemplaza a un `<label>` real (accesibilidad
  y que no se pierda el texto de ayuda al escribir).
- Contraste de texto: fondo oscuro con texto claro (o viceversa) con relación
  de contraste mínima legible; evitar gris claro sobre blanco o gris oscuro
  sobre negro por "estética", rompe legibilidad real.
