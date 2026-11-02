// 3D 장면: 이동, 클릭 상호작용, 담당자의 근무·협업 연출.
import * as THREE from 'three';
import { COFFEE_SPOT, COLS, MAP, MEETING, MEETING_ME, MEETING_SPOTS, MY_SEAT, ROOMS, ROWS, SHELF, SLOTS, buildOffice, doorSign, drawerStand, makeAvatar, toCell, toWorld } from './world.js';
import { clampView, findPath, nearestFree } from './nav.js';
import { CABINETS, DRAWERS, all, driveAccounts, get, onChange, openStore, seedDriveAccounts } from './store.js';
import { loadConfig } from './gdrive.js';
import { recoverInterrupted, stage } from './agents.js';
import { initUI, openAgent, openCalendar, openDocById, openDoor, openDrawer, openMeeting } from './ui.js';

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
me.tag.textContent = '★ 나 · 대표';
me.tag.classList.add('me');
scene.add(me.mesh);
placeSeated(me, MY_SEAT, 0);

const avatars = new Map();

// 발밑 빛 원판: 평소에는 나만, 대화 중에는 상대와 함께 같은 색으로 켠다.
const GLOW_ME = '#ffc94d', GLOW_TALK = '#22d3bd';
function makeGlow() {
  const g = new THREE.Group(), material = (opacity) => new THREE.MeshBasicMaterial({ transparent: true, opacity, depthWrite: false });
  g.add(new THREE.Mesh(new THREE.CircleGeometry(1.15, 32), material(0.4)), new THREE.Mesh(new THREE.RingGeometry(1.12, 1.28, 32), material(0.95)));
  g.rotation.x = -Math.PI / 2;
  g.position.y = 0.03;
  scene.add(g);
  return g;
}
function setGlow(g, color, { x, z }, scale) {
  for (const m of g.children) m.material.color.set(color);
  g.position.x = x; g.position.z = z;
  g.scale.setScalar(scale);
}
const meGlow = makeGlow(), talkGlow = makeGlow();

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
// 화면 좌표 y는 위쪽이 +. 북쪽 벽 꼭대기(높이 3.4)와 사방 벽 바깥 면까지가 화면 경계다.
const SIN = Math.sin(PITCH), COS = Math.cos(PITCH), MIN_HEIGHT = 5;
const EDGE = { left: MAP.minX - 0.45, right: MAP.maxX + 0.45, top: 3.4 * COS - MAP.minZ * SIN + 0.25 * SIN, bottom: -(MAP.maxZ + 0.45) * SIN };
const maxHeight = () => Math.min(EDGE.top - EDGE.bottom, ((EDGE.right - EDGE.left) * innerHeight) / innerWidth);
const view = { height: 14, free: null }; // free: 드래그로 둘러볼 때의 화면 중심 [x, y]
const look = new THREE.Vector3();
const viewWidth = () => (view.height * innerWidth) / innerHeight;
function zoomTo(height) {
  view.height = Math.min(maxHeight(), Math.max(MIN_HEIGHT, height));
  fitCamera();
}
function fitCamera() {
  const w = viewWidth();
  Object.assign(camera, { left: -w / 2, right: w / 2, top: view.height / 2, bottom: -view.height / 2 });
  camera.updateProjectionMatrix();
}

