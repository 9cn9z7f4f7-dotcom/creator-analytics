'use strict';

const express = require('express');
const store = require('../store');

const router = express.Router();

// ---------------------------------------------------------------------------
// Общие хелперы
// ---------------------------------------------------------------------------
function pay(views, rate, k) {
  return Math.round(views * (rate || 0) * k);
}
function fmtViews(v) {
  return v >= 1000 ? (v / 1000).toFixed(1).replace('.0', '') + 'K' : String(v);
}
function pushNotif(type, title, text) {
  store.NOTIF = [{ t: type, ti: title, tx: text, tm: 'только что', n: 1 }, ...store.NOTIF];
  return store.NOTIF[0];
}
let wdAutoId = 500000;

// ---------------------------------------------------------------------------
// BOOTSTRAP — всё, что нужно для первой отрисовки страницы, одним запросом
// ---------------------------------------------------------------------------
router.get('/bootstrap', (req, res) => {
  res.json({
    offers: store.OFFERS,
    formats: store.FORMATS,
    videos: store.VIDEOS,
    creators: store.CREATORS,
    levelNames: store.LVN,
    levelGoals: store.LVG,
    levels: store.LVM,
    myNick: store.MYNICK,
    myEid: store.MYEID,
    moderation: store.MOD,
    rate: store.RATE,
    done: store.DONE,
    topVideos: store.TOP_VIDEOS,
    contests: store.CONTESTS,
    contestsAdminSummary: store.CONTESTS_ADMIN_SUMMARY,
    rates: store.RATES,
    minViews: store.MIN_VIEWS,
    weekTheme: store.WEEK_THEME,
    payouts: store.PAYQ,
    withdrawals: store.WD,
    balance: store.BAL,
    notifications: store.NOTIF,
    schoolMine: store.SCHOOL_MINE,
    schoolAdmin: store.SCHOOL_ADMIN,
    scoutMine: store.SCOUT_MINE,
    scoutAdmin: store.SCOUT_ADMIN,
    briefs: store.BRIEFS,
    adminOffers: store.ADMIN_OFFERS_TABLE,
  });
});

// ---------------------------------------------------------------------------
// ОФФЕРЫ (креатор)
// ---------------------------------------------------------------------------
router.get('/offers', (req, res) => res.json(store.OFFERS));

router.post('/offers/:name/connect', (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const offer = store.OFFERS.find((o) => o.n === name && o.state === 'free');
  if (!offer) return res.status(404).json({ error: 'Оффер недоступен для подключения' });
  offer.state = 'on';
  res.json(store.OFFERS);
});

// ---------------------------------------------------------------------------
// ФОРМАТЫ РОЛИКОВ
// ---------------------------------------------------------------------------
router.get('/formats', (req, res) => res.json(store.FORMATS));

// ---------------------------------------------------------------------------
// МОИ ВИДЕО + РАЗМЕТКА
// ---------------------------------------------------------------------------
router.get('/videos', (req, res) => res.json(store.VIDEOS));

router.post('/videos/:id/mark', (req, res) => {
  const id = Number(req.params.id);
  const v = store.VIDEOS.find((x) => x.i === id);
  if (!v) return res.status(404).json({ error: 'Ролик не найден' });
  const { offerKey, k } = req.body || {};
  if (!offerKey) return res.status(400).json({ error: 'Не указан оффер' });
  const kk = Number(k);
  const fmt = store.FORMATS.find((f) => f.k === kk);
  if (!fmt) return res.status(400).json({ error: 'Неизвестный формат ролика' });
  v.of = offerKey;
  v.k = kk;
  v.st = kk === 0.05 ? 'ok' : 'wait';
  res.status(200).json({ video: v, videos: store.VIDEOS });
});

// ---------------------------------------------------------------------------
// КРЕАТОРЫ (админ)
// ---------------------------------------------------------------------------
router.get('/creators', (req, res) => res.json(store.CREATORS));

router.get('/creators/:nick', (req, res) => {
  const nick = decodeURIComponent(req.params.nick);
  const d = store.CREATORS.find((x) => x.n === nick);
  if (!d) return res.status(404).json({ error: 'Креатор не найден' });
  res.json(d);
});

