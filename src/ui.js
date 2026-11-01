// DOM 패널. 사용자 데이터는 textContent로만 넣는다.
import { CABINETS, DRAWERS, MAX_AGENTS, all, del, get, onChange, put } from './store.js';
import { AGENT_TYPES, accessKey, assign, report, run } from './agents.js';

const $ = (id) => document.getElementById(id);
const panel = $('panel');
let current = null; // 열린 패널을 다시 그리는 함수
let ctx;

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v);
  }
  el.append(...kids.flat().filter((c) => c !== null && c !== undefined));
  return el;
}

const STATUS = { queued: '대기', running: '진행', done: '완료', failed: '실패' };
const time = (ms) => new Date(ms).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

async function show(render, wide = false) {
  const token = (current = render);
  const nodes = await render();
  if (token !== current) return; // 그리는 사이 다른 패널이 열림
  const keep = panel.querySelector('[data-keep]');
  const draft = keep?.value;
  panel.className = wide ? 'wide' : '';
  panel.hidden = false;
  panel.replaceChildren(...nodes);
  const fresh = panel.querySelector('[data-keep]');
  if (fresh && draft) fresh.value = draft;
}

function closePanel() {
  current = null;
  panel.hidden = true;
  ctx.closeDrawers();
}
const headerRow = (title, sub) => h('div', { className: 'row spread' },
  h('div', { className: 'grow' }, h('h2', { textContent: title }), sub ? h('p', { className: 'muted', textContent: sub }) : null),
  h('button', { textContent: '닫기', on: { click: closePanel } }));

// 담당자 패널
export function openAgent(id) { show(() => agentView(id)); }

async function agentView(id) {
  const agent = await get('agents', id);
  if (!agent) { closePanel(); return []; }
  const [tasks, docs, agents] = await Promise.all([all('tasks'), all('docs'), all('agents')]);
  const mine = tasks.filter((t) => t.agentId === id).sort((a, b) => a.createdAt - b.createdAt);
  const input = h('textarea', { placeholder: `${agent.name}에게 지시할 내용`, 'aria-label': '지시 내용' });
  input.dataset.keep = '1';
  const attach = h('select', { 'aria-label': '첨부 문서' }, h('option', { value: '', textContent: '첨부 없음' }),
    docs.sort((a, b) => b.createdAt - a.createdAt).map((d) => h('option', { value: d.id, textContent: d.title })));
  const send = async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    await assign({ agentId: id, input: text, docId: attach.value || null });
  };
  const others = agents.filter((a) => a.id !== id).map((a) => `@${a.name}`).join(' ');
  return [
    headerRow(agent.name, `${agent.role} · ${AGENT_TYPES[agent.type]}`),
    h('div', { className: 'msgs' }, mine.length ? mine.slice(-20).flatMap(bubbles) : h('p', { className: 'muted', textContent: '아직 지시한 업무가 없습니다.' })),
    h('form', { on: { submit: send } }, input,
      h('div', { className: 'row', style: 'margin-top:8px' }, h('div', { className: 'grow' }, attach), h('button', { className: 'primary', textContent: '지시하기' })),
      others ? h('p', { className: 'muted', textContent: `다른 담당자 연결: ${others}` }) : null),
    h('h3', { textContent: '담당자 설정' }),
    h('button', { textContent: '설정 열기', on: { click: () => show(() => agentForm(agent)) } }),
  ];
}

function bubbles(t) {
  const out = [h('div', { className: 'bubble me', textContent: t.input })];
  if (t.status === 'running') out.push(h('div', { className: 'bubble', textContent: '작업 중…' }));
  if (t.status === 'queued') out.push(h('div', { className: 'bubble', textContent: '보고 대기 중', on: {} }));
  if (t.status === 'failed') out.push(h('div', { className: 'bubble fail' }, `실패: ${t.error}`, ' ', h('button', { textContent: '재시도', on: { click: () => run(t) } })));
  if (t.status === 'done') out.push(h('div', { className: 'bubble', textContent: t.result }));
  return out;
}

