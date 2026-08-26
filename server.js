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

app.listen(PORT, () => {
  console.log(`Creator Analytics server running on http://localhost:${PORT}`);
});
