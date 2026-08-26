'use strict';

/**
 * server/store.js
 * ---------------------------------------------------------------------------
 * Единое хранилище данных для бекенда прототипа Creator Analytics.
 *
 * ВАЖНО (по просьбе заказчика): базы данных здесь НЕТ и подключать её пока
 * не нужно. Всё лежит в памяти процесса и сбрасывается при перезапуске
 * сервера — ровно так же, как раньше данные сбрасывались при обновлении
 * страницы в браузере, просто теперь общее состояние живёт на сервере, а не
 * в глобальных JS-переменных каждой отдельной вкладки.
 *
 * Каждый блок ниже — это ЗАГЛУШКА под будущее подключение реальной БД.
 * Когда база появится, нужно будет:
 *   1. Заменить структуру ниже (STORE.*) на клиента БД (например pg.Pool).
 *   2. Переписать тело функций-геттеров и мутаторов так, чтобы вместо обращения
 *      к STORE.* они делали SELECT/INSERT/UPDATE/DELETE.
 *   3. Сигнатуры функций (какие аргументы принимают, что возвращают) менять
 *      не обязательно — роуты в server/routes/*.js от них не зависят.
 *
 * Тестовые данные ниже — это ровно те же данные, что были захардкожены
 * в оригинальном прототипе (public/index.html), перенесённые один в один,
 * чтобы после переезда на бекенд на экране ничего не изменилось.
 */

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

// ---------------------------------------------------------------------------
// Общие хелперы (раньше жили в server/routes/api.js — вынесены сюда, т.к.
// теперь нужны и расчёту конкурсов, и шаблону выплаты, не только апруву).
// ---------------------------------------------------------------------------
function pay(views, rate, k) {
  return Math.round(views * (rate || 0) * k);
}
// Множитель ставки за просмотр по уровню креатора. Раньше он применялся
// только на клиентском калькуляторе-«прикидке» (креатор видел ставку уже
// с учётом уровня), а сама модерация, история принятых, конкурсы и шаблон
// выплаты считали по голой базовой ставке — без множителя. Из-за этого
// «ожидаемая» и реально начисленная сумма могли расходиться. Теперь
// множитель уровня — обязательная часть формулы pay() везде, где считаются
// реальные деньги.
// Если для записи уровень был зафиксирован в момент события (snapshotLv —
// см. MOD/DONE, куда уровень пишется при разметке/приёме), используем его:
// платить нужно по уровню на момент ролика, а не задним числом пересчитывать
// по текущему. Для записей без снимка (старые тестовые данные, до появления
// этого поля) — берём текущий уровень креатора как разумный запасной вариант.
function levelMultForNick(nick, snapshotLv) {
  const lv = snapshotLv || (CREATORS.find((c) => c.n === nick) || {}).lv || 1;
  return LVM[lv] || 1;
}
function fmtViews(v) {
  return v >= 1000 ? (v / 1000).toFixed(1).replace('.0', '') + 'K' : String(v);
}
function ruPlural(n, one, few, many) {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return few;
  return many;
}
function ruDays(n) {
  return ruPlural(n, 'день', 'дня', 'дней');
}
// Подсказка имени по нику в Telegram — используется при первом входе
// креатора, когда он ещё не выбрал отображаемое имя (см. CREATORS.name
// ниже и POST /creators/me/name в api.js). Правило простое и предсказуемое:
// берём буквенный кусок ника до первого разделителя (цифры/подчёркивание/
// точка); если он короче 3 букв (типа «a11esey») — берём все буквы ника
// целиком; если получилось длиннее 6 букв — оставляем первые 4 (короткое
// имя выглядит естественнее, чем обрезок ника целиком). Это ТОЛЬКО
// подсказка в поле ввода — креатор может стереть её и написать своё имя.
function suggestNameFromNick(nick) {
  const raw = String(nick || '').replace(/^@/, '');
  const m = raw.match(/^[a-zA-Zа-яёА-ЯЁ]+/);
  let base = m ? m[0] : '';
  if (base.length < 3) base = raw.replace(/[^a-zA-Zа-яёА-ЯЁ]/g, '');
  if (!base) return '';
  if (base.length > 6) base = base.slice(0, 4);
  return base.charAt(0).toUpperCase() + base.slice(1).toLowerCase();
}
// Занято ли имя другим креатором (сравнение без учёта регистра/пробелов
// по краям) — имена должны быть уникальны, см. POST /creators/me/name.
function isNameTaken(name, exceptNick) {
  const norm = String(name || '').trim().toLowerCase();
  if (!norm) return false;
  return CREATORS.some((c) => c.n !== exceptNick && String(c.name || '').trim().toLowerCase() === norm);
}

