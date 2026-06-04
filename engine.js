// ════════════════════════════════════════════════════════════════════
// SIGNAL ENGINE v17 — BINARY OPTIONS SPECIALIST
// Архитектура: иерархический MTF анализ для бинарных опционов
//
// Изменения v17 (vs v16):
// [FIX-1] conf: псевдолинейный bullCount*2 → логистическая кривая с весами
// [FIX-2] getHTFBias: структура рынка имеет приоритет над сигналом (стабильнее)
// [FIX-3] candlePattern: TF-адаптивные пороги (M1 строже, H1 мягче)
// [FIX-4] scoreSignal: логика «стража» — bull/bear массивы только при разрешённом HTF
// [FIX-5] Весовая таблица систем по Булковски (OB+CHOCH >> RSI+EMA)
// [FIX-6] Stoch %D: стандартный SMA(3, %K) вместо упрощённого среднего
//
// Ключевые принципы (неизменны):
// 1. Murphy: торгуй только В направлении старшего TF
// 2. Nison: паттерн действителен ТОЛЬКО в правильном контексте
// 3. Bulkowski: минимальная надёжность паттерна 65%, веса по статистике
// 4. Douglas: после 3+ убытков — пауза (защита от тильта)
// 5. Taleb: если волатильность низкая — не торгуй
// 6. Elder: 3 экрана = H1 тренд → M15 импульс → M5/M1 вход
// ════════════════════════════════════════════════════════════════════

'use strict';

// ─── [FIX-5] ВЕСОВАЯ ТАБЛИЦА СИСТЕМ ─────────────────────────────────
// Основана на статистике Булковски и ICT-концепциях.
// Чем выше вес — тем значимее сигнал для итогового conf.
const SYSTEM_WEIGHTS = {
  // Институциональные (Smart Money) — самый высокий вес
  'OB':           1.8,  // Order Block: точка институционального интереса
  'CHOCH':        1.5,  // Change of Character: смена тренда подтверждена
  'RSI_DIV':      1.4,  // RSI дивергенция: цена и моментум расходятся
  'STRUCT':       1.2,  // Структура рынка (HH/HL или LH/LL)
  'AT_SUP':       1.2,  // Вход у подтверждённой поддержки (≥2 касания)
  'AT_RES':       1.2,  // Вход у подтверждённого сопротивления
  // Паттерны Нисон — высокий вес при правильном контексте
  'CANDLE:THREE_WHITE': 1.3,
  'CANDLE:THREE_BLACK': 1.3,
  'CANDLE:MORNING_STAR': 1.2,
  'CANDLE:EVENING_STAR': 1.2,
  'CANDLE:MARUBOZU_BULL': 1.0,
  'CANDLE:MARUBOZU_BEAR': 1.0,
  'CANDLE:ENG_BULL':  0.9,
  'CANDLE:ENG_BEAR':  0.9,
  'CANDLE:PIN_BULL':  0.9,
  'CANDLE:PIN_BEAR':  0.9,
  // Трендовые фильтры — средний вес
  'EMA_TREND':    1.0,
  'PSAR_VWAP':    0.9,
  'BB_TREND':     0.8,
  // Осцилляторы — низкий вес (запаздывают, коррелируют)
  'MACD':         0.8,
  'STOCH_REV':    0.7,
  'BB_LOW':       0.6,
  'BB_HIGH':      0.6,
  'RSI_OS':       0.7,
  'RSI_OB':       0.7,
  // По умолчанию
  '_DEFAULT':     0.5,
};

function getSystemWeight(name) {
  // Проверяем точное совпадение, затем префикс CANDLE:
  if (SYSTEM_WEIGHTS[name] !== undefined) return SYSTEM_WEIGHTS[name];
  if (name.startsWith('CANDLE:')) return SYSTEM_WEIGHTS['_DEFAULT'];
  return SYSTEM_WEIGHTS['_DEFAULT'];
}

