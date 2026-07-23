# Skill: Gráficos 2D / canvas / SVG (no-juego)

Trigger: el usuario pide un dashboard, gráfico, editor de dibujo, diagrama
interactivo, visualizador de datos, animación 2D, o cualquier cosa que se
dibuje en `<canvas>` o SVG pero que NO sea un juego.

- Preferí SVG para gráficos vectoriales que necesitan verse nítidos a
  cualquier zoom (diagramas, íconos, gráficos de barras/líneas simples) y
  `<canvas>` para algo con muchos elementos dinámicos o dibujo a mano alzada
  (pizarras, partículas, mapas de calor con miles de puntos).
- Para gráficos de datos (barras, líneas, torta, dispersión): ejes con
  etiquetas legibles, leyenda si hay más de una serie, tooltip al pasar el
  mouse, y una paleta de 4-6 colores coherente (nunca los colores default del
  navegador).
- Para canvas interactivo (dibujo, pizarra, editor): separá SIEMPRE la capa de
  datos (qué se dibujó, en qué orden, con qué propiedades) de la capa de
  render (el `draw()` que recorre esos datos y pinta). Esto permite deshacer,
  exportar, y redibujar en resize sin perder nada.
- Redibujo responsive: escuchá `resize` y volvé a fijar
  `canvas.width`/`canvas.height` según `devicePixelRatio` para que no se vea
  borroso en pantallas retina (`ctx.scale(dpr, dpr)` después de ajustar el
  tamaño real del canvas).
- Animaciones: usá `requestAnimationFrame` con delta time, nunca
  `setInterval` para loops visuales.
- Interacción: coordenadas de mouse/touch normalizadas contra
  `canvas.getBoundingClientRect()`, nunca `clientX`/`clientY` crudos (rompe en
  cuanto el canvas no está pegado a la esquina superior izquierda).
