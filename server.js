'use strict';
const express = require('express');
const http = require('http');
const app = express();
const server = https://https://signal-o6x2.onrender.com/;
const PORT = process.env.PORT || 3001;
const HOST = '0.0.0.0';

// ════════════════════════════════════════════════════
//  CORS
// ════════════════════════════════════════════════════
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

app.use(express.text({ type: '*/*' }));

const marketData = {};
let economicNews = [];
const TFS = ['M1','M5','M15','M30','H1'];
const MAX_HISTORY = 500;
const TF_MS = {'M1':60e3,'M5':300e3,'M15':900e3,'M30':1800e3,'H1':3600e3};
const TF_EXP = {'M1':'1-3 MIN','M5':'5-15 MIN','M15':'15-45 MIN','M30':'30-90 MIN','H1':'1-4 HRS'};
const TF_ORDER = {'M1':1,'M5':2,'M15':3,'M30':4,'H1':5};

const CALC = {

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

  RSI_SERIES(c, p = 14) {
    if (c.length < p + 1) return [];
    const s = [];
    let ag = 0, al = 0;
    for (let i = 1; i <= p; i++) {
      const d = c[i].close - c[i - 1].close;
      if (d > 0) ag += d; else al -= d;
    }
    ag /= p; al /= p;
    s.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
    for (let i = p + 1; i < c.length; i++) {
      const d = c[i].close - c[i - 1].close;
      ag = (ag * (p - 1) + (d > 0 ? d : 0)) / p;
      al = (al * (p - 1) + (d < 0 ? -d : 0)) / p;
      s.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
    }
    return s;
  },

  EMA(c, p) {
    if (!c.length) return 0;
    const k = 2 / (p + 1);
    let v = c[0].close;
    for (let i = 1; i < c.length; i++) v = (c[i].close - v) * k + v;
    return v;
  },

  EMA_SERIES(c, p) {
    if (!c.length) return [];
    const k = 2 / (p + 1);
    const out = [c[0].close];
    for (let i = 1; i < c.length; i++) out.push((c[i].close - out[i - 1]) * k + out[i - 1]);
    return out;
  },

  SMA(c, p) {
    if (c.length < p) return c[c.length - 1]?.close || 0;
    return c.slice(-p).reduce((a, b) => a + b.close, 0) / p;
  },

  ATR(c, p = 14) {
    if (c.length < 2) return 0.0001;
    const tr = [];
    for (let i = 1; i < c.length; i++) {
      const a = c[i], b = c[i - 1];
      tr.push(Math.max(a.high - a.low, Math.abs(a.high - b.close), Math.abs(a.low - b.close)));
    }
    const s = tr.slice(-p);
    const val = s.reduce((x, y) => x + y, 0) / s.length;
    return val > 0 ? val : 0.0001;
  },

  MACD(c) {
    if (c.length < 35) return { macd: 0, signal: 0, hist: 0, cross: null };
    const e12 = this.EMA_SERIES(c, 12);
    const e26 = this.EMA_SERIES(c, 26);
    const ml = e12.map((v, i) => v - e26[i]);
    const k = 2 / 10;
    let sg = ml[0];
    const ss = [sg];
    for (let i = 1; i < ml.length; i++) { sg = (ml[i] - sg) * k + sg; ss.push(sg); }
    const n = ml.length - 1;
    const m = ml[n], si = ss[n];
    let cross = null;
    if (n > 0) {
      if (ml[n - 1] < ss[n - 1] && m > si) cross = 'BULL_CROSS';
      if (ml[n - 1] > ss[n - 1] && m < si) cross = 'BEAR_CROSS';
    }
    return { macd: m, signal: si, hist: m - si, cross };
  },

  STOCH(c, p = 14) {
    if (c.length < p + 3) return { k: 50, d: 50 };
    const calcRaw = (bars) => {
      const hi = Math.max(...bars.map(x => x.high));
      const lo = Math.min(...bars.map(x => x.low));
      const cl = bars[bars.length - 1].close;
      if (hi === lo) return 50;
      return ((cl - lo) / (hi - lo)) * 100;
    };
    const ks = [];
    for (let j = 0; j < 3; j++) {
      const slice = c.slice(-(p + 2 - j), c.length - j || undefined);
      if (slice.length >= p) ks.push(calcRaw(slice.slice(-p)));
    }
    const k = ks.length ? ks.reduce((a, b) => a + b, 0) / ks.length : 50;
    const kArr = [];
    for (let j = 0; j < 3; j++) {
      const slice = c.slice(-(p + 4 - j), c.length - j || undefined);
      if (slice.length >= p) kArr.push(calcRaw(slice.slice(-p)));
    }
    const d = kArr.length ? kArr.reduce((a, b) => a + b, 0) / kArr.length : 50;
    return { k: Math.max(0, Math.min(100, k)), d: Math.max(0, Math.min(100, d)) };
  },

  BB(c, p = 20, m = 2) {
    if (c.length < p) return { upper: 0, mid: 0, lower: 0, pctB: 50, squeeze: false };
    const sl = c.slice(-p).map(x => x.close);
    const mean = sl.reduce((a, b) => a + b, 0) / sl.length;
    const sd = Math.sqrt(sl.reduce((a, b) => a + (b - mean) ** 2, 0) / sl.length);
    const upper = mean + m * sd;
    const lower = mean - m * sd;
    const last = sl[sl.length - 1];
    const pctB = (upper - lower) > 0 ? ((last - lower) / (upper - lower)) * 100 : 50;
    const squeeze = (upper - lower) / mean < 0.015;
    return { upper, mid: mean, lower, pctB: Math.max(0, Math.min(100, pctB)), squeeze };
  },

  CCI(c, p = 14) {
    if (c.length < p) return 0;
    const tp = c.slice(-p).map(x => (x.high + x.low + x.close) / 3);
    const sma = tp.reduce((a, b) => a + b, 0) / tp.length;
    const mad = tp.reduce((a, b) => a + Math.abs(b - sma), 0) / tp.length;
    return mad === 0 ? 0 : (tp[tp.length - 1] - sma) / (0.015 * mad);
  },

  WILLIAMS_R(c, p = 14) {
    if (c.length < p) return -50;
    const sl = c.slice(-p);
    const hi = Math.max(...sl.map(x => x.high));
    const lo = Math.min(...sl.map(x => x.low));
    const cl = c[c.length - 1].close;
    return hi === lo ? -50 : ((hi - cl) / (hi - lo)) * -100;
  },

  MOMENTUM(c, p = 10) {
    if (c.length < p + 1) return 0;
    const now = c[c.length - 1].close;
    const prev = c[c.length - 1 - p].close;
    return prev === 0 ? 0 : ((now - prev) / prev) * 100;
  },

  ROC(c, p = 10) {
    if (c.length < p + 1) return 0;
    const now = c[c.length - 1].close;
    const prev = c[c.length - 1 - p].close;
    return prev === 0 ? 0 : ((now - prev) / prev) * 100;
  },

  OBV_SLOPE(c, lb = 14) {
    if (c.length < lb + 1) return 0;
    const volAvg = c.slice(-20).reduce((a, b) => a + b.volume, 0) / 20;
    let obv = 0;
    const s = [];
    for (let i = 1; i < c.length; i++) {
      let vol = c[i].volume;
      if (vol > volAvg * 3) vol = volAvg * 1.5;
      if (c[i].close > c[i - 1].close) obv += vol;
      else if (c[i].close < c[i - 1].close) obv -= vol;
      s.push(obv);
    }
    const t = s.slice(-lb);
    const f = t[0] || 1;
    return ((t[t.length - 1] - t[0]) / Math.max(1, Math.abs(f))) * 100;
  },

  VWAP(c) {
    const sl = c.slice(-30);
    let pv = 0, vv = 0;
    sl.forEach(x => { const tp = (x.high + x.low + x.close) / 3; pv += tp * x.volume; vv += x.volume; });
    return vv > 0 ? pv / vv : (sl[sl.length - 1]?.close || 0);
  },

  // ✅ FIX: правильный ADX с Wilder smoothing (был DX одного периода = всегда ~0)
  ADX(c, p = 14) {
    if (c.length < p * 2 + 1) return { adx: 0, pdi: 0, mdi: 0 };

    // Шаг 1: TR, +DM, -DM для каждой свечи
    const tr_arr = [], pdm_arr = [], mdm_arr = [];
    for (let i = 1; i < c.length; i++) {
      const hi = c[i].high, lo = c[i].low, pc = c[i-1].close;
      const ph = c[i-1].high, pl = c[i-1].low;
      tr_arr.push(Math.max(hi - lo, Math.abs(hi - pc), Math.abs(lo - pc)));
      const up = hi - ph;
      const dn = pl - lo;
      pdm_arr.push((up > dn && up > 0) ? up : 0);
      mdm_arr.push((dn > up && dn > 0) ? dn : 0);
    }

    // Шаг 2: начальные суммы (первые p баров)
    let atr  = tr_arr.slice(0, p).reduce((a, b) => a + b, 0);
    let apdm = pdm_arr.slice(0, p).reduce((a, b) => a + b, 0);
    let amdm = mdm_arr.slice(0, p).reduce((a, b) => a + b, 0);

    // Шаг 3: собираем DX через Wilder smoothing
    const dx_arr = [];
    const _dx = (apdm, amdm, atr) => {
      const pdi = atr > 0 ? (apdm / atr) * 100 : 0;
      const mdi = atr > 0 ? (amdm / atr) * 100 : 0;
      return (pdi + mdi > 0) ? Math.abs(pdi - mdi) / (pdi + mdi) * 100 : 0;
    };
    dx_arr.push(_dx(apdm, amdm, atr));

    for (let i = p; i < tr_arr.length; i++) {
      atr  = atr  - (atr  / p) + tr_arr[i];
      apdm = apdm - (apdm / p) + pdm_arr[i];
      amdm = amdm - (amdm / p) + mdm_arr[i];
      dx_arr.push(_dx(apdm, amdm, atr));
    }

    // Шаг 4: ADX = Wilder MA от DX
    if (dx_arr.length < p) return { adx: 0, pdi: 0, mdi: 0 };
    let adx = dx_arr.slice(0, p).reduce((a, b) => a + b, 0) / p;
    for (let i = p; i < dx_arr.length; i++) {
      adx = (adx * (p - 1) + dx_arr[i]) / p;
    }

    const pdi_final = atr > 0 ? (apdm / atr) * 100 : 0;
    const mdi_final = atr > 0 ? (amdm / atr) * 100 : 0;

    return {
      adx: Math.min(100, Math.round(adx * 100) / 100),
      pdi: Math.round(pdi_final * 100) / 100,
      mdi: Math.round(mdi_final * 100) / 100
    };
  },

  ICHIMOKU(c) {
    if (c.length < 52) return { above: null, tenkan: 0, kijun: 0, spanA: 0, spanB: 0 };
    const high = (arr) => Math.max(...arr.map(x => x.high));
    const low = (arr) => Math.min(...arr.map(x => x.low));
    const tenkan = (high(c.slice(-9)) + low(c.slice(-9))) / 2;
    const kijun = (high(c.slice(-26)) + low(c.slice(-26))) / 2;
    const spanA = (tenkan + kijun) / 2;
    const spanB = (high(c.slice(-52)) + low(c.slice(-52))) / 2;
    const last = c[c.length - 1].close;
    const above = last > Math.max(spanA, spanB);
    const below = last < Math.min(spanA, spanB);
    return { above, below, tenkan, kijun, spanA, spanB };
  },

  PSAR(c, step = 0.02, max = 0.2) {
    if (c.length < 5) return { sar: 0, bull: true };
    let bull = true;
    let af = step;
    let ep = c[0].low;
    let sar = c[0].high;
    for (let i = 1; i < c.length; i++) {
      sar = sar + af * (ep - sar);
      if (bull) {
        if (c[i].low < sar) { bull = false; sar = ep; ep = c[i].low; af = step; }
        else { if (c[i].high > ep) { ep = c[i].high; af = Math.min(af + step, max); } }
      } else {
        if (c[i].high > sar) { bull = true; sar = ep; ep = c[i].high; af = step; }
        else { if (c[i].low < ep) { ep = c[i].low; af = Math.min(af + step, max); } }
      }
    }
    return { sar, bull };
  },

  RSI_DIV(c, p = 14) {
    if (c.length < 30) return { bull: false, bear: false };
    const tail = c.slice(-25);
    const rs = this.RSI_SERIES(tail, Math.min(p, tail.length - 2));
    if (rs.length < 8) return { bull: false, bear: false };
    const prices = tail.map(x => x.close);
    const mid = Math.floor(prices.length / 2);
    const pNow = prices[prices.length - 1], pMid = prices[mid];
    const rNow = rs[rs.length - 1], rMid = rs[mid];
    return {
      bull: pNow < pMid && rNow > rMid && rNow < 45,
      bear: pNow > pMid && rNow < rMid && rNow > 55
    };
  },

  CANDLE(c) {
    if (c.length < 3) return 'NEUTRAL';
    const [c2, c1, c0] = c.slice(-3);
    const atr = this.ATR(c.slice(-15), 10);
    if (atr <= 0) return 'NEUTRAL';
    const b0 = Math.abs(c0.close - c0.open);
    const b1 = Math.abs(c1.close - c1.open);
    const uw = c0.high - Math.max(c0.close, c0.open);
    const lw = Math.min(c0.close, c0.open) - c0.low;
    const rng = c0.high - c0.low;
    if (rng <= 0) return 'NEUTRAL';
    if (lw > b0 * 2.0 && lw > atr * 0.4 && uw < b0 * 0.5 && c0.close > c0.open) return 'PIN_BULL';
    if (uw > b0 * 2.0 && uw > atr * 0.4 && lw < b0 * 0.5 && c0.close < c0.open) return 'PIN_BEAR';
    if (b0 < rng * 0.1 && rng > atr * 0.3) return 'DOJI';
    if (c1.close < c1.open && c0.close > c0.open && c0.open <= c1.close && c0.close >= c1.open && b0 > b1 * 0.9) return 'ENG_BULL';
    if (c1.close > c1.open && c0.close < c0.open && c0.open >= c1.close && c0.close <= c1.open && b0 > b1 * 0.9) return 'ENG_BEAR';
    if (lw > b0 * 2.2 && uw < atr * 0.15 && b0 > atr * 0.12) return 'HAMMER';
    if (uw > b0 * 2.2 && lw < atr * 0.15 && b0 > atr * 0.12) return 'HANGING_MAN';
    if (uw < atr * 0.08 && lw < atr * 0.08 && b0 > atr * 0.55) return 'MARUBOZU';
    if (c0.high < c1.high && c0.low > c1.low && b0 > atr * 0.2) return 'HARAMI';
    if (c2.close > c2.open && c1.close > c1.open && c0.close > c0.open && c1.close > c2.close && c0.close > c1.close) return 'THREE_WHITE';
    if (c2.close < c2.open && c1.close < c1.open && c0.close < c0.open && c1.close < c2.close && c0.close < c1.close) return 'THREE_BLACK';
    if (c2.close < c2.open && Math.abs(c1.close - c1.open) < atr * 0.3 && c0.close > c0.open && c0.close > (c2.open + c2.close) / 2) return 'MORNING_STAR';
    if (c2.close > c2.open && Math.abs(c1.close - c1.open) < atr * 0.3 && c0.close < c0.open && c0.close < (c2.open + c2.close) / 2) return 'EVENING_STAR';
    return 'NEUTRAL';
  }
};

