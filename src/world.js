// 사무실 3D 구성. 모든 형상은 코드로 직접 만든다(원본 앱의 에셋을 쓰지 않음).
import * as THREE from 'three';
import { DRAWERS } from './store.js';

export const BOUNDS = { x: 12, z: 8 };
export const CELL = 0.5;
export const COLS = (BOUNDS.x * 2) / CELL;
export const ROWS = (BOUNDS.z * 2) / CELL;

export const toCell = (x, z) => [
  Math.min(COLS - 1, Math.max(0, Math.floor((x + BOUNDS.x) / CELL))),
  Math.min(ROWS - 1, Math.max(0, Math.floor((z + BOUNDS.z) / CELL))),
];
export const toWorld = ([cx, cy]) => [(cx + 0.5) * CELL - BOUNDS.x, (cy + 0.5) * CELL - BOUNDS.z];

// 담당자 8자리. stand는 플레이어가 멈추는 위치.
export const SLOTS = [-3.2, 2].flatMap((z) => [-8, -3, 3, 8].map((x) => ({ x, z, seat: [x, z - 1.05], stand: [x, z + 1.1] })));
const CABINET_X = [-6.5, 0, 6.5];
export const BOARD_STAND = [-10.6, 0];
export const drawerStand = (cabinet) => [CABINET_X[cabinet], -6.1];

const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...opts });

function box(w, h, d, material, x, y, z, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  return m;
}

