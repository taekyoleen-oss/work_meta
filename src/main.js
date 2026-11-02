// 3D 장면: 이동, 클릭 상호작용, 담당자의 근무·협업 연출.
import * as THREE from 'three';
import { BOARD_STAND, COFFEE_SPOT, COLS, MAP, MEETING, MEETING_ME, MEETING_SPOTS, MY_SEAT, ROOMS, ROWS, SLOTS, buildOffice, doorSign, doorStand, drawerStand, makeAvatar, toCell, toWorld } from './world.js';
import { findPath, nearestFree } from './nav.js';
import { all, get, onChange, openStore } from './store.js';
import { recoverInterrupted, stage } from './agents.js';
import { initUI, openAgent, openBoard, openDoor, openDrawer, openMeeting } from './ui.js';

const canvas = document.getElementById('scene');
// 작은 해상도로 그려 CSS로 확대하면 픽셀 아트처럼 보인다.
const PIXEL = 3;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#f2e3cf');
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);

scene.add(new THREE.HemisphereLight('#ffffff', '#d8cfc0', 2.2));
const sun = new THREE.DirectionalLight('#fff3e0', 1.1);
sun.position.set(10, 20, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 22, bottom: -22, far: 60 });
scene.add(sun);

const office = buildOffice(scene);
const labels = document.getElementById('labels');
const SPEED = 4, SIT_Y = 0.2, TALK_RANGE = 2.8;

const makeTag = () => { const t = document.createElement('div'); t.className = 'tag'; labels.append(t); return t; };
const makeBubble = () => { const b = document.createElement('div'); b.className = 'speech'; b.hidden = true; labels.append(b); return b; };

// 나와 담당자가 공유하는 움직임 상태
const newActor = (mesh, extra = {}) => ({ mesh, path: [], then: null, sitting: false, bubble: makeBubble(), bubbleUntil: 0, ...extra });

const me = newActor(makeAvatar('#23262d'), { tag: makeTag() });
me.tag.textContent = '나 · 대표';
me.tag.classList.add('me');
scene.add(me.mesh);
placeSeated(me, MY_SEAT, 0);

const avatars = new Map();

function placeSeated(actor, [x, z], yaw) {
  actor.mesh.position.set(x, SIT_Y, z);
  actor.mesh.rotation.y = yaw;
  actor.sitting = true;
}
function walkActor(actor, x, z, then = null) {
  actor.sitting = false;
  actor.mesh.position.y = 0;
  const start = nearestFree(office.blocked, COLS, ROWS, toCell(actor.mesh.position.x, actor.mesh.position.z));
  const goal = nearestFree(office.blocked, COLS, ROWS, toCell(x, z));
  const cells = start && goal && findPath(office.blocked, COLS, ROWS, start, goal);
  if (!cells) { then?.(); return; }
  actor.path = cells.map(toWorld);
  actor.then = then;
}
const arrive = (actor) => { const fn = actor.then; actor.then = null; fn?.(); };
const walkMe = (x, z, then) => walkActor(me, x, z, then);

function say(actor, text) {
  actor.bubble.textContent = text;
  actor.bubble.hidden = false;
  actor.bubbleUntil = performance.now() + 3500;
}
const walkTo = (actor, x, z) => new Promise((ok) => walkActor(actor, x, z, ok));

function sitDown(a) {
  if (meeting) return;
  const { seat, yaw, stand } = SLOTS[a.slot];
  walkActor(a, ...stand, () => { if (!a.busy) placeSeated(a, seat, yaw); });
}