function calcPivotPoints(c) {
  if (c.length < 2) return { pp: 0, r1: 0, r2: 0, r3: 0, s1: 0, s2: 0, s3: 0 };
  const last = c[c.length - 1];
  const h = last.high, l = last.low, cl = last.close;
  const pp = (h + l + cl) / 3;
  return { pp, r1: pp * 2 - l, r2: pp + (h - l), r3: h + 2 * (pp - l), s1: pp * 2 - h, s2: pp - (h - l), s3: l - 2 * (h - pp) };
}

function calcFibonacci(c) {
  if (c.length < 20) return [];
  const win = c.slice(-200);
  const h = Math.max(...win.map(x => x.high));
  const l = Math.min(...win.map(x => x.low));
  const range = h - l;
  if (range === 0) return [];
  return [
    { level: h, name: 'H' },
    { level: h - range * 0.236, name: 'F23' },
    { level: h - range * 0.382, name: 'F38' },
    { level: h - range * 0.5,   name: 'F50' },
    { level: h - range * 0.618, name: 'F61' },
    { level: h - range * 0.786, name: 'F78' },
    { level: l, name: 'L' }
  ];
}

function calcSR(c) {
  if (c.length < 20) return { res: 0, sup: 0, resS: 1, supS: 1, pp: null, fib: [] };
  const pivot = calcPivotPoints(c);
  const fib = calcFibonacci(c);
  const win = c.slice(-200);
  const hi = [], lo = [];
  for (let i = 3; i < win.length - 3; i++) {
    let isHi = true, isLo = true;
    for (let j = i - 3; j <= i + 3; j++) {
      if (j === i) continue;
      if (win[j].high >= win[i].high) isHi = false;
      if (win[j].low <= win[i].low) isLo = false;
    }
    if (isHi) hi.push({ price: win[i].high });
    if (isLo) lo.push({ price: win[i].low });
  }
  const last = win[win.length - 1].close;
  const tol = last * 0.003;
  const cluster = (pts) => {
    const sorted = [...pts].sort((a, b) => a.price - b.price);
    const g = [];
    sorted.forEach(p => {
      const eg = g.find(x => Math.abs(x.price - p.price) <= tol);
      if (eg) { eg.t++; eg.price = (eg.price * (eg.t - 1) + p.price) / eg.t; }
      else g.push({ price: p.price, t: 1 });
    });
    return g.sort((a, b) => b.t - a.t);
  };
  const rg = cluster(hi.filter(h => h.price >= last));
  const sg = cluster(lo.filter(l => l.price <= last));
  const fb = Math.max(...win.slice(-30).map(x => x.high));
  const fl = Math.min(...win.slice(-30).map(x => x.low));
  return { res: rg[0]?.price || pivot.r1 || fb, sup: sg[0]?.price || pivot.s1 || fl, resS: rg[0]?.t || 1, supS: sg[0]?.t || 1, pp: pivot, fib };
}