// =============================================================================
// ОФФЕРЫ — то, что видит креатор на вкладке «Офферы»
// TODO(DB): таблица offers (n, model, description, geo[], epl, conf, hold,
//           rate, goals jsonb, best bool, promo bool, state)
// =============================================================================
const OFFERS = [
  { n: 'Study AI', m: 'RevShare', d: 'Агрегатор нейросетей по подписке', best: 1, geo: ['🇷🇺'], epl: '350 RUB', conf: '19.47%', hold: '0', rate: '0,15 ₽',
    goals: [['Первая подписка', '85 %', '180'], ['Повторная подписка', '20 %', '180'], ['Пополнение баланса', '20 %', '180']], state: 'on' },
  { n: 'Кэмп', m: 'RevShare', d: 'Кэмп — нейросеть для студента', geo: ['🇷🇺', '🇰🇿', '🇧🇾'], epl: '58 RUB', conf: '23.99%', hold: '0', rate: '0,20 ₽',
    goals: [['Первая подписка', '70 %', '180'], ['Повторная подписка', '30 %', '180']], state: 'free' },
  { n: 'Кэмп', m: 'Фикс', d: 'Кэмп — нейросеть для студента', promo: 1, geo: ['🇷🇺'], epl: '300 RUB', conf: '18.43%', hold: '0', rate: '0,20 ₽',
    goals: [['Первая подписка', '300 RUB', '180'], ['Повторная подписка', '100 RUB', '180']], state: 'free' },
  { n: 'Автор24 — мобильное приложение', m: 'Фикс', d: 'Установка и первый заказ', best: 1, promo: 1, geo: ['🇷🇺', '🇺🇦', '🇰🇿', '🇧🇾'], epl: '53 RUB', conf: '80.76%', hold: '30', rate: '0,10 ₽',
    goals: [['Новый заказ', '2 000 RUB', '30']], state: 'lvl3' },
  { n: 'Автор24', m: 'RevShare', d: 'Написание академических работ', best: 1, promo: 1, geo: ['🇷🇺'], epl: '1 500 RUB', conf: '95.76%', hold: '20 дней', rate: '0,10 ₽',
    goals: [['Новый заказ', '20 %', '30 дней'], ['Ребиллы', '20 %', '180 дней']], state: 'lvl3' },
  { n: 'Studybay', m: 'RevShare', d: 'A-Plus Homework Help For All', best: 1, promo: 1, geo: ['🇺🇸', '🇦🇺', '🇨🇦'], epl: '10 USD', conf: '96.94%', hold: '20 дней', rate: '—',
    goals: [['Новый заказ', '60 %', '30 дней'], ['Ребиллы', '15 %', '360 дней']], state: 'soon' },
];

// =============================================================================
// ФОРМАТЫ РОЛИКОВ / КОЭФФИЦИЕНТЫ — используются и при разметке ролика
// креатором (n+d), и на админской странице «Ставки» (d). Раньше это были
// два независимых списка (FMT и COEF) с одними и теми же значениями k —
// здесь это один источник правды.
// TODO(DB): таблица format_coefficients (k numeric, n text, d text)
// =============================================================================
const FORMATS = [
  { k: 0.05, n: 'Упоминание', d: 'сервис назван вскользь, без показа' },
  { k: 0.3, n: 'Мини-туториал', d: 'короткая демонстрация, как пользуешься' },
  { k: 0.7, n: 'Полный туториал', d: 'разбор задачи от начала до результата' },
  { k: 1, n: 'Туториал с разбором возможностей', d: 'подробно показаны несколько функций' },
  { k: 1.5, n: 'Обзор с названием и промокодом', d: 'полный обзор, назван сервис и промокод' },
];

// =============================================================================
// МОИ ВИДЕО (креатор @marsedzhan) — вкладка «Мои видео»
// TODO(DB): таблица videos (id, creator_nick, platform, offer_key, format_k,
//           published_at, views, er, status, withdrawal_id)
// =============================================================================
const VIDEOS = [
  { i: 0, p: 'tt', of: null, k: 0, d: '31.07.2026', v: 694300, er: '14.41%', st: 'none', wd: 0 },
  { i: 1, p: 'tt', of: 'Study AI', k: 0.05, d: '17.07.2026', v: 320700, er: '6.78%', st: 'ok', wd: 0 },
  { i: 2, p: 'tt', of: 'Study AI', k: 0.3, d: '16.07.2026', v: 44500, er: '8.11%', st: 'ok', wd: 0 },
  { i: 3, p: 'tt', of: 'Study AI', k: 0.05, d: '23.07.2026', v: 28000, er: '4.61%', st: 'ok', wd: 0 },
  { i: 4, p: 'tt', of: 'Study AI', k: 0.7, d: '05.08.2026', v: 112000, er: '7.20%', st: 'wait', wd: 0 },
  { i: 5, p: 'tt', of: null, k: 0, d: '03.08.2026', v: 2500, er: '5.70%', st: 'small', wd: 0 },
  { i: 6, p: 'yt', of: null, k: 0, d: '16.07.2026', v: 1400, er: '4.03%', st: 'small', wd: 0 },
  { i: 7, p: 'ig', of: null, k: 0, d: '15.07.2026', v: 590, er: '4.92%', st: 'small', wd: 0 },
];

