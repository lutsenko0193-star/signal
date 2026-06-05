# 📰 NEWS ALERTS API — Отслеживание экономических новостей

## Обзор

Система автоматически отслеживает выход экономических новостей высокого влияния и штрафует или блокирует сигналы. Три API endpoint для управления и мониторинга:

---

## 1️⃣ POST /news — Подать новость

**Назначение:** Зарегистрировать новость в системе

**Формат запроса:**
```json
{
  "currency": "USD",           // Валюта (USD, EUR, GBP, JPY и т.д.)
  "event": "Non-Farm Payroll", // Название события
  "impact": "HIGH",            // Важность: HIGH | MEDIUM | LOW
  "timeOffsetMinutes": 5       // Смещение от текущего времени (может быть отрицательным для прошлых событий)
}
```

**Пример curl:**
```bash
curl -X POST http://localhost:3000/news \
  -H "Content-Type: application/json" \
  -d '{
    "currency": "USD",
    "event": "Non-Farm Payroll",
    "impact": "HIGH",
    "timeOffsetMinutes": 0
  }'
```

**Ответ:**
```json
{
  "ok": true,
  "message": "NEWS ALERT: USD Non-Farm Payroll (HIGH) — registered",
  "newsItem": {
    "currency": "USD",
    "event": "Non-Farm Payroll",
    "impact": "HIGH",
    "timestamp": 1704067200000
  }
}
```

---

## 2️⃣ GET /active_news — Активные новости (последний час)

**Назначение:** Получить список недавно вышедших новостей

**Параметры:** нет

**Пример curl:**
```bash
curl http://localhost:3000/active_news
```

**Ответ:**
```json
{
  "count": 2,
  "news": [
    {
      "currency": "USD",
      "event": "CPI (Consumer Price Index)",
      "impact": "HIGH",
      "minutesAgo": 3,
      "timestamp": 1704067197000
    },
    {
      "currency": "EUR",
      "event": "ECB Interest Rate Decision",
      "impact": "MEDIUM",
      "minutesAgo": 15,
      "timestamp": 1704067185000
    }
  ]
}
```

**Когда использовать:**
- ✅ Мониторить, какие новости вышли
- ✅ Проверить, почему сигнал был заблокирован (если WAIT = HIGH_IMPACT_NEWS)
- ✅ Посмотреть volatility обстановку

---

## 3️⃣ GET /news_calendar — Календарь на 24 часа

**Назначение:** Получить предстоящие новости с обратным отсчётом

**Параметры:**
- `hoursAhead=24` (опционально) — количество часов в будущее (по умолчанию 24)

**Пример curl:**
```bash
# Все новости на 24 часа
curl http://localhost:3000/news_calendar

# Новости на 48 часов
curl "http://localhost:3000/news_calendar?hoursAhead=48"
```

**Ответ:**
```json
{
  "count": 5,
  "hoursAhead": 24,
  "news": [
    {
      "currency": "GBP",
      "event": "GDP (Quarterly Estimate)",
      "impact": "HIGH",
      "minutesUntil": 45,
      "timestamp": 1704067245000
    },
    {
      "currency": "EUR",
      "event": "PMI Manufacturing",
      "impact": "MEDIUM",
      "minutesUntil": 120,
      "timestamp": 1704067320000
    },
    {
      "currency": "USD",
      "event": "FOMC Minutes",
      "impact": "HIGH",
      "minutesUntil": 1440,
      "timestamp": 1704070800000
    }
  ],
  "note": "Plan trades around HIGH impact events. MEDIUM events reduce confidence by 20%."
}
```

**Когда использовать:**
- ✅ Планировать трейды **вокруг** важных событий
- ✅ Избегать входов за 10 минут до HIGH impact новостей
- ✅ Снижать ожидания по winrate в периоды MEDIUM новостей

---

## 🔗 Как система блокирует сигналы

