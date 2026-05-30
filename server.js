console.log('[PO Bridge] LOADED ✅');
(function() {
  const SERVER = 'https://signal-o6x2.onrender.com/data';
  const sentRecently = {};

  // Дедупликация — не слать одно и то же чаще раза в 500мс
  function sendQuote(symbol, price) {
    if (!symbol || !price || price < 0.00001) return;
    const sym = symbol.toUpperCase()
      .replace(/#/g, '').replace(/-/g, '').replace(/ /g, '').replace(/_/g, '');
    const key = sym;
    const now = Date.now();
    if (sentRecently[key] && now - sentRecently[key] < 500) return;
    sentRecently[key] = now;
    console.log('[PO Bridge] →', sym, price);
    fetch(SERVER, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ symbol: sym, bid: price, volume: 1, source: 'pocket_otc' })
    }).catch(() => {});
  }

  // ── WebSocket перехват ──────────────────────────────────
  const _WS = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    const ws = protocols ? new _WS(url, protocols) : new _WS(url);
    ws.addEventListener('message', (e) => {
      try {
        if (e.data instanceof Blob) {
          e.data.arrayBuffer().then(buf => handleBinary(buf));
        } else if (e.data instanceof ArrayBuffer) {
          handleBinary(e.data);
        } else if (typeof e.data === 'string') {
          handleText(e.data);
        }
      } catch(err) {}
    });
    return ws;
  };
  Object.setPrototypeOf(window.WebSocket, _WS);
  window.WebSocket.prototype = _WS.prototype;

  function handleText(raw) {
    // Socket.IO формат 42[...]
    if (raw.startsWith('42[')) {
      try {
        const json = JSON.parse(raw.slice(2));
        const event = json[0];
        const data  = json[1];
        if (['updateStream','updateQuotes','tick','quote','asset'].includes(event)) {
          const ticks = Array.isArray(data) ? data : [data];
          ticks.forEach(tick => {
            const symbol = tick.asset || tick.symbol || tick.id || tick.name || tick.pair;
            const price  = tick.price || tick.close || tick.value || tick.ask || tick.bid;
            if (symbol && price) sendQuote(symbol, parseFloat(price));
          });
        }
        // Массив котировок напрямую
        if (Array.isArray(data)) {
          data.forEach(item => {
            if (item && item.asset && item.price) sendQuote(item.asset, parseFloat(item.price));
          });
        }
      } catch(e) {}
    }
    // Попытка JSON напрямую
    if (raw.startsWith('{') || raw.startsWith('[')) {
      try {
        const d = JSON.parse(raw);
        const items = Array.isArray(d) ? d : [d];
        items.forEach(item => {
          const symbol = item.asset || item.symbol || item.name || item.pair;
          const price  = item.price || item.close || item.ask || item.bid || item.value;
          if (symbol && price) sendQuote(symbol, parseFloat(price));
        });
      } catch(e) {}
    }
  }

  function handleBinary(buf) {
    try {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(buf);

      // Формат: ["AUDNZD otc", ts, price] или ["AUDNZD_OTC", ts, price]
      const r1 = text.matchAll(/\["([A-Z]{3,10}[_ ]?(?:otc|OTC)?[A-Z]{0,3})"[^,]*,([\d.]+),([\d.]+)\]/g);
      for (const m of r1) sendQuote(m[1], parseFloat(m[3]));

      // Формат: {"asset":"XXXX","history":[[ts,price],...]}
      const r2 = text.matchAll(/"asset"\s*:\s*"([^"]+)"/g);
      for (const m of r2) {
        const prices = [...text.matchAll(/\[\d+\.?\d*,\s*([\d.]+)\]/g)];
        if (prices.length) sendQuote(m[1], parseFloat(prices[prices.length - 1][1]));
      }

      // Формат: symbol:price или "symbol","price"
      const r3 = text.matchAll(/"?([A-Z]{6,10}(?:OTC|_OTC)?)"?\s*[,:]\s*"?([\d.]{4,12})"?/g);
      for (const m of r3) {
        const p = parseFloat(m[2]);
        if (p > 0.00001 && p < 99999) sendQuote(m[1], p);
      }

    } catch(e) {}
  }

  // ── XHR перехват (REST котировки) ───────────────────────
  const _open = XMLHttpRequest.prototype.open;
  const _send = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    this._url = url;
    return _open.apply(this, [method, url, ...args]);
  };

  XMLHttpRequest.prototype.send = function(...args) {
    this.addEventListener('load', function() {
      try {
        if (!this.responseText) return;
        const url = this._url || '';
        if (!/quote|tick|stream|asset|price/i.test(url)) return;
        const d = JSON.parse(this.responseText);
        const items = Array.isArray(d) ? d : (d.data ? (Array.isArray(d.data) ? d.data : [d.data]) : [d]);
        items.forEach(item => {
          const symbol = item.asset || item.symbol || item.name || item.pair;
          const price  = item.price || item.close || item.ask || item.bid;
          if (symbol && price) sendQuote(symbol, parseFloat(price));
        });
      } catch(e) {}
    });
    return _send.apply(this, args);
  };

  // ── fetch перехват (REST котировки) ─────────────────────
  const _fetch = window.fetch;
  window.fetch = function(input, init) {
    const url = typeof input === 'string' ? input : (input?.url || '');
    // Не перехватываем наш собственный сервер
    if (url.includes('onrender.com') || url.includes('localhost')) {
      return _fetch.apply(this, arguments);
    }
    return _fetch.apply(this, arguments).then(res => {
      if (/quote|tick|stream|asset|price/i.test(url)) {
        res.clone().json().then(d => {
          const items = Array.isArray(d) ? d : (d.data ? (Array.isArray(d.data) ? d.data : [d.data]) : [d]);
          items.forEach(item => {
            const symbol = item.asset || item.symbol || item.name || item.pair;
            const price  = item.price || item.close || item.ask || item.bid;
            if (symbol && price) sendQuote(symbol, parseFloat(price));
          });
        }).catch(() => {});
      }
      return res;
    });
  };

  console.log('[PO Bridge] All interceptors active ✅');
})();