// =============================================================================
// КРЕАТОРЫ (админ «Креаторы») — read-only список базы
// TODO(DB): таблица creators (n, id эдуграма, lv, r охваты, ct контент,
//           lk лайки, cm коммент, e ER, v доход с просмотров, f доход по
//           рефке, p доход по промокоду, sc доход со скаутинга, pays, code)
// =============================================================================
const CREATORS = [
  { n: '@sochi_nat', id: 629410, lv: 2, r: '113.6K', ct: 86, lk: '1.2K', cm: '25', e: '1.10%', v: 0, f: 31321, p: 1400, sc: 1043, pays: 41, code: 'NATA10' },
  { n: '@basuha220', id: 628745, lv: 1, r: '14.13M', ct: 369, lk: '363K', cm: '6.1K', e: '2.61%', v: 98052, f: 10566, p: 800, sc: 165, pays: 18, code: 'PROMO8310' },
  { n: '@angelo4ek2003', id: 628504, lv: 1, r: '9.77M', ct: 166, lk: '182.2K', cm: '1.3K', e: '1.88%', v: 85701, f: 3926, p: 500, sc: 0, pays: 12, code: 'PROMO710' },
  { n: '@marsedzhan', id: 629398, lv: 1, r: '1.4M', ct: 80, lk: '127.9K', cm: '3.9K', e: '9.39%', v: 9920, f: 3213, p: 500, sc: 796, pays: 14, code: 'MARS10' },
  { n: '@a11esey', id: 629381, lv: 1, r: '9.64M', ct: 177, lk: '471K', cm: '1.9K', e: '4.90%', v: 54439, f: 2654, p: 200, sc: 0, pays: 5, code: 'SKIDKA84' },
  { n: '@frilans_aa', id: 629515, lv: 1, r: '1.23M', ct: 22, lk: '18.9K', cm: '149', e: '1.56%', v: 363, f: 1581, p: 100, sc: 0, pays: 3, code: 'ALEKSA' },
  { n: '@maximova_tahsa', id: 628800, lv: 1, r: '396.7K', ct: 216, lk: '3.1K', cm: '312', e: '0.87%', v: 1305, f: 668, p: 0, sc: 0, pays: 2, code: 'PROMO5910' },
  { n: '@wowluda', id: 628838, lv: 1, r: '4.39M', ct: 91, lk: '153.2K', cm: '848', e: '3.51%', v: 4220, f: 0, p: 0, sc: 0, pays: 0, code: '—' },
  { n: '@lovi_neuro', id: 628952, lv: 1, r: '593.2K', ct: 148, lk: '8K', cm: '343', e: '1.40%', v: 3857, f: 0, p: 0, sc: 0, pays: 0, code: 'LOVI' },
  { n: '@tanya_createss', id: 628971, lv: 1, r: '7.65M', ct: 17, lk: '274.9K', cm: '1.9K', e: '3.62%', v: 248, f: 0, p: 0, sc: 0, pays: 0, code: '—' },
];
// Отображаемое имя — креатор выбирает его сам при первом входе в личный
// кабинет (см. TOUR/namecard во фронте и POST /creators/me/name ниже).
// Ник в Telegram (n) остаётся служебным идентификатором и виден только
// админу — креаторы видят друг друга по этому имени (топы, лидерборды).
// null = ещё не выбрано. У @marsedzhan (единственный креатор, за которого
// реально «заходят» в прототипе) имя намеренно не задано — это и есть
// демонстрация экрана «укажи своё имя» при первом входе. Остальным девяти
// имя подставлено автоматически (как будто они прошли этот шаг раньше),
// чтобы таблица у админа и лидерборды выглядели естественно.
CREATORS.forEach((c) => {
  c.name = c.n === '@marsedzhan' ? null : suggestNameFromNick(c.n);
  // Почта креатора — нигде в системе не собирается (не при регистрации, не
  // в брифе), но нужна дальше по процессу выплаты (см. buildPayoutTemplate
  // ниже). Слот под неё: null, пока админ не впишет её один раз в шаблоне
  // выплаты — дальше подставляется сама на все будущие шаблоны этого креатора.
  c.email = null;
});

const LVN = { 1: 'Новичок', 2: 'Активный', 3: 'Профи', 4: 'Топ' };
const LVG = { 1: 30, 2: 60, 3: 100, 4: 100 }; // оплат за последние 30 дней
let LVM = { 1: 1, 2: 1.2, 3: 1.4, 4: 1.6 }; // множитель ставки за просмотр — редактируется в «Ставках»
const MYNICK = '@marsedzhan', MYEID = 629398;

// ---------------------------------------------------------------------------
// ПЕРЕСЧЁТ УРОВНЕЙ — раньше уровень креатора (lv) был статичным полем,
// которое никто и никогда не менял. Теперь он реально считается по числу
// оплат за последние 30 дней (то же правило, что уже было написано в
// подсказках фронтенда: «меньше 30 оплат» = уровень 1, «от LVG[1]» = уровень
// 2 и т.д.).
//
// ВАЖНО: точность этого пересчёта ограничена тем, что метка времени (ts)
// есть только у оплат, принятых ПОСЛЕ этого изменения — у семи «исторических»
// записей DONE ts нет, и в окно 30 дней они сознательно не попадают. Когда
// появится реальная БД, это исчезнет само — данные будут приходить с
// нормальными timestamp'ами из таблицы moderation_done.
// ---------------------------------------------------------------------------
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function levelForPaymentsCount(n) {
  if (n >= LVG[3]) return 4;
  if (n >= LVG[2]) return 3;
  if (n >= LVG[1]) return 2;
  return 1;
}

function recalcCreatorLevel(nick) {
  const creator = CREATORS.find((c) => c.n === nick);
  if (!creator) return null;
  const cutoff = Date.now() - THIRTY_DAYS_MS;
  const recentPayments = DONE.filter((d) => d.c === nick && typeof d.ts === 'number' && d.ts >= cutoff).length;
  const newLevel = levelForPaymentsCount(recentPayments);
  const changed = newLevel !== creator.lv;
  const prevLevel = creator.lv;
  creator.lv = newLevel;
  return { nick, prevLevel, newLevel, changed, recentPayments };
}

function recalcAllLevels() {
  return CREATORS.map((c) => recalcCreatorLevel(c.n)).filter(Boolean);
}

// =============================================================================
// ОЧЕРЕДЬ ПРОВЕРКИ РОЛИКОВ (админ «Проверка роликов»)
// TODO(DB): таблица moderation_queue (i, creator, lv, platform, views,
//           offer_key, k, why)
// =============================================================================
let MOD = [
  { i: 0, c: '@marsedzhan', lv: 2, p: 'tt', v: 112000, of: 'Study AI', k: 0.7, viewed: false },
  { i: 1, c: '@wowluda', lv: 1, p: 'ig', v: 86400, of: 'Study AI', k: 1.5, viewed: false },
  { i: 2, c: '@lovi_neuro', lv: 1, p: 'ig', v: 31200, of: 'Study AI', k: 1, viewed: false },
  { i: 3, c: '@frilans_aa', lv: 2, p: 'ig', v: 24800, of: 'Study AI', k: 0.3, viewed: false },
  { i: 4, c: '@naka_neiro', lv: 1, p: 'tt', v: 18600, of: 'Кэмп', k: 0.7, viewed: false },
  { i: 5, c: '@maximova_tahsa', lv: 1, p: 'vk', v: 9300, of: 'Study AI', k: 0.05, viewed: false },
];
let modAutoId = 1000;
let doneAutoId = 1000;

// Базовая ставка за просмотр по офферу (₽ на первом уровне)
// TODO(DB): колонка rate_per_view в таблице offers (сейчас отдельная карта,
//           т.к. в прототипе так же было отдельно от списка OFFERS)
let RATE = { 'Study AI': 0.15, 'Кэмп': 0.20, 'Автор24': 0.10 };