export function buildOffice(scene) {
  const blocked = new Set();
  const block = (cx, cz, w, d, pad = 0.35) => {
    const [x0, z0] = toCell(cx - w / 2 - pad, cz - d / 2 - pad);
    const [x1, z1] = toCell(cx + w / 2 + pad, cz + d / 2 + pad);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) blocked.add(`${x},${z}`);
  };
  const interactive = [];

  const { x: X, z: Z } = BOUNDS;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(X * 2, Z * 2), mat('#c9a77c', { roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.userData.floor = true;
  scene.add(floor);
  interactive.push(floor);
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), mat('#b9c7a8'));
  outside.rotation.x = -Math.PI / 2;
  outside.position.y = -0.03;
  scene.add(outside);
  const planks = new THREE.Mesh(new THREE.PlaneGeometry(X * 1.1, Z * 0.6), mat('#7d9a84'));
  planks.rotation.x = -Math.PI / 2;
  planks.position.set(0, 0.01, 5.6);
  planks.receiveShadow = true;
  planks.userData.floor = true;
  scene.add(planks);
  interactive.push(planks);

  // 카메라가 벽 밖으로 나가면 그 벽을 숨겨 시야를 확보한다.
  const wallMat = mat('#f2ece0');
  const glass = mat('#bfe3f2', { transparent: true, opacity: 0.45, roughness: 0.1 });
  const walls = [
    { mesh: box(X * 2, 3.4, 0.25, wallMat, 0, 1.7, -Z, scene), hidden: (c) => c.z < -Z + 0.3 },
    { mesh: box(0.25, 3.4, Z * 2, wallMat, -X, 1.7, 0, scene), hidden: (c) => c.x < -X + 0.3 },
    { mesh: box(0.25, 3.4, Z * 2, glass, X, 1.7, 0, scene), hidden: (c) => c.x > X - 0.3 },
    { mesh: box(X * 2, 3.4, 0.25, glass, 0, 1.7, Z, scene), hidden: (c) => c.z > Z - 0.3 },
  ];

  const deskTop = mat('#a9764a'), metal = mat('#3b4148', { roughness: 0.4 }), chair = mat('#50596a');
  const monitors = SLOTS.map((s) => {
    box(2.3, 0.08, 1.05, deskTop, s.x, 0.76, s.z, scene);
    for (const dx of [-1.05, 1.05]) box(0.08, 0.76, 0.9, metal, s.x + dx, 0.38, s.z, scene);
    // 담당자가 가려지지 않게 모니터는 한쪽으로 비켜 둔다.
    box(0.25, 0.2, 0.2, metal, s.x - 0.65, 0.88, s.z + 0.2, scene);
    const screen = box(0.9, 0.5, 0.05, mat('#20262e', { emissive: '#20262e', emissiveIntensity: 0.6 }), s.x - 0.65, 1.2, s.z + 0.15, scene);
    box(0.34, 0.05, 0.24, mat('#d6d2c7'), s.x + 0.72, 0.82, s.z - 0.1, scene);
    box(0.62, 0.1, 0.62, chair, s.seat[0], 0.5, s.seat[1] - 0.05, scene);
    block(s.x, s.z, 2.3, 1.05);
    block(s.seat[0], s.seat[1], 0.6, 0.6, 0.15);
    return screen;
  });

  const cabMat = mat('#6b7f75'), frontMat = mat('#8aa196'), handle = mat('#e8dcc0', { metalness: 0.5, roughness: 0.3 });
  const drawers = new Map();
  CABINET_X.forEach((x, c) => {
    box(2.4, 2.1, 0.8, cabMat, x, 1.05, -Z + 0.55, scene);
    block(x, -Z + 0.55, 2.4, 0.8);
    DRAWERS.filter((d) => d.cabinet === c).forEach((d, i) => {
      const front = box(2.2, 0.56, 0.7, frontMat.clone(), x, 1.72 - i * 0.66, -Z + 0.62, scene);
      box(0.5, 0.05, 0.05, handle, 0, 0, 0.38, front);
      front.userData.action = { type: 'drawer', id: d.id, cabinet: c };
      front.userData.closedZ = front.position.z;
      interactive.push(front);
      drawers.set(d.id, front);
    });
  });

  // 서쪽 벽의 업무 보드
  const board = box(0.08, 1.5, 3.4, mat('#fdfbf5'), -X + 0.18, 1.7, 0, scene);
  board.userData.action = { type: 'board' };
  interactive.push(board);
  [['#f4d35e', -1, 0.3], ['#a8dadc', 0, 0.3], ['#b7e4c7', 1, 0.3], ['#f4a6a0', -0.5, -0.3], ['#a8dadc', 0.6, -0.3]].forEach(([c, dz, dy]) => {
    box(0.03, 0.4, 0.5, mat(c), 0.05, dy, dz, board);
  });

  const leaf = mat('#4f7f52');
  [[-10.8, -6.8], [10.8, -6.8], [10.8, 6.8], [-10.8, 6.8]].forEach(([x, z]) => {
    box(0.6, 0.6, 0.6, mat('#b5714a'), x, 0.3, z, scene);
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 1), leaf);
    crown.position.set(x, 1.1, z);
    crown.castShadow = true;
    scene.add(crown);
    block(x, z, 0.6, 0.6);
  });

  return { blocked, interactive, drawers, monitors, walls };
}

export function makeAvatar(color) {
  const g = new THREE.Group();
  const skin = mat('#f1c9a5');
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.42, 4, 12), mat(color));
  body.position.y = 0.58;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 24, 16), skin);
  head.position.y = 1.22;
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.36, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), mat('#3a2a22'));
  hair.position.set(0, 1.24, -0.03);
  hair.rotation.x = -0.25;
  const eye = new THREE.SphereGeometry(0.04, 8, 8), black = mat('#1c1c1c');
  for (const dx of [-0.12, 0.12]) {
    const e = new THREE.Mesh(eye, black);
    e.position.set(dx, 1.22, 0.31);
    g.add(e);
  }
  for (const m of [body, head, hair]) { m.castShadow = true; g.add(m); }
  for (const dx of [-0.13, 0.13]) {
    const leg = box(0.14, 0.26, 0.16, mat('#34405a'), dx, 0.13, 0, g);
    leg.userData.leg = dx > 0 ? 1 : -1;
  }
  return g;
}
