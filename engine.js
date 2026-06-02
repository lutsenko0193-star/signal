'use strict';

// ════════════════════════════════════════════════════
//  ENGINE v15 — Основной движок анализа
// ════════════════════════════════════════════════════

// ── Базовые индикаторы (IND) ──────────────────────
const IND = {
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

  ADX(c, p = 14) {
    if (c.length < p * 2 + 1) return { adx: 0, pdi: 0, mdi: 0 };
    const tr_arr = [], pdm_arr = [], mdm_arr = [];
    for (let i = 1; i < c.length; i++) {
      const hi = c[i].high, lo = c[i].low, pc = c[i - 1].close;
      const ph = c[i - 1].high, pl = c[i - 1].low;
      tr_arr.push(Math.max(hi - lo, Math.abs(hi - pc), Math.abs(lo - pc)));
      const up = hi - ph, dn = pl - lo;
      pdm_arr.push((up > dn && up > 0) ? up : 0);
      mdm_arr.push((dn > up && dn > 0) ? dn : 0);
    }
    let atr  = tr_arr.slice(0, p).reduce((a, b) => a + b, 0);
    let apdm = pdm_arr.slice(0, p).reduce((a, b) => a + b, 0);
    let amdm = mdm_arr.slice(0, p).reduce((a, b) => a + b, 0);
    const _dx = (ap, am, at) => {
      const pdi = at > 0 ? (ap / at) * 100 : 0;
      const mdi = at > 0 ? (am / at) * 100 : 0;
      return (pdi + mdi > 0) ? Math.abs(pdi - mdi) / (pdi + mdi) * 100 : 0;
    };
    const dx_arr = [_dx(apdm, amdm, atr)];
    for (let i = p; i < tr_arr.length; i++) {
      atr  = atr  - (atr  / p) + tr_arr[i];
      apdm = apdm - (apdm / p) + pdm_arr[i];
      amdm = amdm - (amdm / p) + mdm_arr[i];
      dx_arr.push(_dx(apdm, amdm, atr));
    }
    if (dx_arr.length < p) return { adx: 0, pdi: 0, mdi: 0 };
    let adx = dx_arr.slice(0, p).reduce((a, b) => a + b, 0) / p;
    for (let i = p; i < dx_arr.length; i++) adx = (adx * (p - 1) + dx_arr[i]) / p;
    return {
      adx: Math.min(100, Math.round(adx * 100) / 100),
      pdi: Math.round((atr > 0 ? (apdm / atr) * 100 : 0) * 100) / 100,
      mdi: Math.round((atr > 0 ? (amdm / atr) * 100 : 0) * 100) / 100
    };
  },

  ICHIMOKU(c) {
    if (c.length < 52) return { above: null, below: null, tenkan: 0, kijun: 0, spanA: 0, spanB: 0, tkCross: null };
    const high = arr => Math.max(...arr.map(x => x.high));
    const low  = arr => Math.min(...arr.map(x => x.low));
    const tenkan = (high(c.slice(-7))  + low(c.slice(-7)))  / 2;
    const kijun  = (high(c.slice(-30)) + low(c.slice(-30))) / 2;
    const spanA  = (tenkan + kijun) / 2;
    const spanB  = (high(c.slice(-52)) + low(c.slice(-52))) / 2;
    const tenkanP = c.length > 8  ? (high(c.slice(-8, -1))  + low(c.slice(-8, -1)))  / 2 : tenkan;
    const kijunP  = c.length > 31 ? (high(c.slice(-31, -1)) + low(c.slice(-31, -1))) / 2 : kijun;
    let tkCross = null;
    if (tenkanP < kijunP && tenkan > kijun) tkCross = 'BULL';
    if (tenkanP > kijunP && tenkan < kijun) tkCross = 'BEAR';
    const last = c[c.length - 1].close;
    return {
      above: last > Math.max(spanA, spanB),
      below: last < Math.min(spanA, spanB),
      tenkan, kijun, spanA, spanB, tkCross
    };
  },

  PSAR(c, step = 0.02, max = 0.2) {
    if (c.length < 5) return { sar: 0, bull: true };
    let bull = true, af = step, ep = c[0].low, sar = c[0].high;
    for (let i = 1; i < c.length; i++) {
      sar = sar + af * (ep - sar);
      if (bull) {
        if (c[i].low < sar) { bull = false; sar = ep; ep = c[i].low; af = step; }
        else if (c[i].high > ep) { ep = c[i].high; af = Math.min(af + step, max); }
      } else {
        if (c[i].high > sar) { bull = true; sar = ep; ep = c[i].high; af = step; }
        else if (c[i].low < ep) { ep = c[i].low; af = Math.min(af + step, max); }
      }
    }
    return { sar, bull };
  },

  VWAP(c) {
    const sl = c.slice(-30);
    let pv = 0, vv = 0;
    sl.forEach(x => { const tp = (x.high + x.low + x.close) / 3; pv += tp * x.volume; vv += x.volume; });
    return vv > 0 ? pv / vv : (sl[sl.length - 1]?.close || 0);
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
    if (c2.close > c2.open && c1.close > c1.open && c0.close > c0.open && c1.close > c2.close && c0.close > c1.close) return 'THREE_WHITE';
    if (c2.close < c2.open && c1.close < c1.open && c0.close < c0.open && c1.close < c2.close && c0.close < c1.close) return 'THREE_BLACK';
    if (c2.close < c2.open && Math.abs(c1.close - c1.open) < atr * 0.3 && c0.close > c0.open && c0.close > (c2.open + c2.close) / 2) return 'MORNING_STAR';
    if (c2.close > c2.open && Math.abs(c1.close - c1.open) < atr * 0.3 && c0.close < c0.open && c0.close < (c2.open + c2.close) / 2) return 'EVENING_STAR';
    return 'NEUTRAL';
  }
};

