// 격자 A* 길찾기. 3D와 무관한 순수 함수.
const key = (x, y) => `${x},${y}`;

export function nearestFree(blocked, cols, rows, [cx, cy]) {
  for (let r = 0; r < Math.max(cols, rows); r++) {
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      if (x >= 0 && y >= 0 && x < cols && y < rows && !blocked.has(key(x, y))) return [x, y];
    }
  }
  return null;
}

export function findPath(blocked, cols, rows, start, goal) {
  const free = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows && !blocked.has(key(x, y));
  const h = ([x, y]) => Math.hypot(x - goal[0], y - goal[1]);
  const open = [{ p: start, g: 0, f: h(start) }];
  const best = new Map([[key(...start), 0]]);
  const from = new Map();
  while (open.length) {
    // ponytail: 선형 최소 탐색. 현재 2,432칸이라 충분, 맵이 크게 늘면 힙으로 교체.
    let i = 0;
    for (let j = 1; j < open.length; j++) if (open[j].f < open[i].f) i = j;
    const { p, g } = open.splice(i, 1)[0];
    if (p[0] === goal[0] && p[1] === goal[1]) {
      const path = [p];
      while (from.has(key(...path[0]))) path.unshift(from.get(key(...path[0])));
      return path;
    }
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const nx = p[0] + dx, ny = p[1] + dy;
      if (!free(nx, ny) || (dx && dy && (!free(p[0] + dx, p[1]) || !free(p[0], p[1] + dy)))) continue;
      const ng = g + Math.hypot(dx, dy), k = key(nx, ny);
      if (ng >= (best.get(k) ?? Infinity)) continue;
      best.set(k, ng); from.set(k, p);
      open.push({ p: [nx, ny], g: ng, f: ng + h([nx, ny]) });
    }
  }
  return null;
}
