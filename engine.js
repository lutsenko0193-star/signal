// ════════════════════════════════════════════════════════════════════
// SIGNAL ENGINE v15 — PROFESSIONAL ANALYSIS ENGINE
// Sources: Murphy, Nison, Wyckoff, Williams VSA, ICT Smart Money,
//          Bulkowski patterns, Elder 3-screens, Ichimoku, ADX Wilder
// ════════════════════════════════════════════════════════════════════

'use strict';

// ─── БАЗОВЫЕ ИНДИКАТОРЫ ─────────────────────────────────────────────
const IND = {

  // EMA с серией
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

  // SMA
  SMA(c, p) {
    if (c.length < p) return c[c.length-1]?.close || 0;
    return c.slice(-p).reduce((a,b) => a+b.close, 0) / p;
  },

  // ATR (Wilder)
  ATR(c, p=14) {
    if (c.length < 2) return 0.0001;
    const trs = [];
    for (let i=1; i<c.length; i++) {
      const h=c[i].high, l=c[i].low, pc=c[i-1].close;
      trs.push(Math.max(h-l, Math.abs(h-pc), Math.abs(l-pc)));
    }
    // Wilder smoothing
    let atr = trs.slice(0,p).reduce((a,b)=>a+b,0)/p;
    for (let i=p; i<trs.length; i++) atr = (atr*(p-1)+trs[i])/p;
    return atr > 0 ? atr : 0.0001;
  },

  // RSI (Wilder)
  RSI(c, p=14) {
    if (c.length < p+1) return 50;
    let ag=0, al=0;
    for (let i=1; i<=p; i++) {
      const d = c[i].close - c[i-1].close;
      if (d>0) ag+=d; else al-=d;
    }
    ag/=p; al/=p;
    for (let i=p+1; i<c.length; i++) {
      const d = c[i].close - c[i-1].close;
      ag = (ag*(p-1)+(d>0?d:0))/p;
      al = (al*(p-1)+(d<0?-d:0))/p;
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

  // MACD (12,26,9)
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
    const hist = m - si;
    // Тренд MACD: гистограмма растёт или падает
    const histPrev = ml[n-1] - ss[n-1];
    const trend = hist > 0 ? (hist > histPrev ? 'BULL_STRONG' : 'BULL_WEAK') :
                             (hist < histPrev ? 'BEAR_STRONG' : 'BEAR_WEAK');
    return { macd:m, signal:si, hist, cross, trend };
  },

  // Stochastic (14,3,3) — зоны 80/20
  STOCH(c, p=14) {
    if (c.length < p+3) return { k:50, d:50, zone:'NEUTRAL', cross:null };
    const raw = (bars) => {
      const hi=Math.max(...bars.map(x=>x.high)), lo=Math.min(...bars.map(x=>x.low));
      const cl=bars[bars.length-1].close;
      return hi===lo ? 50 : ((cl-lo)/(hi-lo))*100;
    };
    // %K = 3-period smoothed raw stoch
    const ks=[];
    for (let j=0; j<3; j++) {
      const sl=c.slice(-(p+2-j), c.length-j||undefined);
      if (sl.length>=p) ks.push(raw(sl.slice(-p)));
    }
    const k = ks.length ? ks.reduce((a,b)=>a+b,0)/ks.length : 50;
    const kArr=[];
    for (let j=0; j<3; j++) {
      const sl=c.slice(-(p+4-j), c.length-j||undefined);
      if (sl.length>=p) kArr.push(raw(sl.slice(-p)));
    }
    const d = kArr.length ? kArr.reduce((a,b)=>a+b,0)/kArr.length : 50;
    const zone = k<20 ? 'OVERSOLD' : k>80 ? 'OVERBOUGHT' : 'NEUTRAL';
    let cross=null;
    // Проверяем кросс %K/%D
    if (ks.length>=2 && kArr.length>=2) {
      const kp=ks[0], dp=kArr[0];
      if (kp<dp && k>d) cross='BULL';
      if (kp>dp && k<d) cross='BEAR';
    }
    return { k:Math.max(0,Math.min(100,k)), d:Math.max(0,Math.min(100,d)), zone, cross };
  },

  // Bollinger Bands
  BB(c, p=20, m=2) {
    if (c.length<p) return { upper:0,mid:0,lower:0,pctB:50,bw:0,squeeze:false };
    const sl=c.slice(-p).map(x=>x.close);
    const mean=sl.reduce((a,b)=>a+b,0)/p;
    const sd=Math.sqrt(sl.reduce((a,b)=>a+(b-mean)**2,0)/p);
    const upper=mean+m*sd, lower=mean-m*sd;
    const last=sl[sl.length-1];
    const pctB=(upper-lower)>0?((last-lower)/(upper-lower))*100:50;
    const bw=(upper-lower)/mean; // Bandwidth
    const squeeze=bw<0.02; // Tight squeeze
    return { upper, mid:mean, lower, pctB:Math.max(0,Math.min(100,pctB)), bw, squeeze };
  },

  // ADX (Wilder) — правильная реализация
  ADX(c, p=14) {
    if (c.length < p*2+1) return { adx:0, pdi:0, mdi:0, trend:'NONE', strength:'NONE' };
    const tr_arr=[], pdm_arr=[], mdm_arr=[];
    for (let i=1; i<c.length; i++) {
      const h=c[i].high, l=c[i].low, pc=c[i-1].close;
      const ph=c[i-1].high, pl=c[i-1].low;
      tr_arr.push(Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc)));
      const up=h-ph, dn=pl-l;
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
    if (dxs.length<p) return { adx:0, pdi:0, mdi:0, trend:'NONE', strength:'NONE' };
    let adx=dxs.slice(0,p).reduce((a,b)=>a+b,0)/p;
    for (let i=p; i<dxs.length; i++) adx=(adx*(p-1)+dxs[i])/p;
    const pdi=atr>0?(apdm/atr)*100:0, mdi=atr>0?(amdm/atr)*100:0;
    adx=Math.min(100,Math.round(adx*100)/100);
    const trend=pdi>mdi?'BULL':'BEAR';
    const strength=adx>50?'VERY_STRONG':adx>40?'STRONG':adx>25?'TRENDING':adx>20?'WEAK':'NONE';
    return { adx, pdi:Math.round(pdi*100)/100, mdi:Math.round(mdi*100)/100, trend, strength };
  },

  // Ichimoku (7/30/52) — параметры для быстрых таймфреймов
  ICHIMOKU(c) {
    if (c.length<52) return { above:null,below:null,tenkan:0,kijun:0,spanA:0,spanB:0,tkCross:null,signal:'NEUTRAL' };
    const H=(arr)=>Math.max(...arr.map(x=>x.high));
    const L=(arr)=>Math.min(...arr.map(x=>x.low));
    const tenkan=(H(c.slice(-7))+L(c.slice(-7)))/2;
    const kijun=(H(c.slice(-30))+L(c.slice(-30)))/2;
    const spanA=(tenkan+kijun)/2;
    const spanB=(H(c.slice(-52))+L(c.slice(-52)))/2;
    const tenkanP=c.length>8?(H(c.slice(-8,-1))+L(c.slice(-8,-1)))/2:tenkan;
    const kijunP=c.length>31?(H(c.slice(-31,-1))+L(c.slice(-31,-1)))/2:kijun;
    let tkCross=null;
    if (tenkanP<kijunP && tenkan>kijun) tkCross='BULL';
    if (tenkanP>kijunP && tenkan<kijun) tkCross='BEAR';
    const last=c[c.length-1].close;
    const above=last>Math.max(spanA,spanB);
    const below=last<Math.min(spanA,spanB);
    // Сигнал: цена выше/ниже облака + Tenkan/Kijun
    let signal='NEUTRAL';
    if (above && tenkan>kijun) signal='BULL';
    if (below && tenkan<kijun) signal='BEAR';
    if (above && tenkan<kijun) signal='BULL_WEAK';
    if (below && tenkan>kijun) signal='BEAR_WEAK';
    return { above, below, tenkan, kijun, spanA, spanB, tkCross, signal };
  },

  // CCI
  CCI(c, p=14) {
    if (c.length<p) return 0;
    const tp=c.slice(-p).map(x=>(x.high+x.low+x.close)/3);
    const sma=tp.reduce((a,b)=>a+b,0)/tp.length;
    const mad=tp.reduce((a,b)=>a+Math.abs(b-sma),0)/tp.length;
    return mad===0?0:(tp[tp.length-1]-sma)/(0.015*mad);
  },

  // Williams %R
  WR(c, p=14) {
    if (c.length<p) return -50;
    const sl=c.slice(-p);
    const hi=Math.max(...sl.map(x=>x.high)), lo=Math.min(...sl.map(x=>x.low));
    return hi===lo?-50:((hi-c[c.length-1].close)/(hi-lo))*-100;
  },

  // VWAP (30-period)
  VWAP(c) {
    const sl=c.slice(-30);
    let pv=0,vv=0;
    sl.forEach(x=>{ const tp=(x.high+x.low+x.close)/3; pv+=tp*x.volume; vv+=x.volume; });
    return vv>0?pv/vv:(sl[sl.length-1]?.close||0);
  },

  // OBV slope
  OBV(c, lb=14) {
    if (c.length<lb+1) return { slope:0, trend:'NEUTRAL' };
    const va=c.slice(-20).reduce((a,b)=>a+b.volume,0)/20;
    let obv=0; const s=[];
    for (let i=1; i<c.length; i++) {
      let vol=c[i].volume; if(vol>va*3)vol=va*1.5;
      if(c[i].close>c[i-1].close)obv+=vol; else if(c[i].close<c[i-1].close)obv-=vol;
      s.push(obv);
    }
    const t=s.slice(-lb), f=t[0]||1;
    const slope=((t[t.length-1]-t[0])/Math.max(1,Math.abs(f)))*100;
    return { slope, trend: slope>5?'BULL':slope<-5?'BEAR':'NEUTRAL' };
  },

  // Parabolic SAR
  PSAR(c, step=0.02, max=0.2) {
    if (c.length<5) return { sar:0, bull:true };
    let bull=true, af=step, ep=c[0].low, sar=c[0].high;
    for (let i=1; i<c.length; i++) {
      sar=sar+af*(ep-sar);
      if (bull) {
        if (c[i].low<sar) { bull=false; sar=ep; ep=c[i].low; af=step; }
        else { if(c[i].high>ep){ ep=c[i].high; af=Math.min(af+step,max); } }
      } else {
        if (c[i].high>sar) { bull=true; sar=ep; ep=c[i].high; af=step; }
        else { if(c[i].low<ep){ ep=c[i].low; af=Math.min(af+step,max); } }
      }
    }
    return { sar, bull };
  },

  // RSI дивергенция
  RSI_DIV(c, p=14) {
    if (c.length<30) return { bull:false, bear:false, type:null };
    const tail=c.slice(-25);
    const rs=this.RSI_S(tail, Math.min(p, tail.length-2));
    if (rs.length<8) return { bull:false, bear:false, type:null };
    const prices=tail.map(x=>x.close), mid=Math.floor(prices.length/2);
    const pNow=prices[prices.length-1], pMid=prices[mid];
    const rNow=rs[rs.length-1], rMid=rs[mid];
    const bull=pNow<pMid && rNow>rMid && rNow<45;
    const bear=pNow>pMid && rNow<rMid && rNow>55;
    return { bull, bear, type: bull?'BULL_DIV':bear?'BEAR_DIV':null };
  },

  // SMA уровни 20/50/200
  SMA_LEVELS(c) {
    const sma20=c.length>=20?c.slice(-20).reduce((a,b)=>a+b.close,0)/20:null;
    const sma50=c.length>=50?c.slice(-50).reduce((a,b)=>a+b.close,0)/50:null;
    const sma200=c.length>=200?c.slice(-200).reduce((a,b)=>a+b.close,0)/200:null;
    const last=c[c.length-1].close;
    let smaCross=null;
    if (sma50&&sma200&&c.length>=201) {
      const p50=c.slice(-51,-1).reduce((a,b)=>a+b.close,0)/50;
      const p200=c.slice(-201,-1).reduce((a,b)=>a+b.close,0)/200;
      if (p50<p200&&sma50>sma200) smaCross='GOLDEN';
      if (p50>p200&&sma50<sma200) smaCross='DEATH';
    }
    return { sma20, sma50, sma200,
      above20:sma20?last>sma20:null,
      above50:sma50?last>sma50:null,
      above200:sma200?last>sma200:null,
      smaCross };
  },
};

