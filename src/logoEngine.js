import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import gsap from 'gsap';

const REST_ROTATION = { x: .025, y: -.08, z: 0 };
const MOTION = { entrance: 1.6, turn: 2.6 };

export async function createLogoScene(host, { signal, modelData } = {}) {
  const gltf = await new GLTFLoader().parseAsync(modelData, '');
  const model = gltf.scene;
  const meshes = [], geometries = new Set(), materials = new Set();
  model.traverse(object => {
    if (!object.isMesh) return;
    meshes.push(object);
    geometries.add(object.geometry);
    (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => materials.add(material));
  });
  function disposeModel() {
    geometries.forEach(geometry => geometry.dispose());
    const textures = new Set();
    materials.forEach(material => {
      Object.values(material).forEach(value => { if (value?.isTexture) textures.add(value); });
      material.dispose();
    });
    textures.forEach(texture => { texture.source?.data?.close?.(); texture.dispose(); });
  }
  if (signal?.aborted) {
    disposeModel();
    throw new DOMException('Logo loading cancelled', 'AbortError');
  }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
  } catch (error) { disposeModel(); throw error; }
  const compact = matchMedia('(pointer: coarse)').matches;
  renderer.setPixelRatio(Math.min(devicePixelRatio, compact ? 1.35 : 1.7));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, .1, 80);
  const room = new RoomEnvironment(), pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(room, .04);
  scene.environment = environment.texture;
  room.dispose(); pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x0c4932, .45));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(-3, 4, 6); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9bffd0, .8);
  rim.position.set(5, -1, 3); scene.add(rim);
  const bounds = new THREE.Box3().setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());
  model.position.sub(center);
  const rig = new THREE.Group(); rig.add(model); scene.add(rig);
  materials.forEach(material => { material.envMapIntensity = .68; });

  // Animate the Blender object nodes, keeping each front face and side wall together.
  const parts = model.children.map(object => ({ object, rest: object.position.clone() }));
  let alive = true, visible = true, paused = false, contextLost = false;
  let frame = 0, last = 0, time = 0, timeline, turn;
  const pointer = { x: 0, y: 0 }, pose = { x: 0, y: 0 };
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const frameInterval = compact ? 1000 / 30 : 1000 / 60;
  host.appendChild(renderer.domElement);
  host.dataset.meshCount = String(meshes.length);
  host.dataset.objectCount = String(parts.length);

  function render() { if (!contextLost) renderer.render(scene, camera); }
  function resize() {
    const rect = host.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    camera.aspect = rect.width / rect.height;
    const tangent = Math.tan(Math.PI * 16 / 180);
    camera.position.z = Math.max(size.y / 2 / tangent, size.x / 2 / camera.aspect / tangent) * 1.1;
    camera.updateProjectionMatrix();
    renderer.setSize(rect.width, rect.height); render();
  }
  function canRun() { return alive && visible && !document.hidden && !paused && !motion.matches && !contextLost; }
  function tick(now) {
    frame = 0;
    if (!canRun()) return;
    if (now - last >= frameInterval - 1) {
      const delta = Math.min((now - last) / 1000, .06);
      last = now; time += delta;
      const easing = 1 - Math.exp(-4 * delta);
      pose.x += (-pointer.y * .12 - pose.x) * easing;
      pose.y += (pointer.x * .2 - pose.y) * easing;
      rig.rotation.x = pose.x; rig.rotation.y = pose.y;
      rig.position.y = Math.sin(time * .65) * .055;
      render();
    }
    frame = requestAnimationFrame(tick);
  }
  function start() {
    if (!frame && canRun()) { last = performance.now(); frame = requestAnimationFrame(tick); }
  }
  function sync() {
    cancelAnimationFrame(frame); frame = 0;
    const running = visible && !document.hidden && !paused && !contextLost;
    timeline?.paused(!running); turn?.paused(!running);
    host.dataset.renderState = contextLost ? 'unavailable' : paused ? 'paused' : motion.matches ? 'reduced' : running ? 'running' : 'suspended';
    start(); render();
  }
  function replay() {
    timeline?.kill(); turn?.kill(); timeline = null; turn = null;
    if (motion.matches) {
      parts.forEach(({ object, rest }) => object.position.copy(rest));
      model.rotation.set(0, 0, 0); sync(); return;
    }
    timeline = gsap.timeline();
    // Keep every original letter and ribbon registered as a single brand mark.
    parts.forEach(({ object, rest }) => object.position.copy(rest));
    model.rotation.set(.06, -.3, 0);
    timeline.to(model.rotation, { ...REST_ROTATION, duration: MOTION.entrance, ease: 'power3.out' }, 0);
    sync();
  }
  function rotate() {
    if (motion.matches) return;
    timeline?.progress(1); turn?.kill();
    turn = gsap.to(model.rotation, { y: model.rotation.y + Math.PI * 2, duration: MOTION.turn, ease: 'power2.inOut', onComplete: () => { model.rotation.y = REST_ROTATION.y; } });
    sync();
  }
  function move(event) {
    if (event.pointerType === 'touch') return;
    const rect = host.getBoundingClientRect();
    pointer.x = (event.clientX - rect.left) / rect.width * 2 - 1;
    pointer.y = (event.clientY - rect.top) / rect.height * 2 - 1;
  }
  function leave() { pointer.x = 0; pointer.y = 0; }
  function preference() {
    timeline?.kill(); turn?.kill();
    rig.rotation.set(0, 0, 0); rig.position.set(0, 0, 0); pose.x = 0; pose.y = 0;
    replay();
  }
  function loseContext(event) { event.preventDefault(); contextLost = true; sync(); }
  function restoreContext() { contextLost = false; resize(); sync(); }
  const ro = new ResizeObserver(resize); ro.observe(host);
  const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); }); io.observe(host);
  host.addEventListener('pointermove', move); host.addEventListener('pointerleave', leave);
  document.addEventListener('visibilitychange', sync); motion.addEventListener('change', preference);
  renderer.domElement.addEventListener('webglcontextlost', loseContext);
  renderer.domElement.addEventListener('webglcontextrestored', restoreContext);
  resize(); replay();
  return {
    replay, rotate, pause(value) { paused = value; sync(); },
    dispose() {
      if (!alive) return;
      alive = false; cancelAnimationFrame(frame); timeline?.kill(); turn?.kill(); ro.disconnect(); io.disconnect();
      host.removeEventListener('pointermove', move); host.removeEventListener('pointerleave', leave);
      document.removeEventListener('visibilitychange', sync); motion.removeEventListener('change', preference);
      renderer.domElement.removeEventListener('webglcontextlost', loseContext);
      renderer.domElement.removeEventListener('webglcontextrestored', restoreContext);
      disposeModel(); environment.dispose(); renderer.dispose(); renderer.domElement.remove();
      delete host.dataset.meshCount; delete host.dataset.objectCount; delete host.dataset.renderState;
    },
  };
}
