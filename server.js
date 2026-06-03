'use strict';
const express = require('express');
const http = require('http');
const https = require('https');
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3001;
const HOST = '0.0.0.0';

// ════════════════════════════════════════════════════
//  НОВЫЙ ДВИЖОК АНАЛИЗА v15
// ════════════════════════════════════════════════════
const ENGINE = require('./engine');
const { IND, scoreSignal, calcSR, marketStructure, momentumScore, manipulationDetector, priceActionZones, mtfConfluence } = ENGINE;

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

  // ✅ FIX: Ichimoku параметры 7/30/52 (было 9/26/52)
  ICHIMOKU(c) {
    if (c.length < 52) return { above: null, below: null, tenkan: 0, kijun: 0, spanA: 0, spanB: 0, tkCross: null };
    const high = (arr) => Math.max(...arr.map(x => x.high));
    const low = (arr) => Math.min(...arr.map(x => x.low));
    const tenkan = (high(c.slice(-7)) + low(c.slice(-7))) / 2;
    const kijun  = (high(c.slice(-30)) + low(c.slice(-30))) / 2;
    const spanA  = (tenkan + kijun) / 2;
    const spanB  = (high(c.slice(-52)) + low(c.slice(-52))) / 2;
    // Предыдущие значения для определения кросса TK
    const tenkanP = c.length > 8  ? (high(c.slice(-8,-1))  + low(c.slice(-8,-1)))  / 2 : tenkan;
    const kijunP  = c.length > 31 ? (high(c.slice(-31,-1)) + low(c.slice(-31,-1))) / 2 : kijun;
    let tkCross = null;
    if (tenkanP < kijunP && tenkan > kijun) tkCross = 'BULL';
    if (tenkanP > kijunP && tenkan < kijun) tkCross = 'BEAR';
    const last = c[c.length - 1].close;
    const above = last > Math.max(spanA, spanB);
    const below = last < Math.min(spanA, spanB);
    return { above, below, tenkan, kijun, spanA, spanB, tkCross };
  },

  // ✅ NEW: SMA 20/50/200
  SMA_LEVELS(c) {
    const sma20  = c.length >= 20  ? c.slice(-20).reduce((a,b)  => a + b.close, 0) / 20  : null;
    const sma50  = c.length >= 50  ? c.slice(-50).reduce((a,b)  => a + b.close, 0) / 50  : null;
    const sma200 = c.length >= 200 ? c.slice(-200).reduce((a,b) => a + b.close, 0) / 200 : null;
    const last = c[c.length - 1].close;
    const aboveSma20  = sma20  ? last > sma20  : null;
    const aboveSma50  = sma50  ? last > sma50  : null;
    const aboveSma200 = sma200 ? last > sma200 : null;
    // Золотой/мёртвый крест SMA50/200
    let smaCross = null;
    if (sma50 && sma200 && c.length >= 201) {
      const prevSma50  = c.slice(-51,-1).reduce((a,b)  => a + b.close, 0) / 50;
      const prevSma200 = c.slice(-201,-1).reduce((a,b) => a + b.close, 0) / 200;
      if (prevSma50 < prevSma200 && sma50 > sma200) smaCross = 'GOLDEN';
      if (prevSma50 > prevSma200 && sma50 < sma200) smaCross = 'DEATH';
    }
    return { sma20, sma50, sma200, aboveSma20, aboveSma50, aboveSma200, smaCross };
  },

  // ✅ NEW: Supply/Demand зоны (Wyckoff-based)
  SUPPLY_DEMAND(c, atr) {
    if (c.length < 30) return { supplyZone: null, demandZone: null, inSupply: false, inDemand: false };
    const last = c[c.length - 1].close;
    const win = c.slice(-100);
    // Ищем базы (консолидации перед сильным движением)
    let demandZone = null, supplyZone = null;
    for (let i = 5; i < win.length - 5; i++) {
      const before = win.slice(i-5, i);
      const after  = win.slice(i, i+5);
      const beforeRange = Math.max(...before.map(x=>x.high)) - Math.min(...before.map(x=>x.low));
      const afterMove   = Math.abs(after[after.length-1].close - after[0].open);
      // База + сильный импульс вверх = зона спроса
      if (beforeRange < atr * 2 && afterMove > atr * 3 && after[after.length-1].close > after[0].open) {
        demandZone = { high: Math.max(...before.map(x=>x.high)), low: Math.min(...before.map(x=>x.low)) };
      }
      // База + сильный импульс вниз = зона предложения
      if (beforeRange < atr * 2 && afterMove > atr * 3 && after[after.length-1].close < after[0].open) {
        supplyZone = { high: Math.max(...before.map(x=>x.high)), low: Math.min(...before.map(x=>x.low)) };
      }
    }
    const inDemand = demandZone ? last >= demandZone.low && last <= demandZone.high * 1.002 : false;
    const inSupply = supplyZone ? last <= supplyZone.high && last >= supplyZone.low * 0.998 : false;
    return { supplyZone, demandZone, inSupply, inDemand };
  },

  // ✅ NEW: VSA — Volume Spread Analysis
  VSA(c) {
    if (c.length < 20) return { signal: 'NEUTRAL', effort: false, noSupply: false, noDemand: false };
    const last = c[c.length - 1];
    const prev = c[c.length - 2];
    const volAvg = c.slice(-20).reduce((a,b) => a + b.volume, 0) / 20;
    const spread = last.high - last.low;
    const spreadAvg = c.slice(-20).reduce((a,b) => a + (b.high-b.low), 0) / 20;
    const isHighVol  = last.volume > volAvg * 1.5;
    const isLowVol   = last.volume < volAvg * 0.7;
    const isWideSpread = spread > spreadAvg * 1.3;
    const isNarrowSpread = spread < spreadAvg * 0.7;
    const isUp   = last.close > last.open;
    const isDown = last.close < last.open;
    // Усилие без результата (effort vs result)
    const effort = isHighVol && isNarrowSpread;
    // Нет предложения — узкий спред, низкий объём при росте
    const noSupply = isLowVol && isNarrowSpread && isUp;
    // Нет спроса — узкий спред, низкий объём при падении
    const noDemand = isLowVol && isNarrowSpread && isDown;
    // Остановка продаж — высокий объём, широкий спред вниз, закрытие в верхней части
    const stoppingVolume = isHighVol && isWideSpread && isDown && 
      (last.close - last.low) > (last.high - last.low) * 0.6;
    // Профессиональный покупатель
    const climaxBull = isHighVol && isWideSpread && isUp;
    const climaxBear = isHighVol && isWideSpread && isDown;
    let signal = 'NEUTRAL';
    if (stoppingVolume || noSupply) signal = 'BULL';
    if (noDemand) signal = 'BEAR';
    if (climaxBull && prev.close < prev.open) signal = 'BULL'; // разворот
    if (climaxBear && prev.close > prev.open) signal = 'BEAR';
    return { signal, effort, noSupply, noDemand, stoppingVolume };
  },

  // ✅ NEW: Метод Вайкоффа — Spring, Upthrust, накопление/распределение
  WYCKOFF(c, sr) {
    if (c.length < 30 || !sr) return { phase: 'UNKNOWN', spring: false, upthrust: false };
    const last = c[c.length - 1];
    const atr  = this.ATR(c.slice(-20), 14);
    // Spring: цена пробила поддержку но быстро вернулась (ложный пробой вниз)
    const spring = last.low < sr.sup - atr * 0.3 && last.close > sr.sup && 
                   (last.close - last.low) > (last.high - last.low) * 0.6;
    // Upthrust: цена пробила сопротивление но быстро вернулась (ложный пробой вверх)
    const upthrust = last.high > sr.res + atr * 0.3 && last.close < sr.res &&
                     (last.high - last.close) > (last.high - last.low) * 0.6;
    // Определяем фазу Вайкоффа
    const win = c.slice(-50);
    const range = Math.max(...win.map(x=>x.high)) - Math.min(...win.map(x=>x.low));
    const recentRange = Math.max(...c.slice(-10).map(x=>x.high)) - Math.min(...c.slice(-10).map(x=>x.low));
    const volAvg = c.slice(-50).reduce((a,b) => a+b.volume, 0) / 50;
    const recentVol = c.slice(-10).reduce((a,b) => a+b.volume, 0) / 10;
    let phase = 'UNKNOWN';
    if (recentRange < range * 0.3 && recentVol < volAvg * 0.8) phase = 'ACCUMULATION';
    if (recentRange < range * 0.3 && recentVol > volAvg * 1.2) phase = 'DISTRIBUTION';
    if (recentRange > range * 0.5 && last.close > c[c.length-10].close) phase = 'MARKUP';
    if (recentRange > range * 0.5 && last.close < c[c.length-10].close) phase = 'MARKDOWN';
    return { phase, spring, upthrust };
  },

  // ✅ NEW: Зоны ликвидности (где стоят стопы толпы)
  LIQUIDITY(c, atr) {
    if (c.length < 30) return { bullLiq: null, bearLiq: null, swept: false };
    const win = c.slice(-50);
    // Ищем swing highs/lows — там стоят стопы
    const swingHighs = [], swingLows = [];
    for (let i = 3; i < win.length - 3; i++) {
      let isH = true, isL = true;
      for (let j = i-3; j <= i+3; j++) {
        if (j === i) continue;
        if (win[j].high >= win[i].high) isH = false;
        if (win[j].low  <= win[i].low)  isL = false;
      }
      if (isH) swingHighs.push(win[i].high);
      if (isL)  swingLows.push(win[i].low);
    }
    const last = c[c.length - 1].close;
    // Ближайшая ликвидность выше (стопы продавцов)
    const bullLiq = swingHighs.filter(h => h > last).sort((a,b) => a-b)[0] || null;
    // Ближайшая ликвидность ниже (стопы покупателей)
    const bearLiq = swingLows.filter(l => l < last).sort((a,b) => b-a)[0] || null;
    // Свип ликвидности — цена прошла через уровень и вернулась
    const swept = (bullLiq && c[c.length-1].high > bullLiq && last < bullLiq) ||
                  (bearLiq && c[c.length-1].low < bearLiq && last > bearLiq);
    return { bullLiq, bearLiq, swept };
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

function analyze(sym, tf) {
  const data = marketData[sym][tf];
  const hist = data.history;
  if (!hist || !hist.length) return;
  const closed = hist.slice(0, -1);
  const n = closed.length;

  if (n < 3) {
    data.signal = 'WAIT';
    data.cached = {
      rsi: '-', conf: 0, struct: `ACCUM(${n}/15)`, pattern: 'WAIT',
      delta: '0', sup: '0', res: '0', newsRisk: false, event: '',
      cp: 'NEUTRAL', wr: '0', mom: '0', bb: '50', adx: '0',
      stochK: '50', cci: '0', bull: 50, bear: 50, mtf: 'NEUTRAL',
      macdCross: '-', vwapPos: 'NEUTRAL', psar: 'BULL',
      ichi: 'IN', edge: 0, stable: 0
    };
    return;
  }

  const last = closed[n - 1];
  if (data.lastTS === last.timestamp && data.cached) return;
  data.lastTS = last.timestamp;

  // Вычисляем базовые значения для движка
  const atr  = IND.ATR(closed, 14);
  const sr   = calcSR(closed);
  const ms   = marketStructure(closed, atr);
  const news = newsStatus(sym);
  const mtf  = mtfConfluence(marketData, sym, tf);
  const mom  = momentumScore(closed);
  const manip = manipulationDetector(closed, atr);
  const pa   = priceActionZones(closed, atr);

  // Запускаем главный скоринг
  const result = scoreSignal({ c: closed, sym, tf, sr, ms, atr, news });

  // MTF бонус/штраф
  let mtfBonus = 0;
  if (mtf.aligned && mtf.count >= 2) {
    if (mtf.bias === 'BULL' && result.signal === 'BUY')  mtfBonus = Math.round(mtf.strength * 0.1);
    if (mtf.bias === 'BEAR' && result.signal === 'SELL') mtfBonus = Math.round(mtf.strength * 0.1);
    if (mtf.bias === 'BULL' && result.signal === 'SELL') mtfBonus = -15;
    if (mtf.bias === 'BEAR' && result.signal === 'BUY')  mtfBonus = -15;
  }

  // Манипуляция — снижаем уверенность
  let manipPenalty = 0;
  if (manip.type === 'PUMP' || manip.type === 'DUMP') manipPenalty = -20;
  if (manip.type === 'SPOOF') manipPenalty = -25;

  // Финальная уверенность
  let finalConf = Math.max(10, Math.min(97, result.conf + mtfBonus + manipPenalty));

  // Стабильность сигнала
  const rawSig = result.signal;
  if (rawSig === data.lastRaw && rawSig !== 'WAIT') {
    data.stable = (data.stable || 0) + 1;
  } else {
    data.stable = rawSig !== 'WAIT' ? 1 : 0;
    data.lastRaw = rawSig;
  }
  data.signal = rawSig;

  // Структура для отображения
  let dispStruct = ms.trend;
  if (n < 15) dispStruct = `ACCUM(${n}/15)`;
  else if (manip.type) dispStruct = manip.type;
  else if (ms.choch)   dispStruct = ms.choch;
  else if (ms.bos)     dispStruct = ms.bos;

  data.cached = {
    // Основные
    conf: Math.round(finalConf),
    signal: rawSig,
    struct: dispStruct,
    stable: data.stable || 0,
    // Индикаторы из движка
    rsi: result.rsi,
    adx: result.adx,
    cci: result.cci,
    stochK: result.stochK,
    bb: result.bb,
    wr: result.wr,
    macdCross: result.macdCross,
    ichi: result.ichi,
    psar: result.psar,
    vwapPos: result.vwapPos,
    // Паттерны
    pattern: result.pattern,
    cp: result.cp,
    // Smart Money
    wyckoffPhase: result.wyckoffPhase,
    vsaType: result.vsaType,
    spring: result.spring,
    upthrust: result.upthrust,
    liqSweep: result.liqSweep,
    inDemand: result.inDemand,
    inSupply: result.inSupply,
    // Elder
    elder: result.elder,
    // MTF
    mtf: mtf.bias + (mtf.aligned ? '_ALIGNED' : ''),
    mtfStrength: mtf.strength,
    // Momentum
    momentum: mom.direction,
    momScore: mom.score,
    // Манипуляция
    manipulation: manip.type,
    // Price Action
    paZone: pa.zone,
    paPosition: pa.position,
    // Причины сигнала
    reasons: (result.reasons || []).join(','),
    // S/R
    sup: sr.sup > 0 ? sr.sup.toFixed(5) : '0',
    res: sr.res > 0 ? sr.res.toFixed(5) : '0',
    // Новости
    newsRisk: news.risk,
    event: news.event,
    // Bull/Bear для отображения
    bull: result.bull,
    bear: result.bear,
    edge: Math.abs(result.rawScore),
    // Совместимость со старым форматом
    delta: '0',
    mom: mom.score.toFixed(2),
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
  <span class="filter-label" style="margin-left:10px">TYPE:</span>
  <button class="filter-btn active" data-type="ALL">ALL</button>
  <button class="filter-btn" data-type="OTC">OTC</button>
  <button class="filter-btn" data-type="FX">FOREX</button>
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
let activeType = 'ALL';
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
document.querySelectorAll('[data-type]').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('[data-type]').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); activeType = b.dataset.type; render(allData);
  });
});
function getFiltered(d) {
  return d.filter(x => {
    if (activeTF !== 'ALL' && x.tf !== activeTF) return false;
    if (activeDir !== 'ALL' && x.signal !== activeDir) return false;
    if (activeConf > 0 && Number(x.conf) < Number(activeConf)) return false;
    if (activeType === 'OTC' && !x.sym.includes('OTC')) return false;
    if (activeType === 'FX'  &&  x.sym.includes('OTC')) return false;
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
  const otcC = new Set(d.filter(x => x.sym.includes('OTC')).map(x => x.sym)).size;
  const fxC  = new Set(d.filter(x => !x.sym.includes('OTC')).map(x => x.sym)).size;
  const avgConf = activeSignals.length ? Math.round(activeSignals.reduce((a,b) => a + b.conf, 0) / activeSignals.length) : 0;
  document.getElementById('stats-bar').innerHTML =
    '<span>OTC: <b style="color:var(--cyan)">' + otcC + '</b></span>' +
    '<span>FOREX: <b style="color:var(--purple)">' + fxC + '</b></span>' +
    '<span>BUY: <b style="color:var(--green)">' + buyC + '</b></span>' +
    '<span>SELL: <b style="color:var(--red)">' + sellC + '</b></span>' +
    '<span>AVG CONF: <b>' + avgConf + '%</b></span>' +
    '<span>LAST UPDATE: <b>' + now.toLocaleTimeString() + '</b></span>';
  const filtered = getFiltered(d);
  const allSyms = [...new Set(d.map(x => x.sym))];
  const otcSyms  = allSyms.filter(s => s.includes('OTC')).sort();
  const fxSyms   = allSyms.filter(s => !s.includes('OTC')).sort();
  let h = '';
  const tops = [...d].filter(x => {
    if (x.signal === 'WAIT') return false;
    if (activeType === 'OTC' && !x.sym.includes('OTC')) return false;
    if (activeType === 'FX'  &&  x.sym.includes('OTC')) return false;
    return true;
  }).sort((a, b) => b.conf - a.conf).slice(0, 6);
  if (tops.length) {
    h += '<div class="section-title">TOP SIGNALS</div><div class="top-signals">';
    tops.forEach(x => {
      const cls = x.signal === 'BUY' ? 'buy' : 'sell';
      const tag = x.sym.includes('OTC') ? 'OTC' : 'FX';
      h += \`<div class="top-card \${cls}" onclick="copyPair('\${x.sym}')">
        <div><div class="tc-pair">\${x.sym} <span style="font-size:8px;opacity:.6">\${tag}</span></div><div class="tc-tf">\${x.tf} · \${x.exp}</div></div>
        <div class="tc-conf \${cls}">\${x.conf}%</div></div>\`;
    });
    h += '</div>';
  }

  // ✅ Функция рендера одной тепловой карты
  const renderHmap = (syms, title, color) => {
    if (!syms.length) return '';
    let out = \`<div class="section-title" style="color:\${color}">\${title} (\${syms.length} pairs)</div>\`;
    out += '<div class="hmap-wrap"><div class="hmap-t">';
    out += '<div class="hmap-hdr"><div></div>' + TFS.map(t => '<div>' + t + '</div>').join('') + '</div>';
    syms.forEach(s => {
      out += '<div class="hmap-row"><div class="hmap-sym">' + s.replace('_OTC','').replace('_otc','') + '</div>';
      TFS.forEach(t => {
        const x = d.find(z => z.sym === s && z.tf === t);
        if (!x) { out += '<div class="hmap-cell hc-w">—</div>'; return; }
        const cls = x.signal === 'BUY' ? 'hc-b' : x.signal === 'SELL' ? 'hc-s' : 'hc-w';
        const lbl = x.signal === 'WAIT' ? '·' : x.signal;
        out += \`<div class="hmap-cell \${cls}" onclick="copyPair('\${x.sym}')" title="\${x.sym} \${t} \${x.signal} \${x.conf}%">
          \${lbl}<span class="conf-pct">\${x.signal !== 'WAIT' ? x.conf + '%' : ''}</span></div>\`;
      });
      out += '</div>';
    });
    out += '</div></div>';
    return out;
  };

  if (activeType === 'ALL' || activeType === 'OTC') h += renderHmap(otcSyms, '⬡ OTC PAIRS', 'var(--cyan)');
  if (activeType === 'ALL' || activeType === 'FX')  h += renderHmap(fxSyms,  '◈ FOREX PAIRS', 'var(--purple)');

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
      // Smart Money индикаторы
      const smTags = [];
      if (x.spring)    smTags.push('<span class="ind-pill ip-bull">🌊 SPRING</span>');
      if (x.upthrust)  smTags.push('<span class="ind-pill ip-bear">⚡ UPTHRUST</span>');
      if (x.liqSweep)  smTags.push(\`<span class="ind-pill \${x.liqSweep.includes('BULL')?'ip-bull':'ip-bear'}">💧 \${x.liqSweep}</span>\`);
      if (x.inDemand)  smTags.push('<span class="ind-pill ip-bull">📦 DEMAND</span>');
      if (x.inSupply)  smTags.push('<span class="ind-pill ip-bear">📦 SUPPLY</span>');
      if (x.manipulation) smTags.push(\`<span class="ind-pill ip-gold">⚠️ \${x.manipulation}</span>\`);
      if (x.wyckoffPhase && x.wyckoffPhase!=='UNKNOWN') smTags.push(\`<span class="ind-pill ip-gold">W: \${x.wyckoffPhase}</span>\`);
      if (x.vsaType && x.vsaType!=='-') smTags.push(\`<span class="ind-pill \${x.vsaType.includes('BULL')||x.vsaType==='NO_SUPPLY'||x.vsaType==='STOPPING_VOL'?'ip-bull':'ip-bear'}">VSA: \${x.vsaType}</span>\`);

      const inds = [
        ['ICHI', x.ichi || 'NEU'],
        ['PSAR', x.psar || 'NEU'],
        ['MTF', (x.mtf || 'NEUTRAL').replace('BULL_ALIGNED','B✓').replace('BEAR_ALIGNED','S✓').replace('BULL','B').replace('BEAR','S').replace('NEUTRAL','NEU')],
        ['MACD', x.macdCross && x.macdCross !== '-' ? x.macdCross : 'NEU'],
        ['VWAP', x.vwapPos || 'NEU'],
        ['PAT', x.pattern && x.pattern !== 'NONE' ? x.pattern.replace('_',' ') : (x.cp && x.cp!=='NEUTRAL' ? x.cp : 'NEU')],
        ['MOM', x.momentum || 'NEU'],
        ['PA', x.paZone || 'NEU'],
      ];
      // Причины сигнала
      const reasonsHtml = x.reasons ? \`<div style="font-size:7px;color:var(--text3);margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="\${x.reasons}">\${x.reasons}</div>\` : '';

      h += \`<div class="card \${sc}">
        \${x.newsRisk ? '<div class="news-badge">⚡ NEWS: ' + x.event + '</div>' : ''}
        \${x.manipulation ? '<div class="news-badge" style="background:rgba(245,200,66,.1);border-color:var(--gold);color:var(--gold)">⚠️ ' + x.manipulation + '</div>' : ''}
        <div class="c-hdr">
          <div>
            <div class="c-sym" onclick="copyPair('\${x.sym}')">\${x.sym.replace('_OTC','').replace('_otc','')} \${x.sym.includes('OTC')?'<span style="font-size:8px;color:var(--cyan);opacity:.7">OTC</span>':'<span style="font-size:8px;color:var(--purple);opacity:.7">FX</span>'}</div>
            <div class="c-price">\${x.price}</div>
          </div>
          <div class="c-sig">
            <div class="sig-lbl \${sc}">\${x.signal}</div>
            <div class="sig-exp">\${x.exp}</div>
            \${x.stable > 1 ? '<div class="sig-stable">✓ CONFIRMED x' + x.stable + '</div>' : ''}
          </div>
        </div>
        <div class="cbar">
          <div class="cbar-hdr"><span>CONFIDENCE</span><span>\${x.conf}%</span></div>
          <div class="cbar-track"><div class="cbar-fill \${sc}" style="width:\${x.conf}%"></div></div>
        </div>
        <div class="bsbar"><div class="bsbar-b" style="flex:\${bullW}"></div><div class="bsbar-s" style="flex:\${bearW}"></div></div>
        <div class="metrics">\${mets.map(([k,v]) => \`<div class="metric"><div class="metric-l">\${k}</div><div class="metric-v \${metricClass(k, v)}">\${v}</div></div>\`).join('')}</div>
        \${reasonsHtml}
        <div class="ind-row">\${inds.map(([k,v]) => \`<span class="ind-pill \${indPillClass(v)}">\${k}: \${v}</span>\`).join('')}<span class="ind-pill \${indPillClass(x.struct)}">\${x.struct}</span></div>
        \${smTags.length ? '<div class="ind-row">' + smTags.join('') + '</div>' : ''}
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
  // Используем https для Render (https URL), http для localhost
  const client = SELF_URL.startsWith('https') ? https : http;
  client.get(SELF_URL + '/ping', (res) => {
    console.log('[PING] keep-alive ok ' + new Date().toISOString());
  }).on('error', (e) => {
    console.log('[PING] keep-alive error:', e.message);
  });
}, 14 * 60 * 1000);

console.log('[KEEP-ALIVE] Will ping ' + SELF_URL + '/ping every 14 min');

server.listen(PORT, HOST, () => {
  console.log('SIGNAL ENGINE v14 running on port ' + PORT);
});
