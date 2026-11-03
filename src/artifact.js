// 아티팩트 창: 문서를 오른쪽에 띄워 보고, 전체 보기·미리보기/코드 전환·복사·내려받기를 한다.
// 사용자 문서는 HTML로 그릴 때 항상 allow-same-origin 없는 iframe에 넣어 앱 저장소와 격리한다.
import { h } from './dom.js';
import { driveEmbed } from './agents.js';
import { parseDelimited } from './analyze.js';
import * as gdrive from './gdrive.js';
import { setDragDoc } from './drop.js';

const $ = (id) => document.getElementById(id);
const CDN = {
  marked: 'https://cdn.jsdelivr.net/npm/marked@15.0.12/lib/marked.esm.js',
  xlsx: 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs',
  mammoth: 'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js',
};
const CODE_EXT = /^(txt|log|js|mjs|ts|tsx|jsx|py|css|xml|ya?ml|sql|sh|java|c|cpp|h|go|rs|rb|php|ini|toml)$/;
// 소스를 볼 수 있는(코드 보기·복사) 형식
const TEXTUAL = new Set(['markdown', 'html', 'svg', 'table', 'json', 'code']);

// 문서 → 보기 형식
export function typeOf(d) {
  if (d.kind === 'link' || d.kind === 'drive') return 'web';
  const mime = d.mime ?? '', ext = (d.title ?? '').match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase() ?? '';
  if (/html/.test(mime) || /^html?$/.test(ext)) return 'html';
  if (/markdown/.test(mime) || /^(md|markdown)$/.test(ext)) return 'markdown';
  if (mime === 'image/svg+xml' || ext === 'svg') return 'svg';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (/^(csv|tsv)$/.test(ext) || /csv|tab-separated/.test(mime)) return 'table';
  if (ext === 'json' || /json/.test(mime)) return 'json';
  if (/^(xlsx|xls|ods)$/.test(ext) || /spreadsheet|ms-excel/.test(mime)) return 'sheet';
  if (ext === 'docx' || /wordprocessingml/.test(mime)) return 'docx';
  if (/^(pptx?|key|odp)$/.test(ext) || /presentation|powerpoint/.test(mime)) return 'slides';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/') || /^(mp4|webm|mov)$/.test(ext)) return 'video';
  if (mime.startsWith('audio/') || /^(mp3|wav|ogg|m4a)$/.test(ext)) return 'audio';
  if (d.kind === 'text') return 'markdown'; // 담당자 보고서는 마크다운으로 쓴다
  if (mime.startsWith('text/') || CODE_EXT.test(ext)) return 'code';
  return 'other';
}

const DOC_CSS = `body{font:15px/1.65 system-ui,-apple-system,"Malgun Gothic",sans-serif;color:#2c2a26;max-width:860px;margin:0 auto;padding:22px 28px}
pre,code{background:#f4f1ea;border-radius:6px;font-family:ui-monospace,Consolas,monospace;font-size:13px}pre{padding:12px;overflow:auto}code{padding:1px 4px}
table{border-collapse:collapse;margin:10px 0}td,th{border:1px solid #ddd5c4;padding:4px 8px;text-align:left}th{background:#f4efe4}img{max-width:100%}
blockquote{margin:0;padding-left:12px;border-left:3px solid #ddd5c4;color:#6b6457}h1,h2,h3{line-height:1.3}`;
// 스크립트 없이 그리는 격리 문서. 링크는 새 탭으로 연다.
const docFrame = (title, html) => {
  const f = h('iframe', { title, sandbox: 'allow-popups allow-popups-to-escape-sandbox' });
  f.srcdoc = `<!doctype html><meta charset="utf-8"><base target="_blank"><style>${DOC_CSS}</style>${html}`;
  return f;
};
let mammothLoad;
const loadMammoth = () => (mammothLoad ??= new Promise((ok, no) => document.head.append(Object.assign(document.createElement('script'), {
  src: CDN.mammoth, onload: () => ok(window.mammoth), onerror: () => { mammothLoad = null; no(new Error('워드 변환기를 불러오지 못했습니다.')); },
}))));

