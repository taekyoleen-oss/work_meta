// 업무 실행기: 담당자 유형별 실행, 협업 연결, 결과의 서랍 보관.
import { all, get, put } from './store.js';
import { analyze } from './analyze.js';

export const AGENT_TYPES = {
  lead: '총괄 (업무 배분)',
  claude: '채팅 봇 (Claude)',
  analyst: '내장 분석 앱',
  archivist: '내장 문서 검색',
  webhook: '외부 앱 (웹훅)',
  human: '사람 담당자',
};
const MAX_ATTACHMENT = 100_000;
// 키·서버가 아직 없을 때의 응답. 실패가 아니라 "접수 후 대기"로 다룬다.
const NOT_CONNECTED = [401, 404, 501, 503];

// 3D 장면이 연결하는 연출 지점. 테스트와 3D 없는 환경에서는 아무 일도 하지 않는다.
export const stage = { visit: async () => {}, home: () => {}, say: () => {}, report: () => {} };

export const accessKey = {
  get: () => localStorage.getItem('office-key') ?? '',
  set: (v) => localStorage.setItem('office-key', v),
};

const stamp = (task, text) => task.log.push({ at: Date.now(), text });

export async function docText(doc) {
  if (doc.kind === 'text') return doc.text;
  if (doc.kind === 'link') return doc.url;
  if (/^text\/|json|xml|csv/.test(doc.mime) || /\.(csv|tsv|txt|md|json|html?)$/i.test(doc.title)) return doc.blob.text();
  throw new Error(`이 문서 형식은 내용을 읽을 수 없습니다: ${doc.title}`);
}

export function parseMentions(input, agents) {
  const targets = [];
  const text = input.replace(/(^|\s)@([^\s@]+)/g, (m, lead, name) => {
    const a = agents.find((x) => x.name === name);
    if (!a) return m;
    if (!targets.includes(a)) targets.push(a);
    return lead;
  }).replace(/ {2,}/g, ' ').trim(); // 줄바꿈·탭은 표 데이터일 수 있어 유지
  return { text, targets };
}

// ponytail: 키워드 포함 여부로만 배분. Claude 키를 연결하면 모델 판단으로 교체.
export function routeByKeywords(text, agents) {
  return agents.filter((a) => a.type !== 'lead' && a.keywords?.some((k) => text.includes(k)));
}

async function callServer(agent, input, history = []) {
  let r;
  try {
    r = await fetch('/api/agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-office-key': accessKey.get() },
      body: JSON.stringify({ agent: { name: agent.name, type: agent.type, system: agent.system, url: agent.url }, input, history }),
    });
  } catch { throw new Error('서버에 연결할 수 없습니다.'); }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.error || `서버 오류 ${r.status}`), { status: r.status });
  return body.result;
}

async function execute(agent, input, doc, context) {
  if (agent.type === 'lead') {
    return context ? `담당별 결과\n${context}` : '맡길 담당자를 정하지 못했습니다. @이름으로 지정해 주세요.';
  }
  const attached = doc ? await docText(doc) : '';
  if (agent.type === 'analyst') return analyze(attached || input);
  if (agent.type === 'archivist') {
    const words = input.toLowerCase().split(/\s+/).filter(Boolean);
    const docs = await all('docs');
    const hits = docs.filter((d) => words.some((w) => `${d.title} ${d.text ?? ''} ${d.url ?? ''}`.toLowerCase().includes(w)));
    return hits.length ? `문서 ${hits.length}건을 찾았습니다.\n${hits.map((d) => `- ${d.title}`).join('\n')}` : '일치하는 문서가 없습니다.';
  }
  if (attached.length > MAX_ATTACHMENT) throw new Error(`첨부가 너무 깁니다 (${MAX_ATTACHMENT.toLocaleString()}자 제한).`);
  const parts = [input];
  if (attached) parts.push(`[첨부: ${doc.title}]\n${attached}`);
  if (context) parts.push(`[다른 담당자 결과]\n${context}`);
  const prompt = parts.join('\n\n');
  if (agent.type === 'webhook') {
    if (!agent.url) throw Object.assign(new Error('웹훅 URL이 아직 없습니다.'), { status: 503 });
    return callServer(agent, prompt);
  }
  const past = (await all('tasks'))
    .filter((t) => t.agentId === agent.id && t.status === 'done' && t.result)
    .sort((a, b) => a.createdAt - b.createdAt).slice(-6);
  return callServer(agent, prompt, past.flatMap((t) => [{ role: 'user', content: t.input }, { role: 'assistant', content: t.result }]));
}