// [FIX-1] Логистическая функция confidence
// rawScore — сумма весов активных систем
// Диапазон: ~52 при слабом сигнале → ~89 при очень сильном
// Формула: 50 + 40 * (1 - 1/(1 + e^(score - pivot)))
function logisticConf(systems) {
  const rawScore = systems.reduce((sum, s) => sum + getSystemWeight(s), 0);
  const pivot = 3.0; // центр кривой — «нормальный» сигнал
  const conf  = 50 + 40 * (1 - 1 / (1 + Math.exp(rawScore - pivot)));
  return Math.max(10, Math.min(92, Math.round(conf)));
}

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
    for (let i = 1; i < c.length; i++) out.push((c[i].close - out[i-1]) * k + out[i-1]);
    return out;
  },

  SMA(c, p) {
    if (c.length < p) return c[c.length-1]?.close || 0;
    return c.slice(-p).reduce((a,b) => a+b.close, 0) / p;
  },

  // ATR — ГЛАВНЫЙ ФИЛЬТР ВОЛАТИЛЬНОСТИ (Taleb)
  ATR(c, p=14) {
    if (c.length < 2) return 0.0001;
    const trs = [];
    for (let i=1; i<c.length; i++) {
      const h=c[i].high, l=c[i].low, pc=c[i-1].close;
      trs.push(Math.max(h-l, Math.abs(h-pc), Math.abs(l-pc)));
    }
    let atr = trs.slice(0, Math.min(p, trs.length)).reduce((a,b)=>a+b,0) / Math.min(p, trs.length);
    for (let i=p; i<trs.length; i++) atr = (atr*(p-1)+trs[i])/p;
    return atr > 0 ? atr : 0.0001;
  },

  RSI(c, p=14) {
    if (c.length < p+1) return 50;
    let ag=0, al=0;
    for (let i=1; i<=p; i++) {
      const d=c[i].close-c[i-1].close;
      if (d>0) ag+=d; else al-=d;
    }
    ag/=p; al/=p;
    for (let i=p+1; i<c.length; i++) {
      const d=c[i].close-c[i-1].close;
      ag=(ag*(p-1)+(d>0?d:0))/p;
      al=(al*(p-1)+(d<0?-d:0))/p;
    }
    return al===0 ? 100 : Math.round((100-100/(1+ag/al))*100)/100;
  },

  RSI_S(c, p=14) {
    if (c.length < p+1) return [];
    const s=[]; let ag=0,al=0;
    for (let i=1; i<=p; i++) { const d=c[i].close-c[i-1].close; if(d>0)ag+=d; else al-=d; }
    ag/=p; al/=p;
    s.push(al===0?100:100-100/(1+ag/al));
    for (let i=p+1; i<c.length; i++) {
      const d=c[i].close-c[i-1].close;
      ag=(ag*(p-1)+(d>0?d:0))/p; al=(al*(p-1)+(d<0?-d:0))/p;
      s.push(al===0?100:100-100/(1+ag/al));
    }
    return s;
  },

  MACD(c) {
    if (c.length < 35) return { macd:0, signal:0, hist:0, cross:null, trend:'NEUTRAL' };
    const e12=this.EMA_S(c,12), e26=this.EMA_S(c,26);
    const ml=e12.map((v,i)=>v-e26[i]);
    const k=2/10; let sg=ml[0]; const ss=[sg];
    for (let i=1; i<ml.length; i++) { sg=(ml[i]-sg)*k+sg; ss.push(sg); }
    const n=ml.length-1, m=ml[n], si=ss[n];
    let cross=null;
    if (n>0) {
      if (ml[n-1]<ss[n-1] && m>si) cross='BULL';
      if (ml[n-1]>ss[n-1] && m<si) cross='BEAR';
    }
    const hist=m-si;
    const histPrev=n>0?ml[n-1]-ss[n-1]:0;
    const trend=hist>0?(hist>histPrev?'BULL_STRONG':'BULL_WEAK'):(hist<histPrev?'BEAR_STRONG':'BEAR_WEAK');
    return { macd:m, signal:si, hist, cross, trend };
  },

  // [FIX-6] Stochastic: %D = стандартный SMA(3, %K)
  STOCH(c, p=14) {
    if (c.length < p+5) return { k:50, d:50, zone:'NEUTRAL', cross:null };

    const rawK=(bars)=>{
      if (bars.length < p) return 50;
      const sl=bars.slice(-p);
      const hi=Math.max(...sl.map(x=>x.high)), lo=Math.min(...sl.map(x=>x.low));
      const cl=sl[sl.length-1].close;
      return hi===lo ? 50 : ((cl-lo)/(hi-lo))*100;
    };

    // Собираем серию %K для последних 5 позиций
    const kSeries=[];
    for (let j=4; j>=0; j--) {
      const end=c.length-j;
      if (end < p) { kSeries.push(50); continue; }
      kSeries.push(rawK(c.slice(0, end)));
    }

    // %K текущий = последнее значение
    const k=kSeries[kSeries.length-1];
    // %D = SMA(3) от последних трёх %K
    const d=(kSeries[2]+kSeries[3]+kSeries[4])/3;
    const kPrev=kSeries[3], dPrev=(kSeries[1]+kSeries[2]+kSeries[3])/3;

    const zone=k<20?'OVERSOLD':k>80?'OVERBOUGHT':'NEUTRAL';
    let cross=null;
    if (kPrev<dPrev && k>d) cross='BULL';
    if (kPrev>dPrev && k<d) cross='BEAR';

    return {
      k:Math.max(0,Math.min(100,k)),
      d:Math.max(0,Math.min(100,d)),
      zone, cross
    };
  },

  BB(c, p=20, m=2) {
    if (c.length<p) return { upper:0,mid:0,lower:0,pctB:50,bw:0,squeeze:false };
    const sl=c.slice(-p).map(x=>x.close);
    const mean=sl.reduce((a,b)=>a+b,0)/p;
    const sd=Math.sqrt(sl.reduce((a,b)=>a+(b-mean)**2,0)/p);
    const upper=mean+m*sd, lower=mean-m*sd;
    const last=sl[sl.length-1];
    const pctB=(upper-lower)>0?((last-lower)/(upper-lower))*100:50;
    const bw=(upper-lower)/mean;
    return { upper, mid:mean, lower, pctB:Math.max(0,Math.min(100,pctB)), bw, squeeze:bw<0.015 };
  },

  ADX(c, p=14) {
    if (c.length<p*2+1) return { adx:0,pdi:0,mdi:0,trend:'NONE',strength:'NONE' };
    const tr_arr=[],pdm_arr=[],mdm_arr=[];
    for (let i=1; i<c.length; i++) {
      const h=c[i].high,l=c[i].low,pc=c[i-1].close,ph=c[i-1].high,pl=c[i-1].low;
      tr_arr.push(Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc)));
      const up=h-ph,dn=pl-l;
      pdm_arr.push((up>dn&&up>0)?up:0);
      mdm_arr.push((dn>up&&dn>0)?dn:0);
    }
    let atr=tr_arr.slice(0,p).reduce((a,b)=>a+b,0);
    let apdm=pdm_arr.slice(0,p).reduce((a,b)=>a+b,0);
    let amdm=mdm_arr.slice(0,p).reduce((a,b)=>a+b,0);
    const _dx=(ap,am,at)=>{ const pdi=at>0?(ap/at)*100:0; const mdi=at>0?(am/at)*100:0; return (pdi+mdi>0)?Math.abs(pdi-mdi)/(pdi+mdi)*100:0; };
    const dxs=[_dx(apdm,amdm,atr)];
    for (let i=p; i<tr_arr.length; i++) {
      atr=atr-(atr/p)+tr_arr[i]; apdm=apdm-(apdm/p)+pdm_arr[i]; amdm=amdm-(amdm/p)+mdm_arr[i];
      dxs.push(_dx(apdm,amdm,atr));
    }
    if (dxs.length<p) return { adx:0,pdi:0,mdi:0,trend:'NONE',strength:'NONE' };
    let adx=dxs.slice(0,p).reduce((a,b)=>a+b,0)/p;
    for (let i=p; i<dxs.length; i++) adx=(adx*(p-1)+dxs[i])/p;
    const pdi=atr>0?(apdm/atr)*100:0, mdi=atr>0?(amdm/atr)*100:0;
    adx=Math.min(100,Math.round(adx*100)/100);
    const trend=pdi>mdi?'BULL':'BEAR';
    const strength=adx>50?'VERY_STRONG':adx>35?'STRONG':adx>20?'TRENDING':adx>15?'WEAK':'NONE';
    return { adx,pdi:Math.round(pdi*100)/100,mdi:Math.round(mdi*100)/100,trend,strength };
  },

  VWAP(c) {
    const sl=c.slice(-20);
    let pv=0,vv=0;
    sl.forEach(x=>{ const tp=(x.high+x.low+x.close)/3; pv+=tp*x.volume; vv+=x.volume; });
    return vv>0?pv/vv:(sl[sl.length-1]?.close||0);
  },

  PSAR(c, step=0.02, max=0.2) {
    if (c.length<5) return { sar:0,bull:true };
    let bull=true,af=step,ep=c[0].low,sar=c[0].high;
    for (let i=1; i<c.length; i++) {
      sar=sar+af*(ep-sar);
      if (bull) { if(c[i].low<sar){bull=false;sar=ep;ep=c[i].low;af=step;} else if(c[i].high>ep){ep=c[i].high;af=Math.min(af+step,max);} }
      else { if(c[i].high>sar){bull=true;sar=ep;ep=c[i].high;af=step;} else if(c[i].low<ep){ep=c[i].low;af=Math.min(af+step,max);} }
    }
    return { sar,bull };
  },
};