function table(rows) {
  const MAX = 2000;
  const [head, ...rest] = rows;
  return h('div', { className: 'table-wrap' },
    rows.length > MAX + 1 ? h('p', { className: 'muted', textContent: `앞의 ${MAX}행만 표시합니다(전체 ${rows.length - 1}행).` }) : null,
    h('table', {},
      h('thead', {}, h('tr', {}, (head ?? []).map((c) => h('th', { textContent: c })))),
      h('tbody', {}, rest.slice(0, MAX).map((r) => h('tr', {}, r.map((c) => h('td', { textContent: c })))))));
}

let urls = [];
const blobUrl = (blob, type) => { const u = URL.createObjectURL(type ? new Blob([blob], { type }) : blob); urls.push(u); return u; };
const textOf = (d) => (d.kind === 'text' ? d.text : d.blob.text());

async function render(d, type, mode) {
  if (mode === 'code') return h('pre', { className: 'code', textContent: await textOf(d) });
  switch (type) {
    case 'web': return h('iframe', { src: d.embed ?? gdrive.asUser(driveEmbed(d.url) ?? d.url, d.account), title: d.title, sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups' });
    case 'markdown': {
      const { marked } = await import(CDN.marked);
      return docFrame(d.title, marked.parse(await textOf(d), { breaks: true })); // 메일·메모의 줄바꿈 유지
    }
    case 'html': { // 스크립트는 돌게 하되 앱과는 다른 출처로 격리한다.
      const f = h('iframe', { title: d.title, sandbox: 'allow-scripts allow-popups allow-forms' });
      f.srcdoc = await textOf(d);
      return f;
    }
    case 'svg': return h('img', { src: blobUrl(d.kind === 'text' ? d.text : d.blob, 'image/svg+xml'), alt: d.title, className: 'fit' }); // img 안의 SVG는 스크립트가 돌지 않는다
    case 'pdf': return h('iframe', { src: blobUrl(d.blob, 'application/pdf'), title: d.title });
    case 'image': return h('img', { src: blobUrl(d.blob), alt: d.title, className: 'fit' });
    case 'video': return h('video', { src: blobUrl(d.blob), controls: true, className: 'fit' });
    case 'audio': return h('audio', { src: blobUrl(d.blob), controls: true, style: 'margin:24px' });
    case 'table': {
      const text = await textOf(d);
      return table(parseDelimited(text, /\.tsv$/i.test(d.title) || !text.split('\n')[0].includes(',') ? '\t' : ','));
    }
    case 'json': {
      const text = await textOf(d);
      let pretty = text;
      try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* 깨진 JSON은 원문 그대로 */ }
      return h('pre', { className: 'code', textContent: pretty });
    }
    case 'code': return h('pre', { className: 'code', textContent: await textOf(d) });
    case 'sheet': {
      const XLSX = await import(CDN.xlsx);
      const book = XLSX.read(await d.blob.arrayBuffer());
      const body = h('div', { className: 'grow-col' });
      const showSheet = (name) => body.replaceChildren(table(XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: false, defval: '' })));
      showSheet(book.SheetNames[0]);
      return [book.SheetNames.length > 1 ? h('div', { className: 'tabs sheet-tabs' }, book.SheetNames.map((n, i) => h('button', {
        textContent: n, 'aria-pressed': String(i === 0),
        on: { click: (e) => { for (const b of e.target.parentNode.children) b.setAttribute('aria-pressed', String(b === e.target)); showSheet(n); } },
      }))) : null, body];
    }
    case 'docx': {
      const mammoth = await loadMammoth();
      const { value } = await mammoth.convertToHtml({ arrayBuffer: await d.blob.arrayBuffer() });
      return docFrame(d.title, value);
    }
    default: return h('p', { className: 'empty' }, type === 'slides'
      ? '슬라이드 파일은 브라우저에서 바로 볼 수 없습니다. 구글 드라이브에 저장하면 구글 미리보기로 봅니다. '
      : '이 형식은 미리 볼 수 없습니다. ', h('a', { href: blobUrl(d.blob), download: d.title, textContent: '내려받기' }));
  }
}

let doc = null, type = null, mode = 'preview';
const viewer = () => $('viewer');