// ---------------------------------------------------------------------------
// ОЧЕРЕДЬ ПРОВЕРКИ РОЛИКОВ (админ)
// ---------------------------------------------------------------------------
router.get('/moderation', (req, res) => res.json(store.MOD));

router.post('/moderation/:i/set-k', (req, res) => {
  const i = Number(req.params.i);
  const m = store.MOD.find((x) => x.i === i);
  if (!m) return res.status(404).json({ error: 'Ролик не найден в очереди' });
  const { k, why } = req.body || {};
  m.k = Number(k);
  if (why) m.why = why;
  res.json({ moderation: store.MOD });
});

router.post('/moderation/:i/approve', (req, res) => {
  const i = Number(req.params.i);
  const idx = store.MOD.findIndex((x) => x.i === i);
  if (idx === -1) return res.status(404).json({ error: 'Ролик не найден в очереди' });
  const m = store.MOD[idx];
  const amount = pay(m.v, store.RATE[m.of], m.k);

  let notif;
  if (m.why) {
    notif = pushNotif('down', 'Коэффициент изменён', m.c + ' · ролик на ' + fmtViews(m.v) + ': коэффициент ' + String(m.k).replace('.', ',') + '. Причина: ' + m.why);
  } else {
    notif = pushNotif('ok', 'Ролик принят', m.c + ' · ' + fmtViews(m.v) + ' просмотров · начислено ' + amount.toLocaleString('ru-RU') + ' ₽');
  }
  store.DONE = [{ ...m, by: 'Наталья', dt: 'сегодня' }, ...store.DONE];
  store.MOD = store.MOD.filter((x) => x.i !== i);

  res.json({ moderation: store.MOD, done: store.DONE, notification: notif, pay: amount });
});

// ---------------------------------------------------------------------------
// УЖЕ ПРИНЯТЫЕ РОЛИКИ (админ)
// ---------------------------------------------------------------------------
router.get('/moderation/done', (req, res) => res.json(store.DONE));

router.post('/moderation/done/:i/redo', (req, res) => {
  const i = Number(req.params.i);
  const d = store.DONE.find((x) => x.i === i);
  if (!d) return res.status(404).json({ error: 'Ролик не найден среди принятых' });
  const { k, why } = req.body || {};
  const kk = Number(k);
  const was = pay(d.v, store.RATE[d.of], d.k);
  d.k = kk;
  const now = pay(d.v, store.RATE[d.of], kk);
  const diff = now - was;
  d.by = 'Наталья';
  d.dt = 'изменено сегодня';
  d.why = why || '';

  const notif = pushNotif(
    diff > 0 ? 'ok' : 'down',
    'Коэффициент пересмотрен',
    d.c + ' · ролик на ' + fmtViews(d.v) + ': ' + (diff > 0 ? 'доначислено ' : 'списано ') + Math.abs(diff).toLocaleString('ru-RU') + ' ₽' + (why ? '. Причина: ' + why : ''),
  );
  res.json({ done: store.DONE, notification: notif, diff });
});

router.delete('/moderation/done/:i', (req, res) => {
  const i = Number(req.params.i);
  const idx = store.DONE.findIndex((x) => x.i === i);
  if (idx === -1) return res.status(404).json({ error: 'Ролик не найден среди принятых' });
  const d = store.DONE[idx];
  const was = pay(d.v, store.RATE[d.of], d.k);
  store.DONE = store.DONE.filter((x) => x.i !== i);
  res.json({ done: store.DONE, was, creator: d.c });
});

// ---------------------------------------------------------------------------
// ДАШБОРД СООБЩЕСТВА
// ---------------------------------------------------------------------------
router.get('/dashboard/top-videos', (req, res) => res.json(store.TOP_VIDEOS));

// ---------------------------------------------------------------------------
// КОНКУРСЫ
// ---------------------------------------------------------------------------
router.get('/contests', (req, res) => res.json(store.CONTESTS));

