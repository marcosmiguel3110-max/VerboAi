# Skill: Audio con Web Audio API (sonido/música procedural)

Trigger: el usuario pide efectos de sonido, música, un "beep", feedback
sonoro para un juego o UI, o cualquier audio que deba generarse en el
navegador SIN archivos externos (mp3/wav no sirven acá: no hay forma de
generarlos server-side gratis, así que TODO sonido se sintetiza en vivo con
Web Audio API).

- Un solo `AudioContext` por proyecto, creado una vez y reusado (crear uno
  nuevo por cada sonido rompe en la mayoría de navegadores después de unos
  pocos). Si hace falta, crealo recién en el primer click/tecla del usuario
  (los navegadores bloquean autoplay de audio sin interacción previa).
- Efectos cortos (saltos, choques, monedas, clicks de UI): `OscillatorNode`
  con `frequency` variando en el tiempo (`setValueAtTime`/`linearRampToValueAtTime`/
  `exponentialRampToValueAtTime`) + un `GainNode` con envolvente ADSR corta
  (attack rápido, decay/release para que no corte seco). Tipo de onda
  (`sine`, `square`, `triangle`, `sawtooth`) según el carácter: `sine` suave,
  `square`/`sawtooth` más "8-bit"/agresivo.
- Ruido (explosiones, viento, impactos): `AudioBufferSourceNode` con un
  buffer generado a mano (`Float32Array` con valores random) pasado por un
  `BiquadFilterNode` (`lowpass`/`bandpass`) para darle forma.
- Música/loops: secuenciar notas con `setTimeout`/`requestAnimationFrame`
  contra un tempo (BPM) fijo, no confiar en `setTimeout` para el timing exacto
  de audio — programar los tiempos de los osciladores con
  `audioCtx.currentTime + offset` (el scheduler de Web Audio es preciso, el
  de JS no).
- SIEMPRE conectar a `audioCtx.destination` al final de la cadena, y
  desconectar/parar nodos (`stop()`, `disconnect()`) cuando termina el sonido
  para no acumular nodos colgados en sonidos que se repiten mucho (saltos en
  un juego, por ejemplo).
- Volumen general: exponer un `GainNode` maestro entre todo y `destination`
  para poder mutear/bajar volumen desde un solo lugar, y arrancarlo en un
  valor razonable (no 1.0 a lo loco, arranca distorsionando si se suman
  varios sonidos a la vez).
