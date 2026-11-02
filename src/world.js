// 사무실 구성. 위에서 내려다보는 픽셀 아트 풍으로 코드에서 직접 그린다.
// 공간은 ROOMS 순서대로 서쪽에서 동쪽으로 이어지고, 칸막이 벽의 통로로 오간다.
import * as THREE from 'three';
import { DRAWERS } from './store.js';

// 새 공간: ROOMS에 한 줄을 더하고 buildOffice에 가구를 놓는다. 벽·바닥·길찾기·안내판은 여기서 따라온다.
export const ROOMS = [
  { id: 'office', name: '사무실', minX: -12, maxX: 12, floor: 'zigzag' },
  { id: 'meeting', name: '미팅룸', minX: 12, maxX: 26, floor: 'diamond', passage: [1.2, 3.6] },
];
// 앱 연결 문은 어느 공간이든 북쪽 벽의 x 위치로 지정한다(사무실도 가능). 순서가 links의 door0, door1…이므로 뒤에만 추가한다.
export const DOOR_SPOTS = [{ room: 'meeting', x: 17 }, { room: 'meeting', x: 19 }, { room: 'meeting', x: 21 }];

export const MAP = { minX: ROOMS[0].minX, maxX: ROOMS.at(-1).maxX, minZ: -8, maxZ: 8 };
export const CELL = 0.5;
export const COLS = (MAP.maxX - MAP.minX) / CELL;
export const ROWS = (MAP.maxZ - MAP.minZ) / CELL;

export const toCell = (x, z) => [
  Math.min(COLS - 1, Math.max(0, Math.floor((x - MAP.minX) / CELL))),
  Math.min(ROWS - 1, Math.max(0, Math.floor((z - MAP.minZ) / CELL))),
];
export const toWorld = ([cx, cy]) => [(cx + 0.5) * CELL + MAP.minX, (cy + 0.5) * CELL + MAP.minZ];

// 책상을 마주 붙인 두 줄. 윗줄은 책상 위쪽에 앉아 아래를, 아랫줄은 책상 아래쪽에 앉아 위를 본다.
export const SLOTS = [[-0.9, -1, 0], [0.15, 1, Math.PI]].flatMap(([z, side, yaw]) => [-6.2, -2.1, 2.1, 6.2].map((x) => ({
  x, z, side, yaw, seat: [x + 0.25, z + side * 1.05], stand: [x + 1.6, z + side * 1.5],
})));
export const MY_SEAT = [0, -6.6];
export const MEETING = { x: 19, z: -1.6 };
export const MEETING_SPOTS = [[16.7, -1.6], [21.3, -1.6], [18, 0.1], [20, 0.1], [15.8, -0.4], [22.2, -0.4], [16.6, 1.2], [21.4, 1.2], [19, 1.2]];
export const MEETING_ME = [19, -3.3];
export const COFFEE_SPOT = [8.2, 5.9];
export const BOARD_STAND = [-2.1, -6.6];
const CABINET_X = [-10.4, -7.7, -5];
export const drawerStand = (cabinet) => [CABINET_X[cabinet], -6.1];
export const doorStand = (i) => [DOOR_SPOTS[i].x, -6.5];
export const doorSign = (i) => [DOOR_SPOTS[i].x, 3.1, -7.8];

function texture(w, h, draw, repeatX = 1, repeatY = 1) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  return t;
}
const brick = (rx, ry) => texture(32, 16, (g) => {
  g.fillStyle = '#f2e3cf'; g.fillRect(0, 0, 32, 16);
  g.fillStyle = '#e4cfb5';
  g.fillRect(0, 7, 32, 1); g.fillRect(0, 15, 32, 1);
  g.fillRect(15, 0, 1, 7); g.fillRect(7, 8, 1, 7); g.fillRect(23, 8, 1, 7);
}, rx, ry);
const zigzag = (rx, ry) => texture(16, 16, (g) => {
  g.fillStyle = '#9aa3a6'; g.fillRect(0, 0, 16, 16);
  g.fillStyle = '#8c9598';
  for (let i = 0; i < 16; i++) g.fillRect(i, 3 + Math.abs((i % 8) - 4), 1, 2);
  for (let i = 0; i < 16; i++) g.fillRect((i + 4) % 16, 11 + Math.abs((i % 8) - 4) - 2, 1, 2);
}, rx, ry);
const diamond = (rx, ry) => texture(32, 32, (g) => {
  g.fillStyle = '#f0ecf7'; g.fillRect(0, 0, 32, 32);
  g.fillStyle = '#c9d5e8';
  for (let i = 0; i < 32; i++) {
    g.fillRect(i, i, 1, 1); g.fillRect(31 - i, i, 1, 1);
    if (i % 32 > 7 && i < 24) { g.fillRect(i, 31 - (i - 8) - 8, 1, 1); }
  }
}, rx, ry);
const FLOORS = { zigzag, diamond };
const SCREENS = ['#4aa3df', '#6d4bc4', '#3fb6a8'];
const screenFace = (i) => texture(16, 10, (g) => {
  g.fillStyle = SCREENS[i % 3]; g.fillRect(0, 0, 16, 10);
  g.fillStyle = '#ffffffaa'; g.fillRect(2, 2, 7, 1); g.fillRect(2, 4, 10, 1); g.fillRect(2, 6, 5, 1);
});