// =============================================================================
// УЖЕ ПРИНЯТЫЕ РОЛИКИ (админ «Проверка роликов» → «Уже принятые»)
// TODO(DB): таблица moderation_done (i, creator, platform, views, offer_key,
//           k, accepted_by, accepted_at, why)
// =============================================================================
let DONE = [
  { i: 100, c: '@marsedzhan', p: 'tt', v: 320700, of: 'Study AI', k: 0.05, by: 'авто', dt: '17 июля' },
  { i: 101, c: '@marsedzhan', p: 'tt', v: 44500, of: 'Study AI', k: 0.3, by: 'Наталья', dt: '16 июля' },
  { i: 102, c: '@basuha220', p: 'tt', v: 1210000, of: 'Study AI', k: 0.7, by: 'Наталья', dt: '22 июля' },
  { i: 103, c: '@a11esey', p: 'yt', v: 812000, of: 'Study AI', k: 0.7, by: 'Наталья', dt: '19 июля' },
  { i: 104, c: '@sochi_nat', p: 'ig', v: 42000, of: 'Study AI', k: 1.5, by: 'Наталья', dt: '25 июля' },
  { i: 105, c: '@angelo4ek2003', p: 'vk', v: 430000, of: 'Study AI', k: 0.05, by: 'авто', dt: '28 июля' },
  { i: 106, c: '@lovi_neuro', p: 'ig', v: 180000, of: 'Study AI', k: 0.3, by: 'Наталья', dt: '30 июля' },
];

// =============================================================================
// ДАШБОРД СООБЩЕСТВА — топ роликов месяца (креатор «Дашборд»)
// TODO(DB): вью/материализованный запрос top_videos_month
// =============================================================================
const TOP_VIDEOS = [
  { c: '@tanya_createss', p: 'ig', of: 'Study AI', v: 1480000, lk: '77K', er: '5.20%' },
  { c: '@basuha220', p: 'tt', of: 'Study AI', v: 1210000, lk: '47.2K', er: '3.90%' },
  { c: '@angelo4ek2003', p: 'tt', of: 'Study AI', v: 905000, lk: '21.7K', er: '2.40%' },
  { c: '@a11esey', p: 'yt', of: 'Study AI', v: 812000, lk: '49.5K', er: '6.10%' },
  { c: '@marsedzhan', p: 'tt', of: '—', v: 694300, lk: '97K', er: '14.41%' },
  { c: '@basuha220', p: 'ig', of: 'Study AI', v: 640000, lk: '26.2K', er: '4.10%' },
  { c: '@wowluda', p: 'ig', of: 'Study AI', v: 520000, lk: '19.8K', er: '3.80%' },
  { c: '@a11esey', p: 'tt', of: 'Study AI', v: 480000, lk: '25.9K', er: '5.40%' },
  { c: '@angelo4ek2003', p: 'vk', of: 'Study AI', v: 430000, lk: '8.2K', er: '1.90%' },
  { c: '@marsedzhan', p: 'tt', of: 'Study AI', v: 320700, lk: '21.3K', er: '6.78%' },
  { c: '@lovi_neuro', p: 'ig', of: 'Study AI', v: 180000, lk: '3.8K', er: '2.10%' },
  { c: '@marsedzhan', p: 'tt', of: 'Study AI', v: 44500, lk: '3.6K', er: '8.11%' },
  { c: '@sochi_nat', p: 'ig', of: 'Study AI', v: 42000, lk: '756', er: '1.80%' },
  { c: '@frilans_aa', p: 'ig', of: 'Study AI', v: 38000, lk: '988', er: '2.60%' },
  { c: '@sochi_nat', p: 'ig', of: 'Study AI', v: 31000, lk: '682', er: '2.20%' },
];

// =============================================================================
// КОНКУРСЫ — общие для креаторской и админской страниц «Конкурсы»
// adminStatus — то, как статус подписан в админской таблице (там 4 текстовых
// статуса: идёт/запланирован/черновик, а полю st для логики хватает live/soon)
// TODO(DB): таблица contests (+ contest_leaderboard, contest_prizes jsonb)
//
// Ниже — четыре «исторических» конкурса из прототипа, у них нет periodStart/
// periodEnd/metric (это старые статичные заглушки для витрины). Реальный
// конструктор (POST /api/contests) создаёт конкурсы уже с этими полями и их
// лидерборд считается по-настоящему функцией computeContestBoard() — из
// реальных данных DONE, а не выдумывается.
// =============================================================================
let CONTESTS = [
  { id: 'c1', of: 'Study AI', n: 'Больше всех оплат', st: 'live', adminStatus: 'идёт',
    d: 'Кто приведёт больше новых оплат за месяц. Минимальный порог участия — 5 оплат. Подробные условия в общем чате.',
    period: '1 — 31 августа', left: '24 дня', people: 34, fund: '200 000 ₽', unit: 'оплат',
    my: { pos: 4, val: '14 оплат', next: 'до 3 места — 4 оплаты' },
    board: [['@sochi_nat', '55 оплат'], ['@basuha220', '26 оплат'], ['@angelo4ek2003', '17 оплат'], ['@marsedzhan', '14 оплат'], ['@a11esey', '7 оплат'], ['@frilans_aa', '4 оплаты'], ['@zienbulat', '3 оплаты']],
    prizes: [['🥇 1 место', '15 000 ₽'], ['🥈 2 место', '10 000 ₽'], ['🥉 3 место', '8 000 ₽'], ['4 — 10 место', 'по 5 000 ₽'], ['10 — 50 место', 'по 2 000 ₽']] },

  { id: 'c2', of: 'Study AI', n: 'Самое вирусное видео', st: 'live', adminStatus: 'идёт',
    d: 'Один ролик с упоминанием сервиса — побеждает тот, у кого больше просмотров. Ролик должен быть размечен под оффер Study AI.',
    period: '1 — 31 августа', left: '24 дня', people: 19, fund: '250 000 ₽', unit: 'просмотров',
    my: { pos: 2, val: '694.3K просмотров', next: 'до 1 места — 506K просмотров' },
    board: [['@basuha220', '1.2M просмотров'], ['@marsedzhan', '694.3K просмотров'], ['@a11esey', '512K просмотров'], ['@tanya_createss', '430K просмотров'], ['@wowluda', '288K просмотров']],
    prizes: [['🥇 1 место', '10 000 ₽'], ['🥈 2 место', '5 000 ₽'], ['🥉 3 место', '3 000 ₽']] },

  { id: 'c3', of: 'Кэмп', n: 'Первые 100 подписок', st: 'soon', adminStatus: 'запланирован',
    d: 'Стартует, когда оффер откроется для всех. Награда за первые подписки по новому офферу.',
    period: 'старт 15 августа', left: 'через 8 дней', people: 0, fund: '50 000 ₽', unit: 'подписок',
    my: null, board: [], prizes: [['🥇 1 место', '20 000 ₽'], ['🥈 2 место', '15 000 ₽'], ['🥉 3 место', '10 000 ₽'], ['4 — 10 место', 'по 5 000 ₽']] },

  { id: 'c4', of: 'Автор24', n: 'Тест ниши: студенты', st: 'soon', adminStatus: 'черновик',
    d: 'Кто первым найдёт рабочую связку под студенческую аудиторию. Оценивается конверсия, а не объём.',
    period: 'старт в сентябре', left: '—', people: 0, fund: '30 000 ₽', unit: '—',
    my: null, board: [], prizes: [['🥇 1 место', '15 000 ₽'], ['🥈 2 место', '10 000 ₽'], ['🥉 3 место', '5 000 ₽']] },
];