// ── Структура рынка ───────────────────────────────
function marketStructure(c, atr) {
  if (c.length < 10) return { trend: 'RANGE', bos: null, choch: null, ob: null };
  const win = c.slice(-30);
  const swingH = [], swingL = [];
  for (let i = 3; i < win.length - 3; i++) {
    let ih = true, il = true;
    for (let j = i - 3; j <= i + 3; j++) {
      if (j === i) continue;
      if (win[j].high >= win[i].high) ih = false;
      if (win[j].low  <= win[i].low)  il = false;
    }
    if (ih) swingH.push({ idx: i, price: win[i].high });
    if (il) swingL.push({ idx: i, price: win[i].low });
  }
  const hh = swingH.length >= 2 && swingH[swingH.length - 1].price > swingH[0].price;
  const hl = swingL.length >= 2 && swingL[swingL.length - 1].price > swingL[0].price;
  const lh = swingH.length >= 2 && swingH[swingH.length - 1].price < swingH[0].price;
  const ll = swingL.length >= 2 && swingL[swingL.length - 1].price < swingL[0].price;
  let trend = 'RANGE';
  if (hh && hl) trend = 'UPTREND';
  else if (lh && ll) trend = 'DOWNTREND';

  // BOS / CHoCH
  let bos = null, choch = null;
  const last = c[c.length - 1];
  const prev = c[c.length - 2];
  if (swingH.length >= 1) {
    const lastH = swingH[swingH.length - 1].price;
    if (prev.close < lastH && last.close > lastH) bos = 'BOS_BULL';
  }
  if (swingL.length >= 1) {
    const lastL = swingL[swingL.length - 1].price;
    if (prev.close > lastL && last.close < lastL) bos = 'BOS_BEAR';
  }
  if (trend === 'DOWNTREND' && bos === 'BOS_BULL') choch = 'CHOCH_BULL';
  if (trend === 'UPTREND'   && bos === 'BOS_BEAR') choch = 'CHOCH_BEAR';

  // Order Block — последняя медвежья свеча перед бычьим импульсом
  let ob = null;
  if (c.length >= 5) {
    const impulse = c.slice(-5);
    const bullImpulse = impulse[impulse.length - 1].close - impulse[0].open > atr * 2;
    const bearImpulse = impulse[0].open - impulse[impulse.length - 1].close > atr * 2;
    if (bullImpulse) ob = { type: 'BULL_OB', high: impulse[0].high, low: impulse[0].low };
    if (bearImpulse) ob = { type: 'BEAR_OB', high: impulse[0].high, low: impulse[0].low };
  }

  return { trend, bos, choch, ob };
}

