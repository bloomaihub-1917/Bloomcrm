/* ══════════════════════════════════════════════════════════════
   features/exhibition/exh-booth-price.js — 부스 단가를 진행관리 금액에 자동으로 넣는다

   · 단가는 부스 타입마다 조기·사전·일반 × KRW·USD (행사 › 부스, code_lists.prices).
   · 어느 구간인가: 기업에 직접 고른 값(exhibitors.price_tier)이 있으면 그것, 없으면
     신청서 받은 날(app_received_at)을 행사의 조기·사전 마감일(exh_cfg.tiers)과 견준다.
     신청일이 없으면 일반으로 본다 — 조기로 잡았다가 나중에 올려 청구하는 것보다 안전하다.
   · 어느 통화인가: 이미 이 기업 금액·인보이스에 통화가 있으면 그것, 없으면 기업 국가로
     (대한민국 KRW, 그 밖 USD, 모르면 KRW).
   · 금액 줄은 «부스» 분류에 origin='booth_price'로 한 줄 둔다. 부스 타입·수량·구간이
     바뀌면 그 줄만 고친다. 사람이 직접 넣은 부스 금액 줄이 있으면 손대지 않는다 —
     둘 다 두면 부스 값을 두 번 청구한다.

   탭(exh-tab.js)은 이 파일을 import하지 않는다 — patchExh가 window.syncBoothPrice로 부른다.
═══════════════════════════════════════════════════════════════ */

import { CODE_LISTS, EXH_ITEMS, getExhibitorById, getOrgById, itemsFor, nextItemSort } from '../../state.js';
import { countryName, escapeHtml, escAttr } from '../../utils.js';
import { saveExhItem, deleteExhItem } from '../../api/exh-save.js';
import { trackAction } from '../../core/audit-log.js';
import { activeExhibitors, exhCfg, liveInvoices } from './exh-calc.js';
import { isBookOnly, isNoBooth, isSharedBooth, refreshExhViews } from '../../modules/exh-tab.js';

export const PRICE_ORIGIN = 'booth_price';
export const TIERS = [['early', '조기'], ['pre', '사전'], ['regular', '일반']];
const tierLabel = (k) => (TIERS.find(t => t[0] === k) || [, ''])[1];

