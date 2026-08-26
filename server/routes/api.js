'use strict';

const express = require('express');
const store = require('../store');

const router = express.Router();

// ---------------------------------------------------------------------------
// Общие хелперы (pay/fmtViews теперь в store.js — их считает и конструктор
// конкурсов, и шаблон выплаты, не только этот файл)
// ---------------------------------------------------------------------------
const { pay, fmtViews } = store;
function pushNotif(type, title, text) {
  store.NOTIF = [{ t: type, ti: title, tx: text, tm: 'только что', n: 1 }, ...store.NOTIF];
  return store.NOTIF[0];
}
let wdAutoId = 500000;

// ---------------------------------------------------------------------------
// BOOTSTRAP — всё, что нужно для первой отрисовки страницы, одним запросом
// ---------------------------------------------------------------------------
router.get('/bootstrap', (req, res) => {
  store.recomputeContests();
  store.recomputePayoutTemplates();
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

  // Порог оплаты — раньше эта фраза была только текстом на странице «Ставки»
  // и нигде не проверялась на бэке. Теперь это реальная блокировка.
  if (v.v < store.MIN_VIEWS) {
    return res.status(400).json({
      error: 'Порог не пройден: нужно минимум ' + store.MIN_VIEWS.toLocaleString('ru-RU') +
        ' просмотров, у ролика ' + v.v.toLocaleString('ru-RU') + '.',
    });
  }

  v.of = offerKey;
  v.k = kk;

  let notif = null;
  let levelChange = null;
  if (kk === 0.05) {
    // «Упоминание» — коэффициент, который в прототипе всегда считался
    // авто-одобряемым (см. исходный st:'ok' сразу после разметки).
    // Раньше на этом всё и заканчивалось — ролик просто помечался
    // оплаченным, но никогда не появлялся в истории принятых. Теперь он
    // сразу уходит в DONE, минуя очередь модерации, ровно как было
    // задумано в подсказке фронтенда «Принято сразу — деньги начислены».
    v.st = 'ok';
    const creator = store.CREATORS.find((c) => c.n === store.MYNICK);
    const lv = creator ? creator.lv : 1;
    // Ставка за просмотр умножается на надбавку уровня — так же, как её
    // видит сам креатор на калькуляторе, иначе показанная сумма разъедется
    // с тем, что реально попадёт в историю принятых.
    const amount = pay(v.v, store.RATE[offerKey] * (store.LVM[lv] || 1), kk);
    const doneEntry = {
      i: store.doneAutoId, c: store.MYNICK, p: v.p, v: v.v, of: offerKey, k: kk, lv,
      by: 'авто', dt: 'сегодня', ts: Date.now(),
    };
    store.doneAutoId = store.doneAutoId + 1;
    store.DONE = [doneEntry, ...store.DONE];
    notif = pushNotif('ok', 'Ролик принят', 'Автоматически · ' + fmtViews(v.v) + ' просмотров · начислено ' + amount.toLocaleString('ru-RU') + ' ₽');
    levelChange = store.recalcCreatorLevel(store.MYNICK);
  } else {
    // Любой другой формат — ролик уходит в очередь модерации админу,
    // как и написано пользователю в модалке разметки («уходит на
    // проверку, обычно до суток»). Раньше это никак не происходило —
    // очередь MOD жила отдельно от того, что реально размечали креаторы.
    v.st = 'wait';
    const creator = store.CREATORS.find((c) => c.n === store.MYNICK);
    const modEntry = {
      i: store.modAutoId, c: store.MYNICK, lv: creator ? creator.lv : 1,
      p: v.p, v: v.v, of: offerKey, k: kk, viewed: false,
    };
    store.modAutoId = store.modAutoId + 1;
    store.MOD = [modEntry, ...store.MOD];
  }

  res.status(200).json({
    video: v, videos: store.VIDEOS,
    moderation: store.MOD, done: store.DONE, notification: notif, levelChange,
  });
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
  m.viewed = true;
  res.json({ moderation: store.MOD });
});