const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...opts });

function box(w, h, d, material, x, y, z, parent, outline = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  // 픽셀 아트의 어두운 외곽선
  if (outline) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: '#4a4650' })));
  return m;
}
function plane(w, d, material, x, y, z, parent) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function plant(x, z, parent, block, size = 1) {
  box(0.5 * size, 0.42 * size, 0.5 * size, mat('#dfe5ea'), x, 0.21 * size, z, parent);
  const leaf = new THREE.SphereGeometry(0.2, 8, 6), green = mat('#57a84f'), light = mat('#8cce6b');
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2, m = new THREE.Mesh(leaf, i % 2 ? light : green);
    m.scale.set(0.8 * size, 0.45 * size, 2.3 * size);
    m.position.set(x + Math.sin(a) * 0.32 * size, (0.85 + (i % 3) * 0.16) * size, z + Math.cos(a) * 0.32 * size);
    m.rotation.set(-0.55, a, 0);
    m.castShadow = true;
    parent.add(m);
  }
  block(x, z, 0.5, 0.5, 0.2);
}
function meshChair(x, z, yaw, parent) {
  const g = new THREE.Group(), black = mat('#2f333b');
  box(0.62, 0.12, 0.6, black, 0, 0.5, 0, g);
  box(0.6, 0.72, 0.1, black, 0, 0.95, -0.32, g);
  box(0.08, 0.42, 0.08, black, 0, 0.22, 0, g, false);
  box(0.6, 0.05, 0.6, black, 0, 0.03, 0, g, false);
  g.position.set(x, 0, z);
  g.rotation.y = yaw;
  parent.add(g);
}
function sofa(x, z, width, yaw, parent, block) {
  const g = new THREE.Group(), peach = mat('#eeb48a'), dark = mat('#dc9b70');
  box(width, 0.34, 1.1, dark, 0, 0.26, 0, g);
  box(width, 0.8, 0.28, peach, 0, 0.72, -0.42, g);
  for (const dx of [-width / 2 + 0.14, width / 2 - 0.14]) box(0.28, 0.54, 1.1, peach, dx, 0.5, 0, g);
  const seat = (width - 0.6) / 3;
  for (let i = 0; i < 3; i++) box(seat - 0.04, 0.16, 0.8, peach, (i - 1) * seat, 0.5, 0.12, g);
  g.position.set(x, 0, z);
  g.rotation.y = yaw;
  parent.add(g);
  block(x, z, width, 1.1, 0.2);
}
function beanbag(x, z, color, parent, block) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.62, 14, 10), mat(color));
  m.scale.y = 0.75;
  m.position.set(x, 0.45, z);
  m.castShadow = true;
  parent.add(m);
  block(x, z, 1.1, 1.1, 0.1);
}
function bookshelf(x, parent, block) {
  const frame = mat('#a7b4c6'), z = -7.45;
  box(3.4, 3, 0.7, frame, x, 1.5, z, parent);
  const colors = ['#3d8a7c', '#d0764f', '#5f7fb5', '#e8e4d8', '#5c9c57', '#32506e'];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
    const px = x - 1.2 + c * 0.8, py = 0.62 + r * 0.82;
    box(0.72, 0.66, 0.04, mat('#5b6b82'), px, py, z + 0.34, parent, false);
    box(0.5, 0.42, 0.14, mat(colors[(r * 4 + c) % 6]), px, py - 0.08, z + 0.4, parent);
  }
  block(x, z, 3.4, 0.7, 0.2);
}

