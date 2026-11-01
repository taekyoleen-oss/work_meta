// 브라우저에 비밀키를 두지 않고 봇을 실행하는 유일한 서버 경계.
import { timingSafeEqual } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-opus-5-5';
const MAX_INPUT = 200_000;

const fail = (res, status, error) => res.status(status).json({ error });
const httpError = (status, message) => Object.assign(new Error(message), { status });

function sameKey(given, expected) {
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function runClaude(agent, input, history) {
  if (!process.env.ANTHROPIC_API_KEY) throw httpError(503, '서버에 ANTHROPIC_API_KEY가 설정되지 않았습니다.');
  const client = new Anthropic({ timeout: 55_000, maxRetries: 0 });
  const msg = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low' }, // 함수 제한 60초 안에 끝내기 위해 낮춤
    system: String(agent.system || `당신은 사무실의 담당자 ${agent.name}입니다. 한국어로 간결하게 보고하세요.`),
    messages: [...history, { role: 'user', content: input }],
  });
  if (msg.stop_reason === 'refusal') throw httpError(422, '모델이 이 요청을 거절했습니다.');
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  return msg.stop_reason === 'max_tokens' ? `${text}\n\n(길이 제한으로 잘렸습니다)` : text;
}

async function runWebhook(agent, input) {
  let url;
  try { url = new URL(agent.url); } catch { throw httpError(400, '웹훅 URL이 올바르지 않습니다.'); }
  const allowed = (process.env.WEBHOOK_ALLOWED_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  // 허용 목록 방식이라 내부망 주소로의 SSRF가 차단된다. redirect도 막아 우회를 차단.
  if (url.protocol !== 'https:' || !allowed.includes(url.hostname.toLowerCase())) {
    throw httpError(403, `허용되지 않은 웹훅 주소입니다: ${url.hostname} (https + WEBHOOK_ALLOWED_HOSTS 등록 필요)`);
  }
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agent: agent.name, input }),
    redirect: 'error',
    signal: AbortSignal.timeout(50_000),
  });
  const body = await r.text();
  if (!r.ok) throw httpError(502, `웹훅 응답 오류 ${r.status}`);
  try {
    const json = JSON.parse(body);
    return String(json.result ?? body);
  } catch { return body; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'POST만 허용됩니다.');
  const expected = process.env.OFFICE_ACCESS_KEY;
  if (!expected) return fail(res, 503, '서버에 OFFICE_ACCESS_KEY가 설정되지 않았습니다.');
  if (!sameKey(req.headers['x-office-key'], expected)) return fail(res, 401, '접근 키가 올바르지 않습니다. 설정에서 입력하세요.');

  const { agent, input, history = [] } = req.body ?? {};
  if (!agent || typeof input !== 'string' || !input.trim() || input.length > MAX_INPUT) return fail(res, 400, '요청 형식이 올바르지 않습니다.');
  const safeHistory = Array.isArray(history)
    ? history.filter((m) => ['user', 'assistant'].includes(m?.role) && typeof m.content === 'string' && m.content)
    : [];
  try {
    if (agent.type === 'claude') return res.json({ result: await runClaude(agent, input, safeHistory) });
    if (agent.type === 'webhook') return res.json({ result: await runWebhook(agent, input) });
    return fail(res, 400, `서버에서 실행할 수 없는 담당자 유형입니다: ${agent.type}`);
  } catch (e) {
    return fail(res, e.status >= 400 && e.status < 600 ? e.status : 502, e.message || '실행 실패');
  }
}