// ---------------------------------------------------------------------------
// СТАВКИ, КОЭФФИЦИЕНТЫ, ПОРОГ ОПЛАТЫ
// ---------------------------------------------------------------------------
router.get('/rates', (req, res) => res.json({
  rates: store.RATES,
  levels: store.LVM,
  levelNames: store.LVN,
  levelGoals: store.LVG,
  minViews: store.MIN_VIEWS,
  formats: store.FORMATS,
}));

router.patch('/rates', (req, res) => {
  const { rates, levels, minViews, formats } = req.body || {};
  if (Array.isArray(rates)) {
    store.RATES = rates;
    // синхронизируем карту RATE (используется при расчёте оплаты за ролики)
    const map = {};
    rates.forEach((r) => { map[r.n] = r.v; });
    store.RATE = map;
  }
  if (levels && typeof levels === 'object') store.LVM = { ...store.LVM, ...levels };
  if (Number.isFinite(minViews)) store.MIN_VIEWS = minViews;
  if (Array.isArray(formats)) {
    // фронтенд присылает массив в том же порядке, что и store.FORMATS
    // (оба построены из одного и того же /api/formats при загрузке страницы)
    formats.forEach((f, idx) => {
      if (store.FORMATS[idx] && Number.isFinite(f.k)) store.FORMATS[idx].k = f.k;
    });
  }
  res.json({ rates: store.RATES, levels: store.LVM, minViews: store.MIN_VIEWS, formats: store.FORMATS });
});

// ---------------------------------------------------------------------------
// ТЕМА НЕДЕЛИ
// ---------------------------------------------------------------------------
router.get('/week-theme', (req, res) => res.json(store.WEEK_THEME));

router.post('/week-theme', (req, res) => {
  const { title, description, offerKey, multiplier } = req.body || {};
  const t = (title || '').trim();
  const d = (description || '').trim();
  const o = (offerKey || '').trim();
  const m = Number(multiplier);
  if (!t) return res.status(400).json({ error: 'Укажите название темы' });
  if (!d) return res.status(400).json({ error: 'Укажите описание темы' });
  if (!o) return res.status(400).json({ error: 'Укажите оффер' });
  if (!Number.isFinite(m) || m <= 0) return res.status(400).json({ error: 'Множитель должен быть положительным числом' });
  store.WEEK_THEME = { title: t, description: d, offerKey: o, multiplier: m };
  res.status(201).json(store.WEEK_THEME);
});

// ---------------------------------------------------------------------------
// ВЫПЛАТЫ (админ)
// ---------------------------------------------------------------------------
router.get('/payouts', (req, res) => res.json(store.PAYQ));

router.post('/payouts/:id/action', (req, res) => {
  const id = Number(req.params.id);
  const x = store.PAYQ.find((y) => y.id === id);
  if (!x) return res.status(404).json({ error: 'Заявка не найдена' });
  const { status } = req.body || {};
  if (!['в работе', 'выплачено', 'отклонена'].includes(status)) {
    return res.status(400).json({ error: 'Неизвестный статус' });
  }
  x.st = status;
  let notif = null;

  if (status === 'выплачено') {
    const w = store.WD.find((z) => z.q === id);
    if (w) w.st = 'выплачено';
    if (x.c === store.MYNICK) {
      notif = pushNotif('money', 'Выплата отправлена', x.s.toLocaleString('ru-RU') + ' ₽ ушли ' + (x.w === 'на карту' ? 'на карту' : 'на баланс SREDA') + '. Проверьте поступление.');
    }
  } else if (status === 'отклонена') {
    const w = store.WD.find((z) => z.q === id);
    if (w) w.st = 'отклонена';
    if (x.c === store.MYNICK) {
      store.BAL = store.BAL + x.s;
      store.VIDEOS.forEach((v) => { if (v.wd === id) v.wd = 0; });
      notif = pushNotif('down', 'Заявка на вывод отклонена', x.s.toLocaleString('ru-RU') + ' ₽ вернулись на баланс. Напишите менеджеру, чтобы разобраться.');
    }
  }

  res.json({
    payouts: store.PAYQ,
    withdrawals: store.WD,
    balance: store.BAL,
    videos: store.VIDEOS,
    notification: notif,
  });
});

