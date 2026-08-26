import { chromium } from 'playwright';
import fs from 'fs';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
page.on('requestfailed', (req) => errors.push('requestfailed: ' + req.url() + ' ' + (req.failure()?.errorText||'')));

const log = (...a) => console.log(...a);

// ---------- 1. Landing page must render exactly as before ----------
await page.goto('http://localhost:3000/');
await page.waitForTimeout(600);
const heroText = await page.locator('.hero h1').innerText();
log('HERO TEXT:', JSON.stringify(heroText));
const landingVisible = await page.locator('#v-land').isVisible();
log('landing visible:', landingVisible);
const headerHidden = await page.locator('header').evaluate(el => getComputedStyle(el).display);
log('header display on landing:', headerHidden);

// ---------- 2. Admin: creators / offers / moderation / done / rates / week theme / payouts / contests / school / scouting / briefs ----------
await page.click('[data-r="admin"]');
await page.waitForTimeout(400);

// creators list loaded
const creatorRows = await page.locator('#tb tr').count();
log('admin creators rows:', creatorRows);

// offers admin table
await page.click('button[data-p="p-a-offers"]');
await page.waitForTimeout(200);
const adminOffersRows = await page.locator('#adminOffersTb tr').count();
log('admin offers table rows:', adminOffersRows);

// moderation queue -> approve one
await page.click('button[data-p="p-a-mod"]');
await page.waitForTimeout(300);
const modRowsBefore = await page.locator('#modtb tr').count();
const doneRowsBefore = await page.locator('#donetb tr').count();
log('mod queue before:', modRowsBefore, 'done before:', doneRowsBefore);
await page.click('#modtb tr >> nth=0 >> button:has-text("Принять")');
await page.waitForTimeout(400);
const modRowsAfter = await page.locator('#modtb tr').count();
const doneRowsAfter = await page.locator('#donetb tr').count();
log('mod queue after approve:', modRowsAfter, 'done after:', doneRowsAfter, '(expect mod-1, done+1)');

// done: drop one video
const dropBtn = page.locator('#donetb tr >> nth=0 >> button:has-text("Снять")');
await dropBtn.click();
await page.waitForTimeout(400);
const doneRowsAfterDrop = await page.locator('#donetb tr').count();
log('done after drop:', doneRowsAfterDrop, '(expect', doneRowsAfter - 1, ')');

// rates page: edit a rate + week theme
await page.click('button[data-p="p-a-rates"]');
await page.waitForTimeout(300);
const rateInput = page.locator('#ratesList input').first();
await rateInput.fill('0.17');
await page.waitForTimeout(900); // let debounce fire
const wtTitleBefore = await page.locator('#wtAdminTitle').inputValue();
log('week theme admin title (prefilled):', wtTitleBefore);
await page.fill('#wtAdminTitle', 'Проверка через Playwright');
await page.fill('#wtAdminDesc', 'Автотест темы недели');
await page.fill('#wtAdminMult', '1.4');
await page.click('button:has-text("Сохранить тему недели")');
await page.waitForTimeout(400);

// verify persisted via direct API call
const rateCheck = await page.evaluate(() => fetch('/api/rates').then(r=>r.json()));
log('RATE after edit (expect Study AI 0.17):', JSON.stringify(rateCheck.rates));
const themeCheck = await page.evaluate(() => fetch('/api/week-theme').then(r=>r.json()));
log('WEEK THEME after save:', JSON.stringify(themeCheck));

// payouts: mark first "новая" into work then paid
await page.click('button[data-p="p-a-pay"]');
await page.waitForTimeout(300);
const payBtn = page.locator('#payTb button:has-text("В работу")').first();
if (await payBtn.count()) { await payBtn.click(); await page.waitForTimeout(400); }

// contests admin
await page.click('button[data-p="p-a-contests"]');
await page.waitForTimeout(200);
const contestRows = await page.locator('#adminContestsTb tr').count();
const acFund = await page.locator('#acFund').innerText();
log('admin contest rows:', contestRows, 'fund card:', acFund);

// school admin
await page.click('button[data-p="p-a-school"]');
await page.waitForTimeout(200);
const schoolRows = await page.locator('#schoolAdminTb tr').count();
log('school admin rows:', schoolRows);

// scouting admin
await page.click('button[data-p="p-a-scout"]');
await page.waitForTimeout(200);
const scoutRows = await page.locator('#scoutAdminTb tr').count();
log('scout admin rows:', scoutRows);

