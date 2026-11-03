// 채팅창 드래그앤드롭: 앱 안의 결과물·문서와 바깥의 파일·링크(뉴스)·글(메일·메모)을 문서로 만들어 다음 요청에 첨부한다.
import { h } from './dom.js';
import { get, put } from './store.js';
import { openDoc } from './artifact.js';

const MIME = 'application/x-office-doc';
const URL_RE = /^https?:\/\/\S+$/i;
const MAX = 10;
const $ = (id) => document.getElementById(id);

export function setDragDoc(e, id, title) {
  e.dataTransfer.setData(MIME, id);
  e.dataTransfer.setData('text/plain', title); // 바깥 앱에 놓으면 제목이 글로 들어간다
  e.dataTransfer.effectAllowed = 'copyLink';
}
export function dragDoc(el, id, title) {
  el.draggable = true;
  el.addEventListener('dragstart', (e) => setDragDoc(e, id, title));
}

const plain = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const hostOf = (url) => { try { return new URL(url).hostname; } catch { return url; } };

// 놓인 데이터 → 첨부 계획. 드롭 이벤트 안에서만 데이터를 읽을 수 있어 동기로 처리한다.
export function readDrop(dt) {
  const id = dt.getData(MIME);
  if (id) return [{ type: 'doc', id }];
  if (dt.files?.length) return [...dt.files].map((file) => ({ type: 'file', file }));
  const text = dt.getData('text/plain').trim();
  const uris = dt.getData('text/uri-list').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (!uris.length && URL_RE.test(text)) uris.push(text);
  if (uris.length) {
    const label = plain(dt.getData('text/html')) || (URL_RE.test(text) ? '' : text);
    return uris.map((url) => ({ type: 'link', url, title: (uris.length === 1 && label ? label : hostOf(url)).slice(0, 80) }));
  }
  return text ? [{ type: 'text', text }] : [];
}

async function save(plan) {
  const base = { id: crypto.randomUUID(), createdAt: Date.now() };
  if (plan.type === 'doc') return get('docs', plan.id);
  if (plan.type === 'file') return put('docs', { ...base, kind: 'file', drawer: 'etc', title: plan.file.name, mime: plan.file.type, blob: plan.file });
  if (plan.type === 'link') return put('docs', { ...base, kind: 'link', drawer: 'links', title: plan.title, url: plan.url, mime: '' });
  const first = plan.text.split('\n').find((l) => l.trim())?.trim() ?? '메모';
  return put('docs', { ...base, kind: 'text', drawer: 'etc', mime: 'text/plain', text: plan.text, title: `메모 - ${first.slice(0, 40)}` });
}

let attached = [];
function drawChips() {
  const box = $('chat-attach');
  box.hidden = !attached.length;
  box.replaceChildren(...attached.map((d) => h('span', { className: 'chip' },
    h('button', { type: 'button', className: 'name', textContent: `📎 ${d.title}`, title: '눌러서 보기', on: { click: async () => openDoc(await get('docs', d.id)) } }),
    h('button', { type: 'button', className: 'x', textContent: '✕', 'aria-label': `${d.title} 첨부 빼기`, on: { click: () => { attached = attached.filter((x) => x !== d); drawChips(); } } }))));
}
export function takeAttachments() {
  const ids = attached.map((d) => d.id);
  attached = [];
  drawChips();
  return ids;
}

export function initChatDrop() {
  const form = $('chat');
  const over = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; form.classList.add('drop-on'); };
  form.addEventListener('dragenter', over);
  form.addEventListener('dragover', over);
  form.addEventListener('dragleave', (e) => { if (!form.contains(e.relatedTarget)) form.classList.remove('drop-on'); });
  form.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    form.classList.remove('drop-on');
    const plans = readDrop(e.dataTransfer);
    if (!plans.length) return;
    try {
      for (const d of await Promise.all(plans.map(save))) {
        if (d && attached.length < MAX && !attached.some((x) => x.id === d.id)) attached.push({ id: d.id, title: d.title });
      }
    } catch (err) { alert(`첨부하지 못했습니다: ${err.message}`); }
    drawChips();
    $('chat-input').focus();
  });
  // 채팅창 밖에 파일을 놓쳐도 브라우저가 앱을 떠나 파일을 열지 않게 한다.
  const guard = (e) => { if (!(e.target instanceof HTMLInputElement && e.target.type === 'file')) e.preventDefault(); };
  addEventListener('dragover', guard);
  addEventListener('drop', guard);
}