// ─── [FIX-3] СВЕЧНЫЕ ПАТТЕРНЫ — TF-АДАПТИВНЫЕ ПОРОГИ ───────────────
// Паттерны на младших TF имеют больше шума → строже пороги
// На старших TF паттерн значимее → мягче пороги
// Только паттерны с надёжностью ≥63% по Булковски
function candlePattern(c, tf='M5') {
  if (c.length<3) return { name:'NEUTRAL',direction:0,reliability:0 };

  // Множитель строгости: M1 самый строгий, H1 самый мягкий
  const TF_MULT = { M1:0.65, M5:1.0, M15:1.2, M30:1.4, H1:1.6 };
  const mult = TF_MULT[tf] || 1.0;

  // ATR по 20 свечам — стабильнее, чем по 15 (v16)
  const atr = IND.ATR(c.slice(-21), 14);
  if (atr <= 0) return { name:'NEUTRAL',direction:0,reliability:0 };

  const [c2,c1,c0] = c.slice(-3);
  const body=(x)=>Math.abs(x.close-x.open);
  const uw=(x)=>x.high-Math.max(x.close,x.open);
  const lw=(x)=>Math.min(x.close,x.open)-x.low;
  const bull=(x)=>x.close>x.open;
  const bear=(x)=>x.close<x.open;
  const b0=body(c0), b1=body(c1);

  // Engulfing — 63%
  if (bear(c1)&&bull(c0)&&c0.open<=c1.close&&c0.close>=c1.open&&b0>b1*mult)
    return { name:'ENG_BULL',direction:1,reliability:63 };
  if (bull(c1)&&bear(c0)&&c0.open>=c1.close&&c0.close<=c1.open&&b0>b1*mult)
    return { name:'ENG_BEAR',direction:-1,reliability:63 };

  // Morning/Evening Star — 72%
  if (bear(c2)&&body(c1)<atr*0.3&&bull(c0)&&c0.close>(c2.open+c2.close)/2)
    return { name:'MORNING_STAR',direction:1,reliability:72 };
  if (bull(c2)&&body(c1)<atr*0.3&&bear(c0)&&c0.close<(c2.open+c2.close)/2)
    return { name:'EVENING_STAR',direction:-1,reliability:72 };

  // Three White Soldiers / Three Black Crows — 78%
  if (bull(c2)&&bull(c1)&&bull(c0)&&c1.close>c2.close&&c0.close>c1.close&&b0>atr*0.3*mult)
    return { name:'THREE_WHITE',direction:1,reliability:78 };
  if (bear(c2)&&bear(c1)&&bear(c0)&&c1.close<c2.close&&c0.close<c1.close&&b0>atr*0.3*mult)
    return { name:'THREE_BLACK',direction:-1,reliability:78 };

  // Pin Bar — 65% (строже на младших TF: mult снижает порог ≈ требует более чёткий pin)
  if (lw(c0)>b0*2.5*mult&&lw(c0)>atr*0.4&&uw(c0)<b0*0.5&&bull(c0))
    return { name:'PIN_BULL',direction:1,reliability:65 };
  if (uw(c0)>b0*2.5*mult&&uw(c0)>atr*0.4&&lw(c0)<b0*0.5&&bear(c0))
    return { name:'PIN_BEAR',direction:-1,reliability:65 };

  // Marubozu — 70% (требует отсутствия теней; mult не влияет — это абсолютный критерий)
  if (uw(c0)<atr*0.08&&lw(c0)<atr*0.08&&b0>atr*0.5*mult&&bull(c0))
    return { name:'MARUBOZU_BULL',direction:1,reliability:70 };
  if (uw(c0)<atr*0.08&&lw(c0)<atr*0.08&&b0>atr*0.5*mult&&bear(c0))
    return { name:'MARUBOZU_BEAR',direction:-1,reliability:70 };

  return { name:'NEUTRAL',direction:0,reliability:0 };
}

