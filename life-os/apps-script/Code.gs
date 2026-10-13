/**
 * Life OS backend: Google Sheets as the database, this script as the API and
 * the automation engine. Paste into Extensions → Apps Script of the Life OS
 * sheet, run `setup` once, then deploy as a web app (see SETUP.md).
 */

// ─── Schema ──────────────────────────────────────────────────────────────────

const TABLES = {
  Events: ['id', 'title', 'category', 'status', 'start', 'end', 'allDay', 'location', 'workout',
    'durationMin', 'budget', 'giftIdea', 'platform', 'contentType', 'link', 'notes',
    'calendarId', 'calEventId', 'source', 'updatedAt'],
  Transactions: ['id', 'date', 'name', 'amount', 'type', 'category', 'account', 'method',
    'currency', 'status', 'eventId', 'loanId', 'source', 'importId', 'fee', 'balanceAfter',
    'notes', 'updatedAt'],
  Budgets: ['id', 'category', 'group', 'direction', 'monthly', 'notes'],
  Loans: ['id', 'name', 'lender', 'type', 'original', 'monthly', 'dueDay', 'interest',
    'start', 'end', 'status', 'notes'],
  Templates: ['id', 'weekday', 'time', 'durationMin', 'title', 'category', 'workout',
    'location', 'active'],
  Rules: ['id', 'match', 'category', 'type', 'notes'],
  Settings: ['key', 'value'],
};

const APP_URL = 'https://toomkris.github.io/life-os/';

const NUMBER_COLS = ['amount', 'fee', 'balanceAfter', 'budget', 'durationMin', 'monthly',
  'original', 'dueDay', 'interest'];

const CATEGORY_TAGS = {
  gym: 'Gym', lift: 'Gym', workout: 'Gym', dance: 'Dance', trip: 'Travel', travel: 'Travel',
  birthday: 'Birthday', bday: 'Birthday', event: 'Event', social: 'Social', content: 'Social',
};

const CATEGORY_EMOJI = {
  Gym: '🏋️', Dance: '💃', Travel: '✈️', Birthday: '🎂', Event: '🎉', Social: '📱', Other: '📌',
};

const CATEGORY_COLOR = {
  Gym: CalendarApp.EventColor.RED,
  Dance: CalendarApp.EventColor.MAUVE,
  Travel: CalendarApp.EventColor.PALE_BLUE,
  Birthday: CalendarApp.EventColor.PALE_RED,
  Event: CalendarApp.EventColor.ORANGE,
  Social: CalendarApp.EventColor.YELLOW,
  Other: CalendarApp.EventColor.GRAY,
};

const DEFAULT_RULES = [
  ['bolt', 'Transport', ''], ['uber', 'Transport', ''], ['elron', 'Transport', ''],
  ['tallinna transport', 'Transport', ''], ['rimi', 'Groceries', ''], ['selver', 'Groceries', ''],
  ['prisma', 'Groceries', ''], ['maxima', 'Groceries', ''], ['lidl', 'Groceries', ''],
  ['coop', 'Groceries', ''], ['wolt', 'Eating Out', ''], ['mcdonald', 'Eating Out', ''],
  ['spotify', 'Subscriptions', ''], ['netflix', 'Subscriptions', ''], ['apple.com', 'Subscriptions', ''],
  ['google', 'Subscriptions', ''], ['myfitness', 'Gym & Health', ''], ['apotheka', 'Gym & Health', ''],
  ['benu', 'Gym & Health', ''], ['ryanair', 'Travel', ''], ['airbaltic', 'Travel', ''],
  ['booking.com', 'Travel', ''], ['airbnb', 'Travel', ''], ['inbank', 'Loan Payments', 'Loan Payment'],
  ['esto', 'Loan Payments', 'Loan Payment'], ['salary', 'Salary', 'Income'], ['palk', 'Salary', 'Income'],
];

// ─── Setup & menu ────────────────────────────────────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🌙 Life OS')
    .addItem('Sync calendar now', 'syncCalendar')
    .addItem('Plan training (next 2 weeks)', 'generateTraining')
    .addItem('Import Revolut CSVs from Drive', 'importFromDrive')
    .addItem('Run auto-categorise', 'autoLinkAll')
    .addItem('Send weekly summary now', 'weeklySummary')
    .addSeparator()
    .addItem('Connect the app', 'showConnection')
    .addItem('Setup / repair', 'setup')
    .addToUi();
}

