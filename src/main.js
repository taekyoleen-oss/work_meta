// 3D 장면: 3인칭 이동, 클릭 상호작용, 담당자 표시.
import * as THREE from 'three';
import { BOARD_STAND, COLS, ROWS, SLOTS, buildOffice, drawerStand, makeAvatar, toCell, toWorld, BOUNDS } from './world.js';
import { findPath, nearestFree } from './nav.js';
import { all, onChange, openStore } from './store.js';
import { recoverInterrupted } from './agents.js';
import { initUI, openAgent, openBoard, openDrawer } from './ui.js';

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#9fd0ee');
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);

scene.add(new THREE.HemisphereLight('#ffffff', '#b8a68c', 1.5));
const sun = new THREE.DirectionalLight('#fff3e0', 1.6);
sun.position.set(8, 14, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 12, bottom: -12, far: 40 });
scene.add(sun);

const office = buildOffice(scene);
const player = makeAvatar('#f4f4f2');
player.position.set(0, 0, 6);
player.rotation.y = Math.PI;
scene.add(player);

// 카메라 궤도
const orbit = { yaw: 0, pitch: 0.42, dist: 9 };
const look = new THREE.Vector3();

// 이동
const SPEED = 4;
let path = [], onArrive = null;

function walkTo(x, z, then = null) {
  const start = nearestFree(office.blocked, COLS, ROWS, toCell(player.position.x, player.position.z));
  const goal = nearestFree(office.blocked, COLS, ROWS, toCell(x, z));
  const cells = start && goal && findPath(office.blocked, COLS, ROWS, start, goal);
  if (!cells) return;
  path = cells.slice(1).map(toWorld);
  onArrive = then;
  if (!path.length) arrive();
}
function arrive() {
  const fn = onArrive;
  onArrive = null;
  fn?.();
}

const keys = new Set();
const typing = () => /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? '');
addEventListener('keydown', (e) => { if (!typing() && 'wasd'.includes(e.key.toLowerCase())) keys.add(e.key.toLowerCase()); });
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

// 입력
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let drag = null;

canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, moved: false };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 6) return;
  drag.moved = true;
  orbit.yaw -= dx * 0.006;
  orbit.pitch = Math.min(1.25, Math.max(0.12, orbit.pitch + dy * 0.004));
  drag.x = e.clientX; drag.y = e.clientY;
});
canvas.addEventListener('pointerup', (e) => {
  const clicked = drag && !drag.moved;
  drag = null;
  if (clicked) handleClick(e);
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  orbit.dist = Math.min(16, Math.max(4, orbit.dist + e.deltaY * 0.01));
}, { passive: false });

function handleClick(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects([...office.interactive, ...[...avatars.values()].map((a) => a.mesh)], true)[0];
  if (!hit) return;
  let o = hit.object;
  while (o && !o.userData.action && !o.userData.floor) o = o.parent;
  if (!o) return;
  if (o.userData.floor) return walkTo(hit.point.x, hit.point.z);
  const a = o.userData.action;
  if (a.type === 'agent') {
    const [x, z] = SLOTS[a.slot].stand;
    walkTo(x, z, () => openAgent(a.id));
  } else if (a.type === 'drawer') {
    walkTo(...drawerStand(a.cabinet), () => { slideDrawer(a.id); openDrawer(a.id); });
  } else if (a.type === 'board') walkTo(...BOARD_STAND, openBoard);
}

// 서랍 애니메이션
let openDrawerId = null;
function slideDrawer(id) { openDrawerId = id; }

// 담당자 아바타와 머리 위 표시
const labels = document.getElementById('labels');
const avatars = new Map();