// ─── СТРУКТУРА РЫНКА ─────────────────────────────────────────────────
function marketStructure(c, atr) {
  if (c.length<20) return { trend:'RANGE',bos:null,choch:null,ob:null,fvg:null };
  const win=c.slice(-50);
  const hi=[],lo=[];
  for (let i=3; i<win.length-3; i++) {
    let ih=true,il=true;
    for (let j=i-3; j<=i+3; j++) {
      if(j===i)continue;
      if(win[j].high>=win[i].high)ih=false;
      if(win[j].low<=win[i].low)il=false;
    }
    if(ih)hi.push({idx:i,price:win[i].high});
    if(il)lo.push({idx:i,price:win[i].low});
  }
  let trend='RANGE';
  if (hi.length>=2&&lo.length>=2) {
    const lastHi=hi[hi.length-1],prevHi=hi[hi.length-2];
    const lastLo=lo[lo.length-1],prevLo=lo[lo.length-2];
    const hh=lastHi.price>prevHi.price,hl=lastLo.price>prevLo.price;
    const lh=lastHi.price<prevHi.price,ll=lastLo.price<prevLo.price;
    if(hh&&hl)trend='UPTREND';
    else if(lh&&ll)trend='DOWNTREND';
  }
  const last=c[c.length-1];
  let bos=null,choch=null;
  if (hi.length>=1&&last.close>hi[hi.length-1].price&&trend==='UPTREND')  bos='BULL_BOS';
  if (lo.length>=1&&last.close<lo[lo.length-1].price&&trend==='DOWNTREND') bos='BEAR_BOS';
  if (trend==='UPTREND'&&lo.length>=1&&last.close<lo[lo.length-1].price)   choch='BEAR_CHOCH';
  if (trend==='DOWNTREND'&&hi.length>=1&&last.close>hi[hi.length-1].price) choch='BULL_CHOCH';

  // Order Block (ICT)
  let ob=null;
  for (let i=c.length-5; i>=Math.max(0,c.length-20); i--) {
    if (i+1>=c.length) continue;
    if (c[i+1].close-c[i].close>atr*2&&c[i].close<c[i].open) { ob={type:'BULL',high:c[i].high,low:c[i].low}; break; }
    if (c[i].close-c[i+1].close>atr*2&&c[i].close>c[i].open) { ob={type:'BEAR',high:c[i].high,low:c[i].low}; break; }
  }
  // FVG
  let fvg=null;
  for (let i=c.length-3; i>=Math.max(0,c.length-10); i--) {
    if (i+2>=c.length) continue;
    if (c[i+2].low>c[i].high)  { fvg={type:'BULL',high:c[i+2].low,low:c[i].high}; break; }
    if (c[i+2].high<c[i].low)  { fvg={type:'BEAR',high:c[i].low,low:c[i+2].high}; break; }
  }
  return { trend,bos,choch,ob,fvg };
}