// ─── СВЕЧНЫЕ ПАТТЕРНЫ ────────────────────────────────────────────────
function candlePattern(c) {
  if (c.length<5) return { name:'NEUTRAL', direction:0, reliability:0 };
  const [c4,c3,c2,c1,c0]=c.slice(-5);
  const atr=IND.ATR(c.slice(-15),10);
  if (atr<=0) return { name:'NEUTRAL', direction:0, reliability:0 };

  const body=(x)=>Math.abs(x.close-x.open);
  const uw=(x)=>x.high-Math.max(x.close,x.open);
  const lw=(x)=>Math.min(x.close,x.open)-x.low;
  const rng=(x)=>x.high-x.low;
  const bull=(x)=>x.close>x.open;
  const bear=(x)=>x.close<x.open;

  const b0=body(c0), b1=body(c1), b2=body(c2);

  // ── Reversal patterns (Булковски) ──
  // Pin Bar (Hammer/Shooting Star) — высокая надёжность ~65%
  if (lw(c0)>b0*2.5 && lw(c0)>atr*0.5 && uw(c0)<b0*0.4 && bull(c0))
    return { name:'PIN_BULL', direction:1, reliability:65 };
  if (uw(c0)>b0*2.5 && uw(c0)>atr*0.5 && lw(c0)<b0*0.4 && bear(c0))
    return { name:'PIN_BEAR', direction:-1, reliability:65 };

  // Engulfing — надёжность ~63%
  if (bear(c1)&&bull(c0)&&c0.open<=c1.close&&c0.close>=c1.open&&b0>b1*1.0)
    return { name:'ENG_BULL', direction:1, reliability:63 };
  if (bull(c1)&&bear(c0)&&c0.open>=c1.close&&c0.close<=c1.open&&b0>b1*1.0)
    return { name:'ENG_BEAR', direction:-1, reliability:63 };

  // Morning/Evening Star — надёжность ~72%
  if (bear(c2)&&b1<atr*0.3&&bull(c0)&&c0.close>(c2.open+c2.close)/2)
    return { name:'MORNING_STAR', direction:1, reliability:72 };
  if (bull(c2)&&b1<atr*0.3&&bear(c0)&&c0.close<(c2.open+c2.close)/2)
    return { name:'EVENING_STAR', direction:-1, reliability:72 };

  // Three White Soldiers / Three Black Crows — надёжность ~78%
  if (bull(c2)&&bull(c1)&&bull(c0)&&c1.close>c2.close&&c0.close>c1.close&&
      b0>atr*0.4&&b1>atr*0.4&&b2>atr*0.4)
    return { name:'THREE_WHITE', direction:1, reliability:78 };
  if (bear(c2)&&bear(c1)&&bear(c0)&&c1.close<c2.close&&c0.close<c1.close&&
      b0>atr*0.4&&b1>atr*0.4&&b2>atr*0.4)
    return { name:'THREE_BLACK', direction:-1, reliability:78 };

  // Doji — нейтральный, но важен в контексте
  if (b0<rng(c0)*0.1&&rng(c0)>atr*0.3)
    return { name:'DOJI', direction:0, reliability:55 };

  // Marubozu — сильное движение
  if (uw(c0)<atr*0.08&&lw(c0)<atr*0.08&&b0>atr*0.6&&bull(c0))
    return { name:'MARUBOZU_BULL', direction:1, reliability:70 };
  if (uw(c0)<atr*0.08&&lw(c0)<atr*0.08&&b0>atr*0.6&&bear(c0))
    return { name:'MARUBOZU_BEAR', direction:-1, reliability:70 };

  // Harami — разворот внутри предыдущей свечи
  if (c0.high<c1.high&&c0.low>c1.low&&b0<b1*0.5&&b1>atr*0.4&&bull(c0)&&bear(c1))
    return { name:'HARAMI_BULL', direction:1, reliability:54 };
  if (c0.high<c1.high&&c0.low>c1.low&&b0<b1*0.5&&b1>atr*0.4&&bear(c0)&&bull(c1))
    return { name:'HARAMI_BEAR', direction:-1, reliability:54 };

  // Tweezer Top/Bottom
  if (Math.abs(c1.high-c0.high)<atr*0.1&&bull(c1)&&bear(c0)&&b0>atr*0.3&&b1>atr*0.3)
    return { name:'TWEEZER_TOP', direction:-1, reliability:60 };
  if (Math.abs(c1.low-c0.low)<atr*0.1&&bear(c1)&&bull(c0)&&b0>atr*0.3&&b1>atr*0.3)
    return { name:'TWEEZER_BOT', direction:1, reliability:60 };

  return { name:'NEUTRAL', direction:0, reliability:0 };
}