// Сводные карточки над админской таблицей «Конкурсы» — в прототипе это были
// отдельные статичные числа, не вычисляемые из списка конкурсов, поэтому
// оставляем их отдельной заглушкой, а не суммой по CONTESTS.
// TODO(DB): вью contests_admin_summary
let CONTESTS_ADMIN_SUMMARY = { live: 2, planned: 2, participants: 41, fund: '500 000 ₽' };
let contestAutoId = 5; // c1..c4 уже заняты историческими конкурсами выше

// ---------------------------------------------------------------------------
// КОНСТРУКТОР КОНКУРСОВ — считает лидерборд из уже существующих данных
// (DONE — принятые размеченные ролики), ничего не выдумывает и не хранит
// отдельно. Метрика конкурса — это то, что можно посчитать по DONE:
//   payments   — количество принятых роликов creator'а за период
//   views_sum  — сумма просмотров принятых роликов за период
//   views_max  — лучший (по просмотрам) один ролик за период
//   earned     — сколько всего начислено (₽) за период
// Период (periodStart/periodEnd) и offerKey (necesito фильтр по офферу,
// null = все офферы) задаются админом в конструкторе.
//
// ОГРАНИЧЕНИЕ (см. также recalcCreatorLevel выше): считаются только те
// записи DONE, у которых есть реальный timestamp (ts) — то есть принятые
// ПОСЛЕ появления этого конструктора. Семь исторических записей без ts в
// подсчёт не попадают. Это станет неактуально после подключения БД.
// ---------------------------------------------------------------------------
function metricUnit(metric) {
  if (metric === 'earned') return '₽';
  if (metric === 'payments') return 'оплат';
  return 'просмотров';
}
function metricLabel(metric) {
  return {
    payments: 'Количество принятых роликов',
    views_sum: 'Сумма просмотров',
    views_max: 'Лучший ролик по просмотрам',
    earned: 'Начислено, ₽',
  }[metric] || metric;
}
function fmtMetricValue(metric, v) {
  if (metric === 'earned') return v.toLocaleString('ru-RU') + ' ₽';
  if (metric === 'payments') return v.toLocaleString('ru-RU') + ' ' + ruPlural(v, 'оплата', 'оплаты', 'оплат');
  return v.toLocaleString('ru-RU') + ' просмотров';
}
function contestStatus(c) {
  const now = Date.now();
  const start = c.periodStart ? new Date(c.periodStart).getTime() : null;
  const end = c.periodEnd ? new Date(c.periodEnd + 'T23:59:59').getTime() : null;
  if (start !== null && now < start) return 'soon';
  if (end !== null && now > end) return 'ended';
  return 'live';
}
function contestLeftLabel(c, st) {
  const now = Date.now();
  if (st === 'ended') return 'завершён';
  if (!c.periodStart && !c.periodEnd) return c.left || '—'; // старые статичные конкурсы без периода
  if (st === 'soon') {
    const days = Math.max(1, Math.ceil((new Date(c.periodStart).getTime() - now) / 86400000));
    return 'через ' + days + ' ' + ruDays(days);
  }
  const days = Math.max(0, Math.ceil((new Date(c.periodEnd + 'T23:59:59').getTime() - now) / 86400000));
  return days <= 0 ? 'последний день' : days + ' ' + ruDays(days);
}
function computeContestBoard(c) {
  if (!c.metric || (!c.periodStart && !c.periodEnd)) return c; // старый статичный конкурс — не трогаем
  const start = c.periodStart ? new Date(c.periodStart).getTime() : null;
  const end = c.periodEnd ? new Date(c.periodEnd + 'T23:59:59').getTime() : null;
  const entries = DONE.filter((d) => {
    if (typeof d.ts !== 'number') return false;
    if (c.of && d.of !== c.of) return false;
    if (start !== null && d.ts < start) return false;
    if (end !== null && d.ts > end) return false;
    return true;
  });
  const byCreator = {};
  entries.forEach((d) => {
    if (!byCreator[d.c]) byCreator[d.c] = { payments: 0, views_sum: 0, views_max: 0, earned: 0 };
    const b = byCreator[d.c];
    b.payments += 1;
    b.views_sum += d.v;
    b.views_max = Math.max(b.views_max, d.v);
    b.earned += pay(d.v, RATE[d.of] * levelMultForNick(d.c, d.lv), d.k);
  });
  const ranked = Object.keys(byCreator)
    .map((nick) => ({ nick, value: byCreator[nick][c.metric] }))
    .sort((a, b) => b.value - a.value);
  c.board = ranked.slice(0, 10).map((r) => [r.nick, fmtMetricValue(c.metric, r.value)]);
  c.people = ranked.length;
  const myIdx = ranked.findIndex((r) => r.nick === MYNICK);
  if (myIdx === -1) {
    c.my = null;
  } else {
    const mine = ranked[myIdx];
    const above = ranked[myIdx - 1];
    c.my = {
      pos: myIdx + 1,
      val: fmtMetricValue(c.metric, mine.value),
      next: above ? ('до ' + myIdx + ' места — ' + fmtMetricValue(c.metric, above.value - mine.value)) : 'ты на первом месте!',
    };
  }
  c.lastComputedAt = Date.now();
  return c;
}
function recomputeContests() {
  CONTESTS.forEach((c) => {
    if (c.periodStart || c.periodEnd) {
      c.st = contestStatus(c);
      c.adminStatus = { live: 'идёт', soon: 'запланирован', ended: 'завершён' }[c.st];
    }
    c.left = contestLeftLabel(c, c.st);
    if (c.metric) c.unit = metricUnit(c.metric);
    computeContestBoard(c);
  });
  const fundTotal = CONTESTS.reduce((sum, c) => sum + (Number(String(c.fund || '').replace(/[^\d]/g, '')) || 0), 0);
  CONTESTS_ADMIN_SUMMARY = {
    live: CONTESTS.filter((c) => c.st === 'live').length,
    planned: CONTESTS.filter((c) => c.st === 'soon').length,
    participants: new Set(CONTESTS.flatMap((c) => (c.board || []).map((b) => b[0]))).size || CONTESTS_ADMIN_SUMMARY.participants,
    fund: fundTotal ? fundTotal.toLocaleString('ru-RU') + ' ₽' : CONTESTS_ADMIN_SUMMARY.fund,
  };
  return CONTESTS;
}