async function agentForm(agent = null) {
  const v = agent ?? { name: '', role: '', type: 'claude', color: '#3d7a8c', system: '', url: '' };
  const name = h('input', { value: v.name, required: true, maxLength: 12, pattern: '[^\\s@]+', title: '띄어쓰기와 @ 없이 입력' });
  const role = h('input', { value: v.role, maxLength: 20 });
  const type = h('select', {}, Object.entries(AGENT_TYPES).map(([k, label]) => h('option', { value: k, textContent: label, selected: k === v.type })));
  const color = h('input', { type: 'color', value: v.color });
  const system = h('textarea', { value: v.system ?? '' });
  const url = h('input', { type: 'url', value: v.url ?? '', placeholder: 'https://…' });
  const sysField = h('label', {}, '역할 지시문 (채팅 봇)', system);
  const urlField = h('label', {}, '웹훅 URL (외부 앱)', url);
  const sync = () => { sysField.hidden = type.value !== 'claude'; urlField.hidden = type.value !== 'webhook'; };
  type.addEventListener('change', sync);
  sync();
  const save = async (e) => {
    e.preventDefault();
    const agents = await all('agents');
    if (agents.some((a) => a.name === name.value && a.id !== agent?.id)) { alert('같은 이름의 담당자가 있습니다.'); return; }
    const used = new Set(agents.map((a) => a.slot));
    const slot = agent?.slot ?? Array.from({ length: MAX_AGENTS }, (_, i) => i).find((i) => !used.has(i));
    const saved = await put('agents', { ...v, id: agent?.id ?? crypto.randomUUID(), slot, name: name.value, role: role.value, type: type.value, color: color.value, system: system.value, url: url.value });
    openAgent(saved.id);
  };
  const remove = async () => {
    if (!confirm(`${agent.name} 담당자를 삭제할까요? 업무 기록과 문서는 남습니다.`)) return;
    await del('agents', agent.id);
    closePanel();
  };
  return [
    headerRow(agent ? `${agent.name} 설정` : '담당자 추가'),
    h('form', { on: { submit: save } },
      h('label', {}, '이름', name), h('label', {}, '역할', role), h('label', {}, '유형', type), sysField, urlField, h('label', {}, '옷 색', color),
      h('div', { className: 'row' }, h('button', { className: 'primary', textContent: '저장' }), agent ? h('button', { type: 'button', className: 'danger', textContent: '삭제', on: { click: remove } }) : null)),
  ];
}

// 업무 보드
export function openBoard() { show(boardView, true); }

async function boardView() {
  const [tasks, agents] = await Promise.all([all('tasks'), all('agents')]);
  const nameOf = (id) => agents.find((a) => a.id === id)?.name ?? '삭제된 담당자';
  tasks.sort((a, b) => b.createdAt - a.createdAt);
  return [
    headerRow('업무 보드', `전체 ${tasks.length}건`),
    h('div', { className: 'board' }, Object.entries(STATUS).map(([s, label]) => {
      const list = tasks.filter((t) => t.status === s);
      return h('section', { className: 'col' }, h('h3', { textContent: `${label} ${list.length}` }),
        list.map((t) => h('button', { className: 'card', on: { click: () => show(() => taskView(t.id)) } },
          t.input.slice(0, 40), h('small', { textContent: `${nameOf(t.agentId)} · ${time(t.createdAt)}` }))));
    })),
  ];
}