/** Creates missing tabs, settings, the Life OS calendar, the import folder and triggers. */
function setup() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(TABLES).forEach(name => ensureSheet_(ss, name, TABLES[name]));
  const blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0) ss.deleteSheet(blank);

  const s = getSettings_();
  const defaults = {
    token: Utilities.getUuid().replace(/-/g, ''),
    timezone: Session.getScriptTimeZone() || 'Europe/Tallinn',
    currency: 'EUR',
    email: Session.getActiveUser().getEmail(),
    calendarName: 'Life OS',
    watchCalendar: 'primary',
    remindersEnabled: 'yes',
  };
  Object.keys(defaults).forEach(k => { if (!s[k]) setSetting_(k, defaults[k]); });

  if (!getSettings_().calendarId) {
    const cal = CalendarApp.getCalendarsByName(getSettings_().calendarName)[0] ||
      CalendarApp.createCalendar(getSettings_().calendarName, { color: CalendarApp.Color.PURPLE });
    setSetting_('calendarId', cal.getId());
  }
  if (!getSettings_().importFolderId) {
    const folder = DriveApp.createFolder('Life OS · Revolut imports');
    folder.createFolder('Imported');
    setSetting_('importFolderId', folder.getId());
  }
  importSeed_();
  if (readTable_('Rules').length === 0) {
    DEFAULT_RULES.forEach(r => upsert_('Rules', { match: r[0], category: r[1], type: r[2] }));
  }
  installTriggers_();
  styleSheets_();
  showConnection();
}

/** One-time import: a Drive file called "Life OS seed.json" ({Events:[...], Transactions:[...], ...}) fills empty tabs. */
function importSeed_() {
  const files = DriveApp.getFilesByName('Life OS seed.json');
  if (!files.hasNext()) return;
  const file = files.next();
  const seed = JSON.parse(file.getBlob().getDataAsString('UTF-8'));
  Object.keys(seed).forEach(name => {
    if (!TABLES[name] || name === 'Settings' || readTable_(name).length) return;
    appendRows_(name, seed[name]);
  });
  file.setTrashed(true);
}

function installTriggers_() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncCalendar').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('importFromDrive').timeBased().everyHours(6).create();
  ScriptApp.newTrigger('dailyReminders').timeBased().everyDays(1).atHour(8).create();
  ScriptApp.newTrigger('generateTraining').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(17).create();
  ScriptApp.newTrigger('weeklySummary').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(19).create();
}

/** Dialog with a one-click link that connects the Life OS app to this sheet. */
function showConnection() {
  const s = getSettings_();
  const guess = ScriptApp.getService().getUrl() || '';
  const url = /\/exec$/.test(guess) ? guess : '';
  const html = HtmlService.createHtmlOutput(
    `<div style="font-family:system-ui,sans-serif;padding:4px 8px;line-height:1.5;color:#17142b">
      <p style="margin-top:0">Paste the <b>Web app URL</b> from <i>Deploy → Manage deployments</i> (it ends in <code>/exec</code>):</p>
      <input id="u" value="${url}" placeholder="https://script.google.com/macros/s/…/exec"
        style="width:100%;padding:9px;border:1px solid #ccc;border-radius:8px;box-sizing:border-box">
      <p><button id="go" style="background:#6c4cf5;color:#fff;border:0;border-radius:10px;padding:10px 16px;font-weight:700;cursor:pointer">🌙 Open & connect my app</button></p>
      <p style="font-size:12px;color:#666">Token (if you connect by hand): <code>${s.token}</code></p>
      <script>
        document.getElementById('go').onclick = function () {
          var u = document.getElementById('u').value.trim();
          if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(u)) { alert('That should be the web app URL ending in /exec'); return; }
          window.open('${APP_URL}#/connect?url=' + encodeURIComponent(u) + '&token=${s.token}', '_blank');
          google.script.host.close();
        };
      </script></div>`).setWidth(480).setHeight(260);
  try {
    SpreadsheetApp.getUi().showModalDialog(html, '🌙 Connect Life OS');
  } catch (err) {
    // Run from the script editor: no dialog available there.
    console.log('Setup done. Deploy as a web app, then in the sheet use 🌙 Life OS → Connect the app. Token: ' + s.token);
  }
}

// ─── Web API ─────────────────────────────────────────────────────────────────

function doGet(e) {
  return handle_(e.parameter || {});
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Bad JSON' }); }
  return handle_(body);
}