router.post('/moderation/:i/approve', (req, res) => {
  const i = Number(req.params.i);
  const idx = store.MOD.findIndex((x) => x.i === i);
  if (idx === -1) return res.status(404).json({ error: 'Ролик не найден в очереди' });
  const m = store.MOD[idx];
  m.viewed = true;
  // Ставка умножается на надбавку уровня, зафиксированного за креатором в
  // момент разметки (m.lv) — так сумма совпадает с тем, что креатор видел
  // на своём калькуляторе, а не считается по голой базовой ставке.
  const amount = pay(m.v, store.RATE[m.of] * store.levelMultForNick(m.c, m.lv), m.k);

  let notif;
  if (m.why) {
    notif = pushNotif('down', 'Коэффициент изменён', m.c + ' · ролик на ' + fmtViews(m.v) + ': коэффициент ' + String(m.k).replace('.', ',') + '. Причина: ' + m.why);
  } else {
    notif = pushNotif('ok', 'Ролик принят', m.c + ' · ' + fmtViews(m.v) + ' просмотров · начислено ' + amount.toLocaleString('ru-RU') + ' ₽');
  }
  store.DONE = [{ ...m, by: 'Наталья', dt: 'сегодня', ts: Date.now() }, ...store.DONE];
  store.MOD = store.MOD.filter((x) => x.i !== i);
  const levelChange = store.recalcCreatorLevel(m.c);

  res.json({ moderation: store.MOD, done: store.DONE, notification: notif, pay: amount, levelChange });
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
  const mult = store.levelMultForNick(d.c, d.lv);
  const was = pay(d.v, store.RATE[d.of] * mult, d.k);
  d.k = kk;
  const now = pay(d.v, store.RATE[d.of] * mult, kk);
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
  const was = pay(d.v, store.RATE[d.of] * store.levelMultForNick(d.c, d.lv), d.k);
  store.DONE = store.DONE.filter((x) => x.i !== i);
  const levelChange = store.recalcCreatorLevel(d.c);
  res.json({ done: store.DONE, was, creator: d.c, levelChange });
});

// ---------------------------------------------------------------------------
// ДАШБОРД СООБЩЕСТВА
// ---------------------------------------------------------------------------
router.get('/dashboard/top-videos', (req, res) => res.json(store.TOP_VIDEOS));

// ---------------------------------------------------------------------------
// КОНКУРСЫ — конструктор для админа + расчёт из уже существующих данных
// (см. store.js: computeContestBoard/recomputeContests). Фоновый пересчёт
// раз в час запущен в server.js — здесь пересчитываем ещё и синхронно при
// каждом GET/мутации, чтобы админ не ждал час после создания конкурса.
// ---------------------------------------------------------------------------
router.get('/contests', (req, res) => {
  store.recomputeContests();
  res.json(store.CONTESTS);
});

const CONTEST_METRICS = ['payments', 'views_sum', 'views_max', 'earned'];

router.post('/contests', (req, res) => {
  const b = req.body || {};
  const name = (b.name || '').trim();
  const metric = CONTEST_METRICS.includes(b.metric) ? b.metric : null;
  const periodStart = (b.periodStart || '').trim();
  const periodEnd = (b.periodEnd || '').trim();
  if (!name) return res.status(400).json({ error: 'Укажите название конкурса' });
  if (!metric) return res.status(400).json({ error: 'Укажите метрику конкурса' });
  if (!periodStart || !periodEnd) return res.status(400).json({ error: 'Укажите период конкурса (с и по)' });
  if (new Date(periodStart).getTime() > new Date(periodEnd).getTime()) {
    return res.status(400).json({ error: 'Дата начала позже даты окончания' });
  }
  const prizes = Array.isArray(b.prizes)
    ? b.prizes.filter((p) => Array.isArray(p) && String(p[0] || '').trim() && String(p[1] || '').trim())
      .map((p) => [String(p[0]).trim(), String(p[1]).trim()])
    : [];

  const contest = {
    id: 'c' + store.contestAutoId,
    of: b.offerKey || null,
    n: name,
    metric,
    unit: store.metricUnit(metric),
    d: (b.description || '').trim(),
    periodStart, periodEnd,
    period: 'с ' + new Date(periodStart).toLocaleDateString('ru-RU') + ' по ' + new Date(periodEnd).toLocaleDateString('ru-RU'),
    fund: (b.fund || '').trim() || '—',
    prizes,
    board: [], people: 0, my: null,
  };
  store.contestAutoId = store.contestAutoId + 1;
  store.CONTESTS = [contest, ...store.CONTESTS];
  store.recomputeContests();
  res.status(201).json({ contests: store.CONTESTS, contestsAdminSummary: store.CONTESTS_ADMIN_SUMMARY });
});