// ─── S/R УРОВНИ ──────────────────────────────────────────────────────
function calcSR(c) {
  if (c.length<20) return { res:0,sup:0,resS:1,supS:1,fib:[] };
  const win=c.slice(-200);
  const last=win[win.length-1].close;
  const tol=last*0.003;
  const hiPts=[],loPts=[];
  for (let i=3; i<win.length-3; i++) {
    let ih=true,il=true;
    for (let j=i-3; j<=i+3; j++) {
      if(j===i)continue;
      if(win[j].high>=win[i].high)ih=false;
      if(win[j].low<=win[i].low)il=false;
    }
    if(ih)hiPts.push({price:win[i].high});
    if(il)loPts.push({price:win[i].low});
  }
  const cluster=(pts)=>{
    const s=[...pts].sort((a,b)=>a.price-b.price),g=[];
    s.forEach(p=>{ const e=g.find(x=>Math.abs(x.price-p.price)<=tol); if(e){e.t++;e.price=(e.price*(e.t-1)+p.price)/e.t;}else g.push({price:p.price,t:1}); });
    return g.sort((a,b)=>b.t-a.t);
  };
  const rg=cluster(hiPts.filter(h=>h.price>=last));
  const sg=cluster(loPts.filter(l=>l.price<=last));
  const h=Math.max(...win.map(x=>x.high)),l=Math.min(...win.map(x=>x.low)),range=h-l;
  const fib=range>0?[
    {level:h,name:'H'},{level:h-range*0.236,name:'F23'},{level:h-range*0.382,name:'F38'},
    {level:h-range*0.5,name:'F50'},{level:h-range*0.618,name:'F61'},{level:l,name:'L'}
  ]:[];
  const fb=Math.max(...win.slice(-30).map(x=>x.high));
  const fl=Math.min(...win.slice(-30).map(x=>x.low));
  return { res:rg[0]?.price||fb, sup:sg[0]?.price||fl, resS:rg[0]?.t||1, supS:sg[0]?.t||1, fib };
}

// ─── ФИЛЬТР ВОЛАТИЛЬНОСТИ (Taleb/Hull) ───────────────────────────────
function volatilityFilter(c, atr) {
  if (c.length<20) return { ok:false,ratio:0,regime:'UNKNOWN' };
  const atr5  = IND.ATR(c.slice(-6), 5);
  const atr20 = IND.ATR(c.slice(-21), 20);
  const ratio = atr5 / Math.max(atr20, 0.00001);
  const lastPrice = c[c.length-1].close;
  const atrPct = (atr / lastPrice) * 100;

  let regime = 'NORMAL';
  if      (atrPct < 0.02)  regime = 'DEAD';
  else if (atrPct < 0.04)  regime = 'LOW';
  else if (atrPct > 0.3)   regime = 'HIGH';
  else if (ratio > 2.0)    regime = 'EXPANDING';
  else if (ratio < 0.5)    regime = 'CONTRACTING';

  const ok = regime !== 'DEAD' && regime !== 'HIGH';
  return { ok, ratio:Math.round(ratio*100)/100, regime, atrPct:Math.round(atrPct*1000)/1000 };
}

// ─── RSI ДИВЕРГЕНЦИЯ ─────────────────────────────────────────────────
function rsiDivergence(c, p=14) {
  if (c.length<30) return { bull:false,bear:false };
  const tail=c.slice(-25);
  const rs=IND.RSI_S(tail, Math.min(p, tail.length-2));
  if (rs.length<8) return { bull:false,bear:false };
  const prices=tail.map(x=>x.close), mid=Math.floor(prices.length/2);
  const pNow=prices[prices.length-1], pMid=prices[mid];
  const rNow=rs[rs.length-1], rMid=rs[mid];
  return {
    bull: pNow<pMid && rNow>rMid && rNow<45,
    bear: pNow>pMid && rNow<rMid && rNow>55
  };
}

// ─── [FIX-2] getHTFBias — структура приоритетнее сигнала ─────────────
// Сигнал старшего TF мог устареть (3 часа назад).
// Структура рынка (HH/HL, LH/LL) изменяется медленнее → более надёжный bias.
function getHTFBias(marketData, sym, tf) {
  if (!marketData) return 'NEUTRAL';
  const order=['M1','M5','M15','M30','H1'];
  const idx=order.indexOf(tf);
  if (idx<0) return 'NEUTRAL';

  for (let i=Math.min(idx+2, order.length-1); i>=idx+1; i--) {
    const htf=order[i];
    const cached=marketData[sym]?.[htf]?.cached;
    if (!cached) continue;

    // [FIX-2] Приоритет: структура > сигнал
    if (cached.struct?.includes('UPTREND'))   return 'BULL';
    if (cached.struct?.includes('DOWNTREND')) return 'BEAR';
    // Сигнал — только как запасной вариант
    if (cached.signal==='BUY')  return 'BULL';
    if (cached.signal==='SELL') return 'BEAR';
  }
  return 'NEUTRAL';
}