const keys = new Set();
const typing = () => /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? '');
addEventListener('keydown', (e) => {
  if (typing()) return;
  const key = e.key.toLowerCase();
  if ('wasd'.includes(key)) keys.add(key);
  else if (key === '+' || key === '=') zoomTo(view.height * 0.8);
  else if (key === '-') zoomTo(view.height * 1.25);
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

// 입력
const ray = new THREE.Raycaster();
ray.params.Line.threshold = 0.01; // 장식용 외곽선이 기본 1단위 범위로 앞의 물체보다 먼저 잡히지 않게
const ndc = new THREE.Vector2();
let drag = null;
const touches = new Map(); // 두 손가락 확대·축소용
let pinch = 0;
const pinchGap = () => { const [a, b] = touches.values(); return Math.hypot(a.x - b.x, a.y - b.y); };

canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, moved: false };
  canvas.setPointerCapture(e.pointerId);
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size === 2) { pinch = pinchGap(); drag.moved = true; }
});
canvas.addEventListener('pointermove', (e) => {
  if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size === 2) {
    const gap = pinchGap();
    if (pinch && gap) zoomTo((view.height * pinch) / gap);
    pinch = gap;
    return;
  }
  if (!drag) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
  drag.moved = true;
  const [x, y] = view.free ?? [look.x, -look.z * SIN];
  view.free = [x - ((e.clientX - drag.x) * viewWidth()) / innerWidth, y + ((e.clientY - drag.y) * view.height) / innerHeight];
  drag.x = e.clientX; drag.y = e.clientY;
});
const release = (e) => { touches.delete(e.pointerId); };
canvas.addEventListener('pointercancel', (e) => { release(e); drag = null; });
canvas.addEventListener('pointerup', (e) => {
  release(e);
  const clicked = drag && !drag.moved;
  if (!touches.size) drag = null;
  if (clicked) handleClick(e);
});
// 터치패드 핀치는 ctrl+휠로 들어오고 값이 작아서 더 크게 반영한다.
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const unit = e.deltaMode === 1 ? 33 : 1;
  zoomTo(view.height * Math.exp(e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.002)));
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
  // 서랍·캐비닛·일정판·문은 걸어가지 않고 그 자리에서 바로 연다. 담당자만 걸어가서 대화한다.
  } else if (a.type === 'drawer') openDrawerAt(a.id);
  else if (a.type === 'calendar') openCalendar();
  else if (a.type === 'door') openDoorAt(a.index);
  else if (a.type === 'shelf') openDrawer('shelf');
  else if (a.type === 'shelfDoc') openDocById(a.id);
}
function greet(id) {
  const a = avatars.get(id);
  if (a) say(a, '네, 부르셨어요?');
  openAgent(id);
}

let openDrawerId = null, openDoorId = null;
function slideDrawer(id) { openDrawerId = id; }
const openDrawerAt = (id) => { slideDrawer(id); openDrawer(id); };
const openDoorAt = (i) => { openDoorId = i; openDoor(i); };

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
  zoomTo(view.height);
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
// 눌러서 여는 벽 안내판
function makeLinkSign(text, at, y, onClick) {
  const tag = makeTag();
  tag.classList.add('sign', 'link');
  tag.textContent = text;
  tag.onclick = onClick;
  return { tag, at, y };
}
// 안내판 링크는 걸어가지 않고 그 자리에서 바로 연다.
const openCabinet = (c) => openDrawerAt(DRAWERS.find((d) => d.cabinet === c).id);
// 서류장마다 연결된 구글 드라이브 계정 안내판
const driveSigns = [0, 1, 2].map((c) => makeLinkSign('', { x: drawerStand(c)[0], z: -7.5 }, 2.75, () => openCabinet(c)));
for (const s of driveSigns) s.tag.classList.add('acct');
async function syncDriveSigns() {
  const accounts = await driveAccounts();
  driveSigns.forEach((s, c) => { s.tag.textContent = accounts[c] ? `☁ 구글 드라이브\n${accounts[c]}` : `${CABINETS[c]}\n드라이브 연결하기`; });
}
const linkSigns = [...driveSigns,
  makeLinkSign('일정 관리 · 구글 캘린더', { x: 0, z: -7.9 }, 3.25, openCalendar),
];
// 서류 캐비닛: 놓인 서류를 칸에 올리고 이름표를 단다. 넘치는 서류는 패널 목록에서 본다.
const shelfSign = makeLinkSign('서류 캐비닛', SHELF, 3.3, () => openDrawer('shelf'));
linkSigns.push(shelfSign);
const shelfTags = office.shelf.map((slot) => {
  const tag = makeTag();
  tag.classList.add('sign', 'link', 'doc-name');
  tag.style.display = 'none';
  return { slot, tag, doc: null };
});
const binderColor = (d) => (/\.pdf$/i.test(d.title) ? '#d9534f' : /\.(pptx?|key|odp)$/i.test(d.title) || d.kind === 'link' ? '#e8963c' : '#5f7fb5');
async function syncShelf() {
  const docs = (await all('docs')).filter((d) => d.drawer === 'shelf').sort((a, b) => a.createdAt - b.createdAt);
  shelfSign.tag.textContent = `서류 캐비닛 · ${docs.length}건`;
  shelfTags.forEach((s, i) => {
    const d = s.doc = docs[i] ?? null;
    s.slot.visible = !!d;
    s.slot.userData.action = d ? { type: 'shelfDoc', id: d.id } : { type: 'shelf' };
    if (!d) { s.tag.style.display = 'none'; return; }
    s.slot.material.color.set(binderColor(d));
    s.tag.textContent = d.title.replace(/\.[^.]+$/, '');
    s.tag.title = d.title;
    s.tag.onclick = () => openDocById(d.id);
  });
}
async function syncDoors() {
  for (const [i, tag] of doorTags.entries()) {
    const door = await get('links', `door${i}`);
    tag.textContent = door?.name || '빈 문';
  }
}