// ---------------------------------------------------------------------------
// ШАБЛОН ДЛЯ ЗАЯВКИ НА ВЫПЛАТУ, КОГДА ОНА «В РАБОТЕ» — сама выплата всё ещё
// делается вручную (см. README), но админу теперь не нужно самому собирать
// эти данные по разным вкладкам: ролики этой заявки уже помечены полем
// wd = id заявки, отсюда и период, и разбивка по проектам.
// Почта креатора нигде в системе не собирается (не при регистрации, не в
// брифе) — шаблон её не выдумывает, только подставляет, если админ уже
// вписал её один раз (см. CREATORS.email и PATCH /creators/:nick/email).
// Пока не вписана — в idLine оставлена явная метка-слот, а не молчаливый
// пропуск, чтобы было видно, что поле есть, но пусто.
// ---------------------------------------------------------------------------
function buildPayoutTemplate(x) {
  const videos = VIDEOS.filter((v) => v.wd === x.id);
  let minTs = null, maxTs = null;
  const byOffer = {};
  videos.forEach((v) => {
    const parts = String(v.d).split('.').map(Number);
    const t = new Date(parts[2] || 1970, (parts[1] || 1) - 1, parts[0] || 1).getTime();
    if (minTs === null || t < minTs) minTs = t;
    if (maxTs === null || t > maxTs) maxTs = t;
    const key = v.of || '—';
    byOffer[key] = (byOffer[key] || 0) + pay(v.v, RATE[key] * levelMultForNick(x.c), v.k);
  });
  const fmtDate = (t) => (t == null ? '—' : new Date(t).toLocaleDateString('ru-RU'));
  const creator = CREATORS.find((c) => c.n === x.c);
  const email = (creator && creator.email) || null;
  return {
    idLine: x.c + ' · ID эдуграм ' + x.eid + ' · ' + (email || 'email не указан'),
    email,
    period: 'с ' + fmtDate(minTs) + ' по ' + fmtDate(maxTs),
    projects: Object.keys(byOffer).map((of) => of + ' — ' + byOffer[of].toLocaleString('ru-RU') + ' ₽'),
    total: x.s.toLocaleString('ru-RU') + ' ₽',
    method: x.w === 'на карту' ? 'по СМЗ на карту' : x.w,
  };
}
// Заявки, которые уже были «в работе» на момент старта сервера (тестовые
// данные) или стали такими до подключения этого шаблона, иначе никогда не
// получили бы template — сама заявка ставится в статус «в работе» только
// один раз, и одноразовая простановка внутри /payouts/:id/action ловит
// только переход В этот статус, а не «уже находится в нём». Пересчитываем
// на каждое обращение, чтобы шаблон совпадал с реально привязанными
// роликами, даже если разметка изменилась после того, как заявка ушла в работу.
function recomputePayoutTemplates() {
  PAYQ.forEach((x) => {
    if (x.st === 'в работе') x.template = buildPayoutTemplate(x);
  });
  return PAYQ;
}

// =============================================================================
// СТАВКИ — базовая ставка по офферу для «Ставок» + порог оплаты
// TODO(DB): таблица offer_rates (n, v), настройка min_views в table settings
// =============================================================================
let RATES = [{ n: 'Study AI', v: 0.15 }, { n: 'Кэмп', v: 0.20 }, { n: 'Автор24', v: 0.10 }];
let MIN_VIEWS = 5000;

// =============================================================================
// ТЕМА НЕДЕЛИ — раньше в прототипе это была статичная надпись «×1,2»
// и в кабинете креатора, и на лендинге. Теперь это реальная сущность:
// админ задаёт её на странице «Ставки», а креаторы видят актуальную версию.
// TODO(DB): таблица week_themes (см. аналогичную фичу в соседнем проекте
//           packages/api/src/routes/week-theme.ts — та же идея, тут своя
//           отдельная реализация без БД)
// =============================================================================
let WEEK_THEME = {
  title: 'AI-карточки для маркетплейсов',
  description: 'У роликов на эту тему сейчас самая высокая конверсия, поэтому коэффициент повышен до конца недели.',
  offerKey: 'Study AI',
  multiplier: 1.2,
};