function handle_(req) {
  if (!req.token || req.token !== getSettings_().token) return json_({ ok: false, error: 'Wrong token' });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    let result;
    switch (req.action || 'all') {
      case 'all': result = snapshot_(); break;
      case 'upsert': result = upsertFromApp_(req.table, req.row); break;
      case 'delete': result = deleteFromApp_(req.table, req.id); break;
      case 'importCsv': result = importCsvText_(req.csv, req.filename || 'upload.csv'); break;
      case 'learn': result = learnRule_(req.match, req.category, req.type); break;
      case 'sync': syncCalendar(); result = snapshot_(); break;
      case 'generateTraining': generateTraining(); result = snapshot_(); break;
      default: throw new Error('Unknown action ' + req.action);
    }
    return json_({ ok: true, data: result });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function snapshot_() {
  const s = getSettings_();
  return {
    events: readTable_('Events'),
    transactions: readTable_('Transactions'),
    budgets: readTable_('Budgets'),
    loans: readTable_('Loans'),
    templates: readTable_('Templates'),
    rules: readTable_('Rules'),
    settings: { currency: s.currency, timezone: s.timezone, email: s.email },
    serverTime: new Date().toISOString(),
  };
}

const WRITABLE = ['Events', 'Transactions', 'Budgets', 'Loans', 'Templates', 'Rules'];

function upsertFromApp_(table, row) {
  if (WRITABLE.indexOf(table) < 0) throw new Error('Table not writable: ' + table);
  if (table === 'Transactions') row = autoLinkTx_(row, readTable_('Events'), readTable_('Loans'), readTable_('Rules'), false);
  const saved = upsert_(table, row);
  if (table === 'Events') return pushEvent_(saved);
  return saved;
}

function deleteFromApp_(table, id) {
  if (WRITABLE.indexOf(table) < 0) throw new Error('Table not writable: ' + table);
  if (table === 'Events') {
    const ev = readTable_('Events').find(e => e.id === id);
    if (ev && ev.calEventId) {
      try {
        const cal = CalendarApp.getCalendarById(ev.calendarId || getSettings_().calendarId);
        if (cal && ev.calendarId === getSettings_().calendarId) {
          const ce = cal.getEventById(ev.calEventId);
          if (ce) (ce.isRecurringEvent() ? ce.getEventSeries().deleteEventSeries() : ce.deleteEvent());
        }
      } catch (err) { /* already gone */ }
    }
  }
  deleteRow_(table, id);
  return { id: id };
}

function learnRule_(match, category, type) {
  match = String(match || '').trim().toLowerCase();
  if (!match) throw new Error('Nothing to learn');
  const existing = readTable_('Rules').find(r => String(r.match).toLowerCase() === match);
  const rule = upsert_('Rules', { id: existing && existing.id, match: match, category: category, type: type || '' });
  autoLinkAll();
  return rule;
}

// ─── Calendar sync ───────────────────────────────────────────────────────────

/** Two-way sync: pushes sheet events to the Life OS calendar, pulls #tagged events and moves. */
function syncCalendar() {
  const s = getSettings_();
  const events = readTable_('Events');

  // 1. Push / reconcile everything the sheet knows about.
  events.forEach(ev => {
    if (!ev.start) return;
    try { pushEvent_(ev); } catch (err) { console.warn('push failed', ev.title, err); }
  });

  // 2. Pull #tagged events from the watched calendar.
  const watch = s.watchCalendar === 'primary' ? CalendarApp.getDefaultCalendar() : CalendarApp.getCalendarById(s.watchCalendar);
  if (!watch) return;
  const from = new Date(Date.now() - 14 * 864e5);
  const to = new Date(Date.now() + 365 * 864e5);
  const known = {};
  readTable_('Events').forEach(e => { if (e.calEventId) known[e.calEventId] = e; });

  watch.getEvents(from, to).forEach(ce => {
    const text = (ce.getTitle() + ' ' + ce.getDescription()).toLowerCase();
    if (text.indexOf('lifeos:') >= 0) return; // one of ours
    const m = text.match(/#(\w+)/g);
    if (!m) return;
    const cat = m.map(t => CATEGORY_TAGS[t.slice(1)]).find(Boolean);
    if (!cat) return;
    const id = ce.getId();
    const prev = known[id];
    const row = {
      id: prev && prev.id,
      title: ce.getTitle().replace(/#\w+/g, '').trim(),
      category: cat,
      status: prev ? prev.status : 'Planned',
      start: fmtCal_(ce.isAllDayEvent() ? ce.getAllDayStartDate() : ce.getStartTime(), ce.isAllDayEvent()),
      end: fmtCal_(ce.isAllDayEvent() ? new Date(ce.getAllDayEndDate().getTime() - 864e5) : ce.getEndTime(), ce.isAllDayEvent()),
      allDay: ce.isAllDayEvent() ? 'yes' : '',
      location: ce.getLocation(),
      calendarId: watch.getId(),
      calEventId: id,
      source: 'Calendar',
    };
    if (prev && prev.start === row.start && prev.end === row.end && prev.title === row.title && prev.location === row.location) return;
    upsert_('Events', row);
  });
  autoLinkAll();
}

/** Creates or updates the calendar copy of one event; pulls back changes made in the calendar. */
function pushEvent_(ev) {
  const s = getSettings_();
  const ownCalId = s.calendarId;
  const calId = ev.calendarId || ownCalId;
  const cal = CalendarApp.getCalendarById(calId);
  if (!cal || !ev.start) return ev;

  const tz = s.timezone;
  const allDay = ev.allDay === 'yes' || ev.allDay === true || !/T\d/.test(ev.start);
  const start = parseLocal_(ev.start, tz);
  let end = ev.end ? parseLocal_(ev.end, tz) : null;
  if (!allDay && (!end || end <= start)) end = new Date(start.getTime() + (Number(ev.durationMin) || 60) * 6e4);
  const cancelled = /cancel/i.test(ev.status || '');
  const isOurs = calId === ownCalId;
  const title = isOurs ? `${CATEGORY_EMOJI[ev.category] || ''} ${ev.title}`.trim() : null;
  const desc = isOurs ? describe_(ev) : null;

  let ce = null;
  if (ev.calEventId) {
    try { ce = cal.getEventById(ev.calEventId); } catch (err) { ce = null; }
  }

  // Deleted in the calendar → mark cancelled in the sheet.
  if (ev.calEventId && !ce) {
    return upsert_('Events', { id: ev.id, calEventId: '', status: cancelled ? ev.status : 'Cancelled' });
  }

  if (ce && cancelled && isOurs) {
    (ce.isRecurringEvent() ? ce.getEventSeries().deleteEventSeries() : ce.deleteEvent());
    return upsert_('Events', { id: ev.id, calEventId: '' });
  }
  if (cancelled) return ev;

  if (ce) {
    // Moved in Google Calendar after our last write → calendar wins.
    const calUpdated = ce.getLastUpdated().getTime();
    const sheetUpdated = ev.updatedAt ? new Date(ev.updatedAt).getTime() : 0;
    if (calUpdated > sheetUpdated + 5000 && !ce.isRecurringEvent()) {
      const ad = ce.isAllDayEvent();
      const newStart = fmtCal_(ad ? ce.getAllDayStartDate() : ce.getStartTime(), ad);
      const newEnd = fmtCal_(ad ? new Date(ce.getAllDayEndDate().getTime() - 864e5) : ce.getEndTime(), ad);
      if (newStart !== ev.start || newEnd !== ev.end || ce.getLocation() !== (ev.location || '')) {
        return upsert_('Events', { id: ev.id, start: newStart, end: newEnd, location: ce.getLocation() });
      }
      return ev;
    }
    if (!isOurs) return ev; // never rewrite events that live in the user's own calendar
    let changed = false;
    if (ce.getTitle() !== title) { ce.setTitle(title); changed = true; }
    if (ce.getDescription() !== desc) { ce.setDescription(desc); changed = true; }
    if ((ce.getLocation() || '') !== (ev.location || '')) { ce.setLocation(ev.location || ''); changed = true; }
    if (!ce.isRecurringEvent()) {
      if (allDay) {
        const endDay = end ? new Date(end.getTime() + 864e5) : new Date(start.getTime() + 864e5);
        if (!ce.isAllDayEvent() || ce.getAllDayStartDate().getTime() !== start.getTime() ||
            ce.getAllDayEndDate().getTime() !== endDay.getTime()) { ce.setAllDayDates(start, endDay); changed = true; }
      } else if (ce.isAllDayEvent() || ce.getStartTime().getTime() !== start.getTime() || ce.getEndTime().getTime() !== end.getTime()) {
        ce.setTime(start, end); changed = true;
      }
    }
    if (CATEGORY_COLOR[ev.category] && ce.getColor() !== CATEGORY_COLOR[ev.category]) { ce.setColor(CATEGORY_COLOR[ev.category]); changed = true; }
    if (!changed) return ev;
    return upsert_('Events', { id: ev.id, updatedAt: new Date(Date.now() + 1000).toISOString() }, true);
  }

  if (!isOurs) return ev;
  const opts = { description: desc, location: ev.location || '' };
  if (ev.category === 'Birthday') {
    const series = cal.createAllDayEventSeries(title, start, CalendarApp.newRecurrence().addYearlyRule(), opts);
    series.setColor(CATEGORY_COLOR.Birthday);
    ce = { getId: () => series.getId(), getLastUpdated: () => series.getLastUpdated() };
  } else if (allDay) {
    const endDay = end ? new Date(end.getTime() + 864e5) : new Date(start.getTime() + 864e5);
    ce = cal.createAllDayEvent(title, start, endDay, opts);
  } else {
    ce = cal.createEvent(title, start, end, opts);
  }
  if (ce.setColor && CATEGORY_COLOR[ev.category]) ce.setColor(CATEGORY_COLOR[ev.category]);
  if (ev.category === 'Travel') {
    ce.addPopupReminder && ce.addPopupReminder(24 * 60);
  }
  return upsert_('Events', {
    id: ev.id, calendarId: ownCalId, calEventId: ce.getId(),
    updatedAt: new Date(Date.now() + 1000).toISOString(),
  }, true);
}

function describe_(ev) {
  const lines = [];
  if (ev.workout) lines.push('Workout: ' + ev.workout);
  if (ev.budget) lines.push('Budget: ' + ev.budget + ' ' + (getSettings_().currency || ''));
  if (ev.giftIdea) lines.push('Gift idea: ' + ev.giftIdea);
  if (ev.link) lines.push(ev.link);
  if (ev.notes) lines.push(ev.notes);
  lines.push('', 'lifeos:' + ev.id);
  return lines.join('\n');
}

// ─── Training planner ────────────────────────────────────────────────────────

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Fills the next 14 days with sessions from the weekly template (skips ones that already exist). */
function generateTraining() {
  const tz = getSettings_().timezone;
  const templates = readTable_('Templates').filter(t => t.active !== 'no' && t.active !== false);
  const events = readTable_('Events');
  const existing = {};
  events.forEach(e => { existing[(e.start || '').slice(0, 10) + '|' + String(e.title).toLowerCase()] = true; });

  for (let i = 1; i <= 14; i++) {
    const day = new Date(Date.now() + i * 864e5);
    const ymd = Utilities.formatDate(day, tz, 'yyyy-MM-dd');
    const wd = WEEKDAYS[Number(Utilities.formatDate(day, tz, 'u')) % 7];
    templates.filter(t => String(t.weekday).slice(0, 3) === wd).forEach(t => {
      const key = ymd + '|' + String(t.title).toLowerCase();
      if (existing[key]) return;
      existing[key] = true;
      const time = t.time ? normTime_(t.time) : '18:00';
      const dur = Number(t.durationMin) || 60;
      const start = ymd + 'T' + time;
      const end = Utilities.formatDate(new Date(parseLocal_(start, tz).getTime() + dur * 6e4), tz, "yyyy-MM-dd'T'HH:mm");
      const saved = upsert_('Events', {
        title: t.title, category: t.category || 'Gym', status: 'Planned', start: start, end: end,
        workout: t.workout || '', durationMin: dur, location: t.location || '', source: 'Template',
      });
      pushEvent_(saved);
    });
  }
}

// ─── Money: Revolut import & auto-linking ────────────────────────────────────

function importFromDrive() {
  const s = getSettings_();
  if (!s.importFolderId) return;
  const folder = DriveApp.getFolderById(s.importFolderId);
  const done = folder.getFoldersByName('Imported').hasNext() ? folder.getFoldersByName('Imported').next() : folder.createFolder('Imported');
  const files = folder.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    if (!/\.csv$/i.test(f.getName()) && f.getMimeType() !== MimeType.CSV) continue;
    importCsvText_(f.getBlob().getDataAsString('UTF-8'), f.getName());
    f.moveTo(done);
  }
}

/** Parses a Revolut statement CSV and adds new rows (duplicates are skipped by Import ID). */
function importCsvText_(csv, filename) {
  const rows = Utilities.parseCsv(String(csv || '').replace(/^﻿/, ''));
  if (rows.length < 2) return { added: 0, skipped: 0 };
  const head = rows[0].map(h => h.trim().toLowerCase());
  const col = name => head.indexOf(name);
  const iType = col('type'), iStart = col('started date'), iDone = col('completed date'), iDesc = col('description'),
    iAmt = col('amount'), iFee = col('fee'), iCur = col('currency'), iState = col('state'), iBal = col('balance'),
    iProduct = col('product');
  if (iDesc < 0 || iAmt < 0) throw new Error('This does not look like a Revolut CSV (needs Description and Amount columns).');

  const known = {};
  readTable_('Transactions').forEach(t => { if (t.importId) known[t.importId] = true; });
  const events = readTable_('Events'), loans = readTable_('Loans'), rules = readTable_('Rules');
  const toAdd = [];
  let skipped = 0;

  rows.slice(1).forEach(r => {
    if (!r[iDesc]) return;
    const state = iState >= 0 ? String(r[iState]).toUpperCase() : 'COMPLETED';
    if (/REVERTED|DECLINED|FAILED/.test(state)) { skipped++; return; }
    if (iProduct >= 0 && /savings|deposit/i.test(r[iProduct])) { skipped++; return; }
    const when = String(r[iStart >= 0 ? iStart : iDone] || '');
    const amount = Number(String(r[iAmt]).replace(',', '.'));
    const importId = Utilities.base64EncodeWebSafe(Utilities.computeDigest(
      Utilities.DigestAlgorithm.MD5, [when, r[iDesc], amount, r[iCur]].join('|'))).slice(0, 16);
    if (known[importId]) { skipped++; return; }
    known[importId] = true;

    const rType = iType >= 0 ? String(r[iType]).toUpperCase() : '';
    let type = amount < 0 ? 'Expense' : 'Income';
    let category = '';
    if (/TOPUP|EXCHANGE|ATM/.test(rType)) type = 'Transfer';
    if (/REFUND/.test(rType)) { type = 'Income'; category = 'Refund'; }

    let tx = {
      id: newId_(), date: when.slice(0, 10), name: String(r[iDesc]).trim(), amount: Math.abs(amount),
      type: type, category: category, account: 'Revolut', method: /CARD/.test(rType) ? 'Card' : (/TRANSFER/.test(rType) ? 'Bank Transfer' : ''),
      currency: iCur >= 0 ? r[iCur] : '', status: /PENDING/.test(state) ? 'Planned' : 'Paid',
      source: 'Revolut CSV', importId: importId, fee: iFee >= 0 ? Math.abs(Number(r[iFee]) || 0) : '',
      balanceAfter: iBal >= 0 && r[iBal] !== '' ? Number(r[iBal]) : '', notes: 'Imported from ' + filename,
      updatedAt: new Date().toISOString(),
    };
    tx = autoLinkTx_(tx, events, loans, rules, true);
    toAdd.push(tx);
  });

  appendRows_('Transactions', toAdd);
  return { added: toAdd.length, skipped: skipped };
}

/** Fills category/type, the trip it belongs to and the loan it pays, without overriding manual choices. */
function autoLinkTx_(tx, events, loans, rules, fresh) {
  const name = String(tx.name || '').toLowerCase();
  if (!tx.category || fresh) {
    const rule = rules.find(r => {
      const m = String(r.match || '').trim();
      if (!m) return false;
      if (m.charAt(0) === '/' && m.lastIndexOf('/') > 0) {
        try { return new RegExp(m.slice(1, m.lastIndexOf('/')), 'i').test(tx.name); } catch (e) { return false; }
      }
      return name.indexOf(m.toLowerCase()) >= 0;
    });
    if (rule && (!tx.category || fresh)) {
      if (!(fresh && tx.category === 'Refund')) tx.category = rule.category;
      if (rule.type) tx.type = rule.type;
    }
  }
  if (!tx.loanId) {
    const loan = loans.find(l => l.status !== 'Paid off' && l.lender && name.indexOf(String(l.lender).toLowerCase()) >= 0);
    if (loan && tx.type !== 'Income') { tx.loanId = loan.id; tx.type = 'Loan Payment'; tx.category = 'Loan Payments'; }
  }
  if (!tx.eventId && tx.date && tx.type === 'Expense') {
    const d = String(tx.date).slice(0, 10);
    const trip = events.find(e => (e.category === 'Travel' || e.category === 'Event') && e.start &&
      /cancel/i.test(e.status || '') === false &&
      d >= String(e.start).slice(0, 10) && d <= String(e.end || e.start).slice(0, 10));
    if (trip) { tx.eventId = trip.id; if (!tx.category && trip.category === 'Travel') tx.category = 'Travel'; }
  }
  return tx;
}

function autoLinkAll() {
  const events = readTable_('Events'), loans = readTable_('Loans'), rules = readTable_('Rules');
  readTable_('Transactions').forEach(tx => {
    const before = JSON.stringify([tx.category, tx.type, tx.eventId, tx.loanId]);
    const after = autoLinkTx_(Object.assign({}, tx), events, loans, rules, false);
    if (JSON.stringify([after.category, after.type, after.eventId, after.loanId]) !== before) {
      upsert_('Transactions', { id: tx.id, category: after.category, type: after.type, eventId: after.eventId, loanId: after.loanId });
    }
  });
}

// ─── Reminders & summaries ───────────────────────────────────────────────────

function dailyReminders() {
  const s = getSettings_();
  if (s.remindersEnabled === 'no' || !s.email) return;
  const tz = s.timezone;
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const inDays = n => Utilities.formatDate(new Date(Date.now() + n * 864e5), tz, 'yyyy-MM-dd');
  const items = [];

  readTable_('Loans').forEach(l => {
    if (l.status === 'Paid off' || !l.dueDay) return;
    for (let i = 0; i <= 3; i++) {
      const d = inDays(i);
      if (Number(d.slice(8, 10)) === Number(l.dueDay) && (!l.end || d <= String(l.end).slice(0, 10))) {
        items.push(`🏦 <b>${esc_(l.name)}</b>: ${money_(l.monthly)} due ${i === 0 ? 'today' : 'in ' + i + ' day' + (i > 1 ? 's' : '')} (${esc_(l.lender)})`);
      }
    }
  });
  readTable_('Events').forEach(e => {
    if (!e.start || /cancel/i.test(e.status || '')) return;
    const start = String(e.start).slice(0, 10);
    if (e.category === 'Birthday') {
      for (let i = 0; i <= 7; i++) {
        if (inDays(i).slice(5) === start.slice(5) && (i === 0 || i === 1 || i === 7)) {
          items.push(`🎂 <b>${esc_(e.title)}</b> ${i === 0 ? 'is today' : 'in ' + i + ' day' + (i > 1 ? 's' : '')}` +
            (e.giftIdea ? ` · gift idea: ${esc_(e.giftIdea)}` : '') + (e.budget ? ` · budget ${money_(e.budget)}` : ''));
        }
      }
    } else if (e.category === 'Travel' || e.category === 'Event') {
      [7, 1, 0].forEach(n => {
        if (start === inDays(n)) items.push(`${CATEGORY_EMOJI[e.category]} <b>${esc_(e.title)}</b> ${n === 0 ? 'starts today' : 'in ' + n + ' day' + (n > 1 ? 's' : '')}` + (e.location ? ` · ${esc_(e.location)}` : ''));
      });
    }
  });
  readTable_('Transactions').forEach(t => {
    if (t.status === 'Planned' && t.date >= today && t.date <= inDays(3)) {
      items.push(`🗓️ Planned payment <b>${esc_(t.name)}</b> ${money_(t.amount)} on ${t.date}`);
    }
  });
  if (!items.length) return;
  MailApp.sendEmail({
    to: s.email,
    subject: '🌙 Life OS · ' + items.length + ' reminder' + (items.length > 1 ? 's' : '') + ' for today',
    htmlBody: wrapMail_('Today’s heads-up', '<ul style="padding-left:18px">' + items.map(i => `<li style="margin:6px 0">${i}</li>`).join('') + '</ul>'),
  });
}

function weeklySummary() {
  const s = getSettings_();
  if (!s.email) return;
  const tz = s.timezone;
  const now = new Date();
  const weekAgo = Utilities.formatDate(new Date(now.getTime() - 7 * 864e5), tz, 'yyyy-MM-dd');
  const today = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  const nextWeek = Utilities.formatDate(new Date(now.getTime() + 7 * 864e5), tz, 'yyyy-MM-dd');
  const month = today.slice(0, 7);
  const events = readTable_('Events');
  const txs = readTable_('Transactions');

  const training = events.filter(e => (e.category === 'Gym' || e.category === 'Dance') && e.start >= weekAgo && e.start.slice(0, 10) <= today);
  const done = training.filter(e => /done/i.test(e.status || '')).length;
  const spentMonth = txs.filter(t => t.type === 'Expense' && t.status !== 'Planned' && String(t.date).slice(0, 7) === month)
    .reduce((a, t) => a + Number(t.amount || 0), 0);
  const budgetOut = readTable_('Budgets').filter(b => b.direction !== 'In' && b.group !== 'Savings' && b.group !== 'Debt')
    .reduce((a, b) => a + Number(b.monthly || 0), 0);
  const upcoming = events.filter(e => e.start && e.start.slice(0, 10) > today && e.start.slice(0, 10) <= nextWeek && !/cancel/i.test(e.status || ''))
    .sort((a, b) => a.start < b.start ? -1 : 1);
  const toSort = txs.filter(t => !t.category && t.type !== 'Transfer').length;

  const body = `
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      ${tile_('Training', done + ' / ' + training.length, 'sessions done')}
      ${tile_('Spent in ' + month, money_(spentMonth), 'of ' + money_(budgetOut) + ' planned')}
      ${tile_('To categorise', String(toSort), 'transactions')}
    </tr></table>
    <h3 style="margin:24px 0 8px">Next 7 days</h3>
    ${upcoming.length ? '<ul style="padding-left:18px">' + upcoming.map(e =>
      `<li style="margin:6px 0">${CATEGORY_EMOJI[e.category] || ''} <b>${esc_(e.title)}</b> · ${prettyDate_(e.start)}${e.location ? ' · ' + esc_(e.location) : ''}</li>`).join('') + '</ul>' : '<p>Nothing planned yet.</p>'}`;
  MailApp.sendEmail({ to: s.email, subject: '🌙 Your Life OS week', htmlBody: wrapMail_('Your week in one look', body) });
}

function tile_(label, value, sub) {
  return `<td style="padding:6px"><div style="background:#f4f2fb;border-radius:14px;padding:14px">
    <div style="font-size:12px;color:#6b6880">${label}</div>
    <div style="font-size:22px;font-weight:700;color:#1d1b2e">${value}</div>
    <div style="font-size:12px;color:#6b6880">${sub}</div></div></td>`;
}

function wrapMail_(title, inner) {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:auto;color:#1d1b2e">
    <div style="background:linear-gradient(135deg,#2b2160,#5b3fc4);color:#fff;border-radius:18px;padding:22px 24px">
      <div style="font-size:13px;opacity:.8">🌙 Life OS</div><div style="font-size:22px;font-weight:700">${title}</div></div>
    <div style="padding:14px 6px">${inner}</div></div>`;
}

// ─── Sheet helpers ───────────────────────────────────────────────────────────

function ensureSheet_(ss, name, cols) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  const width = Math.max(sh.getLastColumn(), 1);
  const head = sh.getRange(1, 1, 1, width).getValues()[0].map(String);
  cols.forEach(c => {
    if (head.indexOf(c) < 0) {
      const at = head.filter(Boolean).length + 1;
      sh.getRange(1, at).setValue(c);
      head[at - 1] = c;
    }
  });
  // Keep text columns as plain text so dates stay ISO strings.
  cols.forEach((c, i) => {
    const idx = head.indexOf(c) + 1;
    if (NUMBER_COLS.indexOf(c) < 0) sh.getRange(1, idx, sh.getMaxRows(), 1).setNumberFormat('@');
  });
  sh.setFrozenRows(1);
  return sh;
}

function styleSheets_() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(TABLES).forEach(name => {
    const sh = ss.getSheetByName(name);
    const head = sh.getRange(1, 1, 1, sh.getLastColumn());
    head.setFontWeight('bold').setBackground('#2b2160').setFontColor('#ffffff');
    sh.setTabColor({ Events: '#7c5cff', Transactions: '#1baf7a', Budgets: '#eda100', Loans: '#e34948',
      Templates: '#e87ba4', Rules: '#2a78d6', Settings: '#52514e' }[name]);
  });
}

function sheet_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('Missing tab ' + name + ' (run setup)');
  return sh;
}

function readTable_(name) {
  const sh = sheet_(name);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const head = values[0].map(String);
  const tz = Session.getScriptTimeZone();
  return values.slice(1).filter(r => r.some(v => v !== '' && v !== null)).map(r => {
    const o = {};
    head.forEach((h, i) => {
      if (!h) return;
      let v = r[i];
      if (v instanceof Date) {
        const hasTime = v.getHours() || v.getMinutes();
        v = Utilities.formatDate(v, tz, hasTime ? "yyyy-MM-dd'T'HH:mm" : 'yyyy-MM-dd');
      }
      o[h] = v;
    });
    return o;
  });
}

function upsert_(name, row, silent) {
  const sh = sheet_(name);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const idCol = head.indexOf('id');
  if (!row.id) row.id = newId_();
  if (head.indexOf('updatedAt') >= 0 && !silent) row.updatedAt = new Date().toISOString();
  const ids = sh.getLastRow() > 1 ? sh.getRange(2, idCol + 1, sh.getLastRow() - 1, 1).getValues().map(r => String(r[0])) : [];
  const at = ids.indexOf(String(row.id));
  if (at >= 0) {
    const range = sh.getRange(at + 2, 1, 1, head.length);
    const current = range.getValues()[0];
    head.forEach((h, i) => { if (Object.prototype.hasOwnProperty.call(row, h)) current[i] = clean_(h, row[h]); });
    range.setValues([current]);
    const out = {};
    head.forEach((h, i) => { out[h] = current[i] instanceof Date ? row[h] : current[i]; });
    return out;
  }
  sh.appendRow(head.map(h => clean_(h, row[h])));
  const out = {};
  head.forEach(h => { out[h] = row[h] === undefined ? '' : row[h]; });
  return out;
}

function appendRows_(name, rows) {
  if (!rows.length) return;
  const sh = sheet_(name);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, head.length)
    .setValues(rows.map(r => head.map(h => clean_(h, r[h]))));
}

function deleteRow_(name, id) {
  const sh = sheet_(name);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const col = head.indexOf('id') + 1;
  if (sh.getLastRow() < 2) return;
  const ids = sh.getRange(2, col, sh.getLastRow() - 1, 1).getValues().map(r => String(r[0]));
  const at = ids.indexOf(String(id));
  if (at >= 0) sh.deleteRow(at + 2);
}

function clean_(col, v) {
  if (v === undefined || v === null) return '';
  if (NUMBER_COLS.indexOf(col) >= 0) return v === '' ? '' : Number(v);
  if (typeof v === 'boolean') return v ? 'yes' : '';
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

function getSettings_() {
  const sh = SpreadsheetApp.getActive().getSheetByName('Settings');
  if (!sh || sh.getLastRow() < 2) return {};
  const out = {};
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(r => { if (r[0]) out[r[0]] = String(r[1]); });
  return out;
}

function setSetting_(key, value) {
  const sh = sheet_('Settings');
  const rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(r => r[0]) : [];
  const at = rows.indexOf(key);
  if (at >= 0) sh.getRange(at + 2, 2).setValue(value);
  else sh.appendRow([key, value]);
}

// ─── Small utils ─────────────────────────────────────────────────────────────

function newId_() { return Utilities.getUuid().slice(0, 8); }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function parseLocal_(s, tz) {
  s = String(s);
  if (/T\d/.test(s)) return Utilities.parseDate(s.slice(0, 16), tz, "yyyy-MM-dd'T'HH:mm");
  return Utilities.parseDate(s.slice(0, 10), tz, 'yyyy-MM-dd');
}

function fmtCal_(d, allDay) {
  const tz = getSettings_().timezone;
  return Utilities.formatDate(d, tz, allDay ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm");
}

function normTime_(t) {
  if (t instanceof Date) return Utilities.formatDate(t, getSettings_().timezone, 'HH:mm');
  const m = String(t).match(/(\d{1,2})[:.](\d{2})/);
  return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : '18:00';
}

function money_(n) {
  const cur = getSettings_().currency || 'EUR';
  return Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: cur });
}

function prettyDate_(s) {
  const d = parseLocal_(s, getSettings_().timezone);
  return Utilities.formatDate(d, getSettings_().timezone, /T\d/.test(s) ? 'EEE d MMM, HH:mm' : 'EEE d MMM');
}

function esc_(s) {
  return String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