// ─── СТРУКТУРА РЫНКА (Smart Money / ICT) ────────────────────────────
function marketStructure(c, atr) {
  if (c.length<20) return { trend:'RANGE', bos:null, choch:null, ob:null, fvg:null };

  // Swing highs/lows
  const swings = (arr, left=3, right=3) => {
    const hi=[], lo=[];
    for (let i=left; i<arr.length-right; i++) {
      let ih=true, il=true;
      for (let j=i-left; j<=i+right; j++) {
        if(j===i)continue;
        if(arr[j].high>=arr[i].high)ih=false;
        if(arr[j].low<=arr[i].low)il=false;
      }
      if(ih)hi.push({idx:i,price:arr[i].high,ts:arr[i].timestamp});
      if(il)lo.push({idx:i,price:arr[i].low,ts:arr[i].timestamp});
    }
    return {hi,lo};
  };

  const win=c.slice(-50);
  const {hi,lo}=swings(win);

  // Определяем тренд по структуре (HH/HL vs LH/LL)
  let trend='RANGE';
  if (hi.length>=2 && lo.length>=2) {
    const lastHi=hi[hi.length-1], prevHi=hi[hi.length-2];
    const lastLo=lo[lo.length-1], prevLo=lo[lo.length-2];
    const hh=lastHi.price>prevHi.price, hl=lastLo.price>prevLo.price;
    const lh=lastHi.price<prevHi.price, ll=lastLo.price<prevLo.price;
    if (hh&&hl) trend='UPTREND';
    else if (lh&&ll) trend='DOWNTREND';
  }

  // Break of Structure (BOS) — подтверждение тренда
  let bos=null;
  const last=c[c.length-1];
  if (hi.length>=1) {
    const lastSwHi=hi[hi.length-1].price;
    if (last.close>lastSwHi && trend==='UPTREND') bos='BULL_BOS';
  }
  if (lo.length>=1) {
    const lastSwLo=lo[lo.length-1].price;
    if (last.close<lastSwLo && trend==='DOWNTREND') bos='BEAR_BOS';
  }

  // Change of Character (CHoCH) — смена тренда
  let choch=null;
  if (trend==='UPTREND' && lo.length>=1) {
    const lastSwLo=lo[lo.length-1].price;
    if (last.close<lastSwLo) choch='BEAR_CHOCH';
  }
  if (trend==='DOWNTREND' && hi.length>=1) {
    const lastSwHi=hi[hi.length-1].price;
    if (last.close>lastSwHi) choch='BULL_CHOCH';
  }

  // Order Block — последняя свеча перед сильным движением
  let ob=null;
  if (c.length>=5) {
    // Bullish OB: медвежья свеча перед сильным бычьим импульсом
    for (let i=c.length-5; i>=Math.max(0,c.length-20); i--) {
      const move=c[i+1].close-c[i].close;
      if (move>atr*2 && c[i].close<c[i].open) {
        ob={ type:'BULL', high:c[i].high, low:c[i].low, idx:i };
        break;
      }
    }
    // Bearish OB: бычья свеча перед сильным медвежьим импульсом
    if (!ob) {
      for (let i=c.length-5; i>=Math.max(0,c.length-20); i--) {
        const move=c[i].close-c[i+1].close;
        if (move>atr*2 && c[i].close>c[i].open) {
          ob={ type:'BEAR', high:c[i].high, low:c[i].low, idx:i };
          break;
        }
      }
    }
  }

  // Fair Value Gap (FVG) — разрыв между свечами
  let fvg=null;
  if (c.length>=3) {
    for (let i=c.length-3; i>=Math.max(0,c.length-10); i--) {
      // Bullish FVG: low[i+2] > high[i]
      if (c[i+2].low>c[i].high) {
        fvg={ type:'BULL', high:c[i+2].low, low:c[i].high };
        break;
      }
      // Bearish FVG: high[i+2] < low[i]
      if (c[i+2].high<c[i].low) {
        fvg={ type:'BEAR', high:c[i].low, low:c[i+2].high };
        break;
      }
    }
  }

  return { trend, bos, choch, ob, fvg, swings:{hi,lo} };
}