// 업무 실행기가 부르는 연출. 3D 동작 때문에 업무가 멈추지 않도록 회의 중에는 건너뛴다.
Object.assign(stage, {
  async visit(agent, other, text) {
    const a = avatars.get(agent.id), b = avatars.get(other.id);
    if (!a || !b || meeting) return;
    a.busy = true;
    const [x, z] = SLOTS[b.slot].stand;
    await walkTo(a, x, z);
    a.mesh.lookAt(b.mesh.position.x, 0, b.mesh.position.z);
    say(a, `${other.name}님, 이것 좀 부탁드려요: ${text.slice(0, 18)}`);
  },
  home(agent) {
    const a = avatars.get(agent.id);
    if (!a) return;
    a.busy = false;
    sitDown(a);
  },
  say(agent, text) { const a = avatars.get(agent.id); if (a) say(a, text); },
  async report(agent, text) {
    const a = avatars.get(agent.id);
    if (!a || meeting) { if (a) say(a, text); return; }
    a.busy = true;
    const { x, z } = me.mesh.position;
    await walkTo(a, x + 1, z + 1);
    a.mesh.lookAt(x, 0, z);
    say(a, text);
    setTimeout(() => stage.home(agent), 3000);
  },
});

// 회의: 모두 테이블로 모이고, 끝나면 자리로 돌아간다.
let meeting = false;
function startMeeting() {
  meeting = true;
  walkMe(...MEETING_ME);
  [...avatars.values()].forEach((a, i) => {
    a.busy = true;
    walkActor(a, ...MEETING_SPOTS[i], () => {
      a.mesh.lookAt(MEETING.x, 0, MEETING.z);
    });
  });
  openMeeting();
}
function endMeeting() {
  meeting = false;
  for (const a of avatars.values()) { a.busy = false; sitDown(a); }
}

// ponytail: 탕비실 왕복만 하는 고정 일과. 일정 데이터가 생기면 그때 교체.
setInterval(() => {
  const idle = [...avatars.values()].filter((a) => a.sitting && !a.busy);
  if (meeting || !idle.length || Math.random() > 0.5) return;
  const a = idle[Math.floor(Math.random() * idle.length)];
  a.busy = true;
  walkTo(a, ...COFFEE_SPOT).then(() => {
    say(a, '커피 한 잔…');
    setTimeout(() => { a.busy = false; sitDown(a); }, 2500);
  });
}, 20000);