async function syncAgents() {
  const [agents, tasks] = await Promise.all([all('agents'), all('tasks')]);
  const seen = new Set();
  for (const agent of agents) {
    seen.add(agent.id);
    let a = avatars.get(agent.id);
    if (a && (a.color !== agent.color || a.slot !== agent.slot)) { removeAvatar(agent.id); a = null; }
    if (!a) {
      const mesh = makeAvatar(agent.color);
      const [x, z] = SLOTS[agent.slot].seat;
      mesh.position.set(x, 0, z);
      mesh.userData.action = { type: 'agent', id: agent.id, slot: agent.slot };
      scene.add(mesh);
      const tag = document.createElement('div');
      tag.className = 'tag';
      labels.append(tag);
      a = { mesh, tag, color: agent.color, slot: agent.slot };
      avatars.set(agent.id, a);
    }
    const mine = tasks.filter((t) => t.agentId === agent.id);
    const running = mine.some((t) => t.status === 'running');
    const last = mine.sort((x, y) => y.createdAt - x.createdAt)[0];
    const failed = !running && last?.status === 'failed';
    a.tag.className = `tag ${running ? 'running' : failed ? 'failed' : ''}`;
    a.tag.textContent = `${agent.name} · ${running ? '작업 중' : failed ? '실패' : agent.role}`;
    const screen = office.monitors[agent.slot].material;
    screen.emissive.set(running ? '#ffb703' : failed ? '#c0392b' : '#4cc9f0');
  }
  for (const id of avatars.keys()) if (!seen.has(id)) {
    office.monitors[avatars.get(id).slot].material.emissive.set('#20262e');
    removeAvatar(id);
  }
}
function removeAvatar(id) {
  const a = avatars.get(id);
  scene.remove(a.mesh);
  a.tag.remove();
  avatars.delete(id);
}

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

const clock = new THREE.Clock();
const v = new THREE.Vector3();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  let moving = false;

  const kx = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0), kz = (keys.has('s') ? 1 : 0) - (keys.has('w') ? 1 : 0);
  if (kx || kz) {
    path = []; onArrive = null;
    const len = Math.hypot(kx, kz), c = Math.cos(orbit.yaw), s = Math.sin(orbit.yaw);
    const dx = ((kx * c + kz * s) / len) * SPEED * dt, dz = ((-kx * s + kz * c) / len) * SPEED * dt;
    const nx = player.position.x + dx, nz = player.position.z + dz;
    if (Math.abs(nx) < BOUNDS.x && Math.abs(nz) < BOUNDS.z && !office.blocked.has(toCell(nx, nz).join(','))) {
      player.position.x = nx; player.position.z = nz;
    }
    player.rotation.y = Math.atan2(dx, dz);
    moving = true;
  } else if (path.length) {
    const [tx, tz] = path[0];
    const dx = tx - player.position.x, dz = tz - player.position.z, d = Math.hypot(dx, dz), step = SPEED * dt;
    if (d <= step) {
      player.position.x = tx; player.position.z = tz;
      path.shift();
      if (!path.length) arrive();
    } else {
      player.position.x += (dx / d) * step; player.position.z += (dz / d) * step;
      player.rotation.y = Math.atan2(dx, dz);
    }
    moving = true;
  }
  player.children.forEach((c) => {
    if (c.userData.leg) c.position.z = moving ? Math.sin(t * 12) * 0.12 * c.userData.leg : 0;
  });

  for (const [id, d] of office.drawers) {
    const target = d.userData.closedZ + (id === openDrawerId ? 0.5 : 0);
    d.position.z += (target - d.position.z) * Math.min(1, dt * 8);
  }

  look.set(player.position.x, 1.1, player.position.z);
  const cp = Math.cos(orbit.pitch);
  camera.position.set(
    look.x + Math.sin(orbit.yaw) * cp * orbit.dist,
    look.y + Math.sin(orbit.pitch) * orbit.dist,
    look.z + Math.cos(orbit.yaw) * cp * orbit.dist,
  );
  camera.lookAt(look);
  for (const w of office.walls) w.mesh.visible = !w.hidden(camera.position);

  camera.updateMatrixWorld();
  for (const a of avatars.values()) {
    a.mesh.lookAt(player.position.x, 0, player.position.z);
    a.mesh.position.y = Math.abs(Math.sin(t * 2 + a.slot)) * 0.02;
    v.set(a.mesh.position.x, 1.85, a.mesh.position.z).project(camera);
    const show = v.z < 1;
    a.tag.style.display = show ? '' : 'none';
    if (show) a.tag.style.transform = `translate(calc(${((v.x + 1) / 2) * innerWidth}px - 50%), ${((1 - v.y) / 2) * innerHeight}px)`;
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

try {
  await openStore();
  await recoverInterrupted();
  initUI({ walkToAgent: (slot, then) => walkTo(...SLOTS[slot].stand, then), slideDrawer, closeDrawers: () => slideDrawer(null) });
  onChange(syncAgents);
  await syncAgents();
  resize();
  frame();
} catch (e) {
  document.getElementById('hint').textContent = `시작 실패: ${e.message}`;
  throw e;
}