const clock = new THREE.Clock();
let lookReady = false;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime, now = performance.now();

  const kx = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0), kz = (keys.has('s') ? 1 : 0) - (keys.has('w') ? 1 : 0);
  let myMoving = false;
  if (kx || kz) {
    me.path = []; me.then = null;
    if (me.sitting) { me.sitting = false; me.mesh.position.y = 0; }
    const len = Math.hypot(kx, kz), dx = (kx / len) * SPEED * dt, dz = (kz / len) * SPEED * dt;
    // 축별로 따져서 가구나 벽에 닿으면 멈추지 않고 옆으로 미끄러진다.
    const p = me.mesh.position, free = (x, z) => x > MAP.minX && x < MAP.maxX && z > MAP.minZ && z < MAP.maxZ && !office.blocked.has(toCell(x, z).join(','));
    if (free(p.x + dx, p.z)) p.x += dx;
    if (free(p.x, p.z + dz)) p.z += dz;
    me.mesh.rotation.y = Math.atan2(dx, dz);
    myMoving = true;
  } else if (me.path.length) {
    stepPath(me, dt);
    myMoving = true;
  }
  animate(me, t, myMoving, false);

  // 패널에서 고른 담당자가 먼저, 없으면 가장 가까운 담당자가 강조 상대다.
  const near = lastNear, partner = avatars.get(ui.selectedId()) ?? avatars.get(near);
  const pulse = 1 + Math.sin(t * 4) * 0.06;
  setGlow(meGlow, partner ? GLOW_TALK : GLOW_ME, me.mesh.position, partner ? pulse : 1);
  talkGlow.visible = !!partner;
  if (partner) setGlow(talkGlow, GLOW_TALK, partner.mesh.position, pulse);
  me.tag.classList.toggle('talking', !!partner);
  for (const [id, a] of avatars) {
    a.tag.classList.toggle('talking', a === partner);
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

  // 나를 따라가되 공간 경계에서 멈춘다. 그때부터는 내가 화면 구석으로 간다.
  if (myMoving) view.free = null;
  const [goalX, goalY] = view.free ?? [me.mesh.position.x, -me.mesh.position.z * SIN];
  const [cx, cy] = clampView(goalX, goalY, viewWidth(), view.height, EDGE);
  if (view.free) view.free = [cx, cy];
  const ease = lookReady ? Math.min(1, dt * 7) : 1;
  lookReady = true;
  look.set(look.x + (cx - look.x) * ease, 0, look.z + (-cy / SIN - look.z) * ease);
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
  for (const { tag, at, y } of linkSigns) project(tag, at, y);
  for (const { slot, tag, doc } of shelfTags) {
    if (!doc) continue;
    tag.style.maxWidth = `${(innerHeight / view.height) * 1.05}px`; // 칸 너비에 맞춰 긴 이름은 줄인다
    project(tag, slot.position, slot.position.y - 0.1);
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

let ui;
try {
  await openStore();
  await seedDriveAccounts((await loadConfig()).driveAccounts);
  await recoverInterrupted();
  ui = initUI({
    walkToAgent: (slot, id) => walkMe(...SLOTS[slot].stand, () => greet(id)),
    openDrawerAt,
    openDoorAt,
    slideDrawer,
    closeScene: () => { slideDrawer(null); openDoorId = null; },
    meSay: (text) => say(me, text),
    startMeeting,
    endMeeting,
  });
  document.getElementById('zoom-in').onclick = () => zoomTo(view.height * 0.8);
  document.getElementById('zoom-out').onclick = () => zoomTo(view.height * 1.25);
  document.getElementById('near-me').onclick = () => { view.free = null; zoomTo(7); };
  onChange(syncAgents);
  onChange(syncDoors);
  onChange(syncShelf);
  onChange(syncDriveSigns);
  await syncAgents();
  await syncDoors();
  await syncShelf();
  await syncDriveSigns();
  resize();
  frame();
  setTimeout(() => { document.getElementById('hint').hidden = true; }, 15000); // 안내는 잠시 보이고 화면을 비워 준다
} catch (e) {
  document.getElementById('hint').textContent = `시작 실패: ${e.message}`;
  throw e;
}
