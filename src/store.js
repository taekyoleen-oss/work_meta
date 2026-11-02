// IndexedDB 저장소와 변경 알림.
export const DRAWERS = [
  { id: 'plan', cabinet: 0, name: '기획·계약' }, { id: 'finance', cabinet: 0, name: '재무·숫자' }, { id: 'hr', cabinet: 0, name: '인사·총무' },
  { id: 'reports', cabinet: 1, name: '결과 보고서' }, { id: 'data', cabinet: 1, name: '분석 자료' }, { id: 'archive', cabinet: 1, name: '보관' },
  { id: 'links', cabinet: 2, name: '웹페이지' }, { id: 'apps', cabinet: 2, name: '업무 앱' }, { id: 'etc', cabinet: 2, name: '기타' },
  { id: 'shelf', cabinet: 3, name: '서류 캐비닛' },
];
export const CABINETS = ['서류장 A', '서류장 B', '서류장 C', '사무실 오른쪽 캐비닛'];
export const MAX_AGENTS = 8;

const SEED = [
  { slot: 1, name: '김총괄', role: '총괄업무', gender: 'male', type: 'lead', color: '#35506e', keywords: ['총괄', '전체', '일정', '조율'] },
  { slot: 0, name: '이조사', role: '조사업무', gender: 'female', type: 'archivist', color: '#c8553d', keywords: ['조사', '찾아', '검색', '문서', '자료'] },
  { slot: 2, name: '박분석', role: '분석업무', gender: 'male', type: 'analyst', color: '#2a6f97', keywords: ['분석', '통계', '매출', '합계', '수치'] },
  { slot: 3, name: '최마케팅', role: '마케팅업무', gender: 'female', type: 'claude', color: '#b0497f', keywords: ['마케팅', '홍보', '광고', '캠페인', '고객'],
    system: '당신은 사무실의 마케팅 담당자입니다. 실행 가능한 마케팅 아이디어를 한국어로 간결하게 보고하세요.' },
  { slot: 4, name: '정기타', role: '기타업무', gender: 'male', type: 'claude', color: '#6a994e', keywords: ['기타', '총무', '정리', '번역', '메일'],
    system: '당신은 사무실의 지원 담당자입니다. 맡은 일을 처리하고 결과를 한국어로 간결하게 보고하세요.' },
];
const SEED_LINKS = [
  { id: 'door0', name: 'AI4Insurance', url: 'https://www.ai4insurance.com/' },
  { id: 'door1', name: '', url: '' },
  { id: 'door2', name: '', url: '' },
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
  const open = indexedDB.open('work-meta', 2);
  open.onupgradeneeded = (e) => {
    for (const n of ['agents', 'tasks', 'docs', 'links']) {
      if (!open.result.objectStoreNames.contains(n)) open.result.createObjectStore(n, { keyPath: 'id' });
    }
    if (e.oldVersion === 1) open.transaction.objectStore('agents').clear(); // 5인 팀으로 교체. 업무·문서는 유지
  };
  db = await req(open);
  if (!(await all('agents')).length) {
    for (const a of SEED) await put('agents', { id: crypto.randomUUID(), ...a });
  }
  if (!(await all('links')).length) for (const l of SEED_LINKS) await put('links', l);
}