function findSwings(c, left = 3, right = 3) {
  const hi = [], lo = [];
  for (let i = left; i < c.length - right; i++) {
    let ih = true, il = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (c[j].high >= c[i].high) ih = false;
      if (c[j].low <= c[i].low) il = false;
    }
    if (ih) hi.push({ idx: i, price: c[i].high });
    if (il) lo.push({ idx: i, price: c[i].low });
  }
  return { hi, lo };
}

function detectPattern(c, sr) {
  if (c.length < 20) return 'NO_PATTERN';
  const tail = c.slice(-40);
  const { hi, lo } = findSwings(tail, 2, 2);
  if (hi.length >= 2) {
    const [a, b] = hi.slice(-2);
    if (Math.abs(a.price - b.price) / a.price < 0.002 && b.idx - a.idx >= 3) return 'DOUBLE_TOP';
  }
  if (lo.length >= 2) {
    const [a, b] = lo.slice(-2);
    if (Math.abs(a.price - b.price) / a.price < 0.002 && b.idx - a.idx >= 3) return 'DOUBLE_BOTTOM';
  }
  if (hi.length >= 3) {
    const [l, m, r] = hi.slice(-3);
    if (m.price > l.price && m.price > r.price && Math.abs(l.price - r.price) / m.price < 0.003) return 'HEAD_SHOULDERS';
  }
  if (lo.length >= 3) {
    const [l, m, r] = lo.slice(-3);
    if (m.price < l.price && m.price < r.price && Math.abs(l.price - r.price) / m.price < 0.003) return 'INV_HS';
  }
  const wide = Math.max(...tail.map(x => x.high)) - Math.min(...tail.map(x => x.low));
  const narrow = Math.max(...tail.slice(-8).map(x => x.high)) - Math.min(...tail.slice(-8).map(x => x.low));
  if (narrow < wide * 0.3) return 'SQUEEZE';
  const last = c[c.length - 1].close;
  const atr = CALC.ATR(c.slice(-20), 10);
  const th = Math.max(last * 0.0005, atr * 0.35);
  if (Math.abs(last - sr.sup) <= th) return 'SUP_BOUNCE';
  if (Math.abs(last - sr.res) <= th) return 'RES_REJECT';
  return 'NO_PATTERN';
}

function marketStruct(c, sr, atr) {
  if (c.length < 12) return { struct: 'CALC', fb: false, spoof: false };
  const last = c[c.length - 1], prev = c[c.length - 2];
  let fb = false;
  if (prev.high > sr.res && last.close < sr.res && (last.high - last.close) > atr * 0.4) fb = true;
  if (prev.low < sr.sup && last.close > sr.sup && (last.close - last.low) > atr * 0.4) fb = true;
  const body = Math.abs(last.close - last.open);
  const uw = last.high - Math.max(last.close, last.open);
  const lw = Math.min(last.close, last.open) - last.low;
  const rng = Math.max(1e-9, last.high - last.low);
  const volAvg = c.slice(-20).reduce((a, b) => a + b.volume, 0) / 20;
  const spoof = ((uw > atr * 1.5 || lw > atr * 1.5) && body < rng * 0.2) ||
    (volAvg > 0 && last.volume > volAvg * 4 && body < rng * 0.2);
  const win = c.slice(-20);
  const sw = findSwings(win, 2, 2);
  const hh = sw.hi.length >= 2 && sw.hi[sw.hi.length - 1].price > sw.hi[0].price;
  const hl = sw.lo.length >= 2 && sw.lo[sw.lo.length - 1].price > sw.lo[0].price;
  const lh = sw.hi.length >= 2 && sw.hi[sw.hi.length - 1].price < sw.hi[0].price;
  const ll = sw.lo.length >= 2 && sw.lo[sw.lo.length - 1].price < sw.lo[0].price;
  let struct = 'RANGE';
  if (hh && hl) struct = 'UPTREND';
  else if (lh && ll) struct = 'DOWNTREND';
  return { struct, fb, spoof };
}

function newsStatus(sym) {
  const now = Date.now();
  const active = economicNews.filter(n => {
    const match = sym.toUpperCase().includes(n.currency.toUpperCase());
    const dist = Math.abs(now - n.timestamp);
    if (n.impact === 'HIGH' && dist <= 300000) return match;
    if (n.impact === 'MEDIUM' && dist <= 120000) return match;
    return false;
  });
  if (!active.length) return { risk: false, impact: 'NONE', event: '' };
  const maxN = active.sort((a, b) => ({ HIGH: 3, MEDIUM: 2, LOW: 1 }[b.impact] - { HIGH: 3, MEDIUM: 2, LOW: 1 }[a.impact]))[0];
  return { risk: true, impact: maxN.impact, event: maxN.event };
}