// ─── SUPPLY & DEMAND ЗОНЫ ────────────────────────────────────────────
function supplyDemand(c, atr) {
  if (c.length<30) return { demand:null, supply:null, inDemand:false, inSupply:false };
  const last=c[c.length-1].close;
  let demand=null, supply=null;

  // Demand zone: консолидация → сильный бычий импульс
  for (let i=5; i<c.length-5; i++) {
    const base=c.slice(Math.max(0,i-3),i);
    const impulse=c.slice(i,Math.min(c.length,i+5));
    if (base.length<2||impulse.length<2) continue;
    const baseRange=Math.max(...base.map(x=>x.high))-Math.min(...base.map(x=>x.low));
    const impMove=impulse[impulse.length-1].close-impulse[0].open;
    if (baseRange<atr*1.5 && impMove>atr*3) {
      demand={ high:Math.max(...base.map(x=>x.high)), low:Math.min(...base.map(x=>x.low)), strength:Math.round(impMove/atr) };
    }
  }
  // Supply zone: консолидация → сильный медвежий импульс
  for (let i=5; i<c.length-5; i++) {
    const base=c.slice(Math.max(0,i-3),i);
    const impulse=c.slice(i,Math.min(c.length,i+5));
    if (base.length<2||impulse.length<2) continue;
    const baseRange=Math.max(...base.map(x=>x.high))-Math.min(...base.map(x=>x.low));
    const impMove=impulse[0].open-impulse[impulse.length-1].close;
    if (baseRange<atr*1.5 && impMove>atr*3) {
      supply={ high:Math.max(...base.map(x=>x.high)), low:Math.min(...base.map(x=>x.low)), strength:Math.round(impMove/atr) };
    }
  }

  const inDemand=demand ? last>=demand.low&&last<=demand.high*(1+atr/last) : false;
  const inSupply=supply ? last<=supply.high&&last>=supply.low*(1-atr/last) : false;
  return { demand, supply, inDemand, inSupply };
}

// ─── VSA (Volume Spread Analysis) ────────────────────────────────────
function vsaAnalysis(c) {
  if (c.length<20) return { signal:'NEUTRAL', type:null };
  const last=c[c.length-1], prev=c[c.length-2];
  const va=c.slice(-20).reduce((a,b)=>a+b.volume,0)/20;
  const sa=c.slice(-20).reduce((a,b)=>a+(b.high-b.low),0)/20;
  const spread=last.high-last.low;
  const isHV=last.volume>va*1.5, isLV=last.volume<va*0.7;
  const isWS=spread>sa*1.3, isNS=spread<sa*0.7;
  const isUp=last.close>last.open, isDown=last.close<last.open;
  const closePos=(last.close-last.low)/(last.high-last.low||1); // 0=low, 1=high

  // Stopping Volume: высокий объём + широкий спред вниз + закрытие выше середины
  if (isHV&&isWS&&isDown&&closePos>0.5) return { signal:'BULL', type:'STOPPING_VOL' };
  // Climax Buy: высокий объём + широкий спред вверх (истощение)
  if (isHV&&isWS&&isUp&&closePos>0.7&&c.length>5&&c[c.length-5].close<last.close*0.99)
    return { signal:'BEAR', type:'CLIMAX_BUY' };
  // No Supply: низкий объём + узкий спред при откате вниз
  if (isLV&&isNS&&isDown) return { signal:'BULL', type:'NO_SUPPLY' };
  // No Demand: низкий объём + узкий спред при откате вверх
  if (isLV&&isNS&&isUp) return { signal:'BEAR', type:'NO_DEMAND' };
  // Effort vs Result: высокий объём + узкий спред = сопротивление
  if (isHV&&isNS) return { signal:'NEUTRAL', type:'EFFORT_NO_RESULT' };
  return { signal:'NEUTRAL', type:null };
}

// ─── МЕТОД ВАЙКОФФА ─────────────────────────────────────────────────
function wyckoff(c, sr, atr) {
  if (c.length<30) return { phase:'UNKNOWN', spring:false, upthrust:false, creek:null };
  const last=c[c.length-1];

  // Spring: пробой поддержки + быстрый возврат (ловушка медведей)
  const spring=last.low<sr.sup-atr*0.3 && last.close>sr.sup &&
               (last.close-last.low)>(last.high-last.low)*0.6;

  // Upthrust: пробой сопротивления + быстрый возврат (ловушка быков)
  const upthrust=last.high>sr.res+atr*0.3 && last.close<sr.res &&
                 (last.high-last.close)>(last.high-last.low)*0.6;

  // Фаза Вайкоффа
  const win50=c.slice(-50);
  const range50=Math.max(...win50.map(x=>x.high))-Math.min(...win50.map(x=>x.low));
  const range10=Math.max(...c.slice(-10).map(x=>x.high))-Math.min(...c.slice(-10).map(x=>x.low));
  const vol50=win50.reduce((a,b)=>a+b.volume,0)/50;
  const vol10=c.slice(-10).reduce((a,b)=>a+b.volume,0)/10;
  const priceDir=c[c.length-1].close-c[c.length-10].close;

  let phase='UNKNOWN';
  if (range10<range50*0.25) {
    phase=vol10>vol50*1.2?'DISTRIBUTION':'ACCUMULATION';
  } else {
    phase=priceDir>0?'MARKUP':'MARKDOWN';
  }

  // Creek (линия сопротивления в накоплении)
  const creek=phase==='ACCUMULATION'?sr.res:null;

  return { phase, spring, upthrust, creek };
}

// ─── ЗОНЫ ЛИКВИДНОСТИ ───────────────────────────────────────────────
function liquidityZones(c, atr) {
  if (c.length<30) return { bullLiq:null, bearLiq:null, swept:false, sweepDir:null };
  const win=c.slice(-60);
  const hiArr=[], loArr=[];
  for (let i=3; i<win.length-3; i++) {
    let ih=true, il=true;
    for (let j=i-3; j<=i+3; j++) {
      if(j===i)continue;
      if(win[j].high>=win[i].high)ih=false;
      if(win[j].low<=win[i].low)il=false;
    }
    if(ih)hiArr.push(win[i].high);
    if(il)loArr.push(win[i].low);
  }
  const last=c[c.length-1];
  const bullLiq=hiArr.filter(h=>h>last.close).sort((a,b)=>a-b)[0]||null;
  const bearLiq=loArr.filter(l=>l<last.close).sort((a,b)=>b-a)[0]||null;

  // Свип ликвидности
  let swept=false, sweepDir=null;
  if (bullLiq && last.high>bullLiq && last.close<bullLiq) { swept=true; sweepDir='BEAR_SWEEP'; }
  if (bearLiq && last.low<bearLiq && last.close>bearLiq) { swept=true; sweepDir='BULL_SWEEP'; }

  return { bullLiq, bearLiq, swept, sweepDir };
}

