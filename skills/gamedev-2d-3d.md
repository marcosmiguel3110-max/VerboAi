# Skill: Desarrollo de juegos 2D/3D (canvas, three.js, motores tipo Minecraft/Terraria)

Trigger: el usuario pide un juego, un motor de juego, algo tipo Minecraft/Terraria,
un mundo voxel, o menciona canvas/three.js/webgl junto con "juego"/"game".

## 2D (canvas)
- Usá `<canvas>` + `requestAnimationFrame` a mano (sin librerías salvo que el
  usuario pida una).
- Estructura obligatoria: game-loop con delta time, un grid de tiles (array 2D)
  para el mundo, cámara/viewport que sigue al jugador, capa de colisiones
  separada de la capa visual.
- Usá `[[TEXTURE::]]` para los tiles/sprites en vez de rectángulos de color.

## 3D (three.js, mundos tipo Minecraft)
- Instalá three.js con `[[NPM_INSTALL::three]]` y cargalo desde esm.sh.
- NO uses greedy meshing ni generación de mesh custom por chunk: es la fuente #1
  de bugs. Usá SIEMPRE `THREE.InstancedMesh` con un `THREE.BoxGeometry(1,1,1)`
  compartido: un InstancedMesh por tipo de bloque, y `setMatrixAt(i, matrix)`
  para cada bloque visible. Es mucho más simple, no rompe, y rinde bien hasta
  varios miles de bloques.
- Antes de instanciar bloques: filtrá los que tienen los 6 vecinos ocupados (no
  se ven, no hace falta dibujarlos). Esto solo, sin greedy meshing, ya resuelve
  el 90% del problema de performance.
- El terreno es un array 3D simple `mundo[x][y][z] = tipoDeBloque` (0 = aire).
  Generalo con ruido simple (una función pseudo-perlina a mano de 20-30 líneas,
  NO npm-instales una librería de noise salvo que el usuario la pida).
- Boilerplate three.js que hay que revisar SIEMPRE porque es donde más rompe:
  1. El renderer necesita `renderer.setSize(window.innerWidth, window.innerHeight)`
     y un listener de `resize` que actualice también `camera.aspect` +
     `camera.updateProjectionMatrix()`.
  2. La textura se carga async con `TextureLoader` — no la uses hasta que el
     callback/onLoad se disparó, si no la caja se ve negra.
  3. El raycaster para romper/poner bloques necesita
     `raycaster.setFromCamera(pointer, camera)` con `pointer` en coordenadas
     normalizadas -1 a 1; el error más común es pasar coordenadas de pixel crudas.
- Cámara/movimiento en primera persona: usá `PointerLockControls` de three
  (`three/examples/jsm/controls/PointerLockControls.js` vía esm.sh), no
  reinventes el mouse-look a mano salvo que el usuario lo pida explícitamente.

## Audio y estructura de archivos
- Audio del juego: siempre real, con Web Audio API (`[[AUDIO::]]` + el código
  real en el JS), nunca placeholders de "sonido aquí".
- Separá SIEMPRE en mínimo estos archivos: `main.js` (loop + setup), `world.js`
  (generación/datos del mundo), `player.js` (movimiento/cámara), `render.js` o
  `blocks.js` (InstancedMesh y texturas). Un juego 3D en un solo archivo gigante
  es la causa #1 de que la respuesta se corte a mitad de camino y el archivo
  quede roto.

## Autocrítica obligatoria antes de entregar
¿El resize del canvas/renderer está manejado? ¿Las texturas se usan después de
cargar, no antes? ¿El raycaster usa coordenadas normalizadas? ¿El loop usa delta
time y no un valor fijo? ¿Hay algún InstancedMesh con más instancias que las
declaradas en el constructor (`new THREE.InstancedMesh(geo, mat, MAX_INSTANCIAS)`)?
Si algo de esto está mal, corregilo antes de responder.

## Diseño visual / "juice" (obligatorio, no opcional)
- Paleta de colores definida antes de tocar código: 4-6 colores coherentes
  (base + acento + UI), nunca colores default del navegador ni rectángulos
  grises sin estilo.
- HUD/UI del juego (vida, puntaje, inventario) con tipografía legible,
  contraste correcto y layout prolijo, no texto crudo pegado en la esquina.
- Feedback visual en cada acción: hit-flash o tint al recibir daño,
  screen-shake corto en impactos/explosiones, partículas simples en
  golpes/pasos/recolección de items, transición suave al cambiar de pantalla o
  morir.
- Animación: sprites 2D con al menos 2-4 frames por estado (idle/caminar/atacar)
  o interpolación de rotación/escala en 3D; nunca un personaje 100% estático.
- Iluminación 3D: como mínimo una luz ambiental + una direccional/punto con
  sombras básicas (`renderer.shadowMap.enabled`, `castShadow`/`receiveShadow`).
- Menú de inicio y pantalla de game-over con estilo propio (no un `alert()` ni
  texto sin formato), coherentes con la paleta elegida.
- Si el usuario no especificó un estilo visual, elegí uno concreto vos mismo
  (pixel-art retro, low-poly pastel, neón oscuro) y aplicalo consistentemente.