// ── Моментум ──────────────────────────────────────
function momentumScore(c) {
  if (c.length < 15) return { score: 0, direction: 'NEUTRAL' };
  const ema5  = IND.EMA(c, 5);
  const ema13 = IND.EMA(c, 13);
  const ema21 = IND.EMA(c, 21);
  const rsi   = IND.RSI(c, 14);
  const last  = c[c.length - 1].close;
  let score = 0;
  if (last > ema5)  score += 10;
  if (ema5 > ema13) score += 10;
  if (ema13 > ema21) score += 10;
  if (rsi > 55) score += 15;
  if (rsi < 45) score -= 15;
  if (last < ema5)  score -= 10;
  if (ema5 < ema13) score -= 10;
  if (ema13 < ema21) score -= 10;
  const direction = score > 15 ? 'BULL' : score < -15 ? 'BEAR' : 'NEUTRAL';
  return { score, direction };
}

// ── Детектор манипуляций ──────────────────────────
function manipulationDetector(c, atr) {
  if (c.length < 10) return { type: null, confidence: 0 };
  const last = c[c.length - 1];
  const volAvg = c.slice(-20).reduce((a, b) => a + b.volume, 0) / 20;
  const body = Math.abs(last.close - last.open);
  const rng  = last.high - last.low;
  const uw   = last.high - Math.max(last.close, last.open);
  const lw   = Math.min(last.close, last.open) - last.low;

  // Спуф — большие тени, маленькое тело
  if ((uw > atr * 1.8 || lw > atr * 1.8) && body < rng * 0.15) {
    return { type: 'SPOOF', confidence: 70 };
  }
  // Памп — резкий рост на высоком объёме
  if (last.volume > volAvg * 3 && last.close > last.open && body > atr * 1.5) {
    return { type: 'PUMP', confidence: 65 };
  }
  // Дамп — резкое падение на высоком объёме
  if (last.volume > volAvg * 3 && last.close < last.open && body > atr * 1.5) {
    return { type: 'DUMP', confidence: 65 };
  }
  return { type: null, confidence: 0 };
}

// ── Зоны прайс-экшена ─────────────────────────────
function priceActionZones(c, atr) {
  if (c.length < 20) return { zone: 'NEUTRAL', position: 'MID' };
  const last  = c[c.length - 1].close;
  const high  = Math.max(...c.slice(-50).map(x => x.high));
  const low   = Math.min(...c.slice(-50).map(x => x.low));
  const range = high - low;
  if (range === 0) return { zone: 'NEUTRAL', position: 'MID' };
  const pct = (last - low) / range;
  let zone = 'NEUTRAL', position = 'MID';
  if (pct > 0.8) { zone = 'SUPPLY'; position = 'TOP'; }
  else if (pct < 0.2) { zone = 'DEMAND'; position = 'BOT'; }
  else if (pct > 0.5) position = 'HIGH';
  else position = 'LOW';
  return { zone, position };
}

// ── MTF конфлюэнс ─────────────────────────────────
function mtfConfluence(marketData, sym, tf) {
  const order = ['M1', 'M5', 'M15', 'M30', 'H1'];
  const idx = order.indexOf(tf);
  let bullCount = 0, bearCount = 0, count = 0;

  for (let i = idx + 1; i < order.length; i++) {
    const htf = order[i];
    if (!marketData[sym] || !marketData[sym][htf] || !marketData[sym][htf].cached) continue;
    const s = marketData[sym][htf].cached;
    count++;
    if (s.signal === 'BUY')  bullCount++;
    if (s.signal === 'SELL') bearCount++;
  }

  const bias     = bullCount > bearCount ? 'BULL' : bearCount > bullCount ? 'BEAR' : 'NEUTRAL';
  const aligned  = count > 0 && (bullCount === count || bearCount === count);
  const strength = Math.max(bullCount, bearCount) * 20;

  return { bias, aligned, strength, count };
}