// ─── ПАТТЕРНЫ ГРАФИКА (Булковски) ────────────────────────────────────
function chartPatterns(c, sr, atr) {
  if (c.length<30) return { name:'NONE', direction:0, reliability:0 };
  const tail=c.slice(-60);

  // Swing points
  const swHi=[], swLo=[];
  for (let i=3; i<tail.length-3; i++) {
    let ih=true,il=true;
    for (let j=i-3; j<=i+3; j++) {
      if(j===i)continue;
      if(tail[j].high>=tail[i].high)ih=false;
      if(tail[j].low<=tail[i].low)il=false;
    }
    if(ih)swHi.push({idx:i,price:tail[i].high});
    if(il)swLo.push({idx:i,price:tail[i].low});
  }

  // Double Top (надёжность 75% по Булковски)
  if (swHi.length>=2) {
    const [a,b]=swHi.slice(-2);
    if (Math.abs(a.price-b.price)/a.price<0.003 && b.idx-a.idx>=5)
      return { name:'DOUBLE_TOP', direction:-1, reliability:75 };
  }
  // Double Bottom (надёжность 72%)
  if (swLo.length>=2) {
    const [a,b]=swLo.slice(-2);
    if (Math.abs(a.price-b.price)/a.price<0.003 && b.idx-a.idx>=5)
      return { name:'DOUBLE_BOTTOM', direction:1, reliability:72 };
  }
  // Head & Shoulders (надёжность 83%)
  if (swHi.length>=3) {
    const [l,m,r]=swHi.slice(-3);
    if (m.price>l.price&&m.price>r.price&&Math.abs(l.price-r.price)/m.price<0.004)
      return { name:'HEAD_SHOULDERS', direction:-1, reliability:83 };
  }
  // Inverse H&S (надёжность 79%)
  if (swLo.length>=3) {
    const [l,m,r]=swLo.slice(-3);
    if (m.price<l.price&&m.price<r.price&&Math.abs(l.price-r.price)/m.price<0.004)
      return { name:'INV_HEAD_SHOULDERS', direction:1, reliability:79 };
  }

  // Triangle patterns
  if (swHi.length>=3 && swLo.length>=3) {
    const hiSlope=(swHi[swHi.length-1].price-swHi[0].price)/(swHi[swHi.length-1].idx-swHi[0].idx||1);
    const loSlope=(swLo[swLo.length-1].price-swLo[0].price)/(swLo[swLo.length-1].idx-swLo[0].idx||1);
    // Ascending Triangle: flat top, rising bottom (надёжность 72%)
    if (Math.abs(hiSlope)<atr*0.01 && loSlope>0)
      return { name:'ASCENDING_TRIANGLE', direction:1, reliability:72 };
    // Descending Triangle: falling top, flat bottom (надёжность 73%)
    if (hiSlope<0 && Math.abs(loSlope)<atr*0.01)
      return { name:'DESCENDING_TRIANGLE', direction:-1, reliability:73 };
    // Symmetrical Triangle (надёжность 54%)
    if (hiSlope<0 && loSlope>0)
      return { name:'SYMMETRICAL_TRIANGLE', direction:0, reliability:54 };
  }

  // Flag/Pennant — откат после импульса
  if (c.length>=20) {
    const impulse=c.slice(-20,-10);
    const flag=c.slice(-10);
    const impMove=Math.abs(impulse[impulse.length-1].close-impulse[0].open);
    const flagRange=Math.max(...flag.map(x=>x.high))-Math.min(...flag.map(x=>x.low));
    if (impMove>atr*4 && flagRange<impMove*0.4) {
      const dir=impulse[impulse.length-1].close>impulse[0].open?1:-1;
      return { name: dir>0?'BULL_FLAG':'BEAR_FLAG', direction:dir, reliability:67 };
    }
  }

  // Support/Resistance bounce
  const last=c[c.length-1].close;
  const th=Math.max(last*0.0005, atr*0.4);
  if (Math.abs(last-sr.sup)<=th) return { name:'SUP_BOUNCE', direction:1, reliability:62 };
  if (Math.abs(last-sr.res)<=th) return { name:'RES_REJECT', direction:-1, reliability:60 };

  return { name:'NONE', direction:0, reliability:0 };
}

// ─── УРОВНИ S/R + ФИБОНАЧЧИ ──────────────────────────────────────────
function calcSR(c) {
  if (c.length<20) return { res:0, sup:0, resS:1, supS:1, pp:null, fib:[] };
  const win=c.slice(-200);
  const last=win[win.length-1].close;
  const tol=last*0.003;

  // Pivot Points (Standard)
  const pp_bar=win[win.length-1];
  const pp=(pp_bar.high+pp_bar.low+pp_bar.close)/3;
  const pivot={ pp, r1:pp*2-pp_bar.low, r2:pp+(pp_bar.high-pp_bar.low),
                s1:pp*2-pp_bar.high, s2:pp-(pp_bar.high-pp_bar.low) };

  // Fibonacci
  const h=Math.max(...win.map(x=>x.high)), l=Math.min(...win.map(x=>x.low));
  const range=h-l;
  const fib=range>0?[
    {level:h,name:'H'},
    {level:h-range*0.236,name:'F23'},
    {level:h-range*0.382,name:'F38'},
    {level:h-range*0.5,name:'F50'},
    {level:h-range*0.618,name:'F61'},
    {level:h-range*0.786,name:'F78'},
    {level:l,name:'L'}
  ]:[];

  // Cluster S/R
  const hiPts=[], loPts=[];
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
    const s=[...pts].sort((a,b)=>a.price-b.price), g=[];
    s.forEach(p=>{ const e=g.find(x=>Math.abs(x.price-p.price)<=tol); if(e){e.t++;e.price=(e.price*(e.t-1)+p.price)/e.t;}else g.push({price:p.price,t:1}); });
    return g.sort((a,b)=>b.t-a.t);
  };
  const rg=cluster(hiPts.filter(h=>h.price>=last));
  const sg=cluster(loPts.filter(l=>l.price<=last));
  const fb=Math.max(...win.slice(-30).map(x=>x.high));
  const fl=Math.min(...win.slice(-30).map(x=>x.low));
  return { res:rg[0]?.price||pivot.r1||fb, sup:sg[0]?.price||pivot.s1||fl,
           resS:rg[0]?.t||1, supS:sg[0]?.t||1, pp:pivot, fib };
}