function mtfStruct(sym, tf) {
  const order = ['M1', 'M5', 'M15', 'M30', 'H1'];
  const idx = order.indexOf(tf);
  if (idx < 0 || idx >= order.length - 1) return 'NEUTRAL';
  const htf = order[idx + 1];
  if (!marketData[sym] || !marketData[sym][htf]) return 'NEUTRAL';
  const s = marketData[sym][htf].cached;
  if (!s) return 'NEUTRAL';
  if (s.struct === 'UPTREND') return s.rsi < 70 ? 'BULLISH_SAFE' : 'BULLISH_WEAK';
  if (s.struct === 'DOWNTREND') return s.rsi > 30 ? 'BEARISH_SAFE' : 'BEARISH_WEAK';
  return 'NEUTRAL';
}

function trendStrength(ema5, ema8, ema13, ema21, ema50, close) {
  let score = 0;
  if (close > ema5) score++; if (ema5 > ema8) score++;
  if (ema8 > ema13) score++; if (ema13 > ema21) score++;
  if (ema21 > ema50) score++;
  return score;
}

function analyze(sym, tf) {
  const data = marketData[sym][tf];
  const hist = data.history;
  if (!hist || !hist.length) return;
  const closed = hist.slice(0, -1);
  const n = closed.length;
  if (n < 3) {
    data.signal = 'WAIT';
    data.cached = { rsi: '-', conf: 0, struct: `ACCUM(${n}/30)`, pattern: 'WAIT', delta: '0', sup: '0', res: '0', newsRisk: false, event: '', cp: 'NEUTRAL', wr: '0', mom: '0', bb: '50', adx: '0', stochK: '50', cci: '0', bull: 0, bear: 0, mtf: 'NEUTRAL' };
    return;
  }
  const last = closed[n - 1];
  if (data.lastTS === last.timestamp && data.cached) return;
  data.lastTS = last.timestamp;
  const rsi   = CALC.RSI(closed);
  const ema5   = CALC.EMA(closed, 5);
  const ema8   = CALC.EMA(closed, 8);
  const ema13  = CALC.EMA(closed, 13);
  const ema21  = CALC.EMA(closed, 21);
  const ema50  = CALC.EMA(closed, 50);
  const atr    = CALC.ATR(closed, 14);
  const macd   = CALC.MACD(closed);
  const stoch  = CALC.STOCH(closed, 14);
  const adxObj = CALC.ADX(closed, 14);
  const adx    = adxObj.adx;
  const obv    = CALC.OBV_SLOPE(closed, 14);
  const vwap   = CALC.VWAP(closed);
  const bb     = CALC.BB(closed, 20, 2);
  const div    = CALC.RSI_DIV(closed);
  const cp     = CALC.CANDLE(closed);
  const wr     = CALC.WILLIAMS_R(closed, 14);
  const mom    = CALC.MOMENTUM(closed, 10);
  const cci    = CALC.CCI(closed, 14);
  const ichi   = CALC.ICHIMOKU(closed);
  const psar   = CALC.PSAR(closed);
  const roc    = CALC.ROC(closed, 10);
  const sr     = calcSR(closed);
  const ms     = marketStruct(closed, sr, atr);
  const news   = newsStatus(sym);
  const mtf    = mtfStruct(sym, tf);
  const pat    = detectPattern(closed, sr);
  const ts     = trendStrength(ema5, ema8, ema13, ema21, ema50, last.close);
  let bull = 0, bear = 0;
  if (n >= 15) {
    if (ms.struct === 'UPTREND') bull += 30;
    if (ms.struct === 'DOWNTREND') bear += 30;
    if (ts >= 5) bull += 25; else if (ts >= 4) bull += 18; else if (ts >= 3) bull += 10;
    const tsB = 5 - ts;
    if (tsB >= 5) bear += 25; else if (tsB >= 4) bear += 18; else if (tsB >= 3) bear += 10;
    if (last.close > vwap * 1.0005) bull += 12; else if (last.close < vwap * 0.9995) bear += 12;
    if (rsi < 25) bull += 20; else if (rsi < 35) bull += 12; else if (rsi < 45) bull += 5;
    if (rsi > 75) bear += 20; else if (rsi > 65) bear += 12; else if (rsi > 55) bear += 5;
    if (macd.cross === 'BULL_CROSS') bull += 22;
    if (macd.cross === 'BEAR_CROSS') bear += 22;
    if (macd.hist > 0 && macd.macd > 0) bull += 8;
    if (macd.hist < 0 && macd.macd < 0) bear += 8;
    // ✅ FIX: Stochastic зоны 80/20 вместо 70/30
    if (stoch.k < 20 && stoch.k > stoch.d) bull += 15; else if (stoch.k < 30) bull += 8;
    if (stoch.k > 80 && stoch.k < stoch.d) bear += 15; else if (stoch.k > 70) bear += 8;
    const BULL_C = ['PIN_BULL', 'ENG_BULL', 'HAMMER', 'THREE_WHITE', 'MARUBOZU', 'MORNING_STAR'];
    const BEAR_C = ['PIN_BEAR', 'ENG_BEAR', 'HANGING_MAN', 'THREE_BLACK', 'EVENING_STAR'];
    if (BULL_C.includes(cp)) bull += 22;
    if (BEAR_C.includes(cp)) bear += 22;
    if (last.close <= sr.sup + atr * 0.4 && sr.supS >= 2) bull += 30;
    if (last.close >= sr.res - atr * 0.4 && sr.resS >= 2) bear += 30;
    if (obv > 8 && last.close - closed[n - 2].close > 0) bull += 15;
    if (obv < -8 && closed[n - 2].close - last.close > 0) bear += 15;
    if (bb.pctB < 8) bull += 12; else if (bb.pctB < 18) bull += 6;
    if (bb.pctB > 92) bear += 12; else if (bb.pctB > 82) bear += 6;
    if (bb.squeeze && ms.struct === 'UPTREND') bull += 8;
    if (bb.squeeze && ms.struct === 'DOWNTREND') bear += 8;
    if (cci < -100) bull += 10; else if (cci < -50) bull += 5;
    if (cci > 100) bear += 10; else if (cci > 50) bear += 5;
    if (wr < -80) bull += 8; else if (wr < -65) bull += 4;
    if (wr > -20) bear += 8; else if (wr > -35) bear += 4;
    if (ichi.above === true) bull += 18;
    if (ichi.below === true) bear += 18;
    if (last.close > ichi.tenkan && ichi.tenkan > ichi.kijun) bull += 8;
    if (last.close < ichi.tenkan && ichi.tenkan < ichi.kijun) bear += 8;
    if (psar.bull && last.close > psar.sar) bull += 12;
    if (!psar.bull && last.close < psar.sar) bear += 12;
    // ✅ FIX: ADX теперь считается правильно, интерпретация работает
    if (adx > 25) { if (adxObj.pdi > adxObj.mdi) bull += 10; if (adxObj.mdi > adxObj.pdi) bear += 10; }
    if (adx > 40) { if (adxObj.pdi > adxObj.mdi) bull += 8; if (adxObj.mdi > adxObj.pdi) bear += 8; }
    if (div.bull) bull += 20;
    if (div.bear) bear += 20;
    const fibNear = sr.fib.some(f => Math.abs(last.close - f.level) < atr * 0.5);
    if (fibNear && ms.struct === 'UPTREND') bull += 15;
    if (fibNear && ms.struct === 'DOWNTREND') bear += 15;
    if (ms.fb) {
      if (n >= 2 && closed[n - 2].low < sr.sup && last.close > sr.sup) bull += 25;
      if (n >= 2 && closed[n - 2].high > sr.res && last.close < sr.res) bear += 25;
    }
    if (mtf === 'BULLISH_SAFE') bull += 18; else if (mtf === 'BULLISH_WEAK') bull += 8;
    if (mtf === 'BEARISH_SAFE') bear += 18; else if (mtf === 'BEARISH_WEAK') bear += 8;
    if (mom > 0.5 && roc > 0.3) bull += 8;
    if (mom < -0.5 && roc < -0.3) bear += 8;
    if (pat === 'DOUBLE_BOTTOM' || pat === 'INV_HS' || pat === 'SUP_BOUNCE') bull += 15;
    if (pat === 'DOUBLE_TOP' || pat === 'HEAD_SHOULDERS' || pat === 'RES_REJECT') bear += 15;
  }
  let veto = null;
  if (ms.spoof) veto = 'SPOOF';
  if (news.impact === 'HIGH') veto = veto || 'HIGH_NEWS';
  if (ms.struct === 'RANGE' && adx < 15) veto = veto || 'NO_TREND';
  const total = Math.max(1, bull + bear);
  const ratio = (bull - bear) / total;
  const base_conf = 50 + ratio * 45;
  const price = last.close;
  const vol = price > 0 ? atr / price : 0.01;
  const vol_factor = Math.min(1.1, Math.max(0.75, 1 - (vol - 0.005) * 8));
  let conf = base_conf * vol_factor;
  let bonus = 0;
  if (ms.fb) bonus += 10;
  if (div.bull || div.bear) bonus += 8;
  if (adx >= 30) bonus += 6;
  if (mtf.includes('SAFE')) bonus += 6;
  if (macd.cross) bonus += 8;
  if (CALC.CANDLE(closed) !== 'NEUTRAL' && CALC.CANDLE(closed) !== 'DOJI') bonus += 5;
  bonus = Math.min(18, bonus);
  conf += bonus;
  if (news.impact === 'HIGH') conf -= 45;
  if (news.impact === 'MEDIUM') conf -= 18;
  if (bb.pctB > 96 || bb.pctB < 4) conf -= 10;
  if (ms.struct === 'RANGE' && adx < 20) conf -= 15;
  if (veto === 'SPOOF') conf -= 30;
  conf = Math.max(10, Math.min(97, conf));
  let rawSig = 'WAIT';
  const edge = Math.abs(bull - bear);
  if (n >= 15 && !veto && conf >= 62 && edge >= 15) {
    if (bull > bear) rawSig = 'BUY';
    if (bear > bull) rawSig = 'SELL';
  }
  if (rawSig === data.lastRaw && rawSig !== 'WAIT') {
    data.stable = (data.stable || 0) + 1;
  } else {
    data.stable = rawSig !== 'WAIT' ? 1 : 0;
    data.lastRaw = rawSig;
  }
  data.signal = rawSig;
  let dispStruct = ms.struct;
  if (n < 15) dispStruct = `ACCUM(${n}/15)`;
  else if (ms.spoof) dispStruct = 'SPOOF!';
  else if (ms.fb) dispStruct = 'FALSE_BRK';
  data.cached = {
    rsi: rsi.toFixed(1), conf: Math.round(conf), struct: dispStruct, pattern: pat,
    delta: obv.toFixed(1), sup: sr.sup > 0 ? sr.sup.toFixed(5) : '0',
    res: sr.res > 0 ? sr.res.toFixed(5) : '0', newsRisk: news.risk, event: news.event,
    cp, wr: wr.toFixed(1), mom: mom.toFixed(2), bb: bb.pctB.toFixed(1),
    adx: adx.toFixed(1), stochK: stoch.k.toFixed(1), cci: cci.toFixed(0),
    bull, bear, mtf, psar: psar.bull ? 'BULL' : 'BEAR',
    ichi: ichi.above ? 'ABOVE' : ichi.below ? 'BELOW' : 'IN',
    macdCross: macd.cross || '-', vwapPos: last.close > vwap ? 'ABOVE' : 'BELOW',
    edge, stable: data.stable || 0
  };
}

