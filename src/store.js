// IndexedDB 저장소와 변경 알림.
export const DRAWERS = [
  { id: 'plan', cabinet: 0, name: '기획·계약' }, { id: 'finance', cabinet: 0, name: '재무·숫자' }, { id: 'hr', cabinet: 0, name: '인사·총무' },
  { id: 'reports', cabinet: 1, name: '결과 보고서' }, { id: 'data', cabinet: 1, name: '분석 자료' }, { id: 'archive', cabinet: 1, name: '보관' },
  { id: 'links', cabinet: 2, name: '웹페이지' }, { id: 'apps', cabinet: 2, name: '업무 앱' }, { id: 'etc', cabinet: 2, name: '기타' },
];
export const CABINETS = ['서류장 A', '서류장 B', '서류장 C'];
export const MAX_AGENTS = 8;

const SEED = [
  { name: '김비서', role: '채팅 담당', type: 'claude', color: '#c8553d', system: '당신은 사무실의 채팅 비서입니다. 지시를 정리하고, 다른 담당자의 결과가 주어지면 핵심만 요약해 한국어로 보고하세요.' },
  { name: '이분석', role: '데이터 분석', type: 'analyst', color: '#2a6f97' },
  { name: '박연동', role: '외부 앱 연동', type: 'webhook', color: '#6a994e', url: '' },
  { name: '최문서', role: '문서 검색', type: 'archivist', color: '#8e6c8a' },
];

let db;
const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((fn) => fn());

const req = (r) => new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
const store = (name, mode) => db.transaction(name, mode).objectStore(name);

export const all = (name) => req(store(name, 'readonly').getAll());
export const get = (name, id) => req(store(name, 'readonly').get(id));
export async function put(name, value) { await req(store(name, 'readwrite').put(value)); emit(); return value; }
export async function del(name, id) { await req(store(name, 'readwrite').delete(id)); emit(); }

export async function openStore() {
  const open = indexedDB.open('work-meta', 1);
  open.onupgradeneeded = () => ['agents', 'tasks', 'docs'].forEach((n) => open.result.createObjectStore(n, { keyPath: 'id' }));
  db = await req(open);
  if (!(await all('agents')).length) {
    for (const [slot, a] of SEED.entries()) await put('agents', { id: crypto.randomUUID(), slot, ...a });
  }
}
