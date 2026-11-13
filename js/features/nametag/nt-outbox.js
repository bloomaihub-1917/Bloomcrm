/* ══════════════════════════════════════════════════════════════
   nt-outbox.js — 네임택 기록을 기기에 먼저 남기고, 연결되면 차례로 보낸다

   현장 와이파이는 끊긴다. 데스크(노트북·태블릿·휴대폰)는 발급·체크인을 누르는 그 순간 이 기기 저장소
   (localStorage)에 한 줄 남기고 화면과 인쇄를 바로 진행한다. 서버로는 뒤에서 들어온 차례대로 보낸다.
   - 끊기면(연결·시간 초과·로그인 토큰·서버 5xx) 그 줄에서 멈추고 잠시 뒤 다시. 연결되면(online) 바로 이어 보낸다
   - 서버가 «받을 수 없다»(4xx)고 하면 그 줄은 «못 보냄»으로 따로 두고 다음으로 간다(무엇이 왜 안 됐는지 남는다)
   - 보낸 줄도 지우지 않고 «보냄»으로 남긴다(기기 기록). 기기 저장소가 차면 오래된 «보냄»부터 지운다
   - 기록 id·시각은 기기가 만든다 → 응답이 끊겨 같은 줄을 두 번 보내도 서버는 한 번만 받는다(routes/nametag.js)
   - 새로 고치거나 브라우저를 닫았다 열어도 남은 줄은 이어 보낸다(어느 행사 화면을 열어 두었든)

   줄: { id, ev, kind, data, at, state: 'wait'|'sent'|'fail', tries, err, sent_at }
     kind  issue(data.rows: 발급 기록) · checkin(data.row) · uncheck(data.id) · void(data.id) · bars(data.items) · contact(data.key, email, phone)
═══════════════════════════════════════════════════════════════ */
import { sendNametag } from '../../api/nametag.js';

const KEY = 'nametag.outbox.v1';
const KEEP_SENT = 3000;   // 기기에 남겨 둘 «보냄» 줄 수(행사 여러 개 합쳐)
const enc = encodeURIComponent;

let log = read();
const net = { ok: null, at: '', err: '', running: false, timer: 0, tries: 0 };
const subs = new Set();