// ✅ FIX: нормализация символа на входе — пробел → _, убираем мусор
function normalizeSymbol(raw) {
  return (raw || '')
    .toUpperCase()
    .replace(/\s+/g, '_')
    .replace(/#/g, '')
    .replace(/-/g, '');
}

app.post('/data', (req, res) => {
  try {
    const raw = req.body.toString().replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim();
    const d = JSON.parse(raw);
    // ✅ FIX: нормализуем символ — "AUDNZD OTC" и "AUDNZD_OTC" станут одним ключом
    const sym = normalizeSymbol(d.symbol);
    const bid = parseFloat(d.bid || d.close || 0);
    const vol = parseFloat(d.volume || 1);
    if (!sym || bid <= 0) return res.status(400).send('Invalid');
    if (!marketData[sym]) {
      marketData[sym] = {};
      TFS.forEach(tf => {
        marketData[sym][tf] = { history: [], tf, signal: 'WAIT', lastRaw: 'WAIT', stable: 0, lastTS: 0, lastAt: 0 };
      });
    }
    const now = Date.now();
    // ✅ Поддержка исторического timestamp от content.js
    // Если ts из расширения в секундах — конвертируем в мс
    let pointTime = now;
    if (d.ts) {
      const tsRaw = parseFloat(d.ts);
      pointTime = tsRaw > 1e12 ? tsRaw : tsRaw * 1000; // секунды → мс
      // Не принимаем точки старше 2 часов
      if (now - pointTime > 2 * 3600 * 1000) pointTime = now;
    }
    const isHistorical = pointTime < now - 5000; // точка старше 5 сек = историческая

    TFS.forEach(tf => {
      const b = marketData[sym][tf];
      const unit = TF_MS[tf];
      const ts = Math.floor(pointTime / unit) * unit;
      const len = b.history.length;
      let newBar = false;

      if (isHistorical) {
        // Исторические точки: вставляем в нужное место по timestamp
        const existing = b.history.find(bar => bar.timestamp === ts);
        if (existing) {
          // Обновляем OHLC существующего бара
          if (bid > existing.high) existing.high = bid;
          if (bid < existing.low) existing.low = bid;
          existing.close = bid;
          existing.volume += vol;
        } else {
          // Новый бар — вставляем и сортируем
          b.history.push({ timestamp: ts, open: bid, high: bid, low: bid, close: bid, volume: vol });
          b.history.sort((a, b) => a.timestamp - b.timestamp);
          newBar = true;
        }
      } else {
        // Живой тик — стандартная обработка
        if (len > 0 && b.history[len - 1].timestamp === ts) {
          const cur = b.history[len - 1];
          cur.close = bid;
          if (bid > cur.high) cur.high = bid;
          if (bid < cur.low) cur.low = bid;
          cur.volume += vol;
        } else {
          if (len > 0) newBar = true;
          b.history.push({ timestamp: ts, open: bid, high: bid, low: bid, close: bid, volume: vol });
        }
      }

      if (b.history.length > MAX_HISTORY) b.history.shift();
      if (newBar || now - b.lastAt >= 15000 || !b.cached) {
        analyze(sym, tf);
        b.lastAt = now;
      }
    });
    res.status(200).send('OK');
  } catch (e) { res.status(400).send('Error: ' + e.message); }
});

app.post('/news', (req, res) => {
  try {
    const d = JSON.parse(req.body.replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim());
    economicNews.push({
      currency: d.currency, event: d.event, impact: d.impact || 'HIGH',
      timestamp: Date.now() + ((d.timeOffsetMinutes || 0) * 60000)
    });
    if (economicNews.length > 50) economicNews.shift();
    res.status(200).send('OK');
  } catch (e) { res.status(400).send('Error'); }
});

app.get('/get_signals', (req, res) => {
  const out = [];
  Object.keys(marketData).forEach(sym => {
    TFS.forEach(tf => {
      const d = marketData[sym][tf];
      const price = d.history.length ? d.history[d.history.length - 1].close : 0;
      if (!d.cached) analyze(sym, tf);
      if (d.cached) {
        out.push({ sym, tf, exp: TF_EXP[tf], signal: d.signal || 'WAIT', price: price.toFixed(5), ...d.cached });
      }
    });
  });
  out.sort((a, b) => a.sym !== b.sym ? a.sym.localeCompare(b.sym) : TF_ORDER[a.tf] - TF_ORDER[b.tf]);
  res.json(out);
});

// ✅ FIX: keep-alive ping endpoint
app.get('/ping', (req, res) => res.status(200).send('pong'));

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SIGNAL ENGINE v14</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#080c14;--bg2:#0d1220;--bg3:#111827;--bg4:#161f30;
  --border:rgba(255,255,255,.06);--border2:rgba(255,255,255,.12);
  --green:#00e59b;--red:#ff3c5e;--blue:#4a9eff;--gold:#f5c842;
  --cyan:#00d4ff;--purple:#a78bfa;--orange:#fb923c;
  --text:#dde4ee;--text2:#8b95a8;--text3:#5a6478
}
body{background:var(--bg);color:var(--text);font-family:'Courier New',monospace;min-height:100vh;font-size:12px}
.hdr{height:52px;background:var(--bg2);border-bottom:1px solid var(--border2);display:flex;align-items:center;padding:0 18px;gap:14px;position:sticky;top:0;z-index:100}
.logo{font-size:14px;font-weight:bold;color:var(--cyan);letter-spacing:3px}
.logo span{color:var(--text2);font-size:10px;letter-spacing:1px}
.hdr-right{margin-left:auto;display:flex;align-items:center;gap:14px;font-size:10px}
.live-dot{width:7px;height:7px;border-radius:50%;background:var(--green);animation:pulse 1.4s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(.8)}}
.hdr-stat{color:var(--text2)}
.hdr-stat b{color:var(--text)}
#btn-refresh{background:rgba(0,212,255,.1);border:1px solid rgba(0,212,255,.3);color:var(--cyan);padding:5px 14px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:10px;letter-spacing:1px;transition:.2s}
#btn-refresh:hover{background:rgba(0,212,255,.2);border-color:var(--cyan)}
.filter-bar{display:flex;gap:8px;padding:10px 18px;background:var(--bg2);border-bottom:1px solid var(--border);flex-wrap:wrap;align-items:center}
.filter-btn{background:transparent;border:1px solid var(--border2);color:var(--text2);padding:4px 12px;border-radius:3px;cursor:pointer;font-family:inherit;font-size:10px;letter-spacing:1px;transition:.15s}
.filter-btn.active{border-color:var(--cyan);color:var(--cyan);background:rgba(0,212,255,.08)}
.filter-label{color:var(--text3);font-size:9px;letter-spacing:2px;margin-right:4px}
.main{padding:14px 16px;display:flex;flex-direction:column;gap:16px}
.section-title{font-size:9px;color:var(--text3);letter-spacing:3px;margin-bottom:8px}
.top-signals{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px}
.top-card{background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:10px 12px;display:flex;align-items:center;gap:10px;cursor:pointer;transition:.15s}
.top-card.buy{border-left:3px solid var(--green)}.top-card.sell{border-left:3px solid var(--red)}
.tc-pair{font-size:14px;font-weight:bold;flex:1}.tc-tf{font-size:9px;color:var(--text2);margin-top:2px}
.tc-conf{font-size:18px;font-weight:bold}.tc-conf.buy{color:var(--green)}.tc-conf.sell{color:var(--red)}
.hmap-wrap{background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:12px 14px;overflow-x:auto}
.hmap-t{min-width:480px}
.hmap-hdr{display:grid;grid-template-columns:90px repeat(5,1fr);gap:3px;margin-bottom:4px;font-size:9px;color:var(--text2);letter-spacing:1px}
.hmap-row{display:grid;grid-template-columns:90px repeat(5,1fr);gap:3px;margin-bottom:3px}
.hmap-sym{font-size:10px;font-weight:bold;display:flex;align-items:center;color:var(--text)}
.hmap-cell{height:28px;border-radius:3px;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:9px;letter-spacing:.5px;cursor:pointer;transition:.15s;position:relative}
.hc-b{background:rgba(0,229,155,.1);color:var(--green);border:1px solid rgba(0,229,155,.2)}
.hc-s{background:rgba(255,60,94,.1);color:var(--red);border:1px solid rgba(255,60,94,.2)}
.hc-w{background:rgba(255,255,255,.02);color:var(--text3);border:1px solid transparent}
.hmap-cell .conf-pct{font-size:7px;position:absolute;bottom:2px;right:3px;opacity:.7}
.tf-section{display:flex;flex-direction:column;gap:10px}
.tf-header{display:flex;align-items:center;gap:10px;font-size:9px;letter-spacing:3px;color:var(--cyan);padding:2px 0}
.tf-header::after{content:'';flex:1;height:1px;background:var(--border)}
.tf-count{background:rgba(0,212,255,.1);border:1px solid rgba(0,212,255,.2);color:var(--cyan);font-size:8px;padding:1px 6px;border-radius:2px}
.cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px}
.card{background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:12px;border-top:2px solid transparent;transition:.15s;position:relative}
.card.buy{border-top-color:var(--green)}.card.sell{border-top-color:var(--red)}.card.wait{opacity:.6}
.c-hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px}
.c-sym{font-size:16px;font-weight:bold;cursor:pointer;transition:.15s}.c-price{font-size:10px;color:var(--text2);margin-top:2px}
.sig-lbl{font-size:15px;font-weight:bold;letter-spacing:1px}
.sig-lbl.buy{color:var(--green)}.sig-lbl.sell{color:var(--red)}.sig-lbl.wait{color:var(--text3)}
.sig-exp{font-size:8px;color:var(--cyan);margin-top:2px}.sig-stable{font-size:8px;color:var(--text3);margin-top:1px}
.cbar{margin-bottom:8px}.cbar-hdr{display:flex;justify-content:space-between;margin-bottom:3px;font-size:9px;color:var(--text2)}
.cbar-track{height:4px;background:var(--bg);border-radius:2px;overflow:hidden}
.cbar-fill{height:100%;border-radius:2px;transition:width .4s ease;background:var(--green)}
.cbar-fill.sell{background:var(--red)}.cbar-fill.wait{background:var(--text3)}
.bsbar{display:flex;height:3px;border-radius:2px;overflow:hidden;margin-bottom:8px}
.bsbar-b{background:var(--green);transition:flex .4s}.bsbar-s{background:var(--red);transition:flex .4s}
.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-bottom:8px}
.metric{background:var(--bg4);border-radius:3px;padding:5px 7px}
.metric-l{color:var(--text3);font-size:8px;margin-bottom:1px;letter-spacing:.5px}.metric-v{font-weight:bold;font-size:10px}
.metric-v.bull{color:var(--green)}.metric-v.bear{color:var(--red)}.metric-v.neutral{color:var(--text2)}
.ind-row{display:flex;flex-wrap:wrap;gap:3px;margin-bottom:8px}
.ind-pill{font-size:8px;padding:2px 5px;border-radius:2px;letter-spacing:.3px}
.ip-bull{background:rgba(0,229,155,.1);color:var(--green);border:1px solid rgba(0,229,155,.15)}
.ip-bear{background:rgba(255,60,94,.1);color:var(--red);border:1px solid rgba(255,60,94,.15)}
.ip-neu{background:rgba(255,255,255,.04);color:var(--text3);border:1px solid var(--border)}
.ip-gold{background:rgba(245,200,66,.08);color:var(--gold);border:1px solid rgba(245,200,66,.2)}
.card-actions{display:flex;gap:5px;margin-top:6px}
.btn-copy{flex:1;background:transparent;border:1px solid var(--border2);color:var(--text2);padding:5px;border-radius:3px;cursor:pointer;font-family:inherit;font-size:9px;letter-spacing:1px;transition:.15s}
.btn-copy:hover{border-color:var(--cyan);color:var(--cyan)}
.btn-analysis{background:transparent;border:1px solid rgba(167,139,250,.3);color:var(--purple);padding:5px 10px;border-radius:3px;cursor:pointer;font-family:inherit;font-size:9px;transition:.15s}
.news-badge{background:rgba(251,146,60,.12);border:1px solid rgba(251,146,60,.3);color:var(--orange);font-size:8px;padding:2px 6px;border-radius:2px;display:inline-block;margin-bottom:6px}
.stats-bar{display:flex;gap:16px;padding:8px 18px;background:var(--bg2);border-top:1px solid var(--border);font-size:9px;color:var(--text2);flex-wrap:wrap}
.stats-bar b{color:var(--text)}
.empty{text-align:center;padding:60px 20px;color:var(--text3)}
.empty-icon{font-size:32px;margin-bottom:12px;opacity:.3}
.copy-toast{position:fixed;bottom:20px;right:20px;background:var(--green);color:#000;padding:8px 16px;border-radius:4px;font-size:10px;font-weight:bold;opacity:0;transform:translateY(10px);transition:.3s;pointer-events:none;z-index:999}
.copy-toast.show{opacity:1;transform:translateY(0)}
</style>
</head><body>
<div class="hdr">
  <div class="logo">SIGNAL ENGINE <span>v14</span></div>
  <div class="hdr-right">
    <div class="live-dot"></div>
    <span class="hdr-stat" id="st">WAIT</span>
    <span class="hdr-stat" id="tm">--:--:--</span>
    <span class="hdr-stat" id="sig-count"><b>0</b> signals</span>
    <button id="btn-refresh" onclick="load()">↻ REFRESH</button>
  </div>
</div>
<div class="filter-bar">
  <span class="filter-label">TF:</span>
  <button class="filter-btn active" data-tf="ALL">ALL</button>
  <button class="filter-btn" data-tf="M1">M1</button>
  <button class="filter-btn" data-tf="M5">M5</button>
  <button class="filter-btn" data-tf="M15">M15</button>
  <button class="filter-btn" data-tf="M30">M30</button>
  <button class="filter-btn" data-tf="H1">H1</button>
  <span class="filter-label" style="margin-left:10px">DIR:</span>
  <button class="filter-btn active" data-dir="ALL">ALL</button>
  <button class="filter-btn" data-dir="BUY">BUY</button>
  <button class="filter-btn" data-dir="SELL">SELL</button>
  <span class="filter-label" style="margin-left:10px">CONF:</span>
  <button class="filter-btn active" data-conf="0">ANY</button>
  <button class="filter-btn" data-conf="65">65%+</button>
  <button class="filter-btn" data-conf="75">75%+</button>
  <button class="filter-btn" data-conf="85">85%+</button>
</div>
<div class="main" id="main">
  <div class="empty"><div class="empty-icon">◎</div>Waiting for market data...<br><br>POST price data to /data endpoint</div>
</div>
<div class="stats-bar" id="stats-bar"></div>
<div class="copy-toast" id="copy-toast">COPIED!</div>
<script>
const TFS = ['M1','M5','M15','M30','H1'];
let allData = [];
let activeTF = 'ALL';
let activeDir = 'ALL';
let activeConf = 0;
let lastRefresh = 0;
document.querySelectorAll('[data-tf]').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('[data-tf]').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); activeTF = b.dataset.tf; render(allData);
  });
});
document.querySelectorAll('[data-dir]').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('[data-dir]').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); activeDir = b.dataset.dir; render(allData);
  });
});
document.querySelectorAll('[data-conf]').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('[data-conf]').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); activeConf = parseInt(b.dataset.conf); render(allData);
  });
});
function getFiltered(d) {
  return d.filter(x => {
    if (activeTF !== 'ALL' && x.tf !== activeTF) return false;
    if (activeDir !== 'ALL' && x.signal !== activeDir) return false;
    // ✅ FIX: явное приведение типов чтобы избежать строкового сравнения
    if (activeConf > 0 && Number(x.conf) < Number(activeConf)) return false;
    return true;
  });
}
function copyPair(sym) {
  navigator.clipboard.writeText(sym).catch(() => {});
  const t = document.getElementById('copy-toast');
  t.textContent = sym + ' COPIED!'; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1500);
}
function metricClass(key, val) {
  const v = parseFloat(val);
  if (key === 'RSI') return v < 35 ? 'bull' : v > 65 ? 'bear' : 'neutral';
  if (key === 'ADX') return v > 25 ? 'bull' : 'neutral';
  if (key === 'CCI') return v < -50 ? 'bull' : v > 50 ? 'bear' : 'neutral';
  if (key === 'STK%K') return v < 30 ? 'bull' : v > 70 ? 'bear' : 'neutral';
  if (key === 'BB%B') return v < 20 ? 'bull' : v > 80 ? 'bear' : 'neutral';
  if (key === 'WR%') return v < -70 ? 'bull' : v > -30 ? 'bear' : 'neutral';
  return 'neutral';
}
function indPillClass(val) {
  if (!val || val === '-' || val === 'NEUTRAL' || val === 'IN') return 'ip-neu';
  if (['BULL','ABOVE','BULLISH_SAFE','BULLISH_WEAK','BULL_CROSS'].includes(val)) return 'ip-bull';
  if (['BEAR','BELOW','BEARISH_SAFE','BEARISH_WEAK','BEAR_CROSS'].includes(val)) return 'ip-bear';
  if (['DOUBLE_BOTTOM','INV_HS','SUP_BOUNCE','MORNING_STAR','THREE_WHITE','ENG_BULL','PIN_BULL','HAMMER'].includes(val)) return 'ip-bull';
  if (['DOUBLE_TOP','HEAD_SHOULDERS','RES_REJECT','EVENING_STAR','THREE_BLACK','ENG_BEAR','PIN_BEAR','HANGING_MAN'].includes(val)) return 'ip-bear';
  if (['SQUEEZE','DOJI','FALSE_BRK'].includes(val)) return 'ip-gold';
  return 'ip-neu';
}
function render(d) {
  const now = new Date();
  document.getElementById('tm').textContent = now.toLocaleTimeString();
  const activeSignals = d.filter(x => x.signal !== 'WAIT');
  document.getElementById('st').textContent = activeSignals.length ? 'ACTIVE' : 'WAIT';
  document.getElementById('sig-count').innerHTML = '<b>' + activeSignals.length + '</b> signals';
  const buyC = d.filter(x => x.signal === 'BUY').length;
  const sellC = d.filter(x => x.signal === 'SELL').length;
  const avgConf = activeSignals.length ? Math.round(activeSignals.reduce((a,b) => a + b.conf, 0) / activeSignals.length) : 0;
  document.getElementById('stats-bar').innerHTML =
    '<span>TOTAL PAIRS: <b>' + new Set(d.map(x => x.sym)).size + '</b></span>' +
    '<span>BUY: <b style="color:var(--green)">' + buyC + '</b></span>' +
    '<span>SELL: <b style="color:var(--red)">' + sellC + '</b></span>' +
    '<span>AVG CONF: <b>' + avgConf + '%</b></span>' +
    '<span>LAST UPDATE: <b>' + now.toLocaleTimeString() + '</b></span>';
  const filtered = getFiltered(d);
  const syms = [...new Set(d.map(x => x.sym))];
  let h = '';
  const tops = [...d].filter(x => x.signal !== 'WAIT').sort((a, b) => b.conf - a.conf).slice(0, 4);
  if (tops.length) {
    h += '<div class="section-title">TOP SIGNALS</div><div class="top-signals">';
    tops.forEach(x => {
      const cls = x.signal === 'BUY' ? 'buy' : 'sell';
      h += \`<div class="top-card \${cls}" onclick="copyPair('\${x.sym}')">
        <div><div class="tc-pair">\${x.sym}</div><div class="tc-tf">\${x.tf} · \${x.exp}</div></div>
        <div class="tc-conf \${cls}">\${x.conf}%</div></div>\`;
    });
    h += '</div>';
  }
  if (syms.length) {
    h += '<div class="section-title">HEATMAP</div><div class="hmap-wrap"><div class="hmap-t">';
    h += '<div class="hmap-hdr"><div></div>' + TFS.map(t => '<div>' + t + '</div>').join('') + '</div>';
    syms.forEach(s => {
      h += '<div class="hmap-row"><div class="hmap-sym">' + s + '</div>';
      TFS.forEach(t => {
        const x = d.find(z => z.sym === s && z.tf === t);
        if (!x) { h += '<div class="hmap-cell hc-w">—</div>'; return; }
        const cls = x.signal === 'BUY' ? 'hc-b' : x.signal === 'SELL' ? 'hc-s' : 'hc-w';
        const lbl = x.signal === 'WAIT' ? '·' : x.signal;
        h += \`<div class="hmap-cell \${cls}" onclick="copyPair('\${x.sym}')" title="\${x.sym} \${t} \${x.signal} \${x.conf}%">
          \${lbl}<span class="conf-pct">\${x.signal !== 'WAIT' ? x.conf + '%' : ''}</span></div>\`;
      });
      h += '</div>';
    });
    h += '</div></div>';
  }
  h += '<div>';
  TFS.forEach(tf => {
    const f = filtered.filter(x => x.tf === tf);
    if (!f.length) return;
    h += \`<div class="tf-section">
      <div class="tf-header">TF \${tf} <span class="tf-count">\${f.filter(x=>x.signal!=='WAIT').length} active</span></div>
      <div class="cards-grid">\`;
    f.forEach(x => {
      const sc = x.signal === 'BUY' ? 'buy' : x.signal === 'SELL' ? 'sell' : 'wait';
      const totalScore = Math.max(1, x.bull + x.bear);
      const bullW = Math.round((x.bull / totalScore) * 100);
      const bearW = 100 - bullW;
      const mets = [
        ['RSI', x.rsi || '50'],
        ['ADX', x.adx || '0'],
        ['CCI', x.cci || '0'],
        ['STK%K', x.stochK || '50'],
        ['BB%B', (x.bb || '50') + '%'],
        ['WR%', x.wr || '0'],
      ];
      const inds = [
        ['ICHI', x.ichi || 'NEU'],
        ['PSAR', x.psar || 'NEU'],
        ['MTF', (x.mtf || 'NEUTRAL').replace('BULLISH_','B-').replace('BEARISH_','S-')],
        ['MACD', x.macdCross && x.macdCross !== '-' ? x.macdCross.replace('_CROSS','') : x.signal !== 'WAIT' ? x.signal==='BUY'?'BULL':'BEAR' : 'NEU'],
        ['VWAP', x.vwapPos || 'NEU'],
        ['PAT', x.pattern && x.pattern !== 'NO_PATTERN' ? x.pattern : (x.cp || 'NEU')],
      ];
      h += \`<div class="card \${sc}">
        \${x.newsRisk ? '<div class="news-badge">⚡ NEWS: ' + x.event + '</div>' : ''}
        <div class="c-hdr">
          <div><div class="c-sym" onclick="copyPair('\${x.sym}')">\${x.sym}</div><div class="c-price">\${x.price}</div></div>
          <div class="c-sig">
            <div class="sig-lbl \${sc}">\${x.signal}</div>
            <div class="sig-exp">\${x.exp}</div>
            \${x.stable > 1 ? '<div class="sig-stable">CONFIRMED x' + x.stable + '</div>' : ''}
          </div>
        </div>
        <div class="cbar">
          <div class="cbar-hdr"><span>CONFIDENCE</span><span>\${x.conf}%</span></div>
          <div class="cbar-track"><div class="cbar-fill \${sc}" style="width:\${x.conf}%"></div></div>
        </div>
        <div class="bsbar"><div class="bsbar-b" style="flex:\${bullW}"></div><div class="bsbar-s" style="flex:\${bearW}"></div></div>
        <div class="metrics">\${mets.map(([k,v]) => \`<div class="metric"><div class="metric-l">\${k}</div><div class="metric-v \${metricClass(k, v)}">\${v}</div></div>\`).join('')}</div>
        <div class="ind-row">\${inds.map(([k,v]) => \`<span class="ind-pill \${indPillClass(v)}">\${k}: \${v}</span>\`).join('')}<span class="ind-pill \${indPillClass(x.struct)}">\${x.struct}</span></div>
        <div class="card-actions">
          <button class="btn-copy" onclick="copyPair('\${x.sym}')">⎘ COPY \${x.sym}</button>
          <button class="btn-analysis" onclick="showDetail('\${x.sym}','\${x.tf}')">DETAIL</button>
        </div>
      </div>\`;
    });
    h += '</div></div>';
  });
  if (!filtered.length && d.length) h += '<div class="empty"><div class="empty-icon">◉</div>No signals match current filters</div>';
  document.getElementById('main').innerHTML = h + '</div>';
}
function showDetail(sym, tf) {
  const x = allData.find(d => d.sym === sym && d.tf === tf);
  if (!x) return;
  const msg = sym + ' | ' + tf + ' | ' + x.signal + ' | CONF:' + x.conf + '% | RSI:' + x.rsi + ' | ADX:' + x.adx + ' | S:' + x.sup + ' R:' + x.res;
  navigator.clipboard.writeText(msg).catch(() => {});
  const t = document.getElementById('copy-toast');
  t.textContent = 'DETAIL COPIED!'; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}
async function load() {
  const now = Date.now();
  if (now - lastRefresh < 500) return;
  lastRefresh = now;
  document.getElementById('btn-refresh').textContent = '↺ ...';
  try {
    const r = await fetch('/get_signals');
    allData = await r.json();
    render(allData);
  } catch(e) { document.getElementById('st').textContent = 'ERR'; }
  document.getElementById('btn-refresh').textContent = '↻ REFRESH';
}
setInterval(load, 2500);
load();
</script>
</body></html>`);
});

// ✅ FIX: Keep-alive — пингуем сами себя каждые 14 минут чтобы Render не засыпал
const SELF_URL = process.env.RENDER_EXTERNAL_URL
  ? process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '')
  : `http://localhost:${PORT}`;

setInterval(() => {
  http.get(SELF_URL + '/ping', (res) => {
    console.log('[PING] keep-alive ok ' + new Date().toISOString());
  }).on('error', (e) => {
    console.log('[PING] keep-alive error:', e.message);
  });
}, 14 * 60 * 1000);

console.log('[KEEP-ALIVE] Will ping ' + SELF_URL + '/ping every 14 min');

server.listen(PORT, HOST, () => {
  console.log('SIGNAL ENGINE v14 running on port ' + PORT);
});