// ── Supply/Demand зоны ────────────────────────────
function supplyDemandZones(c, atr) {
  if (c.length < 30) return { supplyZone: null, demandZone: null, inSupply: false, inDemand: false };
  const last = c[c.length - 1].close;
  const win  = c.slice(-100);
  let demandZone = null, supplyZone = null;
  for (let i = 5; i < win.length - 5; i++) {
    const before = win.slice(i - 5, i);
    const after  = win.slice(i, i + 5);
    const beforeRange = Math.max(...before.map(x => x.high)) - Math.min(...before.map(x => x.low));
    const afterMove   = Math.abs(after[after.length - 1].close - after[0].open);
    if (beforeRange < atr * 2 && afterMove > atr * 3 && after[after.length - 1].close > after[0].open)
      demandZone = { high: Math.max(...before.map(x => x.high)), low: Math.min(...before.map(x => x.low)) };
    if (beforeRange < atr * 2 && afterMove > atr * 3 && after[after.length - 1].close < after[0].open)
      supplyZone = { high: Math.max(...before.map(x => x.high)), low: Math.min(...before.map(x => x.low)) };
  }
  const inDemand = demandZone ? last >= demandZone.low && last <= demandZone.high * 1.002 : false;
  const inSupply = supplyZone ? last <= supplyZone.high && last >= supplyZone.low * 0.998 : false;
  return { supplyZone, demandZone, inSupply, inDemand };
}

// ── Wyckoff ───────────────────────────────────────
function wyckoffAnalysis(c, sr, atr) {
  if (c.length < 30 || !sr) return { phase: 'UNKNOWN', spring: false, upthrust: false };
  const last = c[c.length - 1];
  const spring   = last.low < sr.sup - atr * 0.3 && last.close > sr.sup &&
                   (last.close - last.low) > (last.high - last.low) * 0.6;
  const upthrust = last.high > sr.res + atr * 0.3 && last.close < sr.res &&
                   (last.high - last.close) > (last.high - last.low) * 0.6;
  const win = c.slice(-50);
  const range       = Math.max(...win.map(x => x.high)) - Math.min(...win.map(x => x.low));
  const recentRange = Math.max(...c.slice(-10).map(x => x.high)) - Math.min(...c.slice(-10).map(x => x.low));
  const volAvg   = c.slice(-50).reduce((a, b) => a + b.volume, 0) / 50;
  const recentVol = c.slice(-10).reduce((a, b) => a + b.volume, 0) / 10;
  let phase = 'UNKNOWN';
  if (recentRange < range * 0.3 && recentVol < volAvg * 0.8)  phase = 'ACCUMULATION';
  if (recentRange < range * 0.3 && recentVol > volAvg * 1.2)  phase = 'DISTRIBUTION';
  if (recentRange > range * 0.5 && last.close > c[c.length - 10].close) phase = 'MARKUP';
  if (recentRange > range * 0.5 && last.close < c[c.length - 10].close) phase = 'MARKDOWN';
  return { phase, spring, upthrust };
}

