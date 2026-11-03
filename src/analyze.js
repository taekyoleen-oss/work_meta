// 키 없이 브라우저에서 도는 내장 분석기.
export function parseDelimited(text, sep) {
  const rows = [[]];
  let cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && !cell) quoted = true;
    else if (c === sep) { rows.at(-1).push(cell); cell = ''; }
    else if (c === '\n') { rows.at(-1).push(cell.replace(/\r$/, '')); cell = ''; rows.push([]); }
    else cell += c;
  }
  rows.at(-1).push(cell.replace(/\r$/, ''));
  return rows.filter((r) => r.some((c) => c.trim()));
}

export function detectTable(text) {
  for (const sep of [',', '\t']) {
    const rows = parseDelimited(text, sep);
    if (rows.length >= 2 && rows[0].length >= 2 && rows.every((r) => r.length === rows[0].length)) return rows;
  }
  return null;
}

const toNumber = (s) => {
  const t = s.trim().replace(/,/g, '');
  return t !== '' && Number.isFinite(Number(t)) ? Number(t) : null;
};
const fmt = (n) => n.toLocaleString('ko-KR', { maximumFractionDigits: 2 });

function topCounts(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]);
}

export function analyze(text) {
  const table = detectTable(text.trim());
  if (!table) {
    const words = text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
    return [
      '[텍스트 분석]',
      `글자 수: ${fmt(text.length)}`,
      `줄 수: ${fmt(text.split('\n').length)}`,
      `단어 수: ${fmt(words.length)}`,
      `자주 나온 단어: ${topCounts(words).slice(0, 5).map(([w, n]) => `${w}(${n})`).join(', ') || '없음'}`,
    ].join('\n');
  }
  const [head, ...rows] = table;
  const lines = ['[표 분석]', `행 ${fmt(rows.length)}개 · 열 ${head.length}개`, ''];
  head.forEach((name, c) => {
    const values = rows.map((r) => r[c]);
    const nums = values.map(toNumber).filter((n) => n !== null);
    if (nums.length === values.length) {
      const sum = nums.reduce((a, b) => a + b, 0);
      lines.push(`${name}: 합계 ${fmt(sum)}, 평균 ${fmt(sum / nums.length)}, 최소 ${fmt(Math.min(...nums))}, 최대 ${fmt(Math.max(...nums))}`);
    } else {
      const counts = topCounts(values);
      lines.push(`${name}: 고유값 ${counts.length}개, 상위 ${counts.slice(0, 3).map(([v, n]) => `${v}(${n})`).join(', ')}`);
    }
  });
  return lines.join('\n');
}