### ⛔ HIGH IMPACT NEWS
```
scoreSignal() находит HIGH impact новость в журнале
         ↓
Возвращает { signal: 'WAIT', conf: 0, reason: 'HIGH_IMPACT_NEWS: Non-Farm Payroll' }
         ↓
Сигнал НЕ выводится в топ (conf=0 < MIN_CONF=50)
```

**Продолжительность:** 1 минута до события + 1 минута после

### ⚠️ MEDIUM IMPACT NEWS
```
scoreSignal() применяет newsMultiplier = 0.8
         ↓
Уверенность BUY/SELL × 0.8 (например, 65% → 52%)
         ↓
Сигнал может выйти, но с пониженной уверенностью
```

**Продолжительность:** 1 минута до события + 1 минута после

---

## 📊 Рекомендуемая стратегия использования

| Ситуация | Действие |
|----------|----------|
| **HIGH за 10 мин** | Не открывать НОВЫЕ позиции |
| **HIGH только что** | Закрыть если находишься в убытке, держать если в прибыли |
| **MEDIUM за 30 мин** | Входить можно, но с partial size |
| **После MEDIUM** | Сигналы на 20% менее надежны (но не блокируются) |

---

## 🛠 Технические детали

### Внутренняя архитектура

**server.js:**
```javascript
// Массив активных новостей (последний час)
const newsAlerts = [];

// Функция проверяет каждые 10 секунд
function checkNewsAlerts() {
  const now = Date.now();
  const oneHourAgo = now - 3600000;
  
  // Очистить старые
  while (newsAlerts.length && newsAlerts[0].timestamp < oneHourAgo) {
    newsAlerts.shift();
  }
}

// Запускается: setInterval(checkNewsAlerts, 10000)
```

**engine.js:**
```javascript
// В scoreSignal():
if (news?.impact === 'HIGH') {
  return { signal: 'WAIT', conf: 0, reason: 'HIGH_IMPACT_NEWS' };
}

let newsMultiplier = 1.0;
if (news?.impact === 'MEDIUM') newsMultiplier = 0.8;
// ... позже
conf = Math.round(conf * newsMultiplier);
```

### Временные окна

```
-60 мин        -2 мин   0 мин   +2 мин       +60 мин
    |------------|--------|--------|----------|
    
    За час до
    события
    (календарь)
    
              БЛОКАДА          БЛОКАДА
              HIGH IMPACT
              
              ШТРАФ            ШТРАФ
              MEDIUM
```

---

## 🐛 Отладка

### Как проверить, работает ли система?

1. **Отправить HIGH IMPACT новость:**
```bash
curl -X POST http://localhost:3000/news \
  -H "Content-Type: application/json" \
  -d '{"currency":"USD","event":"TestNews","impact":"HIGH","timeOffsetMinutes":0}'
```

2. **Посмотреть в консоли сервера:**
```
[NEWS] ✓ USD TestNews (HIGH) registered
```

3. **Попросить сигнал:**
```bash
curl "http://localhost:3000/signal?s=EURUSD&tf=M5&marketMode=STRONG"
```

4. **Ожидаемый результат:**
```json
{
  "signal": "WAIT",
  "conf": 0,
  "reason": "HIGH_IMPACT_NEWS: TestNews",
  "note": "New signal blocked — news event impact is HIGH"
}
```

---

## 🚀 Будущие улучшения

- [ ] Сохранение истории новостей в БД
- [ ] Интеграция с календарём Investing.com API
- [ ] Slack/Telegram уведомления за 30 мин до HIGH
- [ ] Автоматическое разъезжание stop-loss перед HIGH
- [ ] Анализ win-rate ПО сигналам (до/после/во время новостей)

---

## 📞 Поддержка

Если система не блокирует сигналы при новостях:
1. Проверить `POST /news` возвращает `"ok": true`
2. Проверить `/active_news` показывает событие
3. Перезагрузить сервер: `npm run stop-all && npm run start-all`
4. Смотреть логи консоли для ошибок

---

**Версия:** 1.0  
**Дата:** 2024-01-02  
**Автор:** Signal Engine News Module  
**Статус:** ✅ Live на GitHub PR #2