export function buildOffice(scene) {
  const blocked = new Set();
  const block = (cx, cz, w, d, pad = 0.35) => {
    const [x0, z0] = toCell(cx - w / 2 - pad, cz - d / 2 - pad);
    const [x1, z1] = toCell(cx + w / 2 + pad, cz + d / 2 + pad);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) blocked.add(`${x},${z}`);
  };
  const interactive = [];
  const walkable = (m) => { m.userData.floor = true; interactive.push(m); };

  for (const r of ROOMS) {
    const w = r.maxX - r.minX;
    walkable(plane(w, 16, mat('#ffffff', { map: FLOORS[r.floor](w / 2, 8) }), (r.minX + r.maxX) / 2, 0, 0, scene));
  }
  walkable(plane(7.6, 3.2, mat('#7c8a93'), 0, 0.01, -6.1, scene));

  // 벽돌 벽. 북쪽만 높게 보이고 나머지는 낮은 턱으로 둔다.
  const wall = (w, h, d, x, z, rx, ry) => box(w, h, d, mat('#ffffff', { map: brick(rx, ry) }), x, h / 2, z, scene, false);
  const width = MAP.maxX - MAP.minX + 0.5, midX = (MAP.minX + MAP.maxX) / 2;
  wall(width, 3.4, 0.3, midX, -8.1, 30, 3);
  wall(width, 0.5, 0.5, midX, 8.2, 30, 1);
  wall(0.5, 0.5, 16.6, MAP.minX - 0.2, 0, 12, 1);
  wall(0.5, 0.5, 16.6, MAP.maxX + 0.2, 0, 12, 1);
  // 칸막이 벽: 공간마다 passage 구간만 비운다.
  for (const { minX: x, passage } of ROOMS.slice(1)) {
    const [a, b] = passage, north = a + 8.2, south = 8.2 - b;
    wall(0.4, 2, north, x, (a - 8.2) / 2, 7, 2);
    wall(0.4, 2, south, x, (b + 8.2) / 2, 3, 2);
    block(x, (a - 8.2) / 2, 0.4, north, 0.2);
    block(x, (b + 8.2) / 2, 0.4, south, 0.2);
  }

  const white = mat('#fbfbf8'), edge = mat('#4d5a68'), silver = mat('#a7adb7'), paper = mat('#f4f1e8');
  const monitors = SLOTS.map((s, i) => {
    box(2.5, 0.12, 1.05, white, s.x, 0.8, s.z, scene);
    box(2.5, 0.42, 0.08, edge, s.x, 0.54, s.z + (s.side > 0 ? 0.5 : -0.5), scene);
    for (const dx of [-1.1, 1.1]) box(0.1, 0.74, 0.1, edge, s.x + dx, 0.37, s.z + s.side * 0.42, scene);
    const mx = s.x - 0.55, mz = s.z + s.side * 0.02;
    box(0.14, 0.3, 0.12, silver, mx, 1, mz, scene);
    box(0.5, 0.04, 0.3, silver, mx, 0.88, mz, scene);
    const face = mat('#ffffff', { map: screenFace(i), emissive: '#20262e', emissiveIntensity: 0.55 });
    const screen = new THREE.Mesh(new THREE.BoxGeometry(1, 0.62, 0.08), [silver, silver, silver, silver, s.side > 0 ? silver : face, s.side > 0 ? face : silver]);
    screen.position.set(mx, 1.42, mz);
    screen.castShadow = true;
    screen.material.emissive = face.emissive; // 상태 표시 색을 한 곳에서 바꾼다
    scene.add(screen);
    box(0.5, 0.03, 0.18, mat('#d6d2c7'), s.x + 0.3, 0.875, s.z + s.side * 0.25, scene);
    box(0.34, 0.1, 0.26, i % 2 ? mat('#3f73b6') : paper, s.x + 0.95, 0.91, s.z - s.side * 0.05, scene);
    meshChair(s.seat[0], s.seat[1], s.yaw, scene);
    block(s.x, s.z, 2.5, 1.05, 0.25);
    block(s.seat[0], s.seat[1], 0.6, 0.6, 0.05);
    return { material: face };
  });

  // 내 자리: 맨 위 중앙의 큰 원목 책상
  box(3.8, 0.12, 1.4, mat('#9b6a3f'), 0, 0.84, -5.4, scene);
  box(3.8, 0.56, 0.1, mat('#7a5230'), 0, 0.5, -4.74, scene);
  for (const dx of [-1.8, 1.8]) box(0.12, 0.8, 1.3, mat('#7a5230'), dx, 0.4, -5.4, scene);
  box(0.14, 0.3, 0.12, silver, 0.95, 1.03, -5.5, scene);
  box(1.2, 0.68, 0.08, silver, 0.95, 1.48, -5.5, scene);
  box(0.8, 0.04, 0.5, paper, -0.9, 0.92, -5.4, scene);
  box(1.1, 0.14, 0.1, mat('#d8b55a'), 0, 0.97, -4.8, scene);
  meshChair(MY_SEAT[0], MY_SEAT[1], 0, scene);
  block(0, -5.4, 3.8, 1.4, 0.25);

  // 서류장: 북쪽 벽, 서랍은 아래(+z)로 열린다.
  const cabMat = mat('#8c9db0'), frontMat = mat('#b7c4d2'), handle = mat('#e8dcc0');
  const drawers = new Map();
  CABINET_X.forEach((x, c) => {
    box(2.4, 2.1, 0.8, cabMat, x, 1.05, -7.5, scene);
    block(x, -7.5, 2.4, 0.8, 0.2);
    DRAWERS.filter((d) => d.cabinet === c).forEach((d, i) => {
      const front = box(2.2, 0.56, 0.7, frontMat.clone(), x, 1.72 - i * 0.66, -7.43, scene);
      box(0.5, 0.05, 0.05, handle, 0, 0, 0.38, front);
      front.userData.action = { type: 'drawer', id: d.id, cabinet: c };
      front.userData.closedZ = front.position.z;
      interactive.push(front);
      drawers.set(d.id, front);
    });
  });

  // 업무 보드: 내 자리 뒤쪽 벽
  const board = box(3, 1.5, 0.08, mat('#fdfbf5'), 0, 2.2, -7.9, scene);
  board.userData.action = { type: 'board' };
  interactive.push(board);
  [['#f4d35e', -1, 0.3], ['#a8dadc', 0, 0.3], ['#b7e4c7', 1, 0.3], ['#f4a6a0', -0.5, -0.3], ['#a8dadc', 0.6, -0.3]].forEach(([c, dx, dy]) => {
    box(0.5, 0.4, 0.03, mat(c), dx, dy, 0.05, board, false);
  });

  // 앱 연결 문: 북쪽 벽. 경첩을 축으로 방 안쪽으로 열린다.
  const doors = DOOR_SPOTS.map(({ x }, i) => {
    const frame = mat('#7a5230');
    box(1.8, 2.6, 0.14, frame, x, 1.3, -7.88, scene);
    box(1.46, 2.34, 0.06, mat('#10181f', { emissive: '#7fd3ff', emissiveIntensity: 1 }), x, 1.17, -7.8, scene, false);
    const hinge = new THREE.Group();
    hinge.position.set(x - 0.7, 0, -7.74);
    scene.add(hinge);
    const leaf = box(1.4, 2.28, 0.07, mat('#c98a52'), 0.7, 1.16, 0, hinge);
    box(0.2, 0.06, 0.1, handle, 1.22, 1.1, 0.06, hinge, false);
    leaf.userData.action = { type: 'door', index: i };
    interactive.push(leaf);
    return hinge;
  });

  bookshelf(7.6, scene, block);

  // 탕비실
  box(2.6, 0.9, 0.7, mat('#e5dfd3'), 8.6, 0.45, 7.3, scene);
  box(0.5, 0.55, 0.45, mat('#2f333b'), 8.1, 1.17, 7.3, scene);
  box(0.4, 1.3, 0.4, mat('#cfe6ee'), 9.3, 1.55, 7.3, scene);
  block(8.6, 7.3, 2.6, 0.7);

  plant(-11, 7, scene, block);
  plant(11, 7, scene, block);
  plant(-3.2, -7.5, scene, block);
  plant(3.2, -7.5, scene, block);

  // 미팅룸
  bookshelf(14.2, scene, block);
  bookshelf(23.8, scene, block);
  sofa(19, -4.9, 4.6, 0, scene, block);
  sofa(19.4, 3.6, 4.6, Math.PI, scene, block);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.16, 32), mat('#e9c88f'));
  top.scale.set(1.5, 1, 0.9);
  top.position.set(MEETING.x, 0.74, MEETING.z);
  top.castShadow = true;
  scene.add(top);
  box(1.6, 0.66, 0.5, mat('#b98a56'), MEETING.x, 0.33, MEETING.z, scene);
  box(0.3, 0.34, 0.3, mat('#6b53c9'), MEETING.x + 0.2, 0.98, MEETING.z - 0.2, scene);
  block(MEETING.x, MEETING.z, 3, 1.8, 0.2);
  for (const [x, z] of [[15, -5], [24.8, 4]]) {
    box(1, 0.7, 0.8, mat('#e9a860'), x, 0.35, z, scene);
    block(x, z, 1, 0.8, 0.15);
  }
  box(0.4, 0.34, 0.3, mat('#f2c033'), 24.8, 0.87, 4, scene);
  plant(15, -5, scene, () => {}, 0.75);
  beanbag(13.6, -2.6, '#2f7fd1', scene, block);
  beanbag(24.4, -2.6, '#9b5fd6', scene, block);
  beanbag(13.6, 5, '#e8479b', scene, block);
  beanbag(24.4, 0.2, '#2f7fd1', scene, block);
  plant(24.6, -5.2, scene, block, 1.3);
  plant(14.2, 6.8, scene, block, 1.3);

  return { blocked, interactive, drawers, monitors, doors };
}