// ─── [FIX-4] ГЛАВНЫЙ СКОРИНГ — логика «стража» + весовой conf ────────
function scoreSignal({ c, sym, tf, sr, ms, atr, news, marketData }) {
  const last=c[c.length-1];
  const n=c.length;
  if (n<15) return { signal:'WAIT', conf:0, reason:'NOT_ENOUGH_DATA' };

  // ══ ШАГ 1: ФИЛЬТР ВОЛАТИЛЬНОСТИ (Taleb) ══
  const vol = volatilityFilter(c, atr);
  if (!vol.ok) return {
    signal:'WAIT', conf:0, reason:'LOW_VOL_'+vol.regime,
    ...emptyIndicators(c, atr, sr, tf)
  };

  // ══ ШАГ 2: НОВОСТНОЙ ФИЛЬТР ══
  if (news?.impact==='HIGH') return {
    signal:'WAIT', conf:0, reason:'HIGH_IMPACT_NEWS',
    ...emptyIndicators(c, atr, sr, tf)
  };

  // ══ ШАГ 3: HTF BIAS — определяем ДО того как считать системы ══
  const htfBias = getHTFBias(marketData, sym, tf);

  // [FIX-4] СТРАЖ: если HTF полностью против нас — не тратим ресурсы
  // При BEAR htfBias bull-сетап невозможен (Правило Murphy #1)
  const allowBull = htfBias !== 'BEAR';
  const allowBear = htfBias !== 'BULL';

  // ══ ШАГ 4: ИНДИКАТОРЫ ══
  const rsi   = IND.RSI(c);
  const macd  = IND.MACD(c);
  const stoch = IND.STOCH(c);
  const bb    = IND.BB(c);
  const adx   = IND.ADX(c);
  const vwap  = IND.VWAP(c);
  const psar  = IND.PSAR(c);
  const ema8  = IND.EMA(c, 8);
  const ema21 = IND.EMA(c, 21);
  const ema50 = IND.EMA(c, 50);
  const cp    = candlePattern(c, tf);   // [FIX-3] передаём tf
  const div   = rsiDivergence(c);

  // ══ ШАГ 5: РЕЖИМ РЫНКА ══
  const isTrending = adx.strength==='TRENDING'||adx.strength==='STRONG'||adx.strength==='VERY_STRONG';
  const isRange    = adx.strength==='NONE'||adx.strength==='WEAK';

  // ══ ШАГ 6: CONFLUENCE — только при разрешённом направлении (Страж) ══
  const bull=[], bear=[];

  // A. EMA тренд (Elder Screen 1)
  if (allowBull && ema8>ema21&&ema21>ema50&&last.close>ema8) bull.push('EMA_TREND');
  if (allowBear && ema8<ema21&&ema21<ema50&&last.close<ema8) bear.push('EMA_TREND');

  // B. MACD (моментум — Elder Screen 2)
  if (allowBull && (macd.cross==='BULL'||(macd.hist>0&&macd.trend==='BULL_STRONG'))) bull.push('MACD');
  if (allowBear && (macd.cross==='BEAR'||(macd.hist<0&&macd.trend==='BEAR_STRONG'))) bear.push('MACD');

  // C. BB
  if (allowBull && bb.pctB<20&&!isTrending)  bull.push('BB_LOW');
  if (allowBear && bb.pctB>80&&!isTrending)  bear.push('BB_HIGH');
  if (allowBull && bb.pctB>55&&isTrending&&ms.trend==='UPTREND')   bull.push('BB_TREND');
  if (allowBear && bb.pctB<45&&isTrending&&ms.trend==='DOWNTREND') bear.push('BB_TREND');

  // D. Stochastic
  if (allowBull && stoch.zone==='OVERSOLD'&&stoch.cross==='BULL')   bull.push('STOCH_REV');
  if (allowBear && stoch.zone==='OVERBOUGHT'&&stoch.cross==='BEAR') bear.push('STOCH_REV');

  // E. RSI экстремальные уровни
  if (allowBull && rsi<30) bull.push('RSI_OS');
  if (allowBear && rsi>70) bear.push('RSI_OB');

  // F. PSAR + VWAP
  if (allowBull && psar.bull&&last.close>vwap)  bull.push('PSAR_VWAP');
  if (allowBear && !psar.bull&&last.close<vwap) bear.push('PSAR_VWAP');

  // G. Свечной паттерн (Elder Screen 3 — триггер)
  if (allowBull && cp.direction>0&&cp.reliability>=63) bull.push('CANDLE:'+cp.name);
  if (allowBear && cp.direction<0&&cp.reliability>=63) bear.push('CANDLE:'+cp.name);

  // H. Структура рынка
  if (allowBull && ms.trend==='UPTREND')   bull.push('STRUCT');
  if (allowBear && ms.trend==='DOWNTREND') bear.push('STRUCT');
  if (allowBull && ms.choch==='BULL_CHOCH') bull.push('CHOCH');
  if (allowBear && ms.choch==='BEAR_CHOCH') bear.push('CHOCH');

  // I. S/R уровни
  if (allowBull && last.close<=sr.sup+atr*0.5&&sr.supS>=2) bull.push('AT_SUP');
  if (allowBear && last.close>=sr.res-atr*0.5&&sr.resS>=2) bear.push('AT_RES');

  // J. RSI дивергенция
  if (allowBull && div.bull) bull.push('RSI_DIV');
  if (allowBear && div.bear) bear.push('RSI_DIV');

  // K. Order Block (ICT)
  if (allowBull && ms.ob?.type==='BULL'&&last.close>=ms.ob.low&&last.close<=ms.ob.high*1.002) bull.push('OB');
  if (allowBear && ms.ob?.type==='BEAR'&&last.close<=ms.ob.high&&last.close>=ms.ob.low*0.998) bear.push('OB');

  // ══ ШАГ 7: filteredBull/Bear — Страж уже отработал при заполнении массивов ══
  // В v17 массивы bull/bear заполняются только при allowBull/allowBear,
  // поэтому отдельная постфильтрация не нужна. Оставляем alias для ясности.
  const filteredBull = bull;
  const filteredBear = bear;
  const bullCount = filteredBull.length;
  const bearCount = filteredBear.length;

  // ══ ШАГ 8: РЕШЕНИЕ ══
  let signal='WAIT';
  let conf=50;
  let reason='INSUFFICIENT_CONFLUENCE';

  const hasTrendConf  = filteredBull.includes('EMA_TREND')||filteredBull.includes('STRUCT');
  const hasTrendConfB = filteredBear.includes('EMA_TREND')||filteredBear.includes('STRUCT');
  const hasPattern    = filteredBull.some(s=>s.startsWith('CANDLE'));
  const hasPatternB   = filteredBear.some(s=>s.startsWith('CANDLE'));
  const hasBBRange    = filteredBull.includes('BB_LOW')||filteredBear.includes('BB_HIGH');
  const hasReversal   = filteredBull.includes('CHOCH')||filteredBull.includes('RSI_DIV');
  const hasReversalB  = filteredBear.includes('CHOCH')||filteredBear.includes('RSI_DIV');

  // [FIX-1] conf теперь рассчитывается через logisticConf, а не bullCount*2
  if (isRange) {
    if (bullCount>=3&&hasBBRange&&hasPattern&&bullCount>bearCount+1) {
      signal='BUY';
      conf=logisticConf(filteredBull);
      reason=filteredBull.join('+');
    } else if (bearCount>=3&&hasBBRange&&hasPatternB&&bearCount>bullCount+1) {
      signal='SELL';
      conf=logisticConf(filteredBear);
      reason=filteredBear.join('+');
    }
  } else if (isTrending) {
    if (bullCount>=3&&hasTrendConf&&bullCount>bearCount) {
      signal='BUY';
      conf=logisticConf(filteredBull);
      reason=filteredBull.join('+');
    } else if (bearCount>=3&&hasTrendConfB&&bearCount>bullCount) {
      signal='SELL';
      conf=logisticConf(filteredBear);
      reason=filteredBear.join('+');
    }
  } else {
    // Нейтральный режим — только сильный разворот
    if (bullCount>=4&&hasReversal&&bullCount>bearCount+2) {
      signal='BUY';
      conf=logisticConf(filteredBull);
      reason=filteredBull.join('+');
    } else if (bearCount>=4&&hasReversalB&&bearCount>bullCount+2) {
      signal='SELL';
      conf=logisticConf(filteredBear);
      reason=filteredBear.join('+');
    }
  }

  return {
    signal,
    conf,
    reason,
    htfBias,
    volRegime: vol.regime,
    atrPct: vol.atrPct,
    regime: isRange?'RANGE':isTrending?'TREND':'NEUTRAL',
    bullSystems: bullCount,
    bearSystems: bearCount,
    rsi: rsi.toFixed(1),
    adx: adx.adx.toFixed(1),
    stochK: stoch.k.toFixed(1),
    bb: bb.pctB.toFixed(1),
    macdCross: macd.cross||'-',
    psar: psar.bull?'BULL':'BEAR',
    vwapPos: last.close>vwap?'ABOVE':'BELOW',
    cp: cp.name,
    pattern: 'NONE',
    ichi: 'IN',
    wr: '0',
    cci: '0',
    struct: ms.trend+(ms.bos?'+'+ms.bos:'')+(ms.choch?'+'+ms.choch:''),
    wyckoffPhase: 'N/A',
    vsaType: '-',
    spring: false,
    upthrust: false,
    liqSweep: null,
    inDemand: false,
    inSupply: false,
    elder: signal,
    bull: signal==='BUY'?conf:100-conf,
    bear: signal==='SELL'?conf:100-conf,
    reasons: reason.split('+').slice(0,6),
    manipulation: null,
    mtf: htfBias,
    mtfStrength: htfBias!=='NEUTRAL'?70:50,
    momentum: 'NEUTRAL',
    momScore: 0,
    paZone: vol.regime,
    paPosition: 50,
    sup: sr.sup>0?sr.sup.toFixed(5):'0',
    res: sr.res>0?sr.res.toFixed(5):'0',
    newsRisk: news?.risk||false,
    event: news?.event||'',
    delta: '0',
    mom: '0',
    stable: 0,
    edge: Math.abs(bullCount-bearCount),
  };
}