// ── VSA ───────────────────────────────────────────
function vsaAnalysis(c) {
  if (c.length < 20) return { signal: 'NEUTRAL', type: '-' };
  const last = c[c.length - 1];
  const prev = c[c.length - 2];
  const volAvg    = c.slice(-20).reduce((a, b) => a + b.volume, 0) / 20;
  const spreadAvg = c.slice(-20).reduce((a, b) => a + (b.high - b.low), 0) / 20;
  const spread = last.high - last.low;
  const isHighVol      = last.volume > volAvg * 1.5;
  const isLowVol       = last.volume < volAvg * 0.7;
  const isWideSpread   = spread > spreadAvg * 1.3;
  const isNarrowSpread = spread < spreadAvg * 0.7;
  const isUp   = last.close > last.open;
  const isDown = last.close < last.open;
  const noSupply       = isLowVol && isNarrowSpread && isUp;
  const noDemand       = isLowVol && isNarrowSpread && isDown;
  const stoppingVolume = isHighVol && isWideSpread && isDown &&
                         (last.close - last.low) > (last.high - last.low) * 0.6;
  let signal = 'NEUTRAL', type = '-';
  if (noSupply)       { signal = 'BULL'; type = 'NO_SUPPLY'; }
  if (stoppingVolume) { signal = 'BULL'; type = 'STOPPING_VOL'; }
  if (noDemand)       { signal = 'BEAR'; type = 'NO_DEMAND'; }
  if (isHighVol && isWideSpread && isUp   && prev.close < prev.open) { signal = 'BULL'; type = 'CLIMAX_BULL'; }
  if (isHighVol && isWideSpread && isDown && prev.close > prev.open) { signal = 'BEAR'; type = 'CLIMAX_BEAR'; }
  return { signal, type };
}

// ── Ликвидность ───────────────────────────────────
function liquidityZones(c) {
  if (c.length < 30) return { bullLiq: null, bearLiq: null, swept: false, liqSweep: null };
  const win = c.slice(-50);
  const swingHighs = [], swingLows = [];
  for (let i = 3; i < win.length - 3; i++) {
    let isH = true, isL = true;
    for (let j = i - 3; j <= i + 3; j++) {
      if (j === i) continue;
      if (win[j].high >= win[i].high) isH = false;
      if (win[j].low  <= win[i].low)  isL = false;
    }
    if (isH) swingHighs.push(win[i].high);
    if (isL) swingLows.push(win[i].low);
  }
  const last    = c[c.length - 1];
  const lastClose = last.close;
  const bullLiq = swingHighs.filter(h => h > lastClose).sort((a, b) => a - b)[0] || null;
  const bearLiq = swingLows.filter(l => l < lastClose).sort((a, b) => b - a)[0]  || null;
  let liqSweep  = null;
  if (bullLiq && last.high > bullLiq && lastClose < bullLiq) liqSweep = 'BULL_SWEEP';
  if (bearLiq && last.low  < bearLiq && lastClose > bearLiq) liqSweep = 'BEAR_SWEEP';
  return { bullLiq, bearLiq, swept: !!liqSweep, liqSweep };
}

// ── Elder Ray ─────────────────────────────────────
function elderRay(c) {
  if (c.length < 15) return { bull: 0, bear: 0, signal: 'NEUTRAL' };
  const ema13 = IND.EMA(c, 13);
  const last  = c[c.length - 1];
  const bull  = last.high - ema13;
  const bear  = last.low  - ema13;
  const signal = bull > 0 && bear > 0 ? 'BULL' : bull < 0 && bear < 0 ? 'BEAR' : 'NEUTRAL';
  return { bull: Math.round(bull * 100000) / 100000, bear: Math.round(bear * 100000) / 100000, signal };
}

