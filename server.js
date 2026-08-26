'use strict';

const path = require('path');
const express = require('express');
const apiRouter = require('./server/routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// API — всё, что реально «прикручено» к бекенду (см. server/store.js).
app.use('/api', apiRouter);

// Простой health-check для Render/мониторинга.
app.get('/healthz', (req, res) => res.json({ ok: true }));

// Статика: сам прототип (лендинг + приложение) отдаётся как есть.
app.use(express.static(path.join(__dirname, 'public')));

// Уровни креаторов и лидерборды конкурсов должны отражать актуальное окно
// в 30 дней / актуальный час, даже если никто их не дёргает мутациями —
// поэтому, помимо пересчёта по месту (в api.js, сразу после действия),
// держим и фоновые тики. Дергаем один раз сразу при старте, чтобы не ждать
// первый тик после деплоя.
//
// Тикаем раз в час, а не раз в 30 дней: сама 30-дневная логика — это окно
// внутри recalcCreatorLevel (Date.now() - THIRTY_DAYS_MS), интервал тут лишь
// определяет, как часто мы это окно перепроверяем. Кроме того, setInterval/
// setTimeout в Node принимают максимум ~24.8 дня (2^31-1 мс, 32-битный int) —
// значение в 30 дней это превышает, и Node молча схлопывает такой таймер до
// 1 мс, из-за чего пересчёт крутился бы в бесконечном цикле каждую
// миллисекунду. Часовой тик и укладывается в лимит, и даёт более свежий
// пересчёт уровня, чем буквально раз в 30 дней.
const store = require('./server/store');
const ONE_HOUR_MS = 60 * 60 * 1000;
store.recalcAllLevels();
store.recomputeContests();
store.recomputePayoutTemplates();
setInterval(() => store.recalcAllLevels(), ONE_HOUR_MS);
setInterval(() => store.recomputeContests(), ONE_HOUR_MS);
setInterval(() => store.recomputePayoutTemplates(), ONE_HOUR_MS);

app.listen(PORT, () => {
  console.log(`Creator Analytics server running on http://localhost:${PORT}`);
});