router.patch('/contests/:id', (req, res) => {
  const c = store.CONTESTS.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Конкурс не найден' });
  const b = req.body || {};
  if (b.name != null && String(b.name).trim()) c.n = String(b.name).trim();
  if (b.description != null) c.d = String(b.description).trim();
  if (b.offerKey !== undefined) c.of = b.offerKey || null;
  if (b.metric && CONTEST_METRICS.includes(b.metric)) { c.metric = b.metric; c.unit = store.metricUnit(b.metric); }
  if (b.periodStart) c.periodStart = String(b.periodStart).trim();
  if (b.periodEnd) c.periodEnd = String(b.periodEnd).trim();
  if (b.periodStart || b.periodEnd) {
    c.period = 'с ' + new Date(c.periodStart).toLocaleDateString('ru-RU') + ' по ' + new Date(c.periodEnd).toLocaleDateString('ru-RU');
  }
  if (b.fund != null) c.fund = String(b.fund).trim() || '—';
  if (Array.isArray(b.prizes)) {
    c.prizes = b.prizes.filter((p) => Array.isArray(p) && String(p[0] || '').trim() && String(p[1] || '').trim())
      .map((p) => [String(p[0]).trim(), String(p[1]).trim()]);
  }
  store.recomputeContests();
  res.json({ contests: store.CONTESTS, contestsAdminSummary: store.CONTESTS_ADMIN_SUMMARY });
});

router.delete('/contests/:id', (req, res) => {
  const exists = store.CONTESTS.some((x) => x.id === req.params.id);
  if (!exists) return res.status(404).json({ error: 'Конкурс не найден' });
  store.CONTESTS = store.CONTESTS.filter((x) => x.id !== req.params.id);
  store.recomputeContests();
  res.json({ contests: store.CONTESTS, contestsAdminSummary: store.CONTESTS_ADMIN_SUMMARY });
});

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
router.get('/payouts', (req, res) => res.json(store.recomputePayoutTemplates()));

router.post('/payouts/:id/action', (req, res) => {
  const id = Number(req.params.id);
  const x = store.PAYQ.find((y) => y.id === id);
  if (!x) return res.status(404).json({ error: 'Заявка не найдена' });
  const { status } = req.body || {};
  if (!['в работе', 'выплачено', 'отклонена'].includes(status)) {
    return res.status(400).json({ error: 'Неизвестный статус' });
  }
  x.st = status;
  x.viewed = true;
  let notif = null;

  // Реальный перевод денег всё ещё делает человек (см. README — платёжного
  // провайдера нет и додумывать его не нужно). Но чтобы админу не пришлось
  // самому собирать период/разбивку по проектам из других вкладок — как
  // только заявка оказывается «в работе», формируем для него готовый
  // шаблон из тех же роликов, что уже привязаны к этой заявке полем
  // VIDEOS[].wd (см. store.recomputePayoutTemplates).
  store.recomputePayoutTemplates();

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
  store.PAYQ = [{ id: qid, c: store.MYNICK, eid: store.MYEID, s: sum, w: way, v: paidVideos.length, d: 'сегодня, только что', st: 'новая', viewed: false }, ...store.PAYQ];
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
  const contactTg = (b.contactTg || '').trim();
  const niche = (b.niche || '').trim();
  // Раньше форма пропускала заявку, если было заполнено хоть что-то одно —
  // компания или имя. Заявка без контакта или без сути продукта админу
  // ни на что не годится (написать некуда, продавать некому). Теперь
  // компания/ниша (что продвигаем) и имя/телеграм (как связаться) —
  // обязательны, остальное — по желанию.
  const missing = [];
  if (!company) missing.push('название компании');
  if (!niche) missing.push('нишу');
  if (!contactName) missing.push('имя контакта');
  if (!contactTg) missing.push('телеграм для связи');
  if (missing.length) {
    return res.status(400).json({ error: 'Заполните обязательные поля: ' + missing.join(', ') });
  }
  const modelLabel = { rev: 'RevShare', fix: 'Фикс', views: 'Оплата за просмотры' }[b.payModel] || b.payModel || '—';
  const entry = {
    id: store.briefAutoId,
    company,
    niche,
    model: modelLabel,
    budget: (b.budget || '').trim() || '—',
    date: 'сегодня',
    status: 'новая',
    site: (b.site || '').trim(),
    message: (b.message || '').trim(),
    geo: (b.geo || '').trim(),
    contactName,
    contactTg,
    note: '',
    viewed: false,
  };
  store.briefAutoId = store.briefAutoId + 1;
  store.BRIEFS = [entry, ...store.BRIEFS];
  res.status(201).json({ briefs: store.BRIEFS });
});

const BRIEF_STATUSES = ['новая', 'на модерации', 'подключён'];
router.patch('/briefs/:id', (req, res) => {
  const id = Number(req.params.id);
  const b = store.BRIEFS.find((x) => x.id === id);
  if (!b) return res.status(404).json({ error: 'Заявка не найдена' });
  const body = req.body || {};
  // Открытие карточки заявки в админке само по себе и есть «просмотр» —
  // снимаем пометку «новое», даже если админ ничего не поменял и просто
  // посмотрел (см. фронтенд: PATCH уходит сразу при открытии модалки).
  if (body.status !== undefined) {
    if (!BRIEF_STATUSES.includes(body.status)) return res.status(400).json({ error: 'Неизвестный статус' });
    b.status = body.status;
  }
  if (body.note !== undefined) b.note = String(body.note).slice(0, 2000);
  b.viewed = true;
  res.json({ briefs: store.BRIEFS });
});

