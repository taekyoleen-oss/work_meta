// 구글 드라이브 저장소. 브라우저에서 구글 로그인(GIS) 토큰으로 Drive API를 직접 부른다.
// 서류장마다 다른 계정을 쓸 수 있어 토큰은 계정(이메일)별로 둔다. drive.file 범위라 이 앱이 올린 파일만 보고 고친다.
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_NAME = '작은 사무실 서류';
const FIELDS = 'id,name,mimeType,createdTime,webViewLink,appProperties';
const KEY = 'gdrive-client-id';

// 서버 설정(Vercel 환경 변수): 클라이언트 ID와 서류장별 기본 계정. 정적 서버로 띄우면 없으므로 빈 값.
let config = { googleClientId: '', driveAccounts: [] };
export async function loadConfig() {
  try {
    const r = await fetch('/api/config');
    if (r.ok) config = { ...config, ...(await r.json()) };
  } catch { /* 설정 없이도 동작 */ }
  return config;
}

export const clientId = {
  get: () => localStorage.getItem(KEY) || config.googleClientId || '',
  set: (v) => (v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY)),
};

// 토큰은 만료(약 1시간) 전까지 이 브라우저에 유지해 새로고침해도 다시 로그인하지 않는다.
const tokenKey = (email) => `gdrive-token:${email}`;
function tokenOf(email) {
  if (!email) return null;
  const t = JSON.parse(localStorage.getItem(tokenKey(email)) ?? 'null');
  return t && Date.now() < t.expires ? t.token : null;
}
export const connected = (email) => !!tokenOf(email);
const dropToken = (email) => localStorage.removeItem(tokenKey(email));

// 로그인 창은 클릭 직후에만 열리므로 스크립트를 미리 받아 둔다.
export function preload() {
  if (!clientId.get() || window.google?.accounts?.oauth2 || document.getElementById('gis')) return;
  document.head.append(Object.assign(document.createElement('script'), { id: 'gis', src: 'https://accounts.google.com/gsi/client', async: true }));
}

// hint 계정으로 로그인을 권한다. 사용자가 로그인 창에서 다른 계정을 고를 수 있으므로 실제 계정 이메일을 돌려준다.
export function connect(hint) {
  if (!clientId.get()) return Promise.reject(new Error('설정에서 구글 클라이언트 ID를 먼저 넣어 주세요.'));
  const oauth = window.google?.accounts?.oauth2;
  if (!oauth) { preload(); return Promise.reject(new Error('구글 로그인을 준비하는 중입니다. 잠시 후 다시 눌러 주세요.')); }
  return new Promise((ok, no) => oauth.initTokenClient({
    client_id: clientId.get(),
    scope: 'https://www.googleapis.com/auth/drive.file',
    login_hint: hint || undefined,
    callback: async (r) => {
      if (r.error) return no(new Error(`구글 로그인 실패: ${r.error}`));
      try {
        const about = await fetch(`${API}/about?fields=user(emailAddress)`, { headers: { Authorization: `Bearer ${r.access_token}` } });
        if (!about.ok) throw new Error(`구글 드라이브 오류 ${about.status}`);
        const email = (await about.json()).user?.emailAddress || hint;
        localStorage.setItem(tokenKey(email), JSON.stringify({ token: r.access_token, expires: Date.now() + (Number(r.expires_in) - 60) * 1000 }));
        ok(email);
      } catch (e) { no(e); }
    },
    error_callback: (e) => no(new Error(
      e.type === 'popup_closed' ? '로그인 창이 닫혔습니다.'
        : e.type === 'popup_failed_to_open' ? '로그인 창이 차단되었습니다. 연결 버튼을 누른 뒤 다시 해 주세요.'
          : `구글 로그인 실패: ${e.message ?? e.type}`)),
  }).requestAccessToken());
}

async function call(email, url, opts = {}) {
  const token = tokenOf(email);
  if (!token) throw new Error(`${email} 드라이브 연결이 끊겼습니다. 다시 연결해 주세요.`);
  const r = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...opts.headers } });
  if (r.status === 401) dropToken(email);
  if (!r.ok) throw new Error(`구글 드라이브 오류 ${r.status}: ${(await r.json().catch(() => null))?.error?.message ?? ''}`);
  return r.status === 204 ? null : r.json();
}
const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const folders = new Map(); // 계정별 '작은 사무실 서류' 폴더 id
async function folder(email) {
  if (folders.has(email)) return folders.get(email);
  const q = encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const found = (await call(email, `${API}/files?q=${q}&fields=files(id)`)).files[0];
  const id = found?.id ?? (await call(email, `${API}/files?fields=id`, json('POST', { name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }))).id;
  folders.set(email, id);
  return id;
}

// Drive 파일 → 앱 문서 기록. 서랍 위치는 파일의 appProperties에, 계정은 account에 둔다.
export const toDoc = (f, account) => ({
  id: `drive:${account}:${f.id}`, kind: 'drive', account, driveId: f.id, drawer: f.appProperties?.drawer ?? 'etc',
  title: f.name, mime: f.mimeType, url: f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view`,
  createdAt: Date.parse(f.createdTime) || Date.now(),
});

// 여러 계정에 로그인한 브라우저에서 그 계정으로 열리게 한다.
export function asUser(url, email) {
  if (!email) return url;
  const u = new URL(url);
  u.searchParams.set('authuser', email);
  return u.href;
}

export async function upload(email, blob, name, drawer) {
  const body = new FormData();
  body.append('metadata', new Blob([JSON.stringify({ name, parents: [await folder(email)], appProperties: { drawer } })], { type: 'application/json' }));
  body.append('file', blob, name);
  return toDoc(await call(email, `${UPLOAD}/files?uploadType=multipart&fields=${FIELDS}`, { method: 'POST', body }), email);
}

export async function list(email) {
  const q = encodeURIComponent(`'${await folder(email)}' in parents and trashed=false`);
  return (await call(email, `${API}/files?q=${q}&pageSize=1000&fields=files(${FIELDS})`)).files.map((f) => toDoc(f, email));
}

export const setDrawer = (email, fileId, drawer) => call(email, `${API}/files/${fileId}?fields=id`, json('PATCH', { appProperties: { drawer } }));
export const trash = (email, fileId) => call(email, `${API}/files/${fileId}?fields=id`, json('PATCH', { trashed: true }));