// ─── СИСТЕМА ТРЁХ ЭКРАНОВ ЭЛДЕРА ─────────────────────────────────────
function elderScreens(c, tf) {
  // Экран 1 (старший TF): тренд по EMA26 и MACD weekly
  // Экран 2 (средний TF): стохастик для входа
  // Экран 3 (младший TF): триггер (свечной паттерн)
  // Упрощённая реализация на одном TF
  const ema13=IND.EMA(c,13), ema26=IND.EMA(c,26);
  const rsi=IND.RSI(c);
  const stoch=IND.STOCH(c);
  const cp=candlePattern(c);

  // Экран 1: тренд
  const screen1=ema13>ema26?'BULL':'BEAR';
  // Экран 2: откат (входим против краткосрочного движения)
  let screen2='WAIT';
  if (screen1==='BULL' && stoch.k<30) screen2='BUY';
  if (screen1==='BEAR' && stoch.k>70) screen2='SELL';
  // Экран 3: триггер
  let screen3='WAIT';
  if (screen2==='BUY' && cp.direction>0) screen3='BUY';
  if (screen2==='SELL' && cp.direction<0) screen3='SELL';

  return { screen1, screen2, screen3, aligned: screen2!=='WAIT'&&screen3!=='WAIT' };
}

// ─── ГЛАВНАЯ ФУНКЦИЯ СКОРИНГА ─────────────────────────────────────────
function scoreSignal(data) {
  const { c, sym, tf, sr, ms, atr, news } = data;
  const last=c[c.length-1];
  const n=c.length;

  if (n<15) return { signal:'WAIT', conf:0, reason:'NOT_ENOUGH_DATA' };

  // Собираем все индикаторы
  const rsi    = IND.RSI(c);
  const macd   = IND.MACD(c);
  const stoch  = IND.STOCH(c);
  const bb     = IND.BB(c);
  const adx    = IND.ADX(c);
  const ichi   = IND.ICHIMOKU(c);
  const obv    = IND.OBV(c);
  const psar   = IND.PSAR(c);
  const wr     = IND.WR(c);
  const cci    = IND.CCI(c);
  const div    = IND.RSI_DIV(c);
  const sma    = IND.SMA_LEVELS(c);
  const vwap   = IND.VWAP(c);
  const cp     = candlePattern(c);
  const pat    = chartPatterns(c, sr, atr);
  const vsa    = vsaAnalysis(c);
  const wyck   = wyckoff(c, sr, atr);
  const liq    = liquidityZones(c, atr);
  const sd     = supplyDemand(c, atr);
  const elder  = elderScreens(c, tf);

  // ── СИСТЕМА ВЕСОВ ──
  // Каждый фактор: +X за бычий сигнал, -X за медвежий
  // Используем фиксированный maxScore для стабильной нормализации

  let score = 0;
  const FIXED_MAX = 200; // фиксированный максимум для нормализации
  const reasons = [];

  // ── 1. СТРУКТУРА РЫНКА (вес 20) ──
  if (ms.trend==='UPTREND')    { score+=20; reasons.push('UPTREND'); }
  if (ms.trend==='DOWNTREND')  { score-=20; reasons.push('DOWNTREND'); }
  if (ms.bos==='BULL_BOS')     { score+=8;  reasons.push('BULL_BOS'); }
  if (ms.bos==='BEAR_BOS')     { score-=8;  reasons.push('BEAR_BOS'); }
  if (ms.choch==='BULL_CHOCH') { score+=12; reasons.push('BULL_CHOCH'); }
  if (ms.choch==='BEAR_CHOCH') { score-=12; reasons.push('BEAR_CHOCH'); }

  // ── 2. SMART MONEY / ICT (вес 15 max) ──
  if (ms.ob) {
    if (ms.ob.type==='BULL' && last.close>=ms.ob.low && last.close<=ms.ob.high*1.002)
      { score+=15; reasons.push('BULL_OB'); }
    if (ms.ob.type==='BEAR' && last.close<=ms.ob.high && last.close>=ms.ob.low*0.998)
      { score-=15; reasons.push('BEAR_OB'); }
  }
  if (ms.fvg) {
    if (ms.fvg.type==='BULL' && last.close>=ms.fvg.low && last.close<=ms.fvg.high)
      { score+=8; reasons.push('BULL_FVG'); }
    if (ms.fvg.type==='BEAR' && last.close>=ms.fvg.low && last.close<=ms.fvg.high)
      { score-=8; reasons.push('BEAR_FVG'); }
  }
  if (liq.swept) {
    if (liq.sweepDir==='BULL_SWEEP') { score+=12; reasons.push('BULL_LIQ_SWEEP'); }
    if (liq.sweepDir==='BEAR_SWEEP') { score-=12; reasons.push('BEAR_LIQ_SWEEP'); }
  }

  // ── 3. SUPPLY & DEMAND (вес 12) ──
  if (sd.inDemand) { score+=12; reasons.push('IN_DEMAND'); }
  if (sd.inSupply) { score-=12; reasons.push('IN_SUPPLY'); }

  // ── 4. WYCKOFF (вес 10) ──
  if (wyck.spring)                                         { score+=10; reasons.push('SPRING'); }
  if (wyck.upthrust)                                       { score-=10; reasons.push('UPTHRUST'); }
  if (wyck.phase==='ACCUMULATION' && ms.trend!=='DOWNTREND') { score+=5; }
  if (wyck.phase==='DISTRIBUTION' && ms.trend!=='UPTREND')   { score-=5; }

  // ── 5. VSA (вес 10) ──
  if (vsa.signal==='BULL') { score+=10; reasons.push('VSA_'+vsa.type); }
  if (vsa.signal==='BEAR') { score-=10; reasons.push('VSA_'+vsa.type); }

  // ── 6. СВЕЧНЫЕ ПАТТЕРНЫ (вес 12) ──
  if (cp.direction > 0) { score += Math.round(cp.reliability * 12 / 100); reasons.push(cp.name); }
  if (cp.direction < 0) { score -= Math.round(cp.reliability * 12 / 100); reasons.push(cp.name); }

  // ── 7. ГРАФИЧЕСКИЕ ПАТТЕРНЫ (вес 14) ──
  if (pat.direction > 0) { score += Math.round(pat.reliability * 14 / 100); reasons.push(pat.name); }
  if (pat.direction < 0) { score -= Math.round(pat.reliability * 14 / 100); reasons.push(pat.name); }

  // ── 8. ICHIMOKU 7/30/52 (вес 12) ──
  if (ichi.signal==='BULL')      { score+=12; reasons.push('ICHI_BULL'); }
  if (ichi.signal==='BEAR')      { score-=12; reasons.push('ICHI_BEAR'); }
  if (ichi.signal==='BULL_WEAK') { score+=5; }
  if (ichi.signal==='BEAR_WEAK') { score-=5; }
  if (ichi.tkCross==='BULL')     { score+=7; reasons.push('TK_BULL'); }
  if (ichi.tkCross==='BEAR')     { score-=7; reasons.push('TK_BEAR'); }

  // ── 9. MACD (вес 10) ──
  if (macd.cross==='BULL')        { score+=10; reasons.push('MACD_BULL'); }
  if (macd.cross==='BEAR')        { score-=10; reasons.push('MACD_BEAR'); }
  if (macd.trend==='BULL_STRONG') { score+=4; }
  if (macd.trend==='BEAR_STRONG') { score-=4; }

  // ── 10. RSI (уровни 25/35/65/75, без зоны 50) ──
  if (rsi<25)       { score+=10; reasons.push('RSI_OV'); }
  else if (rsi<35)  { score+=5; }
  else if (rsi>75)  { score-=10; reasons.push('RSI_OB'); }
  else if (rsi>65)  { score-=5; }
  // RSI дивергенция — важный сигнал
  if (div.bull) { score+=12; reasons.push('RSI_DIV_BULL'); }
  if (div.bear) { score-=12; reasons.push('RSI_DIV_BEAR'); }

  // ── 11. STOCHASTIC 80/20 (вес 10) ──
  if (stoch.zone==='OVERSOLD'  && stoch.cross==='BULL') { score+=10; reasons.push('STOCH_BULL'); }
  else if (stoch.zone==='OVERSOLD')                      { score+=5; }
  if (stoch.zone==='OVERBOUGHT'&& stoch.cross==='BEAR') { score-=10; reasons.push('STOCH_BEAR'); }
  else if (stoch.zone==='OVERBOUGHT')                    { score-=5; }

  // ── 12. ADX + DI (вес 8) ──
  if (adx.strength==='TRENDING'||adx.strength==='STRONG'||adx.strength==='VERY_STRONG') {
    if (adx.trend==='BULL') { score+=8; }
    else                    { score-=8; }
  }

  // ── 13. SMA 20/50/200 (вес 8) ──
  let smaS=0;
  if (sma.above20===true)  smaS++;
  if (sma.above50===true)  smaS++;
  if (sma.above200===true) smaS++;
  if (smaS===3)      { score+=8;  reasons.push('ABOVE_ALL_SMA'); }
  else if (smaS===2) { score+=3; }
  else if (smaS===0) { score-=8;  reasons.push('BELOW_ALL_SMA'); }
  else if (smaS===1) { score-=3; }
  if (sma.smaCross==='GOLDEN') { score+=10; reasons.push('GOLDEN_X'); }
  if (sma.smaCross==='DEATH')  { score-=10; reasons.push('DEATH_X'); }

  // ── 14. BOLLINGER BANDS (вес 8) ──
  if (bb.pctB<8)        { score+=8; reasons.push('BB_LOW'); }
  else if (bb.pctB<20)  { score+=3; }
  if (bb.pctB>92)       { score-=8; reasons.push('BB_HIGH'); }
  else if (bb.pctB>80)  { score-=3; }

  // ── 15. VWAP (вес 6) ──
  if (last.close > vwap*1.001)  { score+=6; }
  else if (last.close < vwap*0.999) { score-=6; }

  // ── 16. OBV (вес 6) ──
  if (obv.trend==='BULL' && ms.trend==='UPTREND')   { score+=6; }
  if (obv.trend==='BEAR' && ms.trend==='DOWNTREND') { score-=6; }

  // ── 17. PSAR (вес 6) ──
  if (psar.bull  && last.close>psar.sar)  { score+=6; }
  if (!psar.bull && last.close<psar.sar)  { score-=6; }

  // ── 18. S/R УРОВНИ (вес 12) ──
  if (last.close<=sr.sup+atr*0.4 && sr.supS>=2) { score+=12; reasons.push('AT_SUP'); }
  if (last.close>=sr.res-atr*0.4 && sr.resS>=2) { score-=12; reasons.push('AT_RES'); }
  const fibNear = sr.fib.some(f=>Math.abs(last.close-f.level)<atr*0.5);
  if (fibNear && ms.trend==='UPTREND')   { score+=6; reasons.push('FIB'); }
  if (fibNear && ms.trend==='DOWNTREND') { score-=6; }

  // ── 19. СИСТЕМА ЭЛДЕРА (вес 10) ──
  if (elder.screen3==='BUY')       { score+=10; reasons.push('ELDER_BUY'); }
  if (elder.screen3==='SELL')      { score-=10; reasons.push('ELDER_SELL'); }
  else if (elder.screen2==='BUY')  { score+=4; }
  else if (elder.screen2==='SELL') { score-=4; }

  // ── 20. CCI + WR (вес 6) ──
  if (cci<-100)      { score+=6; }
  else if (cci<-50)  { score+=3; }
  if (cci>100)       { score-=6; }
  else if (cci>50)   { score-=3; }

  // ── НОВОСТНОЙ ФИЛЬТР ──
  if (news.impact==='HIGH')   { score=score*0.3; reasons.push('HIGH_NEWS'); }
  if (news.impact==='MEDIUM') { score=score*0.75; }

  // ── НОРМАЛИЗАЦИЯ с фиксированным максимумом ──
  // Ограничиваем score в диапазоне [-FIXED_MAX, +FIXED_MAX]
  const clampedScore = Math.max(-FIXED_MAX, Math.min(FIXED_MAX, score));
  // Конвертируем в 0-100: 0=полный медведь, 50=нейтрально, 100=полный бык
  const conf = Math.round(50 + (clampedScore / FIXED_MAX) * 47);
  const clampedConf = Math.max(10, Math.min(94, conf));

  // ── РЕШЕНИЕ — строгие пороги ──
  const absScore = Math.abs(clampedScore);
  let signal = 'WAIT';
  // Минимальный порог: уверенность >62% И абсолютный счёт >30
  if (clampedConf >= 63 && absScore >= 30) signal = 'BUY';
  if (clampedConf <= 37 && absScore >= 30) signal = 'SELL';
  // Не торгуем в боковике
  if (ms.trend==='RANGE' && adx.strength==='NONE') signal='WAIT';

  return {
    signal,
    conf: signal==='SELL' ? 100-clampedConf : clampedConf,
    rawScore: score,
    maxScore,
    reasons: reasons.slice(0,8), // топ-8 причин
    // Индикаторы для отображения
    rsi: rsi.toFixed(1),
    adx: adx.adx.toFixed(1),
    cci: cci.toFixed(0),
    stochK: stoch.k.toFixed(1),
    bb: bb.pctB.toFixed(1),
    wr: wr.toFixed(1),
    macdCross: macd.cross||'-',
    ichi: ichi.above?'ABOVE':ichi.below?'BELOW':'IN',
    psar: psar.bull?'BULL':'BEAR',
    vwapPos: last.close>vwap?'ABOVE':'BELOW',
    pattern: pat.name,
    cp: cp.name,
    struct: ms.trend+(ms.bos?'+'+ms.bos:'')+(ms.choch?'+'+ms.choch:''),
    wyckoffPhase: wyck.phase,
    vsaType: vsa.type||'-',
    spring: wyck.spring,
    upthrust: wyck.upthrust,
    liqSweep: liq.swept?liq.sweepDir:null,
    inDemand: sd.inDemand,
    inSupply: sd.inSupply,
    elder: elder.screen3!=='WAIT'?elder.screen3:elder.screen2,
    bull: Math.round(bullPct),
    bear: Math.round(bearPct),
  };
}