async function taskView(id) {
  const t = await get('tasks', id);
  const agent = await get('agents', t.agentId);
  const note = h('textarea', { placeholder: '진행 상황을 적어 주세요', 'aria-label': '보고 내용' });
  note.dataset.keep = '1';
  const submit = (done) => async () => {
    const text = note.value.trim();
    if (!text) return;
    note.value = '';
    await report(t, text, done);
  };
  return [
    headerRow('업무 상세', `${agent?.name ?? '삭제된 담당자'} · ${STATUS[t.status]}`),
    h('div', { className: 'bubble me', textContent: t.input }),
    t.result ? h('div', { className: 'bubble', style: 'margin-top:8px', textContent: t.result }) : null,
    t.error ? h('div', { className: 'bubble fail', style: 'margin-top:8px', textContent: t.error }) : null,
    h('h3', { textContent: '진행 기록' }),
    h('ol', { className: 'log' }, t.log.map((l) => h('li', { textContent: `${time(l.at)} ${l.text}` }))),
    h('div', { className: 'row' },
      h('button', { textContent: '보드로', on: { click: openBoard } }),
      t.resultDocId ? h('button', { textContent: '보고서 열기', on: { click: async () => openDoc(await get('docs', t.resultDocId)) } }) : null,
      t.status === 'failed' ? h('button', { textContent: '재시도', on: { click: () => run(t) } }) : null),
    agent?.type === 'human' && t.status !== 'done' ? [note,
      h('div', { className: 'row', style: 'margin-top:8px' }, h('button', { textContent: '중간 보고', on: { click: submit(false) } }), h('button', { className: 'primary', textContent: '완료 보고', on: { click: submit(true) } }))] : null,
  ].flat();
}

// 문서함
export function openDrawer(id = 'reports') { show(() => drawerView(id)); }

async function drawerView(id) {
  const drawer = DRAWERS.find((d) => d.id === id);
  const docs = (await all('docs')).filter((d) => d.drawer === id).sort((a, b) => b.createdAt - a.createdAt);
  const title = h('input', { placeholder: '제목', 'aria-label': '링크 제목' });
  const url = h('input', { type: 'url', required: true, placeholder: 'https://… (웹페이지·앱 주소)', 'aria-label': '링크 주소' });
  const file = h('input', { type: 'file', multiple: true, 'aria-label': '파일 올리기' });
  file.addEventListener('change', async () => {
    for (const f of file.files) {
      await put('docs', { id: crypto.randomUUID(), kind: 'file', drawer: id, title: f.name, mime: f.type, blob: f, createdAt: Date.now() });
    }
  });
  const addLink = async (e) => {
    e.preventDefault();
    if (!/^https?:$/.test(new URL(url.value).protocol)) { alert('http 또는 https 주소만 넣을 수 있습니다.'); return; }
    await put('docs', { id: crypto.randomUUID(), kind: 'link', drawer: id, title: title.value.trim() || url.value, mime: 'text/uri-list', url: url.value, createdAt: Date.now() });
  };
  return [
    headerRow(drawer.name, CABINETS[drawer.cabinet]),
    h('div', { className: 'tabs' }, DRAWERS.map((d) => h('button', {
      textContent: d.name, 'aria-pressed': String(d.id === id),
      on: { click: () => { ctx.slideDrawer(d.id); openDrawer(d.id); } },
    }))),
    docs.length ? docs.map(docRow) : h('p', { className: 'muted', textContent: '이 서랍은 비어 있습니다.' }),
    h('div', { className: 'drop' },
      h('label', {}, 'PDF, HTML, 이미지, CSV 등 파일 넣기', file),
      h('form', { on: { submit: addLink } }, title, h('div', { style: 'height:6px' }), url, h('div', { style: 'height:6px' }), h('button', { textContent: '링크 넣기' }))),
  ].flat();
}

function docRow(d) {
  const move = h('select', { 'aria-label': `${d.title} 서랍 이동`, style: 'width:auto', on: { change: (e) => put('docs', { ...d, drawer: e.target.value }) } },
    DRAWERS.map((x) => h('option', { value: x.id, textContent: x.name, selected: x.id === d.drawer })));
  return h('div', { className: 'doc' },
    h('button', { className: 'title', textContent: d.title, title: d.title, on: { click: () => openDoc(d) } }), move,
    h('button', { className: 'danger', textContent: '삭제', 'aria-label': `${d.title} 삭제`, on: { click: () => confirm(`"${d.title}"을 삭제할까요?`) && del('docs', d.id) } }));
}