// ---------------------------------------------------------------------------
// ВЫВОДЫ + БАЛАНС (креатор)
// ---------------------------------------------------------------------------
router.get('/withdrawals', (req, res) => res.json({ withdrawals: store.WD, balance: store.BAL }));

router.post('/withdrawals', (req, res) => {
  if (store.BAL < 1000) return res.status(400).json({ error: 'Минимальная сумма вывода — 1 000 ₽' });
  const { method } = req.body || {};
  const way = method === 'edu' ? 'из ЛК SREDA' : 'на карту';
  const paidVideos = store.VIDEOS.filter((x) => x.st === 'ok' && !x.wd);
  const qid = wdAutoId++;
  paidVideos.forEach((x) => { x.wd = qid; });

  const sum = store.BAL;
  store.WD = [{ d: 'сегодня', s: sum, w: way, v: paidVideos.length, st: 'заявка создана', q: qid }, ...store.WD];
  store.PAYQ = [{ id: qid, c: store.MYNICK, eid: store.MYEID, s: sum, w: way, v: paidVideos.length, d: 'сегодня, только что', st: 'новая' }, ...store.PAYQ];
  const notif = pushNotif('money', 'Заявка на вывод создана', sum.toLocaleString('ru-RU') + ' ₽ · ' + way + ' · ' + paidVideos.length + ' роликов помечены как выведенные. Напишите менеджеру, чтобы мы начислили сумму');
  store.BAL = 0;

  res.status(201).json({
    withdrawals: store.WD,
    payouts: store.PAYQ,
    videos: store.VIDEOS,
    balance: store.BAL,
    notification: notif,
  });
});

// ---------------------------------------------------------------------------
// УВЕДОМЛЕНИЯ
// ---------------------------------------------------------------------------
router.get('/notifications', (req, res) => res.json(store.NOTIF));

router.post('/notifications/read-all', (req, res) => {
  store.NOTIF.forEach((x) => { x.n = 0; });
  res.json(store.NOTIF);
});

// ---------------------------------------------------------------------------
// ШКОЛА
// ---------------------------------------------------------------------------
router.get('/school/mine', (req, res) => res.json(store.SCHOOL_MINE));
router.get('/school/admin', (req, res) => res.json(store.SCHOOL_ADMIN));

// ---------------------------------------------------------------------------
// СКАУТИНГ
// ---------------------------------------------------------------------------
router.get('/scouting/mine', (req, res) => res.json(store.SCOUT_MINE));
router.get('/scouting/admin', (req, res) => res.json(store.SCOUT_ADMIN));

// ---------------------------------------------------------------------------
// БРИФЫ ЗАКАЗЧИКОВ
// ---------------------------------------------------------------------------
router.get('/briefs', (req, res) => res.json(store.BRIEFS));

router.post('/briefs', (req, res) => {
  const b = req.body || {};
  const company = (b.company || '').trim();
  const contactName = (b.contactName || '').trim();
  if (!company && !contactName) {
    return res.status(400).json({ error: 'Укажите хотя бы название компании или имя контакта' });
  }
  const modelLabel = { rev: 'RevShare', fix: 'Фикс', views: 'Оплата за просмотры' }[b.payModel] || b.payModel || '—';
  const entry = {
    company: company || '—',
    niche: b.niche || '—',
    model: modelLabel,
    budget: (b.budget || '').trim() || '—',
    date: 'сегодня',
    status: 'новая',
    site: b.site || '',
    message: b.message || '',
    geo: b.geo || '',
    contactName,
    contactTg: b.contactTg || '',
  };
  store.BRIEFS = [entry, ...store.BRIEFS];
  res.status(201).json({ briefs: store.BRIEFS });
});

// ---------------------------------------------------------------------------
// ОФФЕРЫ — админская таблица
// ---------------------------------------------------------------------------
router.get('/admin/offers', (req, res) => res.json(store.ADMIN_OFFERS_TABLE));

module.exports = router;
