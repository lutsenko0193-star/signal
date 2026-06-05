'use strict';

// ════════════════════════════════════════════════════════════════════
// SIGNAL ENGINE v17 — BINARY OPTIONS SPECIALIST
// Исправлено:
// 1. volatilityFilter — реальные пороги для форекс/OTC
// 2. Минимум систем снижен до 2 (качество > количество)
// 3. HTF фильтр не убивает сигналы, только штрафует
// 4. Свечные паттерны — реальные пропорции
// 5. rawScore добавлен в возврат scoreSignal
// 6. Пороги RSI/Stoch расширены (30/70 → 35/65)
// 7. Confluence логика переработана — раздельные веса
// ════════════════════════════════════════════════════════════════════

// ─── БАЗОВЫЕ ИНДИКАТОРЫ ─────────────────────────────────────────────
const IND = {

  EMA(c, p) {
    if (!c.length) return 0;
    const k = 2 / (p + 1);
    let v = c[0].close;
    for (let i = 1; i < c.length; i++) v = (c[i].close - v) * k + v;
    return v;
  },

  EMA_S(c, p) {
    if (!c.length) return [];
    const k = 2 / (p + 1), out = [c[0].close];
    for (let i = 1; i < c.length; i++) out.push((c[i].close - out[i - 1]) * k + out[i - 1]);
    return out;
  },

  SMA(c, p) {
    if (c.length < p) return c[c.length - 1]?.close || 0;
    return c.slice(-p).reduce((a, b) => a + b.close, 0) / p;
  },

  ATR(c, p = 14) {
    if (c.length < 2) return 0.0001;
    const trs = [];
    for (let i = 1; i < c.length; i++) {
      const h = c[i].high, l = c[i].low, pc = c[i - 1].close;
      trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
    if (!trs.length) return 0.0001;
    const use = trs.slice(-Math.min(p, trs.length));
    let atr = use.reduce((a, b) => a + b, 0) / use.length;
    for (let i = p; i < trs.length; i++) atr = (atr * (p - 1) + trs[i]) / p;
    return atr > 0 ? atr : 0.0001;
  },

  RSI(c, p = 14) {
    if (c.length < p + 1) return 50;
    let ag = 0, al = 0;
    for (let i = 1; i <= p; i++) {
      const d = c[i].close - c[i - 1].close;
      if (d > 0) ag += d; else al -= d;
    }
    ag /= p; al /= p;
    for (let i = p + 1; i < c.length; i++) {
      const d = c[i].close - c[i - 1].close;
      ag = (ag * (p - 1) + (d > 0 ? d : 0)) / p;
      al = (al * (p - 1) + (d < 0 ? -d : 0)) / p;
    }
    return al === 0 ? 100 : Math.round((100 - 100 / (1 + ag / al)) * 100) / 100;
  },

  RSI_S(c, p = 14) {
    if (c.length < p + 1) return [];
    const s = []; let ag = 0, al = 0;
    for (let i = 1; i <= p; i++) { const d = c[i].close - c[i - 1].close; if (d > 0) ag += d; else al -= d; }
    ag /= p; al /= p;
    s.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
    for (let i = p + 1; i < c.length; i++) {
      const d = c[i].close - c[i - 1].close;
      ag = (ag * (p - 1) + (d > 0 ? d : 0)) / p; al = (al * (p - 1) + (d < 0 ? -d : 0)) / p;
      s.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
    }
    return s;
  },

  MACD(c) {
    if (c.length < 26) return { macd: 0, signal: 0, hist: 0, cross: null, trend: 'NEUTRAL' };
    const e12 = this.EMA_S(c, 12), e26 = this.EMA_S(c, 26);
    const ml = e12.map((v, i) => v - e26[i]);
    const k = 2 / 10; let sg = ml[0]; const ss = [sg];
    for (let i = 1; i < ml.length; i++) { sg = (ml[i] - sg) * k + sg; ss.push(sg); }
    const n = ml.length - 1, m = ml[n], si = ss[n];
    let cross = null;
    if (n > 0) {
      if (ml[n - 1] < ss[n - 1] && m > si) cross = 'BULL';
      if (ml[n - 1] > ss[n - 1] && m < si) cross = 'BEAR';
    }
    const hist = m - si;
    const histPrev = n > 0 ? ml[n - 1] - ss[n - 1] : 0;
    const trend = hist > 0 ? (hist > histPrev ? 'BULL_STRONG' : 'BULL_WEAK') : (hist < histPrev ? 'BEAR_STRONG' : 'BEAR_WEAK');
    return { macd: m, signal: si, hist, cross, trend };
  },

  STOCH(c, p = 14) {
    if (c.length < p + 3) return { k: 50, d: 50, zone: 'NEUTRAL', cross: null };
    const raw = (bars) => {
      const hi = Math.max(...bars.map(x => x.high)), lo = Math.min(...bars.map(x => x.low));
      const cl = bars[bars.length - 1].close;
      return hi === lo ? 50 : ((cl - lo) / (hi - lo)) * 100;
    };
    const ks = [];
    for (let j = 0; j < 3; j++) { const sl = c.slice(-(p + 2 - j), c.length - j || undefined); if (sl.length >= p) ks.push(raw(sl.slice(-p))); }
    const k = ks.length ? ks.reduce((a, b) => a + b, 0) / ks.length : 50;
    const kArr = [];
    for (let j = 0; j < 3; j++) { const sl = c.slice(-(p + 4 - j), c.length - j || undefined); if (sl.length >= p) kArr.push(raw(sl.slice(-p))); }
    const d = kArr.length ? kArr.reduce((a, b) => a + b, 0) / kArr.length : 50;
    // Расширенные зоны: 25/75 вместо 20/80
    const zone = k < 25 ? 'OVERSOLD' : k > 75 ? 'OVERBOUGHT' : 'NEUTRAL';
    let cross = null;
    if (ks.length >= 2 && kArr.length >= 2) {
      if (ks[0] < kArr[0] && k > d) cross = 'BULL';
      if (ks[0] > kArr[0] && k < d) cross = 'BEAR';
    }
    return { k: Math.max(0, Math.min(100, k)), d: Math.max(0, Math.min(100, d)), zone, cross };
  },

  BB(c, p = 20, m = 2) {
    if (c.length < p) return { upper: 0, mid: 0, lower: 0, pctB: 50, bw: 0, squeeze: false };
    const sl = c.slice(-p).map(x => x.close);
    const mean = sl.reduce((a, b) => a + b, 0) / p;
    const sd = Math.sqrt(sl.reduce((a, b) => a + (b - mean) ** 2, 0) / p);
    const upper = mean + m * sd, lower = mean - m * sd;
    const last = sl[sl.length - 1];
    const pctB = (upper - lower) > 0 ? ((last - lower) / (upper - lower)) * 100 : 50;
    const bw = (upper - lower) / Math.max(mean, 0.00001);
    return { upper, mid: mean, lower, pctB: Math.max(0, Math.min(100, pctB)), bw, squeeze: bw < 0.012 };
  },

  ADX(c, p = 14) {
    if (c.length < p * 2 + 1) return { adx: 0, pdi: 0, mdi: 0, trend: 'NONE', strength: 'NONE' };
    const tr_arr = [], pdm_arr = [], mdm_arr = [];
    for (let i = 1; i < c.length; i++) {
      const h = c[i].high, l = c[i].low, pc = c[i - 1].close, ph = c[i - 1].high, pl = c[i - 1].low;
      tr_arr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
      const up = h - ph, dn = pl - l;
      pdm_arr.push((up > dn && up > 0) ? up : 0);
      mdm_arr.push((dn > up && dn > 0) ? dn : 0);
    }
    let atr = tr_arr.slice(0, p).reduce((a, b) => a + b, 0);
    let apdm = pdm_arr.slice(0, p).reduce((a, b) => a + b, 0);
    let amdm = mdm_arr.slice(0, p).reduce((a, b) => a + b, 0);
    const _dx = (ap, am, at) => { const pdi = at > 0 ? (ap / at) * 100 : 0; const mdi = at > 0 ? (am / at) * 100 : 0; return (pdi + mdi > 0) ? Math.abs(pdi - mdi) / (pdi + mdi) * 100 : 0; };
    const dxs = [_dx(apdm, amdm, atr)];
    for (let i = p; i < tr_arr.length; i++) {
      atr = atr - (atr / p) + tr_arr[i]; apdm = apdm - (apdm / p) + pdm_arr[i]; amdm = amdm - (amdm / p) + mdm_arr[i];
      dxs.push(_dx(apdm, amdm, atr));
    }
    if (dxs.length < p) return { adx: 0, pdi: 0, mdi: 0, trend: 'NONE', strength: 'NONE' };
    let adx = dxs.slice(0, p).reduce((a, b) => a + b, 0) / p;
    for (let i = p; i < dxs.length; i++) adx = (adx * (p - 1) + dxs[i]) / p;
    const pdi = atr > 0 ? (apdm / atr) * 100 : 0, mdi = atr > 0 ? (amdm / atr) * 100 : 0;
    adx = Math.min(100, Math.round(adx * 100) / 100);
    const trend = pdi > mdi ? 'BULL' : 'BEAR';
    // Снижен порог тренда: 18 вместо 20
    const strength = adx > 50 ? 'VERY_STRONG' : adx > 35 ? 'STRONG' : adx > 22 ? 'TRENDING' : adx > 14 ? 'WEAK' : 'NONE';
    return { adx, pdi: Math.round(pdi * 100) / 100, mdi: Math.round(mdi * 100) / 100, trend, strength };
  },

  VWAP(c) {
    const sl = c.slice(-20);
    let pv = 0, vv = 0;
    sl.forEach(x => { const tp = (x.high + x.low + x.close) / 3; pv += tp * x.volume; vv += x.volume; });
    return vv > 0 ? pv / vv : (sl[sl.length - 1]?.close || 0);
  },

  PSAR(c, step = 0.02, max = 0.2) {
    if (c.length < 5) return { sar: 0, bull: true };
    let bull = true, af = step, ep = c[0].low, sar = c[0].high;
    for (let i = 1; i < c.length; i++) {
      sar = sar + af * (ep - sar);
      if (bull) { if (c[i].low < sar) { bull = false; sar = ep; ep = c[i].low; af = step; } else if (c[i].high > ep) { ep = c[i].high; af = Math.min(af + step, max); } }
      else { if (c[i].high > sar) { bull = true; sar = ep; ep = c[i].high; af = step; } else if (c[i].low < ep) { ep = c[i].low; af = Math.min(af + step, max); } }
    }
    return { sar, bull };
  },
};

// ─── СВЕЧНЫЕ ПАТТЕРНЫ ────────────────────────────────────────────────
// Реальные пропорции — не 2.5x а 1.5x для lw/uw
function candlePattern(c) {
  if (c.length < 3) return { name: 'NEUTRAL', direction: 0, reliability: 0 };
  const [c2, c1, c0] = c.slice(-3);
  const atr = IND.ATR(c.slice(-15), 10);
  if (atr <= 0) return { name: 'NEUTRAL', direction: 0, reliability: 0 };
  const body = (x) => Math.abs(x.close - x.open) || atr * 0.05;
  const uw = (x) => x.high - Math.max(x.close, x.open);
  const lw = (x) => Math.min(x.close, x.open) - x.low;
  const rng = (x) => x.high - x.low || atr * 0.1;
  const bull = (x) => x.close > x.open;
  const bear = (x) => x.close < x.open;
  const b0 = body(c0), b1 = body(c1), b2 = body(c2);

  // Engulfing — реальные пропорции
  if (bear(c1) && bull(c0) && c0.open <= c1.close + atr * 0.1 && c0.close >= c1.open - atr * 0.1 && b0 > b1 * 0.8)
    return { name: 'ENG_BULL', direction: 1, reliability: 65 };
  if (bull(c1) && bear(c0) && c0.open >= c1.close - atr * 0.1 && c0.close <= c1.open + atr * 0.1 && b0 > b1 * 0.8)
    return { name: 'ENG_BEAR', direction: -1, reliability: 65 };

  // Morning/Evening Star
  if (bear(c2) && body(c1) < atr * 0.4 && bull(c0) && c0.close > (c2.open + c2.close) / 2 && b2 > atr * 0.3)
    return { name: 'MORNING_STAR', direction: 1, reliability: 72 };
  if (bull(c2) && body(c1) < atr * 0.4 && bear(c0) && c0.close < (c2.open + c2.close) / 2 && b2 > atr * 0.3)
    return { name: 'EVENING_STAR', direction: -1, reliability: 72 };

  // Three White Soldiers / Three Black Crows
  if (bull(c2) && bull(c1) && bull(c0) && c1.close > c2.close && c0.close > c1.close && b0 > atr * 0.2)
    return { name: 'THREE_WHITE', direction: 1, reliability: 78 };
  if (bear(c2) && bear(c1) && bear(c0) && c1.close < c2.close && c0.close < c1.close && b0 > atr * 0.2)
    return { name: 'THREE_BLACK', direction: -1, reliability: 78 };

  // Pin Bar — снижен порог: 1.5x вместо 2.5x
  if (lw(c0) > b0 * 1.5 && lw(c0) > atr * 0.25 && uw(c0) < rng(c0) * 0.35)
    return { name: 'PIN_BULL', direction: 1, reliability: 65 };
  if (uw(c0) > b0 * 1.5 && uw(c0) > atr * 0.25 && lw(c0) < rng(c0) * 0.35)
    return { name: 'PIN_BEAR', direction: -1, reliability: 65 };

  // Hammer / Hanging Man
  if (lw(c0) > b0 * 2.0 && uw(c0) < atr * 0.15 && b0 > atr * 0.1)
    return { name: 'HAMMER', direction: 1, reliability: 63 };
  if (uw(c0) > b0 * 2.0 && lw(c0) < atr * 0.15 && b0 > atr * 0.1)
    return { name: 'HANGING_MAN', direction: -1, reliability: 63 };

  // Marubozu — сильная свеча без теней
  if (uw(c0) < atr * 0.1 && lw(c0) < atr * 0.1 && b0 > atr * 0.4 && bull(c0))
    return { name: 'MARUBOZU_BULL', direction: 1, reliability: 70 };
  if (uw(c0) < atr * 0.1 && lw(c0) < atr * 0.1 && b0 > atr * 0.4 && bear(c0))
    return { name: 'MARUBOZU_BEAR', direction: -1, reliability: 70 };

  // Doji в зоне поддержки/сопротивления
  if (b0 < rng(c0) * 0.1 && rng(c0) > atr * 0.3)
    return { name: 'DOJI', direction: 0, reliability: 55 };

  return { name: 'NEUTRAL', direction: 0, reliability: 0 };
}

// ─── СТРУКТУРА РЫНКА ─────────────────────────────────────────────────
function marketStructure(c, atr) {
  if (c.length < 15) return { trend: 'RANGE', bos: null, choch: null, ob: null, fvg: null };
  const win = c.slice(-50);
  const hi = [], lo = [];
  // Уменьшен lookaround с 3 до 2 для более частых свингов
  const LR = 2;
  for (let i = LR; i < win.length - LR; i++) {
    let ih = true, il = true;
    for (let j = i - LR; j <= i + LR; j++) {
      if (j === i) continue;
      if (win[j].high >= win[i].high) ih = false;
      if (win[j].low <= win[i].low) il = false;
    }
    if (ih) hi.push({ idx: i, price: win[i].high });
    if (il) lo.push({ idx: i, price: win[i].low });
  }
  let trend = 'RANGE';
  if (hi.length >= 2 && lo.length >= 2) {
    const lastHi = hi[hi.length - 1], prevHi = hi[hi.length - 2];
    const lastLo = lo[lo.length - 1], prevLo = lo[lo.length - 2];
    const hh = lastHi.price > prevHi.price, hl = lastLo.price > prevLo.price;
    const lh = lastHi.price < prevHi.price, ll = lastLo.price < prevLo.price;
    if (hh && hl) trend = 'UPTREND';
    else if (lh && ll) trend = 'DOWNTREND';
    else if (hh || hl) trend = 'UPTREND'; // мягкое условие
    else if (lh || ll) trend = 'DOWNTREND';
  }
  const last = c[c.length - 1];
  let bos = null, choch = null;
  if (hi.length >= 1 && last.close > hi[hi.length - 1].price) bos = 'BULL_BOS';
  if (lo.length >= 1 && last.close < lo[lo.length - 1].price) bos = 'BEAR_BOS';
  if (trend === 'UPTREND' && lo.length >= 1 && last.close < lo[lo.length - 1].price) choch = 'BEAR_CHOCH';
  if (trend === 'DOWNTREND' && hi.length >= 1 && last.close > hi[hi.length - 1].price) choch = 'BULL_CHOCH';

  // Order Block
  let ob = null;
  for (let i = c.length - 4; i >= Math.max(0, c.length - 20); i--) {
    if (i + 1 >= c.length) continue;
    if (c[i + 1].close - c[i].close > atr * 1.5 && c[i].close < c[i].open) { ob = { type: 'BULL', high: c[i].high, low: c[i].low }; break; }
    if (c[i].close - c[i + 1].close > atr * 1.5 && c[i].close > c[i].open) { ob = { type: 'BEAR', high: c[i].high, low: c[i].low }; break; }
  }
  // FVG
  let fvg = null;
  for (let i = c.length - 3; i >= Math.max(0, c.length - 10); i--) {
    if (i + 2 >= c.length) continue;
    if (c[i + 2].low > c[i].high) { fvg = { type: 'BULL', high: c[i + 2].low, low: c[i].high }; break; }
    if (c[i + 2].high < c[i].low) { fvg = { type: 'BEAR', high: c[i].low, low: c[i + 2].high }; break; }
  }
  return { trend, bos, choch, ob, fvg };
}

// ─── S/R УРОВНИ ──────────────────────────────────────────────────────
function calcSR(c) {
  if (c.length < 15) return { res: 0, sup: 0, resS: 1, supS: 1, fib: [] };
  const win = c.slice(-200);
  const last = win[win.length - 1].close;
  const tol = last * 0.004; // чуть шире кластеризация
  const hiPts = [], loPts = [];
  const LR = 2;
  for (let i = LR; i < win.length - LR; i++) {
    let ih = true, il = true;
    for (let j = i - LR; j <= i + LR; j++) {
      if (j === i) continue;
      if (win[j].high >= win[i].high) ih = false;
      if (win[j].low <= win[i].low) il = false;
    }
    if (ih) hiPts.push({ price: win[i].high });
    if (il) loPts.push({ price: win[i].low });
  }
  const cluster = (pts) => {
    const s = [...pts].sort((a, b) => a.price - b.price), g = [];
    s.forEach(p => { const e = g.find(x => Math.abs(x.price - p.price) <= tol); if (e) { e.t++; e.price = (e.price * (e.t - 1) + p.price) / e.t; } else g.push({ price: p.price, t: 1 }); });
    return g.sort((a, b) => b.t - a.t);
  };
  const rg = cluster(hiPts.filter(h => h.price >= last));
  const sg = cluster(loPts.filter(l => l.price <= last));
  const h = Math.max(...win.map(x => x.high)), l = Math.min(...win.map(x => x.low)), range = h - l;
  const fib = range > 0 ? [
    { level: h, name: 'H' }, { level: h - range * 0.236, name: 'F23' }, { level: h - range * 0.382, name: 'F38' },
    { level: h - range * 0.5, name: 'F50' }, { level: h - range * 0.618, name: 'F61' }, { level: l, name: 'L' }
  ] : [];
  const fb = Math.max(...win.slice(-30).map(x => x.high));
  const fl = Math.min(...win.slice(-30).map(x => x.low));
  return { res: rg[0]?.price || fb, sup: sg[0]?.price || fl, resS: rg[0]?.t || 1, supS: sg[0]?.t || 1, fib };
}

// ─── ФИЛЬТР ВОЛАТИЛЬНОСТИ — ИСПРАВЛЕН ────────────────────────────────
// Реальные пороги для форекс/OTC:
//   Forex major: atrPct ~0.02-0.08%
//   Forex minor: atrPct ~0.03-0.12%
//   OTC:         atrPct ~0.01-0.05%
function volatilityFilter(c, atr) {
  if (c.length < 10) return { ok: false, ratio: 1, regime: 'UNKNOWN' };
  const atr5 = IND.ATR(c.slice(-6), 5);
  const atr20 = IND.ATR(c.slice(-21), 20);
  const ratio = atr5 / Math.max(atr20, 0.00001);
  const lastPrice = c[c.length - 1].close;
  const atrPct = (atr / lastPrice) * 100;

  // ИСПРАВЛЕНЫ ПОРОГИ:
  // Было: DEAD < 0.02, LOW < 0.04 — слишком строго для форекс/OTC
  // Стало: DEAD < 0.003 (буквально мёртвый рынок), LOW < 0.007
  let regime = 'NORMAL';
  if (atrPct < 0.003) regime = 'DEAD';        // Полностью мёртвый рынок
  else if (atrPct < 0.007) regime = 'LOW';      // Очень низкая волатильность
  else if (atrPct > 0.8) regime = 'HIGH';     // Экстремально высокая (новости)
  else if (ratio > 2.2) regime = 'EXPANDING';
  else if (ratio < 0.4) regime = 'CONTRACTING';

  const ok = regime !== 'DEAD' && regime !== 'HIGH';
  return { ok, ratio: Math.round(ratio * 100) / 100, regime, atrPct: Math.round(atrPct * 10000) / 10000 };
}

// ─── RSI ДИВЕРГЕНЦИЯ ─────────────────────────────────────────────────
function rsiDivergence(c, p = 14) {
  if (c.length < 20) return { bull: false, bear: false };
  const tail = c.slice(-20);
  const rs = IND.RSI_S(tail, Math.min(p, tail.length - 2));
  if (rs.length < 6) return { bull: false, bear: false };
  const prices = tail.map(x => x.close), mid = Math.floor(prices.length / 2);
  const pNow = prices[prices.length - 1], pMid = prices[mid];
  const rNow = rs[rs.length - 1], rMid = rs[mid];
  // Расширены пороги: <50 вместо <45
  return {
    bull: pNow < pMid && rNow > rMid && rNow < 50,
    bear: pNow > pMid && rNow < rMid && rNow > 50
  };
}

// ─── ГЛАВНЫЙ СКОРИНГ ─────────────────────────────────────────────────
function scoreSignal({ c, sym, tf, sr, ms, atr, news, marketData }) {
  const last = c[c.length - 1];
  const n = c.length;
  if (n < 10) return { signal: 'WAIT', conf: 0, reason: 'NOT_ENOUGH_DATA', rawScore: 0, ...emptyIndicators(c, atr, sr) };

  const vol = volatilityFilter(c, atr);
  if (!vol.ok) return {
    signal: 'WAIT', conf: 0, reason: 'LOW_VOL_' + vol.regime, rawScore: 0,
    ...emptyIndicators(c, atr, sr)
  };

  if (news?.impact === 'HIGH') return {
    signal: 'WAIT', conf: 0, reason: 'HIGH_IMPACT_NEWS: ' + (news.event || 'UNKNOWN'), rawScore: 0,
    ...emptyIndicators(c, atr, sr)
  };

  // MEDIUM IMPACT = штраф 20% к confidence (не полный стоп)
  let newsMultiplier = 1.0;
  if (news?.impact === 'MEDIUM') newsMultiplier = 0.8;

  const htfBias = getHTFBias(marketData, sym, tf);

  // NEW: Добавляем VSA и Смарт-структуры в основной скоринг
  const vsa = vsaAnalysis(c);
  const manip = manipulationDetector(c, atr);
  const liq = liquidityZones(c, atr);
  const wyck = wyckoff(c, sr, atr);

  // ══ ШАГ 5: РЕЖИМ РЫНКА (Определяет веса) ══
  const adx = IND.ADX(c);
  const isTrending = adx.strength === 'TRENDING' || adx.strength === 'STRONG' || adx.strength === 'VERY_STRONG';
  const isRange = adx.strength === 'NONE' || adx.strength === 'WEAK';

  const weightMultiplier = isTrending ? { trend: 1.5, osc: 0.7 } : { trend: 0.7, osc: 1.5 };

  // ══ ШАГ 4: ИНДИКАТОРЫ ══
  const rsi = IND.RSI(c);
  const macd = IND.MACD(c);
  const stoch = IND.STOCH(c);
  const bb = IND.BB(c);
  const vwap = IND.VWAP(c);
  const psar = IND.PSAR(c);
  const ema8 = IND.EMA(c, 8);
  const ema21 = IND.EMA(c, 21);
  const ema50 = IND.EMA(c, 50);
  const cp = candlePattern(c);
  const div = rsiDivergence(c);

  // ══ ШАГ 6: CONFLUENCE — ВЗВЕШЕННАЯ СИСТЕМА ══
  let bullScore = 0, bearScore = 0;
  const bullReasons = [], bearReasons = [];

  // A. EMA тренд — вес высокий в тренде
  const emaWeight = 2 * weightMultiplier.trend;
  if (ema8 > ema21 && ema21 > ema50) { bullScore += emaWeight; bullReasons.push('EMA_TREND'); }
  else if (ema8 < ema21 && ema21 < ema50) { bearScore += emaWeight; bearReasons.push('EMA_TREND'); }
  else if (ema8 > ema21 && last.close > ema8) { bullScore += 1; bullReasons.push('EMA_SHORT'); }
  else if (ema8 < ema21 && last.close < ema8) { bearScore += 1; bearReasons.push('EMA_SHORT'); }

  // B. MACD
  const macdWeight = 2 * weightMultiplier.trend;
  if (macd.cross === 'BULL') { bullScore += macdWeight; bullReasons.push('MACD_X'); }
  else if (macd.hist > 0 && macd.trend === 'BULL_STRONG') { bullScore += 1; bullReasons.push('MACD_BULL'); }
  if (macd.cross === 'BEAR') { bearScore += macdWeight; bearReasons.push('MACD_X'); }
  else if (macd.hist < 0 && macd.trend === 'BEAR_STRONG') { bearScore += 1; bearReasons.push('MACD_BEAR'); }

  // C. RSI — вес выше в боковике
  const oscWeight = 2 * weightMultiplier.osc;
  if (rsi < 35) { bullScore += oscWeight; bullReasons.push('RSI_OS'); }
  else if (rsi < 45) { bullScore += 1; bullReasons.push('RSI_LOW'); }
  if (rsi > 65) { bearScore += oscWeight; bearReasons.push('RSI_OB'); }
  else if (rsi > 55) { bearScore += 1; bearReasons.push('RSI_HIGH'); }

  // D. Stochastic
  if (stoch.zone === 'OVERSOLD') { bullScore += 2; bullReasons.push('STOCH_OS'); }
  else if (stoch.k < 40 && stoch.cross === 'BULL') { bullScore += 1; bullReasons.push('STOCH_X_BULL'); }
  if (stoch.zone === 'OVERBOUGHT') { bearScore += 2; bearReasons.push('STOCH_OB'); }
  else if (stoch.k > 60 && stoch.cross === 'BEAR') { bearScore += 1; bearReasons.push('STOCH_X_BEAR'); }

  // E. BB
  if (bb.pctB < 25) { bullScore += (1.5 * weightMultiplier.osc); bullReasons.push('BB_LOW'); }
  else if (bb.pctB < 40) { bullScore += 1; bullReasons.push('BB_LOW2'); }
  if (bb.pctB > 75) { bearScore += (1.5 * weightMultiplier.osc); bearReasons.push('BB_HIGH'); }
  else if (bb.pctB > 60) { bearScore += 1; bearReasons.push('BB_HIGH2'); }

  // F. PSAR + VWAP
  if (psar.bull) { bullScore += 1; bullReasons.push('PSAR_BULL'); }
  else { bearScore += 1; bearReasons.push('PSAR_BEAR'); }
  if (last.close > vwap) { bullScore += 1; bullReasons.push('ABOVE_VWAP'); }
  else { bearScore += 1; bearReasons.push('BELOW_VWAP'); }

  // G. Свечной паттерн
  if (cp.direction > 0 && cp.reliability >= 63) {
    const w = cp.reliability >= 72 ? 2 : 1;
    bullScore += w; bullReasons.push('CANDLE:' + cp.name);
  }
  if (cp.direction < 0 && cp.reliability >= 63) {
    const w = cp.reliability >= 72 ? 2 : 1;
    bearScore += w; bearReasons.push('CANDLE:' + cp.name);
  }

  // H. Структура рынка
  if (ms.trend === 'UPTREND') { bullScore += 2; bullReasons.push('STRUCT_UP'); }
  if (ms.trend === 'DOWNTREND') { bearScore += 2; bearReasons.push('STRUCT_DN'); }
  if (ms.choch === 'BULL_CHOCH') { bullScore += 2; bullReasons.push('CHOCH_BULL'); }
  if (ms.choch === 'BEAR_CHOCH') { bearScore += 2; bearReasons.push('CHOCH_BEAR'); }

  // I. S/R уровни
  if (last.close <= sr.sup + atr * 0.8) { const w = sr.supS >= 3 ? 2 : 1; bullScore += w; bullReasons.push('AT_SUP'); }
  if (last.close >= sr.res - atr * 0.8) { const w = sr.resS >= 3 ? 2 : 1; bearScore += w; bearReasons.push('AT_RES'); }

  // J. RSI дивергенция
  if (div.bull) { bullScore += 4; bullReasons.push('RSI_DIV'); }
  if (div.bear) { bearScore += 4; bearReasons.push('RSI_DIV'); }

  // K. Smart Money & VSA (NEW)
  if (vsa.signal === 'BULL') { bullScore += 2; bullReasons.push('VSA_BULL'); }
  if (vsa.signal === 'BEAR') { bearScore += 2; bearReasons.push('VSA_BEAR'); }
  if (liq.swept) {
    if (liq.sweepDir === 'BEAR') { bullScore += 3; bullReasons.push('LIQ_SWEEP_BULL'); }
    if (liq.sweepDir === 'BULL') { bearScore += 3; bearReasons.push('LIQ_SWEEP_BEAR'); }
  }
  if (wyck.spring) { bullScore += 3; bullReasons.push('WYCKOFF_SPRING'); }
  if (wyck.upthrust) { bearScore += 3; bearReasons.push('WYCKOFF_UTAD'); }

  if (ms.ob?.type === 'BULL' && last.close >= ms.ob.low && last.close <= ms.ob.high * 1.002) { bullScore += 2.5; bullReasons.push('OB_BULL'); }
  if (ms.ob?.type === 'BEAR' && last.close <= ms.ob.high && last.close >= ms.ob.low * 0.998) { bearScore += 2.5; bearReasons.push('OB_BEAR'); }

  // ══ ШАГ 7: HTF ФИЛЬТР — ШТРАФ, НЕ УБИЙСТВО ══
  let htfPenalty = 0;
  if (htfBias === 'BEAR' && bullScore > bearScore) htfPenalty = 6;
  if (htfBias === 'BULL' && bearScore > bullScore) htfPenalty = 6;
  const adjBullScore = bullScore - (htfBias === 'BEAR' ? htfPenalty : 0);
  const adjBearScore = bearScore - (htfBias === 'BULL' ? htfPenalty : 0);

  // ══ ШАГ 8: РЕШЕНИЕ ══
  const MIN_SCORE = 10; // Порог повышен для фильтрации шума
  const MIN_EDGE = 7;   // Требуется более явное преимущество одной из сторон

  let signal = 'WAIT';
  let conf = 50;
  let reason = 'INSUFFICIENT_CONFLUENCE';
  let rawScore = 0;

  const maxPossible = 25;

  if (adjBullScore >= MIN_SCORE && adjBullScore - adjBearScore >= MIN_EDGE) {
    signal = 'BUY';
    rawScore = adjBullScore;
    // Более консервативная формула: 65% base + 24% за score
    conf = Math.round(65 + (adjBullScore / maxPossible) * 24 + (cp.direction > 0 ? 2 : 0));
    reason = bullReasons.slice(0, 7).join('+');
  } else if (adjBearScore >= MIN_SCORE && adjBearScore - adjBullScore >= MIN_EDGE) {
    signal = 'SELL';
    rawScore = adjBearScore;
    // Более консервативная формула: 63% base + 26% за score
    conf = Math.round(63 + (adjBearScore / maxPossible) * 26 + (cp.direction < 0 ? 2 : 0));
    reason = bearReasons.slice(0, 7).join('+');
  }

  // HTF совпадение — бонус уверенности (+3 вместо +5)
  if (signal === 'BUY' && htfBias === 'BULL') conf += 3;
  if (signal === 'SELL' && htfBias === 'BEAR') conf += 3;

  // ✅ NEW: Штраф за MEDIUM IMPACT новости
  conf = Math.round(conf * newsMultiplier);

  conf = Math.max(10, Math.min(92, conf));

  return {
    signal,
    conf: Math.round(conf),
    reason,
    rawScore: Math.max(adjBullScore, adjBearScore),
    // Метаданные
    htfBias,
    volRegime: vol.regime,
    atrPct: vol.atrPct,
    regime: isRange ? 'RANGE' : isTrending ? 'TREND' : 'NEUTRAL',
    bullSystems: bullReasons.length,
    bearSystems: bearReasons.length,
    // Индикаторы
    rsi: rsi.toFixed(1),
    adx: adx.adx.toFixed(1),
    stochK: stoch.k.toFixed(1),
    bb: bb.pctB.toFixed(1),
    macdCross: macd.cross || '-',
    psar: psar.bull ? 'BULL' : 'BEAR',
    vwapPos: last.close > vwap ? 'ABOVE' : 'BELOW',
    cp: cp.name,
    pattern: 'NONE',
    ichi: 'IN',
    wr: '0',
    cci: '0',
    struct: ms.trend + (ms.bos ? '+' + ms.bos : '') + (ms.choch ? '+' + ms.choch : ''),
    wyckoffPhase: wyck.phase,
    vsaType: vsa.signal !== 'NEUTRAL' ? vsa.signal : '-',
    spring: wyck.spring,
    upthrust: wyck.upthrust,
    liqSweep: liq.swept ? liq.sweepDir : null,
    inDemand: false, // Можно добавить расчет Supply/Demand зон
    inSupply: false,
    elder: signal,
    bull: signal === 'BUY' ? conf : 100 - conf,
    bear: signal === 'SELL' ? conf : 100 - conf,
    reasons: reason.split('+').slice(0, 7),
    manipulation: null,
    mtf: htfBias,
    mtfStrength: htfBias !== 'NEUTRAL' ? 70 : 50,
    momentum: 'NEUTRAL',
    momScore: 0,
    paZone: vol.regime,
    paPosition: 50,
    sup: sr.sup > 0 ? sr.sup.toFixed(5) : '0',
    res: sr.res > 0 ? sr.res.toFixed(5) : '0',
    newsRisk: news?.risk || false,
    event: news?.event || '',
    delta: '0',
    mom: '0',
    stable: 0,
    edge: Math.abs(adjBullScore - adjBearScore),
  };
}

// ─── HELPERS ─────────────────────────────────────────────────────────
function emptyIndicators(c, atr, sr) {
  const rsi = IND.RSI(c), adx = IND.ADX(c), stoch = IND.STOCH(c), bb = IND.BB(c);
  const macd = IND.MACD(c), psar = IND.PSAR(c), vwap = IND.VWAP(c);
  const cp = candlePattern(c);
  const ms = c.length >= 15 ? marketStructure(c, atr) : { trend: 'RANGE', bos: null, choch: null, ob: null, fvg: null };
  const last = c[c.length - 1] || { close: 0 };
  return {
    rsi: rsi.toFixed(1), adx: adx.adx.toFixed(1), stochK: stoch.k.toFixed(1),
    bb: bb.pctB.toFixed(1), macdCross: macd.cross || '-', psar: psar.bull ? 'BULL' : 'BEAR',
    vwapPos: last.close > vwap ? 'ABOVE' : 'BELOW', cp: cp.name, pattern: 'NONE',
    ichi: 'IN', wr: '0', cci: '0', struct: ms.trend, wyckoffPhase: 'N/A',
    vsaType: '-', spring: false, upthrust: false, liqSweep: null,
    inDemand: false, inSupply: false, elder: 'WAIT',
    bull: 50, bear: 50, reasons: [], manipulation: null,
    mtf: 'NEUTRAL', mtfStrength: 50, momentum: 'NEUTRAL', momScore: 0,
    paZone: 'N/A', paPosition: 50, rawScore: 0,
    sup: sr.sup > 0 ? sr.sup.toFixed(5) : '0', res: sr.res > 0 ? sr.res.toFixed(5) : '0',
    newsRisk: false, event: '', delta: '0', mom: '0', stable: 0, edge: 0,
  };
}

// HTF bias из кэша старших TF
function getHTFBias(marketData, sym, tf) {
  if (!marketData) return 'NEUTRAL';
  const order = ['M1', 'M5', 'M15', 'M30', 'H1'];
  const idx = order.indexOf(tf);
  if (idx < 0) return 'NEUTRAL';
  for (let i = order.length - 1; i > idx; i--) { // Смотрим самый старший из доступных
    if (i >= order.length) continue;
    const htf = order[i];
    const cached = marketData[sym]?.[htf]?.cached;
    if (!cached) continue;
    if (cached.signal === 'BUY') return 'BULL';
    if (cached.signal === 'SELL') return 'BEAR';
    if (cached.struct?.includes('UPTREND')) return 'BULL';
    if (cached.struct?.includes('DOWNTREND')) return 'BEAR';
  }
  return 'NEUTRAL';
}

// Вспомогательные функции
function momentumScore(c) {
  if (c.length < 10) return { score: 0, direction: 'NEUTRAL', acceleration: 0 };
  const roc5 = (c[c.length - 1].close - c[c.length - 6].close) / Math.max(c[c.length - 6].close, 0.00001) * 100;
  const roc3 = (c[c.length - 1].close - c[c.length - 4].close) / Math.max(c[c.length - 4].close, 0.00001) * 100;
  return { score: roc5, direction: roc5 > 0 ? 'BULL' : 'BEAR', acceleration: roc3 - roc5, roc3, roc5 };
}

function manipulationDetector(c, atr) {
  if (c.length < 5) return { type: null, probability: 0 };
  const last = c[c.length - 1];
  const va = c.slice(-20).reduce((a, b) => a + b.volume, 0) / 20;
  const body = Math.abs(last.close - last.open);
  const uw = last.high - Math.max(last.close, last.open);
  const lw = Math.min(last.close, last.open) - last.low;
  const rng = last.high - last.low || 1;
  if (lw > atr * 1.5 && body < rng * 0.25 && last.volume > va * 2 && last.close > last.open)
    return { type: 'STOP_HUNT_BULL', probability: 75 };
  if (uw > atr * 1.5 && body < rng * 0.25 && last.volume > va * 2 && last.close < last.open)
    return { type: 'STOP_HUNT_BEAR', probability: 75 };
  if ((uw > atr * 2 || lw > atr * 2) && body < rng * 0.15)
    return { type: 'SPOOF', probability: 65 };
  return { type: null, probability: 0 };
}

function priceActionZones(c, atr) {
  if (c.length < 10) return { zone: 'NEUTRAL', position: 50, strength: 0 };
  const win = c.slice(-20);
  const maxH = Math.max(...win.map(x => x.high)), minL = Math.min(...win.map(x => x.low));
  const range = maxH - minL || 1;
  const pos = ((c[c.length - 1].close - minL) / range) * 100;
  const zone = pos < 20 ? 'DEEP_SUPPORT' : pos < 35 ? 'SUPPORT' : pos > 80 ? 'DEEP_RESISTANCE' : pos > 65 ? 'RESISTANCE' : 'NEUTRAL';
  return { zone, position: Math.round(pos), strength: 0 };
}

function mtfConfluence(marketData, sym, tf) {
  const bias = getHTFBias(marketData, sym, tf);
  return { bias, strength: bias !== 'NEUTRAL' ? 70 : 50, aligned: bias !== 'NEUTRAL', count: 1 };
}

function liquidityZones(c, atr) {
  if (c.length < 30) return { bullLiq: null, bearLiq: null, swept: false, sweepDir: null };
  const win = c.slice(-40);
  const last = c[c.length - 1];
  const swingHighs = [], swingLows = [];
  for (let i = 2; i < win.length - 2; i++) {
    if (win[i].high > win[i - 1].high && win[i].high > win[i + 1].high) swingHighs.push(win[i].high);
    if (win[i].low < win[i - 1].low && win[i].low < win[i + 1].low) swingLows.push(win[i].low);
  }
  const bullLiq = Math.max(...swingHighs);
  const bearLiq = Math.min(...swingLows);

  let swept = false, sweepDir = null;
  if (last.high > bullLiq && last.close < bullLiq) { swept = true; sweepDir = 'BULL'; }
  if (last.low < bearLiq && last.close > bearLiq) { swept = true; sweepDir = 'BEAR'; }

  return { bullLiq, bearLiq, swept, sweepDir };
}

function supplyDemand(c, atr) {
  return { demand: null, supply: null, inDemand: false, inSupply: false };
}

function wyckoff(c, sr, atr) {
  if (c.length < 30 || !sr) return { phase: 'N/A', spring: false, upthrust: false };
  const last = c[c.length - 1];
  const spring = last.low < sr.sup && last.close > sr.sup && (last.close - last.low) > (last.high - last.low) * 0.5;
  const upthrust = last.high > sr.res && last.close < sr.res && (last.high - last.close) > (last.high - last.low) * 0.5;
  return { phase: 'N/A', spring, upthrust };
}

function vsaAnalysis(c) {
  if (c.length < 20) return { signal: 'NEUTRAL', type: null };
  const last = c[c.length - 1];
  const volAvg = c.slice(-20).reduce((a, b) => a + b.volume, 0) / 20;
  const isHighVol = last.volume > volAvg * 1.5;
  const isLowVol = last.volume < volAvg * 0.7;
  const spread = last.high - last.low;
  const isNarrow = spread < (IND.ATR(c, 10) * 0.8);

  if (isHighVol && isNarrow) return { signal: 'NEUTRAL', type: 'EFFORT_NO_RESULT' };
  if (isLowVol && isNarrow && last.close > last.open) return { signal: 'BEAR', type: 'NO_DEMAND' };
  if (isLowVol && isNarrow && last.close < last.open) return { signal: 'BULL', type: 'NO_SUPPLY' };

  return { signal: 'NEUTRAL', type: null };
}

function elderScreens(c, tf) {
  const ema13 = IND.EMA(c, 13), ema26 = IND.EMA(c, 26);
  const screen1 = ema13 > ema26 ? 'BULL' : 'BEAR';
  return { screen1, screen2: 'WAIT', screen3: 'WAIT', aligned: false };
}

function confluenceCount(signals) {
  const bull = signals.filter(s => s > 0).length, bear = signals.filter(s => s < 0).length;
  return { bull, bear, dominant: bull > bear ? 'BULL' : bear > bull ? 'BEAR' : 'NEUTRAL' };
}

module.exports = {
  IND, scoreSignal, calcSR, marketStructure, candlePattern,
  chartPatterns: () => ({ name: 'NONE', direction: 0, reliability: 0 }),
  vsaAnalysis, wyckoff, liquidityZones, supplyDemand, elderScreens,
  momentumScore, manipulationDetector, priceActionZones, mtfConfluence, confluenceCount
};