// briefs admin (before submission)
await page.click('button[data-p="p-a-brief"]');
await page.waitForTimeout(200);
const briefRowsBefore = await page.locator('#briefsTb tr').count();
log('briefs admin rows before submit:', briefRowsBefore);

// ---------- 3. Client: submit a brief ----------
await page.click('#hr .exit'); // "Выйти" -> home/land
await page.waitForTimeout(200);
await page.click('[data-r="client"]');
await page.waitForTimeout(300);
await page.fill('#brCompany', 'PW Test Co');
await page.fill('#brName', 'Плейрайт Тестов');
await page.selectOption('#brNiche', { index: 1 });
await page.click('button:has-text("Отправить бриф")');
await page.waitForTimeout(400);
const sentModalVisible = await page.locator('#ovSent').evaluate(el => el.classList.contains('on'));
log('brief "sent" modal visible:', sentModalVisible);
await page.click('#ovSent button:has-text("Понятно")');
await page.waitForTimeout(300);

// check admin sees the new brief
await page.click('[data-r="admin"]');
await page.waitForTimeout(300);
await page.click('button[data-p="p-a-brief"]');
await page.waitForTimeout(200);
const briefRowsAfter = await page.locator('#briefsTb tr').count();
log('briefs admin rows after submit:', briefRowsAfter, '(expect', briefRowsBefore + 1, ')');

// ---------- 4. Creator: mark a video, withdraw, notifications, offers connect, school/scout mine ----------
await page.click('#hr .exit');
await page.waitForTimeout(200);
// preempt the onboarding tour so it never opens (avoids automation flakiness with its overlay)
await page.evaluate(() => { try { localStorage.setItem('ca_tour_done','1'); } catch(e){} }).catch(()=>{});
await page.click('[data-r="creator"]');
await page.waitForTimeout(400);
await page.evaluate(() => { if (typeof tourEnd === 'function') tourEnd(); }).catch(()=>{});
await page.waitForTimeout(200);

await page.click('button[data-p="p-c-videos"]');
await page.waitForTimeout(300);
const markBtn = page.locator('#vtb button:has-text("Разметить")').first();
if (await markBtn.count()) {
  await markBtn.click();
  await page.waitForTimeout(300);
  await page.selectOption('#mkOf', 'Study AI');
  await page.click('.fmt[data-k="0.3"]');
  await page.click('button:has-text("Отправить на проверку")');
  await page.waitForTimeout(400);
}
const vidRows = await page.locator('#vtb tr').count();
log('creator video rows:', vidRows);

// offers page: connect a free offer
await page.click('button[data-p="p-c-offers"]');
await page.waitForTimeout(300);
const wkTitle = await page.locator('#wkTitle').innerText();
log('creator sees week theme title (expect our test title):', wkTitle);
const connectBtn = page.locator('.ofc button:has-text("Подключиться")').first();
if (await connectBtn.count()) { await connectBtn.click(); await page.waitForTimeout(400); }

// school mine
await page.click('button[data-p="p-c-school"]');
await page.waitForTimeout(200);
const schoolMineText = await page.locator('#schMineProgress').innerText();
log('creator school progress:', schoolMineText);

// scouting mine
await page.click('button[data-p="p-c-scout"]');
await page.waitForTimeout(200);
const scoutLink = await page.locator('#scoutLink').inputValue();
log('creator scout link:', scoutLink);

// home: withdraw
await page.click('button[data-p="p-c-home"]');
await page.waitForTimeout(300);
const balBefore = await page.locator('#cBal').innerText();
log('balance before withdraw:', balBefore);
await page.click('button:has-text("Вывести средства")');
await page.waitForTimeout(300);
await page.click('button:has-text("Создать заявку и написать менеджеру")');
await page.waitForTimeout(500);
const balAfter = await page.locator('#cBal').innerText();
log('balance after withdraw (expect 0 ₽):', balAfter);

// notifications
await page.click('.bell');
await page.waitForTimeout(300);
const notifCountBefore = await page.locator('#nlist .ni').count();
log('notif count:', notifCountBefore);
await page.click('#npanel button:has-text("Прочитать все")');
await page.waitForTimeout(300);
const bdotVisible = await page.locator('#bdot').evaluate(el => getComputedStyle(el).display);
log('notif bell dot display after read-all (expect none):', bdotVisible);

log('=== CONSOLE/PAGE ERRORS ===', JSON.stringify(errors, null, 2));
await page.screenshot({ path: '/tmp/work/creator-analytics/final_admin_rates.png' });

await browser.close();