async function draw() {
  for (const u of urls) URL.revokeObjectURL(u);
  urls = [];
  const d = doc, body = $('viewer-body');
  body.replaceChildren(h('p', { className: 'empty', textContent: '여는 중…' }));
  let nodes;
  try { nodes = await render(d, type, mode); } catch (e) { nodes = h('p', { className: 'empty', textContent: `열지 못했습니다: ${e.message}` }); }
  if (d !== doc) return; // 그리는 사이 다른 문서를 열었다
  body.replaceChildren(...[nodes].flat().filter(Boolean));
  drawActions();
}

function drawActions() {
  const d = doc, textual = TEXTUAL.has(type) && type !== 'code' && type !== 'json';
  const btn = (text, onClick, extra = {}) => h('button', { textContent: text, on: { click: onClick }, ...extra });
  const download = async () => {
    const blob = d.kind === 'text' ? new Blob([d.text], { type: 'text/markdown' }) : d.blob;
    const name = d.kind === 'text' && !/\.[a-z0-9]{1,8}$/i.test(d.title) ? `${d.title}.md` : d.title;
    h('a', { href: blobUrl(blob), download: name }).click();
  };
  const copy = async (e) => {
    await navigator.clipboard.writeText(await textOf(d));
    e.target.textContent = '복사됨';
    setTimeout(() => { e.target.textContent = '복사'; }, 1200);
  };
  const tabUrl = type === 'web' ? gdrive.asUser(d.url, d.account) : ['pdf', 'image', 'video', 'audio'].includes(type) ? blobUrl(d.blob) : null;
  $('viewer-actions').replaceChildren(...[
    textual ? h('span', { className: 'seg', role: 'group', 'aria-label': '보기 방식' },
      btn('미리보기', () => setMode('preview'), { 'aria-pressed': String(mode === 'preview') }),
      btn('코드', () => setMode('code'), { 'aria-pressed': String(mode === 'code') })) : null,
    TEXTUAL.has(type) ? btn('복사', copy) : null,
    d.kind === 'text' || d.blob ? btn('내려받기', download) : null,
    tabUrl ? h('a', { href: tabUrl, target: '_blank', rel: 'noopener noreferrer', textContent: '새 탭' }) : null,
  ].filter(Boolean));
}
function setMode(m) { mode = m; draw(); }

function setFull(on) {
  viewer().classList.toggle('full', on);
  $('viewer-full').textContent = on ? '분할 보기' : '전체 보기';
}

export async function openDoc(d) {
  if (!d) return;
  doc = d; type = typeOf(d); mode = 'preview';
  $('viewer-title').textContent = d.title;
  $('viewer-type').textContent = LABEL[type];
  if (!viewer().open) viewer().show();
  document.body.classList.add('art-open');
  await draw();
}
const LABEL = { web: '웹', markdown: '문서', html: 'HTML', svg: 'SVG', pdf: 'PDF', table: '표', json: 'JSON', code: '코드', sheet: '스프레드시트', docx: '워드', slides: '슬라이드', image: '이미지', video: '동영상', audio: '오디오', other: '파일' };

export function closeDoc() { viewer().close(); }

export function initArtifact() {
  $('viewer-close').onclick = closeDoc;
  $('viewer-full').onclick = () => setFull(!viewer().classList.contains('full'));
  $('viewer-title').ondblclick = () => setFull(!viewer().classList.contains('full'));
  // 제목을 채팅창으로 끌면 지금 보는 문서가 첨부된다. 저장되지 않은 웹 화면은 주소로 넘긴다.
  $('viewer-title').addEventListener('dragstart', (e) => {
    if (doc?.id) setDragDoc(e, doc.id, doc.title);
    else if (doc?.url) { e.dataTransfer.setData('text/uri-list', doc.url); e.dataTransfer.setData('text/plain', doc.title); }
  });
  viewer().addEventListener('close', () => {
    doc = null;
    for (const u of urls) URL.revokeObjectURL(u);
    urls = [];
    $('viewer-body').replaceChildren();
    setFull(false);
    document.body.classList.remove('art-open');
  });
  // 창 안 iframe에 초점이 있으면 키가 오지 않으므로, 밖에서 누른 Esc만 처리한다.
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !viewer().open || document.querySelector('dialog[open]:not(#viewer)')) return;
    e.preventDefault();
    if (viewer().classList.contains('full')) setFull(false);
    else closeDoc();
  });
}