function parse(raw){ try { const o = JSON.parse(raw || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; } }

/* 행사의 구간 기준 — exh_cfg.tiers = { early: { until, cap }, pre: { until, cap } }
   until: 그날까지 받은 신청 / cap: 선착순 부스 수(예: 조기 100부스, 사전 50부스).
   둘 다 적으면 둘 다 맞아야 그 구간이다. 옛 형식(early: '날짜')도 읽는다. */
export function tierDates(evKey){
  const raw = exhCfg(evKey).tiers || {};
  const norm = (v) => (typeof v === 'string' ? { until: v } : (v || {}));
  return { early: norm(raw.early), pre: norm(raw.pre) };
}

/* 선착순 — 신청서 받은 순(같은 날이면 등록 순서)으로 부스 수를 쌓아 몇 번째 부스부터인지 본다 */
function boothsBefore(x){
  const order = activeExhibitors(x.event_id)
    .filter(e => e.app_received_at && !e.price_tier && boothQtyOf(e) > 0)
    .sort((a, b) => String(a.app_received_at).localeCompare(String(b.app_received_at)) || String(a.id).localeCompare(String(b.id)));
  /* 직접 구간을 정해 둔 기업도 그 구간 몫을 차지한다 */
  const fixed = activeExhibitors(x.event_id).filter(e => e.price_tier && e.id !== x.id);
  const fixedEarly = fixed.filter(e => e.price_tier === 'early').reduce((a, e) => a + boothQtyOf(e), 0);
  const fixedPre = fixed.filter(e => e.price_tier === 'pre').reduce((a, e) => a + boothQtyOf(e), 0);
  let n = 0;
  for(const e of order){ if(e.id === x.id) break; n += boothQtyOf(e); }
  return { n, fixedEarly, fixedPre };
}

export function tierOf(x){
  if(TIERS.some(t => t[0] === x.price_tier)) return { tier: x.price_tier, auto: false };
  const d = String(x.app_received_at || '').slice(0, 10);
  const t = tierDates(x.event_id);
  if(!d) return { tier: 'regular', auto: true, why: '신청일 없음' };
  const { n, fixedEarly, fixedPre } = boothsBefore(x);
  const q = boothQtyOf(x);
  const okDate = (c) => !c.until || d <= c.until;
  const has = (c) => c.until || +c.cap;
  /* 이 기업의 부스가 전부 그 구간 안에 들어가야 그 구간이다(걸치면 다음 구간) */
  const earlyCap = +t.early.cap ? +t.early.cap - fixedEarly : Infinity;
  if(has(t.early) && okDate(t.early) && n + q <= earlyCap) return { tier: 'early', auto: true, seq: n + 1 };
  /* 사전 몫은 조기 몫 다음 자리부터 — 조기에 수 제한이 없으면 앞선 부스는 모두 조기로 쓴 것으로 본다 */
  const preCap = +t.pre.cap ? +t.pre.cap - fixedPre : Infinity;
  const preEnd = (isFinite(earlyCap) ? Math.max(0, earlyCap) : n) + preCap;
  if(has(t.pre) && okDate(t.pre) && n + q <= preEnd) return { tier: 'pre', auto: true, seq: n + 1 };
  return { tier: 'regular', auto: true, seq: n + 1 };
}

export function currencyFor(x){
  const had = itemsFor(x.id).find(i => i.currency && i.origin !== PRICE_ORIGIN)
    || liveInvoices(x.id).find(r => r.currency);
  if(had) return had.currency;
  const o = x.org_id ? getOrgById(x.org_id) : null;
  const c = o && o.country;
  return c && countryName(c) !== '대한민국' ? 'USD' : 'KRW';
}

function boothRow(x){
  const rows = CODE_LISTS.filter(c => c.list_key === 'booth_type' && c.code === x.booth_type);
  return rows.find(c => c.event_id === x.event_id) || rows.find(c => !c.event_id) || null;
}
const boothQtyOf = (x) => (isSharedBooth(x) || isBookOnly(x) || isNoBooth(x) ? 0
  : Math.max(1, Number(String(x.booth_qty || '').replace(/[^0-9.]/g, '')) || 1));

const isManualBooth = (i) => i.category === 'booth' && i.origin !== PRICE_ORIGIN && !i.voided_at && i.billable !== 'no';

/* 이 기업의 부스 금액이 어떻게 잡히는지 — 드로어 안내와 동기화가 같은 답을 본다 */
export function boothPriceFor(x){
  const { tier, auto, why } = tierOf(x);
  const cur = currencyFor(x);
  const row = x.booth_type ? boothRow(x) : null;
  const unit = row ? Number(parse(row.prices)[tier]?.[cur.toLowerCase()]) || 0 : 0;
  const qty = boothQtyOf(x);
  const manual = itemsFor(x.id).filter(isManualBooth);
  let state = 'ok';
  if(!x.booth_type || qty === 0) state = 'none';
  else if(manual.length) state = 'manual';
  else if(!unit) state = 'noprice';
  return { tier, auto, why, cur, unit, qty, amount: unit * qty, label: row ? (row.label || row.code) : (x.booth_type || ''), state };
}

/* 금액 줄 맞추기. 반환: 'set' | 'removed' | 'same' | 'manual' | 'noprice' | 'none' */
export async function syncBoothPrice(exhId, { quiet = false } = {}){
  const x = getExhibitorById(exhId);
  if(!x) return 'none';
  const p = boothPriceFor(x);
  const auto = itemsFor(exhId).filter(i => i.origin === PRICE_ORIGIN && !i.voided_at);
  const want = p.state === 'ok';

  if(!want){
    /* 직접 넣은 줄이 생겼거나 부스가 없어졌으면 자동 줄은 걷는다(이중 청구 방지).
       단가가 비었을 때도 옛 금액이 남아 청구되면 안 되니 걷는다. */
    for(const i of auto){
      const at = EXH_ITEMS.indexOf(i);
      if(at >= 0) EXH_ITEMS.splice(at, 1);
      await deleteExhItem(i.id);
    }
    if(auto.length && !quiet){ refreshExhViews(); }
    return auto.length ? 'removed' : p.state;
  }

  const name = `${p.label} (${tierLabel(p.tier)})`;
  const fields = { category: 'booth', name, qty: String(p.qty), unit_price: String(p.unit),
    amount: String(p.amount), currency: p.cur, billable: 'yes', origin: PRICE_ORIGIN };
  const [cur, ...extra] = auto;
  for(const i of extra){   // 혹시 두 줄이 되면 하나만 남긴다
    const at = EXH_ITEMS.indexOf(i); if(at >= 0) EXH_ITEMS.splice(at, 1);
    await deleteExhItem(i.id);
  }
  if(cur && Object.keys(fields).every(k => String(cur[k] ?? '') === fields[k])) return 'same';

  const rec = cur ? { ...cur, ...fields }
    : { id: `XI-${Date.now()}_${Math.floor(Math.random() * 1000)}`, exhibitor_id: exhId, ...fields,
        note: '부스 단가에서 자동', sort_order: nextItemSort(exhId), catalog_id: '', app_id: '', change_kind: '' };
  const prev = cur ? { ...cur } : null;
  if(cur) Object.assign(cur, fields); else EXH_ITEMS.push(rec);
  const r = await saveExhItem(rec);
  if(!r.ok){
    if(cur) Object.assign(cur, prev); else { const at = EXH_ITEMS.indexOf(rec); if(at >= 0) EXH_ITEMS.splice(at, 1); }
    return 'none';
  }
  if(!cur && r.id && r.id !== rec.id) rec.id = r.id;
  if(!quiet){
    trackAction('edit', '부스 금액 자동', x.company_name || '',
      `부스 금액을 <b>${escapeHtml(name)}</b> ${p.cur} ${p.unit.toLocaleString()} × ${p.qty} = ${p.amount.toLocaleString()}로 맞췄어요`,
      { kind: 'exhibitor', id: exhId, tab: 'billing' });
    refreshExhViews();
  }
  return 'set';
}

/* 행사 전체에 한 번에 — 단가·마감일을 정한 뒤, 이미 부스가 정해진 기업에 넣는다 */
export async function applyBoothPricesToEvent(evKey){
  const list = activeExhibitors(evKey).filter(x => x.booth_type);
  if(!list.length){ alert('부스 타입이 정해진 참가기업이 없어요.'); return; }
  const pre = list.map(x => ({ x, p: boothPriceFor(x) }));
  const n = (s) => pre.filter(o => o.p.state === s).length;
  if(!confirm(`참가기업 ${list.length}곳의 부스 금액을 단가대로 맞출까요?
· 넣거나 고칠 곳: ${n('ok')}곳
· 직접 넣은 부스 금액이 있어 그대로 둘 곳: ${n('manual')}곳
· 단가가 비어 있는 곳: ${n('noprice')}곳`)) return;
  const cnt = {};
  for(const { x } of pre){ const s = await syncBoothPrice(x.id, { quiet: true }); cnt[s] = (cnt[s] || 0) + 1; }
  refreshExhViews();
  trackAction('edit', '부스 금액 자동', evKey,
    `부스 단가를 참가기업에 반영 — 넣음·고침 ${cnt.set || 0}, 그대로 ${cnt.same || 0}, 직접 넣은 금액 유지 ${cnt.manual || 0}, 단가 없음 ${cnt.noprice || 0}`);
  alert(`반영했어요 — 넣음·고침 ${cnt.set || 0}곳, 이미 맞음 ${cnt.same || 0}곳, 직접 넣은 금액 유지 ${cnt.manual || 0}곳, 단가 없음 ${cnt.noprice || 0}곳`);
}

export function tierRuleText(t){
  const one = (c, l) => (c.until || +c.cap) ? `${l} ${[c.cap ? `선착순 ${c.cap}부스` : '', c.until ? `~${c.until}` : ''].filter(Boolean).join(' · ')}` : '';
  return [one(t.early, '조기'), one(t.pre, '사전')].filter(Boolean).join(' / ');
}

/* 드로어 «부스 배정» 안의 단가 구간 칸과 금액 안내 */
export function boothPriceBlock(x){
  const p = boothPriceFor(x);
  const t = tierDates(x.event_id);
  const opt = (v, l) => `<option value="${v}"${(x.price_tier || '') === v ? ' selected' : ''}>${l}</option>`;
  const autoL = `자동 (${tierLabel(tierOf({ ...x, price_tier: '' }).tier)})`;
  const note = p.state === 'ok' ? `부스 금액 ${p.cur} ${p.unit.toLocaleString()} × ${p.qty} = <b>${p.amount.toLocaleString()}</b> — 금액 탭에 자동으로 들어가요`
    : p.state === 'manual' ? '직접 넣은 부스 금액 줄이 있어 자동으로 넣지 않아요 — 단가대로 하려면 그 줄을 지우세요'
    : p.state === 'noprice' ? `«${escapeHtml(p.label)}» ${tierLabel(p.tier)} ${p.cur} 단가가 비어 있어요 — 행사 › 부스에서 적으세요`
    : '부스 타입을 고르면 단가대로 금액이 들어가요';
  return `<div class="fg"><label class="fl">단가 구간</label>
      <select class="fi" style="font-size:var(--fs-12)" onchange="setExhField('${escAttr(x.id)}','price_tier',this.value,'단가 구간')">
        ${opt('', autoL)}${TIERS.map(([k, l]) => opt(k, l)).join('')}</select>
      <div style="font-size:var(--fs-10_5);color:var(--i5);margin-top:3px">${
        !x.price_tier ? (p.why ? '신청일이 없어 일반으로 봐요. ' : `신청일 ${escapeHtml(String(x.app_received_at || '').slice(0, 10))} 기준. `) : ''}${
        tierRuleText(t) || '행사 › 부스에서 조기·사전 기준(마감일·선착순 부스 수)을 정하세요'}${
        !x.price_tier && tierOf(x).seq ? ` · 신청 순서로 ${tierOf(x).seq}번째 부스부터` : ''}</div>
      <div style="font-size:var(--fs-11);color:${p.state === 'ok' ? 'var(--i3)' : 'var(--am)'};margin-top:4px">${note}</div></div>`;
}

Object.assign(window, { syncBoothPrice, applyBoothPricesToEvent, boothPriceBlock });