// ---------------------------------------------------------------------------
// ОФФЕРЫ — админская таблица (конструктор по шаблону: название, модель,
// ставка, доступ). Отдельная сущность от OFFERS (карточки на вкладке
// «Офферы» у креатора) — см. комментарий у ADMIN_OFFERS_TABLE в store.js.
// ---------------------------------------------------------------------------
router.get('/admin/offers', (req, res) => res.json(store.ADMIN_OFFERS_TABLE));

router.post('/admin/offers', (req, res) => {
  const b = req.body || {};
  const offer = (b.offer || '').trim();
  if (!offer) return res.status(400).json({ error: 'Укажите название оффера' });
  const entry = {
    id: store.adminOfferAutoId,
    offer,
    model: (b.model || '').trim() || '—',
    rate: (b.rate || '').trim() || '—',
    perView: (b.perView || '').trim() || '—',
    connected: 0,
    paid: null,
    access: (b.access || '').trim() || 'всем',
  };
  store.adminOfferAutoId = store.adminOfferAutoId + 1;
  store.ADMIN_OFFERS_TABLE = [entry, ...store.ADMIN_OFFERS_TABLE];
  res.status(201).json({ adminOffers: store.ADMIN_OFFERS_TABLE });
});

router.patch('/admin/offers/:id', (req, res) => {
  const id = Number(req.params.id);
  const o = store.ADMIN_OFFERS_TABLE.find((x) => x.id === id);
  if (!o) return res.status(404).json({ error: 'Оффер не найден' });
  const b = req.body || {};
  if (b.offer != null && String(b.offer).trim()) o.offer = String(b.offer).trim();
  if (b.model != null) o.model = String(b.model).trim() || '—';
  if (b.rate != null) o.rate = String(b.rate).trim() || '—';
  if (b.perView != null) o.perView = String(b.perView).trim() || '—';
  if (b.access != null) o.access = String(b.access).trim() || 'всем';
  res.json({ adminOffers: store.ADMIN_OFFERS_TABLE });
});

router.delete('/admin/offers/:id', (req, res) => {
  const id = Number(req.params.id);
  const exists = store.ADMIN_OFFERS_TABLE.some((x) => x.id === id);
  if (!exists) return res.status(404).json({ error: 'Оффер не найден' });
  store.ADMIN_OFFERS_TABLE = store.ADMIN_OFFERS_TABLE.filter((x) => x.id !== id);
  res.json({ adminOffers: store.ADMIN_OFFERS_TABLE });
});

// ---------------------------------------------------------------------------
// ШКОЛА — админский список курсов (конструктор по шаблону: название +
// статистика). Реального видео/контента уроков в прототипе нет и не
// появится здесь — это создаёт только карточку курса в админке.
// ---------------------------------------------------------------------------
router.post('/school/admin/courses', (req, res) => {
  const b = req.body || {};
  const name = (b.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Укажите название курса' });
  const entry = { id: store.schoolCourseAutoId, name, started: 0, completed: 0, paid: 0 };
  store.schoolCourseAutoId = store.schoolCourseAutoId + 1;
  store.SCHOOL_ADMIN.courses = [entry, ...store.SCHOOL_ADMIN.courses];
  res.status(201).json({ schoolAdmin: store.SCHOOL_ADMIN });
});

router.patch('/school/admin/courses/:id', (req, res) => {
  const id = Number(req.params.id);
  const c = store.SCHOOL_ADMIN.courses.find((x) => x.id === id);
  if (!c) return res.status(404).json({ error: 'Курс не найден' });
  const b = req.body || {};
  if (b.name != null && String(b.name).trim()) c.name = String(b.name).trim();
  if (Number.isFinite(b.started)) c.started = b.started;
  if (Number.isFinite(b.completed)) c.completed = b.completed;
  if (Number.isFinite(b.paid)) c.paid = b.paid;
  res.json({ schoolAdmin: store.SCHOOL_ADMIN });
});

router.delete('/school/admin/courses/:id', (req, res) => {
  const id = Number(req.params.id);
  const exists = store.SCHOOL_ADMIN.courses.some((x) => x.id === id);
  if (!exists) return res.status(404).json({ error: 'Курс не найден' });
  store.SCHOOL_ADMIN.courses = store.SCHOOL_ADMIN.courses.filter((x) => x.id !== id);
  res.json({ schoolAdmin: store.SCHOOL_ADMIN });
});

module.exports = router;