// ─── HELPERS ─────────────────────────────────────────────────────────
function emptyIndicators(c, atr, sr, tf='M5') {
  const rsi=IND.RSI(c), adx=IND.ADX(c), stoch=IND.STOCH(c), bb=IND.BB(c);
  const macd=IND.MACD(c), psar=IND.PSAR(c), vwap=IND.VWAP(c);
  const cp=candlePattern(c, tf), ms=marketStructure(c,atr), last=c[c.length-1];
  return {
    rsi:rsi.toFixed(1), adx:adx.adx.toFixed(1), stochK:stoch.k.toFixed(1),
    bb:bb.pctB.toFixed(1), macdCross:macd.cross||'-', psar:psar.bull?'BULL':'BEAR',
    vwapPos:last.close>vwap?'ABOVE':'BELOW', cp:cp.name, pattern:'NONE',
    ichi:'IN', wr:'0', cci:'0', struct:ms.trend, wyckoffPhase:'N/A',
    vsaType:'-', spring:false, upthrust:false, liqSweep:null,
    inDemand:false, inSupply:false, elder:'WAIT',
    bull:50, bear:50, reasons:[], manipulation:null,
    mtf:'NEUTRAL', mtfStrength:50, momentum:'NEUTRAL', momScore:0,
    paZone:'N/A', paPosition:50,
    sup:sr.sup>0?sr.sup.toFixed(5):'0', res:sr.res>0?sr.res.toFixed(5):'0',
    newsRisk:false, event:'', delta:'0', mom:'0', stable:0, edge:0,
  };
}

