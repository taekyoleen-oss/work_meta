// 구글 드라이브 저장소. 브라우저에서 구글 로그인(GIS) 토큰으로 Drive API를 직접 부른다.
// drive.file 범위라 이 앱이 올린 파일만 보고 고칠 수 있다. 토큰은 메모리에만 두고 새로고침하면 다시 연결한다.
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_NAME = '작은 사무실 서류';
const FIELDS = 'id,name,mimeType,createdTime,webViewLink,appProperties';
const KEY = 'gdrive-client-id';

export const clientId = {
  get: () => localStorage.getItem(KEY) ?? '',
  set: (v) => (v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY)),
};

let token = null, expires = 0, folderId = null;
export const connected = () => !!token && Date.now() < expires;

// 로그인 창은 클릭 직후에만 열리므로 스크립트를 미리 받아 둔다.
export function preload() {
  if (!clientId.get() || window.google?.accounts?.oauth2 || document.getElementById('gis')) return;
  document.head.append(Object.assign(document.createElement('script'), { id: 'gis', src: 'https://accounts.google.com/gsi/client', async: true }));
}

export function connect() {
  if (!clientId.get()) return Promise.reject(new Error('설정에서 구글 클라이언트 ID를 먼저 넣어 주세요.'));
  const oauth = window.google?.accounts?.oauth2;
  if (!oauth) { preload(); return Promise.reject(new Error('구글 로그인을 준비하는 중입니다. 잠시 후 다시 눌러 주세요.')); }
  return new Promise((ok, no) => oauth.initTokenClient({
    client_id: clientId.get(),
    scope: 'https://www.googleapis.com/auth/drive.file',
    callback: (r) => {
      if (r.error) return no(new Error(`구글 로그인 실패: ${r.error}`));
      token = r.access_token;
      expires = Date.now() + (Number(r.expires_in) - 60) * 1000;
      ok();
    },
    error_callback: (e) => no(new Error(e.type === 'popup_closed' ? '로그인 창이 닫혔습니다.' : `구글 로그인 실패: ${e.message ?? e.type}`)),
  }).requestAccessToken());
}

async function call(url, opts = {}) {
  if (!connected()) { token = null; throw new Error('구글 드라이브 연결이 끊겼습니다. 다시 연결해 주세요.'); }
  const r = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...opts.headers } });
  if (r.status === 401) token = null;
  if (!r.ok) throw new Error(`구글 드라이브 오류 ${r.status}: ${(await r.json().catch(() => null))?.error?.message ?? ''}`);
  return r.status === 204 ? null : r.json();
}
const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function folder() {
  if (folderId) return folderId;
  const q = encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const found = (await call(`${API}/files?q=${q}&fields=files(id)`)).files[0];
  folderId = found?.id ?? (await call(`${API}/files?fields=id`, json('POST', { name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }))).id;
  return folderId;
}

// Drive 파일 → 앱 문서 기록. 서랍 위치는 파일의 appProperties에 둔다.
export const toDoc = (f) => ({
  id: `drive:${f.id}`, kind: 'drive', driveId: f.id, drawer: f.appProperties?.drawer ?? 'etc',
  title: f.name, mime: f.mimeType, url: f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view`,
  createdAt: Date.parse(f.createdTime) || Date.now(),
});

export async function upload(blob, name, drawer) {
  const body = new FormData();
  body.append('metadata', new Blob([JSON.stringify({ name, parents: [await folder()], appProperties: { drawer } })], { type: 'application/json' }));
  body.append('file', blob, name);
  return toDoc(await call(`${UPLOAD}/files?uploadType=multipart&fields=${FIELDS}`, { method: 'POST', body }));
}

export async function list() {
  const q = encodeURIComponent(`'${await folder()}' in parents and trashed=false`);
  return (await call(`${API}/files?q=${q}&pageSize=1000&fields=files(${FIELDS})`)).files.map(toDoc);
}

export const setDrawer = (fileId, drawer) => call(`${API}/files/${fileId}?fields=id`, json('PATCH', { appProperties: { drawer } }));
export const trash = (fileId) => call(`${API}/files/${fileId}?fields=id`, json('PATCH', { trashed: true }));
