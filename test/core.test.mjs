import test from 'node:test';
import assert from 'node:assert/strict';
import { findPath, nearestFree } from '../src/nav.js';
import { analyze, parseDelimited } from '../src/analyze.js';
import { driveEmbed, parseMentions, routeByKeywords } from '../src/agents.js';
import handler from '../api/agent.js';

test('길찾기는 벽을 돌아가고 대각선으로 모서리를 뚫지 않는다', () => {
  const blocked = new Set(['2,0', '2,1', '2,2', '2,3']);
  const path = findPath(blocked, 5, 5, [0, 0], [4, 0]);
  assert.ok(path.some(([, y]) => y === 4));
  assert.ok(path.every(([x, y]) => !blocked.has(`${x},${y}`)));
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    if (ax !== bx && ay !== by) assert.ok(!blocked.has(`${bx},${ay}`) && !blocked.has(`${ax},${by}`));
  }
});
test('막힌 목표는 경로가 없고 nearestFree가 대체 칸을 준다', () => {
  const blocked = new Set(['1,0', '1,1', '0,1']);
  assert.equal(findPath(blocked, 3, 3, [2, 2], [0, 0]), null);
  assert.deepEqual(nearestFree(new Set(['1,1']), 3, 3, [1, 1]), [0, 0]);
});
test('CSV 따옴표와 숫자 통계', () => {
  assert.deepEqual(parseDelimited('a,"b,c"\n1,"x""y"\n', ','), [['a', 'b,c'], ['1', 'x"y']]);
  const out = analyze('부서,매출\n영업,"1,000"\n개발,2000\n영업,3000');
  assert.match(out, /행 3개 · 열 2개/);
  assert.match(out, /매출: 합계 6,000, 평균 2,000, 최소 1,000, 최대 3,000/);
  assert.match(out, /영업\(2\)/);
});
test('표가 아니면 텍스트 분석', () => assert.match(analyze('안녕하세요 안녕하세요 반갑습니다'), /단어 수: 3/));
test('멘션은 실제 담당자만 인식하고 이메일은 건드리지 않는다', () => {
  const a = { name: '이분석' };
  const { text, targets } = parseMentions('@이분석 @없는사람 매출 봐줘 me@x.com', [a]);
  assert.deepEqual(targets, [a]);
  assert.equal(text, '@없는사람 매출 봐줘 me@x.com');
  assert.equal(parseMentions('봐줘 @이분석 a,b\n1,2', [a]).text, '봐줘 a,b\n1,2');
});

test('총괄은 키워드로 담당자를 고르고 자신은 제외한다', () => {
  const lead = { type: 'lead', keywords: ['분석'] }, a = { type: 'analyst', keywords: ['분석'] }, m = { type: 'claude', keywords: ['홍보'] };
  assert.deepEqual(routeByKeywords('매출 분석 부탁', [lead, a, m]), [a]);
  assert.deepEqual(routeByKeywords('안녕', [lead, a, m]), []);
});
test('드라이브 주소만 임베드 주소로 바꾼다', () => {
  assert.equal(driveEmbed('https://drive.google.com/drive/folders/abc-1?usp=sharing'), 'https://drive.google.com/embeddedfolderview?id=abc-1#list');
  assert.equal(driveEmbed('https://docs.google.com/document/d/x_1/edit'), 'https://docs.google.com/document/d/x_1/preview');
  assert.equal(driveEmbed('https://drive.google.com/drive/my-drive'), null);
  assert.equal(driveEmbed('https://evil.com/drive/folders/abc'), null);
});

const call = async (body, headers = {}, method = 'POST') => {
  let out;
  const res = { code: 200, status(s) { this.code = s; return this; }, json(b) { out = { code: this.code, body: b }; return out; } };
  await handler({ method, headers, body }, res);
  return out;
};
test('API는 접근 키 없으면 닫혀 있다', async () => {
  delete process.env.OFFICE_ACCESS_KEY;
  assert.equal((await call({})).code, 503);
  process.env.OFFICE_ACCESS_KEY = 'secret';
  assert.equal((await call({}, { 'x-office-key': 'wrong' })).code, 401);
  assert.equal((await call({}, {}, 'GET')).code, 405);
});
test('웹훅은 허용 목록 밖과 http를 거부한다', async () => {
  process.env.OFFICE_ACCESS_KEY = 'secret';
  process.env.WEBHOOK_ALLOWED_HOSTS = 'hooks.example.com';
  const h = { 'x-office-key': 'secret' };
  const send = (url) => call({ agent: { type: 'webhook', url }, input: 'x' }, h);
  assert.equal((await send('https://169.254.169.254/latest')).code, 403);
  assert.equal((await send('http://hooks.example.com/a')).code, 403);
  assert.equal((await send('not a url')).code, 400);
});
test('서버는 내장 유형을 실행하지 않고 Claude 키 누락을 알린다', async () => {
  process.env.OFFICE_ACCESS_KEY = 'secret';
  delete process.env.ANTHROPIC_API_KEY;
  const h = { 'x-office-key': 'secret' };
  assert.equal((await call({ agent: { type: 'analyst' }, input: 'x' }, h)).code, 400);
  const r = await call({ agent: { type: 'claude' }, input: 'x' }, h);
  assert.equal(r.code, 503);
  assert.match(r.body.error, /ANTHROPIC_API_KEY/);
});