// =============================================================================
// ВЫПЛАТЫ (админ «Выплаты») + ВЫВОДЫ и БАЛАНС креатора (кабинет «Мой кабинет»)
// TODO(DB): таблицы payout_requests (id, creator, eid, sum, way, videos_count,
//           requested_at, status) и withdrawals (date, sum, way, videos_count,
//           status, payout_id); balance — поле в таблице creators
// =============================================================================
let PAYQ = [
  { id: 101, c: '@sochi_nat', eid: 629410, s: 31321, w: 'на карту', v: 0, d: 'сегодня, 11:20', st: 'новая', viewed: false },
  { id: 102, c: '@basuha220', eid: 628745, s: 12480, w: 'из ЛК SREDA', v: 9, d: 'вчера, 18:04', st: 'в работе', viewed: true },
  { id: 103, c: '@angelo4ek2003', eid: 629233, s: 7300, w: 'на карту', v: 5, d: '8 августа', st: 'выплачено', viewed: true },
  { id: 104, c: '@lovi_neuro', eid: 629512, s: 2150, w: 'на карту', v: 3, d: '5 августа', st: 'выплачено', viewed: true },
  { id: 105, c: '@frilans_aa', eid: 629688, s: 1040, w: 'на карту', v: 2, d: '4 августа', st: 'отклонена', viewed: true },
];
let WD = [
  { d: '22 июля', s: 8400, w: 'на карту', v: 3, st: 'выплачено', q: null },
  { d: '8 июля', s: 5620, w: 'из ЛК SREDA', v: 2, st: 'выплачено', q: null },
];
let BAL = 15053;

// =============================================================================
// УВЕДОМЛЕНИЯ (креатор @marsedzhan)
// TODO(DB): таблица notifications (creator_nick, type, title, text, created_at, unread)
// =============================================================================
let NOTIF = [
  { t: 'ok', ti: 'Ролик принят', tx: 'TikTok от 16 июля · коэффициент 0,3 · начислено 2 003 ₽', tm: '2 часа назад', n: 1 },
  { t: 'cup', ti: 'Конкурс заканчивается через 3 дня', tx: 'Ты на 4 месте. До третьего — 4 оплаты, это 8 000 ₽ призовых', tm: 'сегодня, 09:00', n: 1 },
  { t: 'scout', ti: 'Твой креатор начал зарабатывать', tx: '@lena.creates сделала первую оплату — тебе начислено 27 ₽', tm: 'вчера', n: 1 },
  { t: 'down', ti: 'Коэффициент изменён', tx: 'Ролик от 23 июля: 0,3 → 0,05. Причина: сервис только назван, показа нет', tm: '23 июля', n: 0 },
  { t: 'lvl', ti: 'Уровень вырос', tx: 'Теперь 2 уровень — ставка за просмотр 0,18 ₽ вместо 0,15 ₽', tm: '1 июля', n: 0 },
];

// =============================================================================
// ШКОЛА — прогресс креатора + сводная статистика для админа
// TODO(DB): таблицы school_courses, school_progress (creator_nick, course_id, status)
// =============================================================================
const SCHOOL_MINE = {
  completed: 2, total: 9,
  lessons: [
    { title: 'ИИ Блогер: быстрый старт', modules: 5, status: 'done', progressLabel: 'пройдено' },
    { title: 'AI-музыка: от промпта до трека', modules: 12, status: 'done', progressLabel: 'пройдено' },
    { title: 'AI-карточки для маркетплейсов', modules: 12, status: 'progress', progressLabel: '4 из 12' },
    { title: 'AI-фотосессии', modules: 14, status: 'locked', progressLabel: null },
    { title: 'SMM под ключ на AI', modules: 12, status: 'locked', progressLabel: null },
  ],
};
const SCHOOL_ADMIN = {
  started: 64, completed: 21, multiplier: '×3.4',
  courses: [
    { id: 1, name: 'ИИ Блогер: быстрый старт', started: 64, completed: 21, paid: 14 },
    { id: 2, name: 'AI-карточки для маркетплейсов', started: 28, completed: 9, paid: 7 },
    { id: 3, name: 'AI-музыка', started: 19, completed: 6, paid: 3 },
    { id: 4, name: 'SMM под ключ', started: 12, completed: 2, paid: 0 },
  ],
};
let schoolCourseAutoId = 5;

// =============================================================================
// СКАУТИНГ — «мои приведённые» (креатор) + «кто кого привёл» (админ)
// TODO(DB): таблица scouting_links (scout_nick, scout_eid, invited_nick,
//           invited_eid, joined_at, stage, payments_count, payments_sum,
//           scout_earned)
// =============================================================================
const SCOUT_MINE = {
  invited: 3, activated: 2, payments: 29, earnedMonth: 796,
  refLink: 'https://sreda.ru/?rid=626d1232d1cc97b3',
  rows: [
    { nick: '@ai_katya', eid: 629522, date: '12 июля', stage: 'приносит оплаты', payments: 18, sum: '9 882 ₽', earned: '494 ₽' },
    { nick: '@neuro_dima', eid: 629547, date: '20 июля', stage: 'приносит оплаты', payments: 11, sum: '6 039 ₽', earned: '302 ₽' },
    { nick: '@lena.creates', eid: 629601, date: '2 августа', stage: 'снимает первый ролик', payments: 0, sum: null, earned: null },
  ],
};
const SCOUT_ADMIN = {
  invited: 31, activated: 12, activationRate: '39%',
  rows: [
    { nick: '@sochi_nat', eid: 629410, invited: 9, activated: 5, payments: 38, sum: '20 862 ₽', paidOut: '1 043 ₽' },
    { nick: '@marsedzhan', eid: 629398, invited: 3, activated: 2, payments: 29, sum: '15 921 ₽', paidOut: '796 ₽' },
    { nick: '@basuha220', eid: 628745, invited: 4, activated: 1, payments: 6, sum: '3 294 ₽', paidOut: '165 ₽' },
  ],
};

