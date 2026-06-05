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
let newsAlerts = []; // ✅ NEW: Массив активных уведомлений о новостях
const TFS = ['M1', 'M5', 'M15', 'M30', 'H1'];
const MAX_HISTORY = 500;
const TF_MS = { 'M1': 60e3, 'M5': 300e3, 'M15': 900e3, 'M30': 1800e3, 'H1': 3600e3 };
const TF_EXP = { 'M1': '1-3 MIN', 'M5': '5-15 MIN', 'M15': '15-45 MIN', 'M30': '30-90 MIN', 'H1': '1-4 HRS' };
const TF_ORDER = { 'M1': 1, 'M5': 2, 'M15': 3, 'M30': 4, 'H1': 5 };

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

// ✅ NEW: Отслеживание активных новостей и уведомления
function checkNewsAlerts() {
  const now = Date.now();
  
  // Ищем новости которые только выходят (в течение 1 минуты)
  const justReleased = economicNews.filter(n => Math.abs(now - n.timestamp) <= 60000 && n.timestamp <= now);
  
  justReleased.forEach(news => {
    // Проверяем не уведомляли ли уже об этой новости
    if (!newsAlerts.find(a => a.event === news.event && a.timestamp === news.timestamp)) {
      newsAlerts.push({
        event: news.event,
        currency: news.currency,
        impact: news.impact,
        timestamp: news.timestamp,
        releasedAt: now,
        alertSent: true
      });
      
      // Лог выхода новости
      console.log(`[NEWS ALERT] 🔔 ${news.impact} - ${news.currency}: ${news.event}`);
    }
  });
  
  // Очищаем старые уведомления (старше 1 часа)
  newsAlerts = newsAlerts.filter(a => now - a.releasedAt <= 3600000);
}

// ✅ NEW: Запуск проверки новостей каждые 10 секунд
setInterval(() => checkNewsAlerts(), 10000);

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
  // ✅ FIX: Removed aggressive caching that froze signals
  // Always recalculate to ensure signals update properly
  data.lastTS = last.timestamp;

  // Вычисляем базовые значения для движка
  const atr = IND.ATR(closed, 14);
  const sr = calcSR(closed);
  const ms = marketStructure(closed, atr);
  const news = newsStatus(sym);
  const mtf = mtfConfluence(marketData, sym, tf);
  const mom = momentumScore(closed);
  const manip = manipulationDetector(closed, atr);
  const pa = priceActionZones(closed, atr);

  // Запускаем главный скоринг
  const result = scoreSignal({ c: closed, sym, tf, sr, ms, atr, news });

  // MTF бонус/штраф
  let mtfBonus = 0;
  if (mtf.aligned && mtf.count >= 2) {
    if (mtf.bias === 'BULL' && result.signal === 'BUY') mtfBonus = Math.round(mtf.strength * 0.1);
    if (mtf.bias === 'BEAR' && result.signal === 'SELL') mtfBonus = Math.round(mtf.strength * 0.1);
    if (mtf.bias === 'BULL' && result.signal === 'SELL') mtfBonus = -15;
    if (mtf.bias === 'BEAR' && result.signal === 'BUY') mtfBonus = -15;
  }

  // Манипуляция — снижаем уверенность
  let manipPenalty = 0;
  if (manip.type === 'PUMP' || manip.type === 'DUMP') manipPenalty = -20;
  if (manip.type === 'SPOOF') manipPenalty = -25;

  // Финальная уверенность
  let finalConf = Math.max(10, Math.min(97, result.conf + mtfBonus + manipPenalty));

  // Стабильность сигнала с гистерезисом — предотвращение частых переключений
  const rawSig = result.signal;
  const prevConf = data.cached?.conf || 0;
  const confChange = Math.abs(finalConf - prevConf);

  // Только переключаем сигнал если:
  // 1. Новый сигнал более уверен (на 10+ пункты)
  // 2. Новый сигнал WAIT (всегда разрешено)
  // 3. Сигнал другой (BUY→SELL или наоборот)
  let updatedSig = data.lastRaw || 'WAIT';
  if (rawSig === 'WAIT' || confChange >= 10 || (rawSig !== data.lastRaw && finalConf >= 62)) {
    updatedSig = rawSig;
    if (updatedSig === data.lastRaw && updatedSig !== 'WAIT') {
      data.stable = (data.stable || 0) + 1;
    } else {
      data.stable = updatedSig !== 'WAIT' ? 1 : 0;
      data.lastRaw = updatedSig;
    }
  }
  data.signal = updatedSig;

  // Структура для отображения
  let dispStruct = ms.trend;
  if (n < 15) dispStruct = `ACCUM(${n}/15)`;
  else if (manip.type) dispStruct = manip.type;
  else if (ms.choch) dispStruct = ms.choch;
  else if (ms.bos) dispStruct = ms.bos;

  data.cached = {
    // Основные
    conf: Math.round(finalConf),
    signal: updatedSig,
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
    if (economicNews.length > MAX_NEWS) economicNews.shift();
    res.status(200).send('OK');
  } catch (e) { res.status(400).send('Error'); }
});

// ✅ NEW: Получить активные новости (которые вышли в последний час)
app.get('/active_news', (req, res) => {
  const now = Date.now();
  const active = newsAlerts
    .filter(n => now - n.releasedAt <= 3600000)  // За последний час
    .map(n => ({
      currency: n.currency,
      event: n.event,
      impact: n.impact,
      releaseTime: new Date(n.releasedAt).toISOString(),
      minutesAgo: Math.round((now - n.releasedAt) / 60000)
    }))
    .sort((a, b) => b.releasedAt - a.releasedAt);
  
  res.json({
    count: active.length,
    news: active,
    timestamp: new Date(now).toISOString()
  });
});

// ✅ NEW: Получить расписание предстоящих новостей
app.get('/news_calendar', (req, res) => {
  const now = Date.now();
  const upcoming = economicNews
    .filter(n => n.timestamp > now && n.timestamp <= now + 24*3600000)  // На следующие 24 часа
    .map(n => ({
      currency: n.currency,
      event: n.event,
      impact: n.impact,
      releaseTime: new Date(n.timestamp).toISOString(),
      minutesUntil: Math.round((n.timestamp - now) / 60000)
    }))
    .sort((a, b) => a.timestamp - b.timestamp);
  
  res.json({
    count: upcoming.length,
    news: upcoming,
    timestamp: new Date(now).toISOString()
  });
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
