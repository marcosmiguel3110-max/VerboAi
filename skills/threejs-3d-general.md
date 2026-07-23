# Skill: 3D general con three.js (no-juego): viewers, configuradores, data viz 3D

Trigger: el usuario pide visualizar un objeto/modelo 3D, un configurador de
producto, una escena 3D decorativa/hero para una landing, o graficar datos en
3D, sin que sea un juego jugable.

- Instalá three.js con `[[NPM_INSTALL::three]]` y cargalo desde esm.sh.
- Escena base mínima: `Scene`, `PerspectiveCamera`, `WebGLRenderer` con
  `antialias: true`, una luz ambiental + una direccional. Sin esto la escena
  se ve plana o directamente negra.
- Controles de cámara: `OrbitControls` (`three/examples/jsm/controls/OrbitControls.js`
  vía esm.sh) para que el usuario pueda rotar/zoomear con el mouse, salvo que
  pida una cámara fija.
- Resize obligatorio: listener de `resize` que actualice
  `renderer.setSize(...)`, `camera.aspect` y `camera.updateProjectionMatrix()`.
  Es el bug #1 en escenas three.js: se ve bien al cargar y se rompe apenas
  cambia el tamaño de ventana.
- Modelos externos (glTF/GLB): `GLTFLoader` vía esm.sh, y SIEMPRE mostrar un
  estado de carga (spinner/porcentaje) mientras el modelo no llegó — no dejar
  la escena vacía en silencio.
- Data viz 3D (barras/puntos en 3D): usá geometría instanciada
  (`InstancedMesh`) si hay muchos elementos (>200), no un mesh por dato suelto,
  o el framerate se cae.
- Performance: `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))`
  para no reventar el framerate en pantallas retina/4k.
- Cleanup: si la escena vive dentro de un componente que se puede desmontar,
  cancelá el `requestAnimationFrame` y hacé `dispose()` de geometrías/materiales
  al salir, para no dejar loops de render corriendo en el fondo.