export function makeAvatar(color, gender = 'male') {
  const g = new THREE.Group();
  const female = gender === 'female';
  const skin = mat('#f1c9a5'), hairMat = mat(female ? '#7a4a2a' : '#2a221e'), top = mat(color);
  const add = (m) => { m.castShadow = true; g.add(m); return m; };
  const body = add(new THREE.Mesh(new THREE.CapsuleGeometry(female ? 0.21 : 0.25, 0.42, 4, 12), top));
  body.position.y = 0.6;
  const head = add(new THREE.Mesh(new THREE.SphereGeometry(0.34, 24, 16), skin));
  head.position.y = 1.22;
  const hair = add(new THREE.Mesh(new THREE.SphereGeometry(0.36, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat));
  hair.position.set(0, 1.24, -0.03);
  hair.rotation.x = -0.25;
  const eye = new THREE.SphereGeometry(0.04, 8, 8), black = mat('#1c1c1c');
  for (const dx of [-0.12, 0.12]) {
    const e = new THREE.Mesh(eye, black);
    e.position.set(dx, 1.22, 0.31);
    g.add(e);
  }
  if (female) {
    // 긴 머리, 입술, 치마로 구분
    box(0.56, 0.62, 0.16, hairMat, 0, 1.02, -0.24, g, false);
    for (const dx of [-0.31, 0.31]) box(0.1, 0.46, 0.24, hairMat, dx, 1.08, -0.04, g, false);
    box(0.1, 0.025, 0.02, mat('#c2455d'), 0, 1.1, 0.33, g, false);
    const skirt = add(new THREE.Mesh(new THREE.ConeGeometry(0.33, 0.42, 16), mat('#2f3346')));
    skirt.position.y = 0.42;
    for (const dx of [-0.11, 0.11]) {
      const leg = box(0.1, 0.26, 0.12, skin, dx, 0.13, 0, g, false);
      leg.userData.leg = dx > 0 ? 1 : -1;
    }
  } else {
    // 짧은 머리, 넥타이, 바지로 구분
    box(0.08, 0.34, 0.03, mat('#a8323a'), 0, 0.72, 0.25, g, false);
    box(0.2, 0.04, 0.03, mat('#fbfbf7'), 0, 0.88, 0.235, g, false);
    for (const dx of [-0.13, 0.13]) {
      const leg = box(0.15, 0.3, 0.17, mat('#2b3243'), dx, 0.15, 0, g, false);
      leg.userData.leg = dx > 0 ? 1 : -1;
    }
  }
  for (const dx of [-0.32, 0.32]) {
    const arm = box(0.1, 0.44, 0.12, top, dx, 0.68, 0.06, g, false);
    arm.userData.arm = dx > 0 ? 1 : -1;
  }
  return g;
}