export async function run(task) {
  const agent = await get('agents', task.agentId);
  if (!agent) throw new Error('담당자를 찾을 수 없습니다.');
  Object.assign(task, { status: 'running', error: null, pending: null });
  stamp(task, `${agent.name} 작업 시작`);
  await put('tasks', task);
  try {
    const agents = await all('agents');
    const { text, targets } = parseMentions(task.input, agents);
    const others = targets.filter((a) => a.id !== agent.id);
    if (agent.type === 'lead' && !others.length) others.push(...routeByKeywords(text, agents));
    let context = '';
    for (const other of others) {
      await stage.visit(agent, other, text); // 동료 자리로 걸어가 말을 건다
      // 멘션을 제거한 text만 넘기므로 하위 업무가 다시 위임하는 일은 없다.
      const sub = await assign({ agentId: other.id, input: text || task.input, docId: task.docId, parentId: task.id });
      stamp(task, `${other.name}와 협업 → ${{ done: '결과 수신', failed: '실패' }[sub.status] ?? '접수됨'}`);
      await put('tasks', task);
      context += `${other.name}: ${sub.result ?? sub.error ?? `접수됨 (${sub.pending ?? '담당자 확인 대기'})`}\n`;
    }
    if (others.length) stage.home(agent);
    const doc = task.docId ? await get('docs', task.docId) : null;
    let result;
    try {
      result = await execute(agent, text || task.input, doc, context);
    } catch (e) {
      if (!context) throw e;
      result = `${context}\n(${agent.name} 요약 실패: ${e.message})`; // 위임 결과는 버리지 않는다.
    }
    const saved = await put('docs', {
      id: crypto.randomUUID(), kind: 'text', drawer: 'reports', mime: 'text/plain', text: result,
      title: `${agent.name} 보고 - ${task.input.slice(0, 24)}`, createdAt: Date.now(), taskId: task.id,
    });
    Object.assign(task, { status: 'done', result, resultDocId: saved.id });
    stamp(task, '완료 · 결과 보고서 서랍에 보관');
    if (task.parentId) stage.say(agent, '끝났어요!');
    else stage.report(agent, '보고드립니다. 결과를 서랍에 넣어 두었어요.');
  } catch (e) {
    if (NOT_CONNECTED.includes(e.status)) {
      Object.assign(task, { status: 'queued', pending: e.message });
      stamp(task, `접수만 됨: ${e.message}`);
      stage.say(agent, '접수했어요. 연결되면 처리할게요.');
    } else {
      Object.assign(task, { status: 'failed', error: e.message });
      stamp(task, `실패: ${e.message}`);
      stage.say(agent, '문제가 생겼어요.');
    }
  }
  return put('tasks', task);
}

export async function assign({ agentId, input, docId = null, parentId = null }) {
  const agent = await get('agents', agentId);
  const task = { id: crypto.randomUUID(), agentId, input, docId, parentId, status: 'queued', result: null, error: null, pending: null, createdAt: Date.now(), log: [] };
  stamp(task, `${agent.name}에게 지시`);
  await put('tasks', task);
  stage.say(agent, '네, 알겠습니다.');
  return agent.type === 'human' ? task : run(task);
}

export async function report(task, text, done) {
  stamp(task, text);
  if (done) Object.assign(task, { status: 'done', result: text });
  else task.status = 'running';
  return put('tasks', task);
}

// 새로고침으로 끊긴 실행은 복구할 수 없으므로 실패로 표시해 재시도하게 한다.
export async function recoverInterrupted() {
  const agents = await all('agents');
  for (const t of await all('tasks')) {
    const human = agents.find((a) => a.id === t.agentId)?.type === 'human';
    if (t.status === 'running' && !human) await put('tasks', { ...t, status: 'failed', error: '새로고침으로 중단되었습니다.' });
  }
}

// 구글 드라이브 주소를 앱 안에서 보여 줄 수 있는 주소로 바꾼다. 불가능하면 null.
export function driveEmbed(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.hostname !== 'drive.google.com' && u.hostname !== 'docs.google.com') return null;
  const folder = u.pathname.match(/\/folders\/([\w-]+)/)?.[1];
  if (folder) return `https://drive.google.com/embeddedfolderview?id=${folder}#list`;
  const file = u.pathname.match(/^(\/(?:file|document|spreadsheets|presentation)\/d\/[\w-]+)/)?.[1];
  return file ? `https://${u.hostname}${file}/preview` : null;
}