function read(){
  try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
let warned = false;
function save(){
  for(let i = 0; i < 4; i++){
    try { localStorage.setItem(KEY, JSON.stringify(log)); return true; }
    catch {
      /* 저장소가 찼다 — 오래된 «보냄»부터 반씩 덜어 낸다. 안 보낸 줄은 지우지 않는다 */
      const sent = log.filter(o => o.state === 'sent');
      if(!sent.length) break;
      const drop = new Set(sent.slice(0, Math.ceil(sent.length / 2)).map(o => o.id));
      log = log.filter(o => !drop.has(o.id));
    }
  }
  if(!warned){ warned = true; alert('이 기기 저장 공간이 부족해 네임택 기록을 기기에 남기지 못했어요. 인터넷이 연결된 상태로 계속해 주세요.'); }
  return false;
}
function trim(){
  const sent = log.filter(o => o.state === 'sent');
  if(sent.length <= KEEP_SENT) return;
  const drop = new Set(sent.slice(0, sent.length - KEEP_SENT).map(o => o.id));
  log = log.filter(o => !drop.has(o.id));
}
const emit = (type, op, res) => subs.forEach(f => { try { f(type, op, res); } catch(e){ console.warn('네임택 대기열', e); } });

export const newId = (p) => p + Date.now() + Math.random().toString(16).slice(2, 8).padEnd(6, '0');
export const onOutbox = (f) => { subs.add(f); return () => subs.delete(f); };
export const waiting = (ev) => log.filter(o => o.state === 'wait' && (!ev || o.ev === ev));
export const failed = (ev) => log.filter(o => o.state === 'fail' && (!ev || o.ev === ev));
export const deviceLog = (ev) => log.filter(o => !ev || o.ev === ev);
export const netState = () => ({ ...net, waiting: waiting().length });

/* 기기에 남긴다 — 저장이 되면 true. 그다음 화면·인쇄를 진행하고, 보내기는 뒤에서 */
export function enqueue(ev, kind, data){
  const op = { id: newId('Q-'), ev, kind, data, at: new Date().toISOString(), state: 'wait', tries: 0, err: '' };
  log.push(op);
  const ok = save();
  emit('change');
  kick(0);
  return ok;
}

/* 서버에 보낼 꼴 — 기기 줄에서 그때 만든다(같은 내용을 두 번 저장하지 않게) */
/* 발급 기록에는 한 줄로 — 줄바꿈은 종이에 찍을 때만 쓴다(명단·엑셀·마스터DB 올리기가 한 줄을 기대한다) */
const one = (v) => v == null ? v : String(v).replace(/\s*\n\s*/g, ' ').trim();
function request(op){
  const d = op.data, ev = `/${enc(op.ev)}`;
  switch(op.kind){
    case 'issue': return [`${ev}/issue`, 'POST', { batch_id: d.rows[0]?.batch_id, reason: d.reason || undefined, onsite: !!d.onsite,
      cards: d.rows.map(r => ({ id: r.id, checkin_id: r._checkin_id || undefined, printed_at: r.printed_at, person_key: r.person_key,
        source: r.source, ref_id: r.ref_id, contact_id: r.contact_id, name: one(r.name), company: one(r.company), job_title: one(r.job_title),
        badge: r.badge, lang: r.lang, bar: r._bar_id || undefined, email: r._email || undefined, phone: r._phone || undefined })) }];
    case 'checkin': return [`${ev}/checkin`, 'POST', { person_key: d.row.person_key, id: d.row.id, checked_at: d.row.checked_at }];
    case 'uncheck': return [`/checkin/${enc(d.id)}/void`, 'POST', {}];
    case 'void': return [`/print/${enc(d.id)}/void`, 'POST', {}];
    case 'bars': return [`${ev}/bars`, 'PUT', { items: d.items, via: d.via }];
    case 'contact': return [`${ev}/people/${enc(d.key)}`, 'PUT', { email: d.email, phone: d.phone }];
    case 'pos': return [`${ev}/people/${enc(d.key)}/pos`, 'PUT', { pos: d.pos }];
    case 'edits': return [`${ev}/people/${enc(d.key)}/edits`, 'PUT', { edits: d.edits }];
  }
  return null;
}
/* 다시 보내도 되는 실패 — 연결·시간 초과·로그인 토큰(e.status 없음), 401(토큰 만료), 408·429, 서버 5xx */
const retryable = (e) => !e.status || e.status === 401 || e.status === 408 || e.status === 429 || e.status >= 500;

export function kick(ms = 0){
  clearTimeout(net.timer);
  net.timer = setTimeout(flush, ms);
}
export async function flush(){
  if(net.running) return;
  net.running = true;
  try {
    for(;;){
      const op = log.find(o => o.state === 'wait');
      if(!op) break;
      const req = request(op);
      let res = null;
      try {
        if(!req) throw Object.assign(new Error('알 수 없는 기록'), { status: 400 });
        res = await sendNametag(...req);
      } catch(e){
        /* 되돌리기·취소가 404면 이미 된 것(다른 데스크가 먼저 했거나, 만든 줄이 못 보냄) */
        if(e.status === 404 && (op.kind === 'void' || op.kind === 'uncheck')) res = { ok: true, gone: true };
        else if(retryable(e)){
          op.tries++; op.err = e.message; save();
          net.ok = false; net.err = e.message; net.tries++;
          emit('change');
          kick(Math.min(30000, 2000 * 2 ** Math.min(net.tries, 4)));   // 2 · 4 · 8 · 16 · 30초
          return;
        } else {
          op.state = 'fail'; op.err = e.message; save();
          emit('fail', op, e);
          continue;
        }
      }
      op.state = 'sent'; op.sent_at = new Date().toISOString(); op.err = '';
      trim(); save();
      markNet(true);
      emit('sent', op, res);
    }
  } finally { net.running = false; emit('change'); }
}
/* /live 같은 다른 요청의 성패도 연결 상태로 친다 */
export function markNet(ok, err){
  const was = net.ok;
  net.ok = ok; net.err = ok ? '' : err || '';
  if(ok){ net.at = new Date().toISOString(); net.tries = 0; if(was === false && waiting().length) kick(0); }
  if(was !== ok) emit('change');
}
/* 못 보낸 줄 — 다시 보내기 / 치우기 */
export function retryFailed(ev){ failed(ev).forEach(o => { o.state = 'wait'; o.tries = 0; }); save(); emit('change'); kick(0); }
export function dismissFailed(ev){ failed(ev).forEach(o => { o.state = 'sent'; o.err = '치움 · ' + o.err; }); save(); emit('change'); }

window.addEventListener('online', () => kick(0));
/* 안 보낸 줄이 있는데 창을 닫으려 하면 붙잡는다 — 기기에는 남지만, 다시 열어야 이어 보낸다 */
window.addEventListener('beforeunload', (e) => { if(waiting().length){ e.preventDefault(); e.returnValue = ''; } });
if(waiting().length) kick(3000);   // 지난번에 못 보낸 줄 — 로그인이 끝날 즈음 이어 보낸다