// ── Главный скоринг ───────────────────────────────
function scoreSignal({ c, sym, tf, sr, ms, atr, news }) {
  const reasons = [];
  let bullScore = 0, bearScore = 0;

  const rsi    = IND.RSI(c, 14);
  const adxObj = IND.ADX(c, 14);
  const adx    = adxObj.adx;
  const pdi    = adxObj.pdi;
  const mdi    = adxObj.mdi;
  const cci    = IND.CCI(c, 14);
  const stoch  = IND.STOCH(c, 14);
  const bb     = IND.BB(c, 20);
  const wr     = IND.WILLIAMS_R(c, 14);
  const macd   = IND.MACD(c);
  const ichi   = IND.ICHIMOKU(c);
  const psar   = IND.PSAR(c);
  const vwap   = IND.VWAP(c);
  const cp     = IND.CANDLE(c);
  const last   = c[c.length - 1].close;

  // ── RSI
  if (rsi < 30) { bullScore += 20; reasons.push('RSI_OB'); }
  else if (rsi < 40) { bullScore += 10; reasons.push('RSI_LOW'); }
  if (rsi > 70) { bearScore += 20; reasons.push('RSI_OS'); }
  else if (rsi > 60) { bearScore += 10; reasons.push('RSI_HIGH'); }

  // ── ADX trend strength
  if (adx > 25) {
    if (pdi > mdi) { bullScore += 15; reasons.push('ADX_BULL'); }
    else           { bearScore += 15; reasons.push('ADX_BEAR'); }
  }

  // ── CCI
  if (cci < -100) { bullScore += 12; reasons.push('CCI_OB'); }
  if (cci >  100) { bearScore += 12; reasons.push('CCI_OS'); }

  // ── Stochastic
  if (stoch.k < 20 && stoch.d < 20) { bullScore += 15; reasons.push('STOCH_OB'); }
  if (stoch.k > 80 && stoch.d > 80) { bearScore += 15; reasons.push('STOCH_OS'); }

  // ── BB
  if (bb.pctB < 10) { bullScore += 12; reasons.push('BB_LOW'); }
  if (bb.pctB > 90) { bearScore += 12; reasons.push('BB_HIGH'); }
  if (bb.squeeze)   { bullScore += 5; bearScore += 5; reasons.push('BB_SQUEEZE'); }

  // ── Williams %R
  if (wr < -80) { bullScore += 10; reasons.push('WR_OB'); }
  if (wr > -20) { bearScore += 10; reasons.push('WR_OS'); }

  // ── MACD
  if (macd.cross === 'BULL_CROSS') { bullScore += 18; reasons.push('MACD_BULL'); }
  if (macd.cross === 'BEAR_CROSS') { bearScore += 18; reasons.push('MACD_BEAR'); }
  if (macd.hist > 0) bullScore += 5;
  if (macd.hist < 0) bearScore += 5;

  // ── Ichimoku
  let ichiLabel = 'IN';
  if (ichi.above) { bullScore += 15; ichiLabel = 'ABOVE'; reasons.push('ICHI_ABOVE'); }
  if (ichi.below) { bearScore += 15; ichiLabel = 'BELOW'; reasons.push('ICHI_BELOW'); }
  if (ichi.tkCross === 'BULL') { bullScore += 10; reasons.push('TK_BULL'); }
  if (ichi.tkCross === 'BEAR') { bearScore += 10; reasons.push('TK_BEAR'); }

  // ── PSAR
  const psarLabel = psar.bull ? 'BULL' : 'BEAR';
  if (psar.bull)  { bullScore += 10; reasons.push('PSAR_BULL'); }
  else            { bearScore += 10; reasons.push('PSAR_BEAR'); }

  // ── VWAP
  let vwapPos = 'NEUTRAL';
  if (last > vwap) { bullScore += 8; vwapPos = 'ABOVE'; reasons.push('VWAP_ABOVE'); }
  if (last < vwap) { bearScore += 8; vwapPos = 'BELOW'; reasons.push('VWAP_BELOW'); }

  // ── Candle pattern
  const bullCandles = ['PIN_BULL','ENG_BULL','HAMMER','MORNING_STAR','THREE_WHITE'];
  const bearCandles = ['PIN_BEAR','ENG_BEAR','HANGING_MAN','EVENING_STAR','THREE_BLACK'];
  if (bullCandles.includes(cp)) { bullScore += 15; reasons.push('CANDLE_' + cp); }
  if (bearCandles.includes(cp)) { bearScore += 15; reasons.push('CANDLE_' + cp); }

  // ── Market structure
  if (ms.trend === 'UPTREND')   { bullScore += 12; reasons.push('MS_UP'); }
  if (ms.trend === 'DOWNTREND') { bearScore += 12; reasons.push('MS_DOWN'); }
  if (ms.bos === 'BOS_BULL')    { bullScore += 15; reasons.push('BOS_BULL'); }
  if (ms.bos === 'BOS_BEAR')    { bearScore += 15; reasons.push('BOS_BEAR'); }

  // ── S/R proximity
  if (sr.sup > 0 && Math.abs(last - sr.sup) / last < 0.002) { bullScore += 12; reasons.push('AT_SUP'); }
  if (sr.res > 0 && Math.abs(last - sr.res) / last < 0.002) { bearScore += 12; reasons.push('AT_RES'); }

  // ── News risk — снижаем
  if (news.risk) { bullScore = Math.round(bullScore * 0.7); bearScore = Math.round(bearScore * 0.7); }

  // ── Smart Money
  const sd  = supplyDemandZones(c, atr);
  const wyk = wyckoffAnalysis(c, sr, atr);
  const vsa = vsaAnalysis(c);
  const liq = liquidityZones(c);
  const eld = elderRay(c);

  if (sd.inDemand) { bullScore += 15; reasons.push('IN_DEMAND'); }
  if (sd.inSupply) { bearScore += 15; reasons.push('IN_SUPPLY'); }
  if (wyk.spring)  { bullScore += 20; reasons.push('SPRING'); }
  if (wyk.upthrust){ bearScore += 20; reasons.push('UPTHRUST'); }
  if (vsa.signal === 'BULL') { bullScore += 10; reasons.push('VSA_' + vsa.type); }
  if (vsa.signal === 'BEAR') { bearScore += 10; reasons.push('VSA_' + vsa.type); }
  if (liq.liqSweep === 'BULL_SWEEP') { bullScore += 12; reasons.push('LIQ_SWEEP_BULL'); }
  if (liq.liqSweep === 'BEAR_SWEEP') { bearScore += 12; reasons.push('LIQ_SWEEP_BEAR'); }
  if (eld.signal === 'BULL') bullScore += 8;
  if (eld.signal === 'BEAR') bearScore += 8;

  // ── Финальный результат
  const rawScore = bullScore - bearScore;
  const total    = bullScore + bearScore || 1;
  let signal = 'WAIT';
  let conf   = 50;

  if (rawScore > 20) {
    signal = 'BUY';
    conf   = Math.min(97, 50 + Math.round((bullScore / total) * 50));
  } else if (rawScore < -20) {
    signal = 'SELL';
    conf   = Math.min(97, 50 + Math.round((bearScore / total) * 50));
  }

  // Паттерн
  let pattern = 'NONE';
  if (wyk.spring)   pattern = 'SPRING';
  else if (wyk.upthrust) pattern = 'UPTHRUST';
  else if (ms.choch) pattern = ms.choch;
  else if (ms.bos)   pattern = ms.bos;

  return {
    signal, conf, rawScore,
    bull: bullScore, bear: bearScore,
    rsi:    Math.round(rsi * 10) / 10,
    adx:    Math.round(adx * 10) / 10,
    cci:    Math.round(cci * 10) / 10,
    stochK: Math.round(stoch.k * 10) / 10,
    bb:     Math.round(bb.pctB * 10) / 10,
    wr:     Math.round(wr * 10) / 10,
    macdCross: macd.cross || '-',
    ichi:   ichiLabel,
    psar:   psarLabel,
    vwapPos,
    cp,
    pattern,
    wyckoffPhase: wyk.phase,
    vsaType: vsa.type,
    spring:   wyk.spring,
    upthrust: wyk.upthrust,
    liqSweep: liq.liqSweep,
    inDemand: sd.inDemand,
    inSupply: sd.inSupply,
    elder: eld.signal,
    reasons
  };
}

// ── Экспорт ───────────────────────────────────────
module.exports = {
  IND,
  scoreSignal,
  marketStructure,
  momentumScore,
  manipulationDetector,
  priceActionZones,
  mtfConfluence
};