module.exports = { IND, scoreSignal, calcSR, marketStructure, candlePattern, chartPatterns, vsaAnalysis, wyckoff, liquidityZones, supplyDemand, elderScreens };

// ─── ДОПОЛНИТЕЛЬНЫЕ МОДУЛИ ────────────────────────────────────────────

// Momentum Score (Rate of Change + Acceleration)
function momentumScore(c) {
  if (c.length < 20) return { score: 0, direction: 'NEUTRAL', acceleration: 0 };
  const roc10 = c.length > 10 ? (c[c.length-1].close - c[c.length-11].close) / c[c.length-11].close * 100 : 0;
  const roc5  = c.length > 5  ? (c[c.length-1].close - c[c.length-6].close)  / c[c.length-6].close  * 100 : 0;
  const roc3  = c.length > 3  ? (c[c.length-1].close - c[c.length-4].close)  / c[c.length-4].close  * 100 : 0;
  // Ускорение = разница скоростей
  const acceleration = roc3 - roc5;
  const score = roc10 * 0.3 + roc5 * 0.4 + roc3 * 0.3;
  const direction = score > 0.1 ? 'BULL' : score < -0.1 ? 'BEAR' : 'NEUTRAL';
  return { score: Math.round(score * 100) / 100, direction, acceleration: Math.round(acceleration * 100) / 100, roc3, roc5, roc10 };
}