// =============================================================================
// БРИФЫ ЗАКАЗЧИКОВ — форма на лендинге («Бриф на размещение») и админский
// список «Заявки». Раньше эти две страницы были никак не связаны: отправка
// брифа с лендинга просто показывала модалку и никуда не сохранялась.
// Теперь реальная отправка добавляет строку в тот же список, который видит
// админ.
// TODO(DB): таблица client_briefs (company, site, niche, message, pay_model,
//           budget, geo, contact_name, contact_tg, status, created_at)
// =============================================================================
let BRIEFS = [
  { id: 1, company: 'Кэмп', niche: 'Образование', model: 'RevShare', budget: '—', date: '3 авг', status: 'подключён',
    site: '', message: '', geo: '', contactName: '', contactTg: '', note: '', viewed: true },
  { id: 2, company: 'Автор24', niche: 'Образование', model: 'Фикс', budget: '100 000 ₽', date: '1 авг', status: 'на модерации',
    site: '', message: '', geo: '', contactName: '', contactTg: '', note: '', viewed: true },
  { id: 3, company: 'Studybay', niche: 'Образование', model: 'RevShare', budget: '—', date: '29 июл', status: 'новая',
    site: '', message: '', geo: '', contactName: '', contactTg: '', note: '', viewed: false },
];
let briefAutoId = 4;

// =============================================================================
// ОФФЕРЫ — админская таблица (модель/ставка/подключено/оплат/доступ по
// каждой цели оффера). Отдельный набор от OFFERS выше, т.к. в прототипе
// у админа была отдельная более подробная таблица.
// TODO(DB): вью offers_admin_summary
// =============================================================================
let ADMIN_OFFERS_TABLE = [
  { id: 1, offer: 'Study AI', model: 'RevShare', rate: '85% / 20% / 20%', perView: '0,15 ₽', connected: 212, paid: 150, access: 'всем' },
  { id: 2, offer: 'Кэмп', model: 'RevShare', rate: '70% / 30%', perView: '0,20 ₽', connected: 8, paid: null, access: 'с уровня 2' },
  { id: 3, offer: 'Кэмп', model: 'Фикс', rate: '300 ₽ / 100 ₽', perView: '0,20 ₽', connected: 8, paid: null, access: 'с уровня 2' },
  { id: 4, offer: 'Автор24', model: 'Фикс', rate: '2 000 ₽ за заказ', perView: '0,10 ₽', connected: 3, paid: null, access: 'с уровня 3' },
  { id: 5, offer: 'Автор24', model: 'RevShare', rate: '20% / 20%', perView: '0,10 ₽', connected: 3, paid: null, access: 'с уровня 3' },
  { id: 6, offer: 'Studybay', model: 'RevShare', rate: '60% / 15%', perView: '—', connected: 0, paid: null, access: 'скоро' },
];
let adminOfferAutoId = 7;

module.exports = {
  clone,
  pay, fmtViews, ruPlural, ruDays, levelMultForNick,
  suggestNameFromNick, isNameTaken,
  OFFERS, FORMATS, VIDEOS, CREATORS, LVN, LVG,
  get LVM() { return LVM; }, set LVM(v) { LVM = v; },
  MYNICK, MYEID,
  levelForPaymentsCount, recalcCreatorLevel, recalcAllLevels,
  get MOD() { return MOD; }, set MOD(v) { MOD = v; },
  get modAutoId() { return modAutoId; }, set modAutoId(v) { modAutoId = v; },
  get doneAutoId() { return doneAutoId; }, set doneAutoId(v) { doneAutoId = v; },
  get RATE() { return RATE; }, set RATE(v) { RATE = v; },
  get DONE() { return DONE; }, set DONE(v) { DONE = v; },
  TOP_VIDEOS,
  get CONTESTS() { return CONTESTS; }, set CONTESTS(v) { CONTESTS = v; },
  get CONTESTS_ADMIN_SUMMARY() { return CONTESTS_ADMIN_SUMMARY; }, set CONTESTS_ADMIN_SUMMARY(v) { CONTESTS_ADMIN_SUMMARY = v; },
  get contestAutoId() { return contestAutoId; }, set contestAutoId(v) { contestAutoId = v; },
  metricUnit, metricLabel, fmtMetricValue, recomputeContests, computeContestBoard,
  buildPayoutTemplate, recomputePayoutTemplates,
  get RATES() { return RATES; }, set RATES(v) { RATES = v; },
  get MIN_VIEWS() { return MIN_VIEWS; }, set MIN_VIEWS(v) { MIN_VIEWS = v; },
  get WEEK_THEME() { return WEEK_THEME; }, set WEEK_THEME(v) { WEEK_THEME = v; },
  get PAYQ() { return PAYQ; }, set PAYQ(v) { PAYQ = v; },
  get WD() { return WD; }, set WD(v) { WD = v; },
  get BAL() { return BAL; }, set BAL(v) { BAL = v; },
  get NOTIF() { return NOTIF; }, set NOTIF(v) { NOTIF = v; },
  SCHOOL_MINE, SCHOOL_ADMIN, SCOUT_MINE, SCOUT_ADMIN,
  get schoolCourseAutoId() { return schoolCourseAutoId; }, set schoolCourseAutoId(v) { schoolCourseAutoId = v; },
  get BRIEFS() { return BRIEFS; }, set BRIEFS(v) { BRIEFS = v; },
  get briefAutoId() { return briefAutoId; }, set briefAutoId(v) { briefAutoId = v; },
  get ADMIN_OFFERS_TABLE() { return ADMIN_OFFERS_TABLE; }, set ADMIN_OFFERS_TABLE(v) { ADMIN_OFFERS_TABLE = v; },
  get adminOfferAutoId() { return adminOfferAutoId; }, set adminOfferAutoId(v) { adminOfferAutoId = v; },
};