// 고정 시점: 남쪽 위에서 북쪽 벽을 비스듬히 내려다본다. 휠은 확대·축소.
const PITCH = 0.86, CAM_DIST = 60;
const view = { height: 17 };
const look = new THREE.Vector3();
function fitCamera() {
  const w = (view.height * innerWidth) / innerHeight;
  Object.assign(camera, { left: -w / 2, right: w / 2, top: view.height / 2, bottom: -view.height / 2 });
  camera.updateProjectionMatrix();
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
  if (drag && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) >= 6) drag.moved = true;
});
canvas.addEventListener('pointerup', (e) => {
  const clicked = drag && !drag.moved;
  drag = null;
  if (clicked) handleClick(e);
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  view.height = Math.min(26, Math.max(8, view.height + e.deltaY * 0.01));
  fitCamera();
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
  if (o.userData.floor) return walkMe(hit.point.x, hit.point.z);
  const a = o.userData.action;
  if (a.type === 'agent') {
    walkMe(...SLOTS[a.slot].stand, () => greet(a.id));
  } else if (a.type === 'drawer') {
    walkMe(...drawerStand(a.cabinet), () => { slideDrawer(a.id); openDrawer(a.id); });
  } else if (a.type === 'board') walkMe(...BOARD_STAND, openBoard);
  else if (a.type === 'door') walkMe(...doorStand(a.index), () => { openDoorId = a.index; openDoor(a.index); });
}
function greet(id) {
  const a = avatars.get(id);
  if (a) say(a, '네, 부르셨어요?');
  openAgent(id);
}

let openDrawerId = null, openDoorId = null;
function slideDrawer(id) { openDrawerId = id; }

// 가장 가까운 대화 상대
function nearestAgent() {
  let best = null, bestD = TALK_RANGE;
  for (const [id, a] of avatars) {
    const d = a.mesh.position.distanceTo(me.mesh.position);
    if (d < bestD) { best = id; bestD = d; }
  }
  return best;
}
let lastNear = undefined;
async function updateNear() {
  const id = nearestAgent();
  if (id === lastNear) return;
  lastNear = id;
  const agent = id ? await get('agents', id) : null;
  ui.setTalkTarget(agent);
}

async function syncAgents() {
  const [agents, tasks] = await Promise.all([all('agents'), all('tasks')]);
  const seen = new Set();
  for (const agent of agents) {
    seen.add(agent.id);
    let a = avatars.get(agent.id);
    if (a && (a.color !== agent.color || a.slot !== agent.slot || a.gender !== agent.gender)) { removeAvatar(agent.id); a = null; }
    if (!a) {
      const mesh = makeAvatar(agent.color, agent.gender);
      mesh.userData.action = { type: 'agent', id: agent.id, slot: agent.slot };
      scene.add(mesh);
      a = newActor(mesh, { tag: makeTag(), color: agent.color, slot: agent.slot, gender: agent.gender, busy: false });
      placeSeated(a, SLOTS[agent.slot].seat, SLOTS[agent.slot].yaw);
      avatars.set(agent.id, a);
    }
    const mine = tasks.filter((t) => t.agentId === agent.id);
    const running = mine.some((t) => t.status === 'running');
    const last = mine.sort((x, y) => y.createdAt - x.createdAt)[0];
    const failed = !running && last?.status === 'failed';
    a.working = running;
    a.tag.className = `tag ${running ? 'running' : failed ? 'failed' : ''}`;
    a.tag.textContent = `${agent.name} · ${running ? '작업 중' : failed ? '실패' : agent.role}`;
    office.monitors[agent.slot].material.emissive.set(running ? '#ffb703' : failed ? '#c0392b' : '#4cc9f0');
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
  a.bubble.remove();
  avatars.delete(id);
}

function resize() {
  renderer.setSize(Math.ceil(innerWidth / PIXEL), Math.ceil(innerHeight / PIXEL), false);
  fitCamera();
}
addEventListener('resize', resize);

function stepPath(actor, dt) {
  const [tx, tz] = actor.path[0];
  const p = actor.mesh.position;
  const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz), step = SPEED * dt;
  if (d <= step) {
    p.x = tx; p.z = tz;
    actor.path.shift();
    if (!actor.path.length) arrive(actor);
  } else {
    p.x += (dx / d) * step; p.z += (dz / d) * step;
    actor.mesh.rotation.y = Math.atan2(dx, dz);
  }
}
function animate(actor, t, moving, typingNow) {
  for (const c of actor.mesh.children) {
    if (c.userData.leg) {
      c.position.z = moving ? Math.sin(t * 12) * 0.12 * c.userData.leg : 0;
      c.visible = !actor.sitting;
    }
    if (c.userData.arm) c.rotation.x = typingNow ? -1.3 + Math.sin(t * 16 + c.userData.arm) * 0.12 : moving ? Math.sin(t * 12) * 0.5 * c.userData.arm : 0;
  }
}
const v = new THREE.Vector3();
function project(el, pos, y, centerOnly = false) {
  v.set(pos.x, y, pos.z).project(camera);
  const show = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
  el.style.display = show ? '' : 'none';
  if (show) el.style.transform = `translate(calc(${((v.x + 1) / 2) * innerWidth}px - 50%), calc(${((1 - v.y) / 2) * innerHeight}px - ${centerOnly ? 100 : 0}%))`;
}

// 문 이름표와 미팅룸 안내
const v3 = new THREE.Vector3();
const doorTags = office.doors.map(() => { const t = makeTag(); t.classList.add('sign'); return t; });
const roomTags = ROOMS.slice(1).map((r) => {
  const tag = makeTag();
  tag.classList.add('sign');
  tag.textContent = `${r.name} →`;
  return { tag, at: { x: r.minX, z: (r.passage[0] + r.passage[1]) / 2 } };
});
async function syncDoors() {
  for (const [i, tag] of doorTags.entries()) {
    const door = await get('links', `door${i}`);
    tag.textContent = door?.name || '빈 문';
  }
}

const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime, now = performance.now();

  const kx = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0), kz = (keys.has('s') ? 1 : 0) - (keys.has('w') ? 1 : 0);
  let myMoving = false;
  if (kx || kz) {
    me.path = []; me.then = null;
    if (me.sitting) { me.sitting = false; me.mesh.position.y = 0; }
    const len = Math.hypot(kx, kz), dx = (kx / len) * SPEED * dt, dz = (kz / len) * SPEED * dt;
    const nx = me.mesh.position.x + dx, nz = me.mesh.position.z + dz;
    if (nx > MAP.minX && nx < MAP.maxX && nz > MAP.minZ && nz < MAP.maxZ && !office.blocked.has(toCell(nx, nz).join(','))) {
      me.mesh.position.x = nx; me.mesh.position.z = nz;
    }
    me.mesh.rotation.y = Math.atan2(dx, dz);
    myMoving = true;
  } else if (me.path.length) {
    stepPath(me, dt);
    myMoving = true;
  }
  animate(me, t, myMoving, false);

  const near = lastNear;
  for (const [id, a] of avatars) {
    const moving = a.path.length > 0;
    if (moving) stepPath(a, dt);
    // 내가 가까이 오면 앉은 채로 나를 돌아본다.
    if (a.sitting) {
      const p = a.mesh.position, target = id === near ? Math.atan2(me.mesh.position.x - p.x, me.mesh.position.z - p.z) : SLOTS[a.slot].yaw;
      const diff = Math.atan2(Math.sin(target - a.mesh.rotation.y), Math.cos(target - a.mesh.rotation.y));
      a.mesh.rotation.y += diff * Math.min(1, dt * 6);
    }
    animate(a, t, moving, a.sitting && id !== near);
  }
  updateNear();

  for (const [id, d] of office.drawers) {
    const target = d.userData.closedZ + (id === openDrawerId ? 0.55 : 0);
    d.position.z += (target - d.position.z) * Math.min(1, dt * 8);
  }
  office.doors.forEach((h, i) => {
    const target = i === openDoorId ? -1.75 : 0;
    h.rotation.y += (target - h.rotation.y) * Math.min(1, dt * 6);
  });

  // 세로는 방 전체가 보이게 거의 고정하고, 가로로 플레이어를 따라간다.
  look.set(me.mesh.position.x, 0, Math.min(1.5, Math.max(-1.5, me.mesh.position.z)));
  camera.position.set(look.x, look.y + Math.sin(PITCH) * CAM_DIST, look.z + Math.cos(PITCH) * CAM_DIST);
  camera.lookAt(look);

  camera.updateMatrixWorld();
  for (const actor of [me, ...avatars.values()]) {
    const headY = actor.mesh.position.y + 1.65;
    project(actor.tag, actor.mesh.position, headY);
    if (!actor.bubble.hidden) {
      if (now > actor.bubbleUntil) actor.bubble.hidden = true;
      else project(actor.bubble, actor.mesh.position, headY + 0.28, true);
    }
  }
  for (const [i, tag] of doorTags.entries()) { v3.set(...doorSign(i)); project(tag, { x: v3.x, z: v3.z }, v3.y); }
  for (const { tag, at } of roomTags) project(tag, at, 2.6);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

let ui;
try {
  await openStore();
  await recoverInterrupted();
  ui = initUI({
    walkToAgent: (slot, id) => walkMe(...SLOTS[slot].stand, () => greet(id)),
    walkToDrawers: (id) => walkMe(...drawerStand(0), () => { slideDrawer(id); openDrawer(id); }),
    walkToDoor: (i) => walkMe(...doorStand(i), () => { openDoorId = i; openDoor(i); }),
    slideDrawer,
    closeScene: () => { slideDrawer(null); openDoorId = null; },
    meSay: (text) => say(me, text),
    startMeeting,
    endMeeting,
  });
  onChange(syncAgents);
  onChange(syncDoors);
  await syncAgents();
  await syncDoors();
  resize();
  frame();
} catch (e) {
  document.getElementById('hint').textContent = `시작 실패: ${e.message}`;
  throw e;
}