// Детектор манипуляций (pump/dump, stop hunt, spoofing)
function manipulationDetector(c, atr) {
  if (c.length < 10) return { type: null, probability: 0 };
  const last = c[c.length-1];
  const prev = c[c.length-2];
  const va = c.slice(-20).reduce((a,b) => a+b.volume, 0) / 20;
  const body = Math.abs(last.close - last.open);
  const uw = last.high - Math.max(last.close, last.open);
  const lw = Math.min(last.close, last.open) - last.low;
  const rng = last.high - last.low || 1;

  // Stop Hunt: длинный фитиль + возврат + высокий объём
  const stopHuntBull = lw > atr * 1.5 && body < rng * 0.25 && last.volume > va * 2 && last.close > last.open;
  const stopHuntBear = uw > atr * 1.5 && body < rng * 0.25 && last.volume > va * 2 && last.close < last.open;

  // Pump: резкий рост на высоком объёме после консолидации
  const recentRange = Math.max(...c.slice(-10).map(x=>x.high)) - Math.min(...c.slice(-10).map(x=>x.low));
  const pump = last.close - prev.close > atr * 2.5 && last.volume > va * 3 && recentRange < atr * 5;
  const dump = prev.close - last.close > atr * 2.5 && last.volume > va * 3 && recentRange < atr * 5;

  // Spoofing: огромный фитиль + маленькое тело + объём ниже среднего
  const spoof = (uw > atr * 2 || lw > atr * 2) && body < rng * 0.15 && last.volume < va * 0.8;

  if (stopHuntBull) return { type: 'STOP_HUNT_BULL', probability: 78 };
  if (stopHuntBear) return { type: 'STOP_HUNT_BEAR', probability: 78 };
  if (pump)         return { type: 'PUMP', probability: 70 };
  if (dump)         return { type: 'DUMP', probability: 70 };
  if (spoof)        return { type: 'SPOOF', probability: 65 };
  return { type: null, probability: 0 };
}

// Price Action зоны (без индикаторов, чистое движение)
function priceActionZones(c, atr) {
  if (c.length < 20) return { zone: 'NEUTRAL', strength: 0 };
  const last = c[c.length-1];
  const win20 = c.slice(-20);

  // Определяем контекст по последним 20 свечам
  const highs = win20.map(x => x.high);
  const lows  = win20.map(x => x.low);
  const closes = win20.map(x => x.close);
  const maxH = Math.max(...highs), minL = Math.min(...lows);
  const range = maxH - minL || 1;

  // Позиция цены в диапазоне (0=дно, 100=топ)
  const position = ((last.close - minL) / range) * 100;

  // Сила последнего движения
  const recentMove = Math.abs(last.close - c[c.length-5].close) / atr;

  // Консолидация или тренд
  const recentRange = Math.max(...c.slice(-5).map(x=>x.high)) - Math.min(...c.slice(-5).map(x=>x.low));
  const isConsolidating = recentRange < atr * 1.5;

  // Определяем зону
  let zone = 'NEUTRAL';
  if (position < 20 && !isConsolidating)       zone = 'DEEP_SUPPORT';
  else if (position < 35)                       zone = 'SUPPORT';
  else if (position > 80 && !isConsolidating)  zone = 'DEEP_RESISTANCE';
  else if (position > 65)                       zone = 'RESISTANCE';
  else if (isConsolidating)                     zone = 'CONSOLIDATION';
  else if (recentMove > 3)                      zone = 'BREAKOUT';

  return { zone, position: Math.round(position), strength: Math.round(recentMove * 10) / 10 };
}

// Многотаймфреймовый анализ (MTF Confluence)
function mtfConfluence(marketData, sym, tf) {
  const order = ['M1','M5','M15','M30','H1'];
  const idx = order.indexOf(tf);
  if (idx < 0) return { bias: 'NEUTRAL', strength: 0, aligned: false };

  const signals = [];
  // Смотрим все старшие таймфреймы
  for (let i = idx + 1; i < order.length; i++) {
    const htf = order[i];
    if (!marketData[sym] || !marketData[sym][htf] || !marketData[sym][htf].cached) continue;
    const cached = marketData[sym][htf].cached;
    if (cached.signal === 'BUY')  signals.push(1);
    if (cached.signal === 'SELL') signals.push(-1);
  }

  if (!signals.length) return { bias: 'NEUTRAL', strength: 0, aligned: false };

  const sum = signals.reduce((a,b) => a+b, 0);
  const bias = sum > 0 ? 'BULL' : sum < 0 ? 'BEAR' : 'NEUTRAL';
  const strength = Math.abs(sum) / signals.length; // 0-1
  const aligned = signals.every(s => s === signals[0]); // все TF согласны

  return { bias, strength: Math.round(strength * 100), aligned, count: signals.length };
}

// Confluence Count — считаем сколько систем согласны
function confluenceCount(signals) {
  const bull = signals.filter(s => s > 0).length;
  const bear = signals.filter(s => s < 0).length;
  const total = signals.length;
  return {
    bull, bear, total,
    bullPct: Math.round(bull/total*100),
    bearPct: Math.round(bear/total*100),
    dominant: bull > bear ? 'BULL' : bear > bull ? 'BEAR' : 'NEUTRAL',
    strength: Math.abs(bull-bear)/total // 0=split, 1=unanimous
  };
}

// Экспортируем новые функции
module.exports.momentumScore = momentumScore;
module.exports.manipulationDetector = manipulationDetector;
module.exports.priceActionZones = priceActionZones;
module.exports.mtfConfluence = mtfConfluence;
module.exports.confluenceCount = confluenceCount;