// 문서 보기
let blobUrl = null;
async function openDoc(d) {
  if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
  const body = $('viewer-body'), actions = $('viewer-actions');
  $('viewer-title').textContent = d.title;
  actions.replaceChildren();
  const newTab = (href) => actions.append(h('a', { href, target: '_blank', rel: 'noopener noreferrer', textContent: '새 탭에서 열기' }));
  const isHtml = /html/.test(d.mime) || /\.html?$/i.test(d.title);
  const isPdf = d.mime === 'application/pdf' || /\.pdf$/i.test(d.title);
  if (d.kind === 'text') {
    body.replaceChildren(h('pre', { textContent: d.text }));
  } else if (d.kind === 'link') {
    newTab(d.url);
    // 외부 사이트가 임베드를 막으면 빈 화면이 되므로 새 탭 링크를 항상 함께 둔다.
    body.replaceChildren(h('iframe', { src: d.url, title: d.title, sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups' }));
  } else if (isHtml) {
    // 스크립트는 허용하되 allow-same-origin을 빼서 앱 저장소에 접근하지 못하게 격리한다.
    const frame = h('iframe', { title: d.title, sandbox: 'allow-scripts' });
    frame.srcdoc = await d.blob.text();
    body.replaceChildren(frame);
  } else if (isPdf) {
    blobUrl = URL.createObjectURL(new Blob([d.blob], { type: 'application/pdf' }));
    newTab(blobUrl);
    body.replaceChildren(h('iframe', { src: blobUrl, title: d.title }));
  } else if (d.mime.startsWith('image/') && d.mime !== 'image/svg+xml') {
    blobUrl = URL.createObjectURL(d.blob);
    body.replaceChildren(h('img', { src: blobUrl, alt: d.title }));
  } else if (/^text\/|json|csv|xml/.test(d.mime) || /\.(csv|tsv|txt|md|json)$/i.test(d.title)) {
    body.replaceChildren(h('pre', { textContent: await d.blob.text() }));
  } else {
    blobUrl = URL.createObjectURL(d.blob);
    body.replaceChildren(h('p', { style: 'padding:18px' }, '이 형식은 미리 볼 수 없습니다. ', h('a', { href: blobUrl, download: d.title, textContent: '내려받기' })));
  }
  $('viewer').showModal();
}

async function renderAgentList() {
  const agents = (await all('agents')).sort((a, b) => a.slot - b.slot);
  $('agent-list').replaceChildren(...agents.map((a) => h('button', {
    title: a.role,
    on: { click: () => ctx.walkToAgent(a.slot, () => openAgent(a.id)) },
  }, h('span', { className: 'dot', style: `background:${a.color}` }), a.name)));
  $('btn-new-agent').disabled = agents.length >= MAX_AGENTS;
}

export function initUI(context) {
  ctx = context;
  $('btn-board').onclick = openBoard;
  $('btn-docs').onclick = () => openDrawer();
  $('btn-new-agent').onclick = () => show(() => agentForm());
  $('btn-settings').onclick = () => { $('settings-key').value = accessKey.get(); $('settings').showModal(); };
  $('settings').addEventListener('close', () => { if ($('settings').returnValue === 'save') accessKey.set($('settings-key').value.trim()); });
  $('viewer-close').onclick = () => $('viewer').close();
  $('viewer').addEventListener('close', () => $('viewer-body').replaceChildren());
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden && !document.querySelector('dialog[open]')) closePanel(); });
  // 사용자가 입력 중이면 다시 그리지 않아 포커스와 초안을 지킨다.
  onChange(() => {
    renderAgentList();
    const editing = panel.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName);
    if (current && !editing && !panel.querySelector('form input[required]:focus')) show(current, panel.classList.contains('wide'));
  });
  renderAgentList();
}