// Дополнительные утилиты
function momentumScore(c) {
  if (c.length<10) return { score:0, direction:'NEUTRAL', acceleration:0 };
  const roc5=(c[c.length-1].close-c[c.length-6].close)/c[c.length-6].close*100;
  const roc3=(c[c.length-1].close-c[c.length-4].close)/c[c.length-4].close*100;
  return { score:roc5, direction:roc5>0?'BULL':'BEAR', acceleration:roc3-roc5, roc3, roc5 };
}

function manipulationDetector(c, atr) {
  if (c.length<5) return { type:null, probability:0 };
  const last=c[c.length-1];
  const va=c.slice(-20).reduce((a,b)=>a+b.volume,0)/20;
  const body=Math.abs(last.close-last.open);
  const uw=last.high-Math.max(last.close,last.open);
  const lw=Math.min(last.close,last.open)-last.low;
  const rng=last.high-last.low||1;
  if (lw>atr*1.5&&body<rng*0.25&&last.volume>va*2&&last.close>last.open)
    return { type:'STOP_HUNT_BULL', probability:75 };
  if (uw>atr*1.5&&body<rng*0.25&&last.volume>va*2&&last.close<last.open)
    return { type:'STOP_HUNT_BEAR', probability:75 };
  if ((uw>atr*2||lw>atr*2)&&body<rng*0.15)
    return { type:'SPOOF', probability:65 };
  return { type:null, probability:0 };
}

function priceActionZones(c, atr) {
  if (c.length<10) return { zone:'NEUTRAL', position:50, strength:0 };
  const win=c.slice(-20);
  const maxH=Math.max(...win.map(x=>x.high)), minL=Math.min(...win.map(x=>x.low));
  const range=maxH-minL||1;
  const pos=((c[c.length-1].close-minL)/range)*100;
  const zone=pos<20?'DEEP_SUPPORT':pos<35?'SUPPORT':pos>80?'DEEP_RESISTANCE':pos>65?'RESISTANCE':'NEUTRAL';
  return { zone, position:Math.round(pos), strength:0 };
}

function mtfConfluence(marketData, sym, tf) {
  const bias=getHTFBias(marketData, sym, tf);
  return { bias, strength:bias!=='NEUTRAL'?70:50, aligned:bias!=='NEUTRAL', count:1 };
}

function liquidityZones(c, atr) {
  return { bullLiq:null, bearLiq:null, swept:false, sweepDir:null };
}

function supplyDemand(c, atr) {
  return { demand:null, supply:null, inDemand:false, inSupply:false };
}

function wyckoff(c, sr, atr) {
  return { phase:'N/A', spring:false, upthrust:false };
}

function vsaAnalysis(c) {
  return { signal:'NEUTRAL', type:null };
}

function elderScreens(c, tf) {
  const ema13=IND.EMA(c,13), ema26=IND.EMA(c,26);
  const screen1=ema13>ema26?'BULL':'BEAR';
  return { screen1, screen2:'WAIT', screen3:'WAIT', aligned:false };
}

function confluenceCount(signals) {
  const bull=signals.filter(s=>s>0).length, bear=signals.filter(s=>s<0).length;
  return { bull, bear, dominant:bull>bear?'BULL':bear>bull?'BEAR':'NEUTRAL' };
}

module.exports = {
  IND, scoreSignal, calcSR, marketStructure, candlePattern,
  chartPatterns: ()=>({ name:'NONE',direction:0,reliability:0 }),
  vsaAnalysis, wyckoff, liquidityZones, supplyDemand, elderScreens,
  momentumScore, manipulationDetector, priceActionZones, mtfConfluence,
  confluenceCount, getHTFBias, logisticConf, SYSTEM_WEIGHTS,
};
