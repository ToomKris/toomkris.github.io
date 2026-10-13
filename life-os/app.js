/* Life OS web app: talks to the Apps Script API (or runs on demo data until connected). */
(() => {
  'use strict';

  // ─── Constants ─────────────────────────────────────────────────────────────
  const CATS = {
    Gym: { emoji: '🏋️', color: 'var(--c-gym)' },
    Dance: { emoji: '💃', color: 'var(--c-dance)' },
    Travel: { emoji: '✈️', color: 'var(--c-travel)' },
    Birthday: { emoji: '🎂', color: 'var(--c-birthday)' },
    Event: { emoji: '🎉', color: 'var(--c-event)' },
    Social: { emoji: '📱', color: 'var(--c-social)' },
    Other: { emoji: '📌', color: 'var(--c-other)' },
  };
  const TX_CATS = {
    'Rent & Bills': '🏠', Groceries: '🛒', 'Eating Out': '🍔', Shopping: '🛍️', Transport: '🚇',
    Entertainment: '🎬', Travel: '✈️', 'Gym & Health': '💪', Subscriptions: '📺', 'Content Creation': '📸',
    'Events & Gifts': '🎁', 'Loan Payments': '🏦', Savings: '🌱', '3rd pension': '🧓', Investments: '📈',
    Other: '❓', Salary: '💼', 'Side Hustle': '🚀', 'Brand Deals': '🤝', Refund: '↩️',
  };
  const TX_TYPES = ['Expense', 'Income', 'Loan Payment', 'Savings', 'Transfer'];
  const WORKOUTS = ['Lift', 'Dance', 'Cardio', 'Mobility'];
  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const TRIP_GRADS = [
    'linear-gradient(135deg,#1e3c72,#2a78d6 60%,#6dd5fa)',
    'linear-gradient(135deg,#42275a,#734b6d 50%,#f4a6c1)',
    'linear-gradient(135deg,#0f2027,#2c5364 50%,#1baf7a)',
    'linear-gradient(135deg,#3a1c71,#d76d77 60%,#ffaf7b)',
    'linear-gradient(135deg,#232526,#5b3fc4 60%,#b65bd6)',
  ];
  const CFG_KEY = 'lifeos.config', CACHE_KEY = 'lifeos.cache', DEMO_KEY = 'lifeos.demo';

  // ─── Small helpers ─────────────────────────────────────────────────────────
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const ym = d => ymd(d).slice(0, 7);
  const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const parseD = s => {
    if (!s) return null;
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
  };
  const hasTime = s => /T\d/.test(String(s || ''));
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = () => startOfDay(new Date());
  const daysUntil = s => Math.round((startOfDay(parseD(s)) - today()) / 864e5);
  const mondayOf = d => { const x = startOfDay(d); const wd = (x.getDay() + 6) % 7; return addDays(x, -wd); };
  const num = v => Number(v) || 0;
  const fmtDate = (s, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => parseD(s)?.toLocaleDateString('en-GB', opts) ?? '';
  const fmtRange = (a, b) => {
    if (!b || ymd(parseD(a)) === ymd(parseD(b))) return fmtDate(a, { day: 'numeric', month: 'short', year: 'numeric' });
    return `${fmtDate(a, { day: 'numeric', month: 'short' })} – ${fmtDate(b, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  };
  const uid = () => Math.random().toString(36).slice(2, 10);
  const isCancelled = e => /cancel/i.test(e.status || '');
  const isDone = e => /done/i.test(e.status || '');
  const catOf = c => CATS[c] || CATS.Other;
  const needsCat = t => !t.category && t.type !== 'Transfer';
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  let currency = 'EUR';
  const money = (n, dp) => {
    const v = num(n);
    const digits = dp ?? (Math.abs(v) >= 1000 || Number.isInteger(v) ? 0 : 2);
    return v.toLocaleString('en-IE', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits });
  };

  // ─── State & storage ───────────────────────────────────────────────────────
  const store = {
    get(k, fallback) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };

  const S = {
    cfg: store.get(CFG_KEY, { url: '', token: '' }),
    data: null,
    mode: 'demo',
    status: '',
    ui: { calMonth: ym(new Date()), calSel: ymd(new Date()), calOff: {}, weekStart: ymd(mondayOf(new Date())), moneyMonth: ym(new Date()), txQuery: '', txFilter: 'all' },
  };
  const connected = () => !!(S.cfg.url && S.cfg.token);

  // ─── API ───────────────────────────────────────────────────────────────────
  async function apiGet() {
    const u = new URL(S.cfg.url);
    u.searchParams.set('token', S.cfg.token);
    u.searchParams.set('action', 'all');
    const r = await fetch(u.toString(), { redirect: 'follow' });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Request failed');
    return j.data;
  }
  async function apiPost(action, payload) {
    const r = await fetch(S.cfg.url, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: S.cfg.token, action, ...payload }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Request failed');
    return j.data;
  }

  const TABLE_KEY = { Events: 'events', Transactions: 'transactions', Budgets: 'budgets', Loans: 'loans', Templates: 'templates', Rules: 'rules' };

  async function load() {
    if (connected()) {
      S.mode = 'live';
      const cached = store.get(CACHE_KEY);
      if (cached && !S.data) { S.data = cached; render(); }
      setSync('Syncing…');
      try {
        S.data = await apiGet();
        store.set(CACHE_KEY, S.data);
        setSync('Synced ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
      } catch (err) {
        setSync('Offline · showing last copy');
        toast('Could not reach your sheet: ' + err.message);
        if (!S.data) S.data = emptyData();
      }
    } else {
      S.mode = 'demo';
      S.data = store.get(DEMO_KEY) || demoData();
      setSync('Demo data');
    }
    currency = S.data.settings?.currency || 'EUR';
    render();
  }

  async function save(table, row) {
    const key = TABLE_KEY[table];
    const list = S.data[key];
    if (!row.id) row.id = uid();
    const i = list.findIndex(r => r.id === row.id);
    if (i >= 0) list[i] = { ...list[i], ...row }; else list.push(row);
    render();
    if (S.mode === 'demo') { store.set(DEMO_KEY, S.data); return row; }
    try {
      const saved = await apiPost('upsert', { table, row });
      const j = list.findIndex(r => r.id === row.id);
      if (j >= 0) list[j] = { ...list[j], ...saved };
      store.set(CACHE_KEY, S.data);
      render();
      return saved;
    } catch (err) { toast('Not saved: ' + err.message); load(); }
  }

  async function remove(table, id) {
    const key = TABLE_KEY[table];
    S.data[key] = S.data[key].filter(r => r.id !== id);
    render();
    if (S.mode === 'demo') { store.set(DEMO_KEY, S.data); return; }
    try { await apiPost('delete', { table, id }); store.set(CACHE_KEY, S.data); } catch (err) { toast('Not deleted: ' + err.message); load(); }
  }

  async function runAction(action, label) {
    if (S.mode === 'demo') {
      if (action === 'generateTraining') { demoGenerateTraining(); store.set(DEMO_KEY, S.data); render(); toast('Training planned for the next 2 weeks'); }
      else toast('Connect your sheet in Settings to do this for real');
      return;
    }
    setSync(label + '…');
    try { S.data = await apiPost(action, {}); store.set(CACHE_KEY, S.data); render(); toast(label + ' done'); setSync('Synced just now'); }
    catch (err) { toast(label + ' failed: ' + err.message); setSync('Sync failed'); }
  }

  function emptyData() { return { events: [], transactions: [], budgets: [], loans: [], templates: [], rules: [], settings: { currency: 'EUR' } }; }

  // ─── Derived data ──────────────────────────────────────────────────────────
  const D = {
    events() { return S.data.events.filter(e => e.start); },
    eventsOn(day) {
      const d = ymd(day);
      return D.events().filter(e => {
        if (e.category === 'Birthday') return e.start.slice(5, 10) === d.slice(5);
        const s = e.start.slice(0, 10), en = (e.end || e.start).slice(0, 10);
        return d >= s && d <= en;
      }).sort((a, b) => (hasTime(a.start) ? a.start.slice(11) : '00') < (hasTime(b.start) ? b.start.slice(11) : '00') ? -1 : 1);
    },
    nextBirthday(e) {
      const t = today(); const b = parseD(e.start);
      let n = new Date(t.getFullYear(), b.getMonth(), b.getDate());
      if (n < t) n = new Date(t.getFullYear() + 1, b.getMonth(), b.getDate());
      return n;
    },
    txIn(month) { return S.data.transactions.filter(t => String(t.date).slice(0, 7) === month); },
    spentBy(month) {
      const out = {};
      D.txIn(month).forEach(t => {
        if (t.type === 'Income' || t.type === 'Transfer') return;
        const k = t.category || 'Uncategorised';
        out[k] = out[k] || { paid: 0, planned: 0 };
        out[k][t.status === 'Planned' ? 'planned' : 'paid'] += num(t.amount);
      });
      return out;
    },
    totals(month) {
      const r = { income: 0, spent: 0, saved: 0, loans: 0, planned: 0 };
      D.txIn(month).forEach(t => {
        const a = num(t.amount);
        if (t.status === 'Planned') { if (t.type !== 'Income') r.planned += a; return; }
        if (t.type === 'Income') r.income += a;
        else if (t.type === 'Expense') r.spent += a;
        else if (t.type === 'Savings') r.saved += a;
        else if (t.type === 'Loan Payment') r.loans += a;
      });
      return r;
    },
    loanStats(l) {
      const pays = S.data.transactions.filter(t => t.loanId === l.id);
      const paid = pays.filter(t => t.status !== 'Planned').reduce((a, t) => a + num(t.amount), 0);
      const remaining = Math.max(0, num(l.original) - paid);
      const monthsLeft = num(l.monthly) ? Math.ceil(remaining / num(l.monthly) - 1e-9) : 0;
      let due = null;
      if (l.dueDay && remaining > 0) {
        const t = today();
        due = new Date(t.getFullYear(), t.getMonth(), num(l.dueDay));
        if (due < t) due = new Date(t.getFullYear(), t.getMonth() + 1, num(l.dueDay));
        if (l.start && due < parseD(l.start)) due = parseD(l.start);
      }
      return { pays, paid, remaining, monthsLeft, due, pct: num(l.original) ? Math.min(100, paid / num(l.original) * 100) : 0 };
    },
    tripSpend(e) {
      const tx = S.data.transactions.filter(t => t.eventId === e.id);
      const paid = tx.filter(t => t.status !== 'Planned').reduce((a, t) => a + num(t.amount), 0);
      const planned = tx.filter(t => t.status === 'Planned').reduce((a, t) => a + num(t.amount), 0);
      return { tx, paid, planned };
    },
    training(from, to) {
      return D.events().filter(e => (e.category === 'Gym' || e.category === 'Dance') && e.start.slice(0, 10) >= ymd(from) && e.start.slice(0, 10) <= ymd(to));
    },
  };

  // ─── Rendering ─────────────────────────────────────────────────────────────
  const views = { home, calendar, training, money: moneyPage, trips, loans, settings };
  function route() { return (location.hash.replace(/^#\/?/, '') || 'home').split('?')[0]; }

  function render() {
    if (!S.data) return;
    const r = views[route()] ? route() : 'home';
    document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.route === r));
    $('#view').innerHTML = (S.mode === 'demo' && r !== 'settings' ? demoBanner() : '') + views[r]();
    $('#fab').hidden = r === 'settings';
  }

  function setSync(text) {
    S.status = text;
    $('#sync').innerHTML = `<span class="dot ${S.mode === 'live' ? 'live' : 'demo'}"></span>${esc(text)}`;
  }

  function demoBanner() {
    return `<div class="banner"><span>✨</span><span class="small"><b>You're looking at demo data.</b> Connect your Google Sheet to see your real life.</span><span class="spacer"></span><a class="btn sm primary" href="#/settings">Connect</a></div>`;
  }

  const catChip = c => `<span class="chip cat" style="--cat:${catOf(c).color}"><span class="sw"></span>${esc(c || 'Other')}</span>`;
  const empty = (ico, text) => `<div class="empty"><div class="e-ico">${ico}</div>${text}</div>`;

  function evRow(e) {
    const c = catOf(e.category);
    const time = hasTime(e.start) ? `${e.start.slice(11, 16)}${e.end && hasTime(e.end) && e.end.slice(0, 10) === e.start.slice(0, 10) ? '–' + e.end.slice(11, 16) : ''}` : 'All day';
    const meta = [time, e.location, e.workout].filter(Boolean).map(esc).join(' · ');
    return `<div class="ev ${isDone(e) ? 'done' : ''}" style="--cat:${c.color}" data-edit="Events" data-id="${esc(e.id)}">
      <span class="ev-bar"></span>
      <div><div class="ev-title">${c.emoji} ${esc(e.title)}</div><div class="ev-meta">${meta}</div></div>
      ${e.category === 'Gym' || e.category === 'Dance' ? `<button class="btn sm ${isDone(e) ? 'primary' : ''}" data-done="${esc(e.id)}">${isDone(e) ? '✓ Done' : 'Mark done'}</button>` : ''}
    </div>`;
  }

  function agenda(days) {
    const t = today();
    let html = '';
    for (let i = 0; i < days; i++) {
      const d = addDays(t, i);
      const evs = D.eventsOn(d).filter(e => !isCancelled(e));
      if (!evs.length) continue;
      const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
      html += `<div class="agenda-day"><div class="agenda-date">${label}</div>${evs.map(evRow).join('')}</div>`;
    }
    return html || empty('🌙', 'Nothing planned. Tap + to add something.');
  }

  function meterRow(name, emoji, paid, planned, budget) {
    const total = paid + planned;
    const scale = Math.max(budget, total) || 1;
    const ratio = budget ? total / budget : 0;
    const cls = !budget ? '' : ratio > 1 ? 'over' : ratio > .85 ? 'near' : 'ok';
    const statusTxt = !budget ? '' : ratio > 1 ? `Over by ${money(total - budget)}` : `${money(budget - total)} left`;
    return `<div class="meter">
      <div class="m-name">${emoji} ${esc(name)}</div>
      <div class="m-val num"><b>${money(total)}</b> / ${budget ? money(budget) : '—'}</div>
      <div class="bar" role="img" aria-label="${esc(name)}: ${money(paid)} paid, ${money(planned)} planned, budget ${money(budget)}">
        ${paid ? `<i class="${cls}" style="width:${paid / scale * 100}%" data-tip="${esc(name)} · paid ${money(paid)}"></i>` : ''}
        ${planned ? `<i class="planned ${cls}" style="width:${planned / scale * 100}%" data-tip="${esc(name)} · planned ${money(planned)}"></i>` : ''}
      </div>
      ${statusTxt ? `<div class="status-txt ${cls}" style="grid-column:1/-1">${cls === 'over' ? '⚠︎ ' : ''}${statusTxt}</div>` : ''}
    </div>`;
  }

  // Home ----------------------------------------------------------------------
  function home() {
    const now = new Date();
    const h = now.getHours();
    const greet = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    const month = ym(now);
    const tot = D.totals(month);
    const budgetOut = S.data.budgets.filter(b => b.direction !== 'In' && !['Savings', 'Debt'].includes(b.group)).reduce((a, b) => a + num(b.monthly), 0);
    const wk = D.training(mondayOf(now), addDays(mondayOf(now), 6)).filter(e => !isCancelled(e));
    const wkDone = wk.filter(isDone).length;
    const trips = D.events().filter(e => e.category === 'Travel' && !isCancelled(e) && (e.end || e.start).slice(0, 10) >= ymd(today()))
      .sort((a, b) => a.start < b.start ? -1 : 1);
    const next = trips[0];
    const loansLeft = S.data.loans.filter(l => l.status !== 'Paid off').reduce((a, l) => a + D.loanStats(l).remaining, 0);
    const toSort = S.data.transactions.filter(needsCat).length;
    const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate();

    const spentBy = D.spentBy(month);
    const meters = S.data.budgets.filter(b => b.direction !== 'In' && num(b.monthly) > 0).map(b => {
      const s = spentBy[b.category] || { paid: 0, planned: 0 };
      return { b, s, r: (s.paid + s.planned) / num(b.monthly) };
    }).sort((a, b) => b.r - a.r).slice(0, 6);

    const bdays = D.events().filter(e => e.category === 'Birthday').map(e => ({ e, n: D.nextBirthday(e) }))
      .filter(x => (x.n - today()) / 864e5 <= 45).sort((a, b) => a.n - b.n);

    return `
      <section class="hero">
        <p>${now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <h1>${greet} 🌙</h1>
        <div class="hero-stats">
          <div><div class="hs-val num">${wkDone}/${wk.length}</div><div class="hs-lbl">sessions this week</div></div>
          <div><div class="hs-val num">${money(Math.max(0, budgetOut - tot.spent))}</div><div class="hs-lbl">left to spend · ${plural(daysLeft, 'day')} to go</div></div>
          ${next ? `<div><div class="hs-val">${daysUntil(next.start) <= 0 ? 'Now' : daysUntil(next.start) + 'd'}</div><div class="hs-lbl">until ${esc(next.title)}</div></div>` : ''}
        </div>
      </section>

      <div class="grid g-4 mt">
        <div class="card tile"><div class="t-lbl">💸 Spent this month</div><div class="t-val num">${money(tot.spent)}</div><div class="t-sub">of ${money(budgetOut)} planned</div></div>
        <div class="card tile"><div class="t-lbl">💰 Income</div><div class="t-val num">${money(tot.income)}</div><div class="t-sub">${money(tot.saved)} saved</div></div>
        <div class="card tile"><div class="t-lbl">✈️ Next trip</div><div class="t-val">${next ? esc(next.title) : '—'}</div><div class="t-sub">${next ? fmtRange(next.start, next.end) : 'Nothing booked'}</div></div>
        <div class="card tile"><div class="t-lbl">🏦 Loans left</div><div class="t-val num">${money(loansLeft)}</div><div class="t-sub">${plural(S.data.loans.filter(l => l.status !== 'Paid off').length, 'active loan')}</div></div>
      </div>

      ${toSort ? `<div class="banner mt"><span>🟠</span><span class="small"><b>${plural(toSort, 'transaction')}</b> need a category.</span><span class="spacer"></span><a class="btn sm" href="#/money" data-filter="uncat">Sort them</a></div>` : ''}

      <div class="grid g-main mt">
        <div class="card">
          <div class="card-head"><h2>Coming up</h2><a class="btn sm ghost" href="#/calendar">Calendar →</a></div>
          ${agenda(10)}
        </div>
        <div class="stack">
          <div class="card">
            <div class="card-head"><h2>Budgets · ${now.toLocaleDateString('en-GB', { month: 'long' })}</h2><a class="btn sm ghost" href="#/money">Money →</a></div>
            ${meters.length ? meters.map(m => meterRow(m.b.category, TX_CATS[m.b.category] || '•', m.s.paid, m.s.planned, num(m.b.monthly))).join('') : empty('🎯', 'Add budgets in Money.')}
          </div>
          ${bdays.length ? `<div class="card"><div class="card-head"><h2>Birthdays soon</h2></div>
            ${bdays.map(({ e, n }) => {
              const d = Math.round((n - today()) / 864e5);
              return `<div class="ev" style="--cat:${CATS.Birthday.color}" data-edit="Events" data-id="${esc(e.id)}"><span class="ev-bar"></span>
                <div><div class="ev-title">🎂 ${esc(e.title)}</div><div class="ev-meta">${n.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}${e.giftIdea ? ' · 🎁 ' + esc(e.giftIdea) : ''}</div></div>
                <span class="chip">${d === 0 ? 'Today!' : 'in ' + plural(d, 'day')}</span></div>`;
            }).join('')}</div>` : ''}
        </div>
      </div>`;
  }

  // Calendar ------------------------------------------------------------------
  function calendar() {
    const [y, m] = S.ui.calMonth.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const start = mondayOf(first);
    const t = ymd(today());
    let cells = WEEKDAYS.map(w => `<div class="wd">${w}</div>`).join('');
    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i);
      if (i >= 35 && d.getMonth() !== m - 1) break;
      const evs = D.eventsOn(d).filter(e => !isCancelled(e) && !S.ui.calOff[e.category || 'Other']);
      const k = ymd(d);
      cells += `<div class="day ${d.getMonth() !== m - 1 ? 'out' : ''} ${k === t ? 'today' : ''} ${k === S.ui.calSel ? 'sel' : ''}" data-day="${k}">
        <span class="dn">${d.getDate()}</span>
        ${evs.slice(0, 3).map(e => `<span class="pill ${isDone(e) ? 'done' : ''}" style="--cat:${catOf(e.category).color}" title="${esc(e.title)}">${catOf(e.category).emoji} ${esc(e.title)}</span>`).join('')}
        ${evs.length > 3 ? `<span class="more">+${evs.length - 3} more</span>` : ''}
      </div>`;
    }
    const sel = parseD(S.ui.calSel);
    const selEvs = D.eventsOn(sel).filter(e => !S.ui.calOff[e.category || 'Other']);
    return `
      <div class="page-head">
        <div><h1>${first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</h1><p>Everything synced with your Google Calendar.</p></div>
        <div class="row">
          <button class="btn icon-btn" data-cal="-1" aria-label="Previous month">‹</button>
          <button class="btn" data-cal="0">Today</button>
          <button class="btn icon-btn" data-cal="1" aria-label="Next month">›</button>
          <button class="btn" data-run="sync" data-label="Calendar sync">⟳ Sync</button>
        </div>
      </div>
      <div class="chips" style="margin-bottom:14px">
        ${Object.keys(CATS).map(c => `<span class="chip cat toggle ${S.ui.calOff[c] ? 'off' : ''}" style="--cat:${CATS[c].color}" data-calcat="${c}"><span class="sw"></span>${CATS[c].emoji} ${c}</span>`).join('')}
      </div>
      <div class="grid g-main" style="grid-template-columns:minmax(0,2fr) minmax(260px,1fr)">
        <div class="cal">${cells}</div>
        <div class="card" style="align-self:start">
          <div class="card-head"><h2>${sel.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
            <button class="btn sm" data-new="Events" data-date="${S.ui.calSel}">+ Add</button></div>
          ${selEvs.length ? selEvs.map(evRow).join('') : empty('☁️', 'Free day.')}
        </div>
      </div>`;
  }

  // Training ------------------------------------------------------------------
  function training() {
    const ws = parseD(S.ui.weekStart);
    const we = addDays(ws, 6);
    const sessions = D.training(ws, we);
    const t = ymd(today());
    const cols = WEEKDAYS.map((w, i) => {
      const d = addDays(ws, i);
      const list = sessions.filter(e => e.start.slice(0, 10) === ymd(d)).sort((a, b) => a.start < b.start ? -1 : 1);
      return `<div class="wcol ${ymd(d) === t ? 'today' : ''}">
        <div class="wh"><b>${w}</b><span>${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' })}</span></div>
        ${list.map(e => `<div class="sess ${isDone(e) ? 'done' : ''} ${isCancelled(e) ? 'skipped' : ''}" style="--cat:${catOf(e.category).color}" data-edit="Events" data-id="${esc(e.id)}">
            <div class="s-t">${catOf(e.category).emoji} ${esc(e.title)}</div>
            <div class="s-m">${hasTime(e.start) ? e.start.slice(11, 16) : ''}${e.durationMin ? ' · ' + e.durationMin + ' min' : ''}${e.location ? ' · ' + esc(e.location) : ''}</div>
            ${e.workout ? `<div class="s-m">${esc(e.workout)}</div>` : ''}
            ${isCancelled(e) ? '<div class="s-m">Skipped</div>' : `<button class="s-done" data-done="${esc(e.id)}">${isDone(e) ? '✓ Done' : 'Mark done'}</button>`}
          </div>`).join('')}
        <button class="addslot" data-new="Events" data-date="${ymd(d)}" data-cat="Gym">+ session</button>
      </div>`;
    }).join('');

    // last 8 weeks done counts
    const weeks = [];
    for (let i = 7; i >= 0; i--) {
      const s = addDays(mondayOf(new Date()), -7 * i);
      const list = D.training(s, addDays(s, 6));
      weeks.push({ s, done: list.filter(isDone).length, planned: list.filter(e => !isCancelled(e)).length });
    }
    const maxW = Math.max(4, ...weeks.map(w => w.done));
    const thisWeek = weeks[weeks.length - 1];
    let streak = 0;
    for (let i = weeks.length - 2; i >= 0; i--) { if (weeks[i].done > 0) streak++; else break; }
    if (thisWeek.done > 0) streak++;
    const pct = thisWeek.planned ? Math.round(thisWeek.done / thisWeek.planned * 100) : 0;
    const monthAgo = addDays(today(), -30);
    const byType = {};
    D.training(monthAgo, today()).filter(isDone).forEach(e => String(e.workout || e.category).split(',').map(s => s.trim()).filter(Boolean).forEach(k => { byType[k] = (byType[k] || 0) + 1; }));

    const tmpl = S.data.templates.slice().sort((a, b) => WEEKDAYS.indexOf(String(a.weekday).slice(0, 3)) - WEEKDAYS.indexOf(String(b.weekday).slice(0, 3)) || String(a.time).localeCompare(String(b.time)));

    return `
      <div class="page-head">
        <div><h1>Training</h1><p>Gym, dance and everything that makes you sweat.</p></div>
        <div class="row">
          <button class="btn icon-btn" data-week="-1" aria-label="Previous week">‹</button>
          <button class="btn" data-week="0">This week</button>
          <button class="btn icon-btn" data-week="1" aria-label="Next week">›</button>
          <button class="btn primary" data-run="generateTraining" data-label="Training plan">✦ Plan next 2 weeks</button>
        </div>
      </div>
      <div class="grid g-3">
        <div class="card"><div class="row"><div class="ring" style="--p:${pct};--c:var(--good)"><span>${pct}%</span></div>
          <div class="tile"><div class="t-lbl">This week</div><div class="t-val num">${thisWeek.done} / ${thisWeek.planned}</div><div class="t-sub">sessions done</div></div></div></div>
        <div class="card tile"><div class="t-lbl">🔥 Streak</div><div class="t-val">${plural(streak, 'week')}</div><div class="t-sub">in a row with at least one session</div></div>
        <div class="card tile"><div class="t-lbl">Last 30 days</div>
          <div class="chips" style="margin-top:6px">${Object.keys(byType).length ? Object.entries(byType).map(([k, v]) => `<span class="chip">${esc(k)} <b>${v}</b></span>`).join('') : '<span class="faint small">No sessions marked done yet</span>'}</div></div>
      </div>
      <h2 class="mt-l" style="margin-bottom:12px">${fmtDate(ymd(ws), { day: 'numeric', month: 'short' })} – ${fmtDate(ymd(we), { day: 'numeric', month: 'short' })}</h2>
      <div class="week">${cols}</div>
      <div class="grid g-2 mt-l">
        <div class="card">
          <div class="card-head"><h2>Sessions done per week</h2><span class="faint small">last 8 weeks</span></div>
          <div class="bars" role="img" aria-label="Sessions done per week: ${weeks.map(w => w.done).join(', ')}">
            ${weeks.map((w, i) => `<div class="b ${i === 7 ? 'now' : ''}" data-tip="Week of ${fmtDate(ymd(w.s), { day: 'numeric', month: 'short' })} · ${w.done} done of ${w.planned}">
              <span class="num" style="color:var(--text-2);font-weight:700">${w.done || ''}</span>
              <i style="height:${w.done / maxW * 100}%"></i><span>${w.s.getDate()}/${w.s.getMonth() + 1}</span></div>`).join('')}
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Weekly template</h2><button class="btn sm" data-new="Templates">+ Add</button></div>
          <p class="small muted" style="margin:-6px 0 12px">Every Sunday these get added to your calendar for the coming weeks.</p>
          ${tmpl.length ? tmpl.map(x => `<div class="ev ${x.active === 'no' ? 'done' : ''}" style="--cat:${catOf(x.category).color}" data-edit="Templates" data-id="${esc(x.id)}">
              <span class="ev-bar"></span><div><div class="ev-title">${esc(x.weekday)} · ${esc(x.title)}</div>
              <div class="ev-meta">${esc(x.time || '')}${x.durationMin ? ' · ' + x.durationMin + ' min' : ''}${x.location ? ' · ' + esc(x.location) : ''}${x.workout ? ' · ' + esc(x.workout) : ''}</div></div>
              <span class="chip">${x.active === 'no' ? 'Paused' : 'Weekly'}</span></div>`).join('') : empty('🗓️', 'Add your usual week: e.g. Mon lift, Tue dance.')}
        </div>
      </div>`;
  }

  // Money ---------------------------------------------------------------------
  function moneyPage() {
    const month = S.ui.moneyMonth;
    const md = parseD(month + '-01');
    const tot = D.totals(month);
    const spentBy = D.spentBy(month);
    const budgets = S.data.budgets.filter(b => b.direction !== 'In');
    const incomeBudget = S.data.budgets.filter(b => b.direction === 'In').reduce((a, b) => a + num(b.monthly), 0);
    const groups = {};
    budgets.forEach(b => { (groups[b.group || 'Other'] = groups[b.group || 'Other'] || []).push(b); });
    const unbudgeted = Object.keys(spentBy).filter(k => !budgets.some(b => b.category === k));

    const q = S.ui.txQuery.toLowerCase();
    let txs = S.ui.txFilter === 'uncat' ? S.data.transactions.filter(needsCat) : D.txIn(month);
    if (S.ui.txFilter === 'planned') txs = S.data.transactions.filter(t => t.status === 'Planned');
    if (q) txs = txs.filter(t => [t.name, t.category, t.notes, t.type].join(' ').toLowerCase().includes(q));
    txs = txs.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const events = Object.fromEntries(S.data.events.map(e => [e.id, e]));

    return `
      <div class="page-head">
        <div><h1>Money</h1><p>Budget smart, crush the loans, see where every coin goes.</p></div>
        <div class="row">
          <button class="btn icon-btn" data-month="-1" aria-label="Previous month">‹</button>
          <b style="min-width:130px;text-align:center">${md.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</b>
          <button class="btn icon-btn" data-month="1" aria-label="Next month">›</button>
        </div>
      </div>
      <div class="grid g-4">
        <div class="card tile"><div class="t-lbl">💰 Income</div><div class="t-val num" style="color:var(--good)">${money(tot.income)}</div><div class="t-sub">expected ${money(incomeBudget)}</div></div>
        <div class="card tile"><div class="t-lbl">💸 Spent</div><div class="t-val num">${money(tot.spent)}</div><div class="t-sub">${tot.planned ? money(tot.planned) + ' more planned' : 'nothing else planned'}</div></div>
        <div class="card tile"><div class="t-lbl">🌱 Saved & invested</div><div class="t-val num">${money(tot.saved)}</div><div class="t-sub">this month</div></div>
        <div class="card tile"><div class="t-lbl">🏦 Loan payments</div><div class="t-val num">${money(tot.loans)}</div><div class="t-sub">this month</div></div>
      </div>
      <div class="grid g-main mt">
        <div class="card">
          <div class="card-head">
            <h2>Transactions</h2>
            <div class="row">
              <input class="input search" placeholder="Search…" value="${esc(S.ui.txQuery)}" data-txq>
              <div class="seg">
                <button class="${S.ui.txFilter === 'all' ? 'on' : ''}" data-txf="all">Month</button>
                <button class="${S.ui.txFilter === 'uncat' ? 'on' : ''}" data-txf="uncat">To sort</button>
                <button class="${S.ui.txFilter === 'planned' ? 'on' : ''}" data-txf="planned">Planned</button>
              </div>
            </div>
          </div>
          <div class="list">
            ${txs.length ? txs.map(t => {
              const inc = t.type === 'Income';
              const ev = events[t.eventId];
              return `<div class="tx ${t.status === 'Planned' ? 'planned' : ''}" data-edit="Transactions" data-id="${esc(t.id)}">
                <div class="tx-ico">${TX_CATS[t.category] || (t.type === 'Transfer' ? '🔁' : t.category ? '•' : '🟠')}</div>
                <div><div class="tx-name">${esc(t.name)}</div>
                  <div class="tx-meta">${fmtDate(t.date)}
                    ${!needsCat(t) ? (t.category ? `<span>· ${esc(t.category)}</span>` : '') : `<span class="chip warn" data-pickcat="${esc(t.id)}">Pick category</span>`}
                    ${t.type === 'Transfer' ? '<span>· Transfer</span>' : ''}
                    ${ev ? `<span class="chip cat" style="--cat:${catOf(ev.category).color}">${catOf(ev.category).emoji} ${esc(ev.title)}</span>` : ''}
                    ${t.status === 'Planned' ? '<span class="chip">Planned</span>' : ''}
                  </div></div>
                <div class="tx-amt num ${inc ? 'in' : ''}">${inc ? '+' : '−'}${money(t.amount, 2)}${t.currency && t.currency.toUpperCase() !== currency && /^[A-Za-z]{3}$/.test(t.currency) ? `<div class="tiny faint">${esc(t.currency.toUpperCase())}</div>` : ''}</div>
              </div>`;
            }).join('') : empty('🧾', S.ui.txFilter === 'uncat' ? 'All sorted. Nice!' : 'No transactions here yet.')}
          </div>
        </div>
        <div class="stack">
          <div class="card">
            <div class="card-head"><h2>Import from Revolut</h2></div>
            <label class="drop" id="drop">
              <input type="file" accept=".csv,text/csv" id="csvfile" class="sr-only">
              <div style="font-size:26px">📥</div>
              <div><b>Drop your Revolut CSV here</b></div>
              <div class="small faint">or click to choose a file. Duplicates are skipped and merchants get sorted automatically.</div>
            </label>
          </div>
          <div class="card">
            <div class="card-head"><h2>Budget vs actual</h2><button class="btn sm" data-new="Budgets">+ Budget</button></div>
            ${Object.entries(groups).map(([g, list]) => `
              <div class="agenda-date" style="margin-top:14px">${esc(g)}</div>
              ${list.map(b => { const s = spentBy[b.category] || { paid: 0, planned: 0 }; return `<div data-edit="Budgets" data-id="${esc(b.id)}" style="cursor:pointer">${meterRow(b.category, TX_CATS[b.category] || '•', s.paid, s.planned, num(b.monthly))}</div>`; }).join('')}`).join('') || empty('🎯', 'No budgets yet.')}
            ${unbudgeted.length ? `<div class="agenda-date" style="margin-top:18px">No budget set</div>${unbudgeted.map(k => meterRow(k, TX_CATS[k] || '🟠', spentBy[k].paid, spentBy[k].planned, 0)).join('')}` : ''}
          </div>
        </div>
      </div>`;
  }

  // Trips & events ------------------------------------------------------------
  function trips() {
    const t = ymd(today());
    const all = D.events().filter(e => (e.category === 'Travel' || e.category === 'Event') && !isCancelled(e));
    const upcoming = all.filter(e => (e.end || e.start).slice(0, 10) >= t).sort((a, b) => a.start < b.start ? -1 : 1);
    const past = all.filter(e => (e.end || e.start).slice(0, 10) < t).sort((a, b) => a.start > b.start ? -1 : 1);
    const bdays = D.events().filter(e => e.category === 'Birthday').map(e => ({ e, n: D.nextBirthday(e) })).sort((a, b) => a.n - b.n);

    const card = (e, i) => {
      const d = daysUntil(e.start);
      const endD = daysUntil(e.end || e.start);
      const sp = D.tripSpend(e);
      const budget = num(e.budget);
      const nights = e.end ? Math.max(0, Math.round((startOfDay(parseD(e.end)) - startOfDay(parseD(e.start))) / 864e5)) : 0;
      return `<div class="card trip" data-edit="Events" data-id="${esc(e.id)}">
        <div class="trip-top" style="background:${TRIP_GRADS[i % TRIP_GRADS.length]}">
          <span class="badge">${catOf(e.category).emoji} ${e.category === 'Travel' ? (nights ? plural(nights, 'night') : 'Day trip') : 'Event'}</span>
          <div class="cd">${d > 0 ? `${d}<small>days to go</small>` : endD >= 0 ? 'Happening now' : 'Done'}</div>
          <div><div class="tt">${esc(e.title)}</div><div class="small" style="opacity:.85">${fmtRange(e.start, e.end)}${e.location ? ' · ' + esc(e.location) : ''}</div></div>
        </div>
        <div class="trip-body">
          ${meterRow('Budget', '💶', sp.paid, sp.planned, budget)}
          ${sp.tx.length ? `<div class="mt small">${sp.tx.map(x => `<div class="row" style="justify-content:space-between;padding:3px 0"><span class="muted">${esc(x.name)}${x.status === 'Planned' ? ' <span class="chip">Planned</span>' : ''}</span><b class="num">${money(x.amount, 2)}</b></div>`).join('')}</div>` : '<div class="small faint mt">Spending during these dates gets linked here automatically.</div>'}
          <div class="row mt">
            ${e.link ? `<a class="btn sm" href="${esc(e.link)}" target="_blank" rel="noopener" data-stop>🔗 Booking</a>` : ''}
            <button class="btn sm" data-new="Transactions" data-event="${esc(e.id)}">+ Expense</button>
          </div>
        </div>
      </div>`;
    };

    return `
      <div class="page-head">
        <div><h1>Trips & events</h1><p>Countdowns, budgets and everything you booked.</p></div>
        <button class="btn primary" data-new="Events" data-cat="Travel">+ Plan a trip</button>
      </div>
      ${upcoming.length ? `<div class="grid g-3">${upcoming.map(card).join('')}</div>` : `<div class="card">${empty('🧳', 'No trips planned yet. Where to next?')}</div>`}
      <div class="card mt-l">
        <div class="card-head"><h2>🎂 Birthdays</h2><button class="btn sm" data-new="Events" data-cat="Birthday">+ Birthday</button></div>
        ${bdays.length ? bdays.map(({ e, n }) => {
          const d = Math.round((n - today()) / 864e5);
          return `<div class="ev" style="--cat:${CATS.Birthday.color}" data-edit="Events" data-id="${esc(e.id)}"><span class="ev-bar"></span>
            <div><div class="ev-title">${esc(e.title)}</div><div class="ev-meta">${n.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}${e.giftIdea ? ' · 🎁 ' + esc(e.giftIdea) : ''}${e.budget ? ' · ' + money(e.budget) : ''}</div></div>
            <span class="chip">${d === 0 ? 'Today!' : 'in ' + plural(d, 'day')}</span></div>`;
        }).join('') : empty('🎈', 'Add birthdays and get a reminder a week before, with your gift idea.')}
      </div>
      ${past.length ? `<h2 class="mt-l" style="margin-bottom:12px">Past</h2><div class="grid g-3">${past.slice(0, 6).map((e, i) => card(e, i + 2)).join('')}</div>` : ''}`;
  }

  // Loans ---------------------------------------------------------------------
  function loans() {
    const list = S.data.loans.slice().sort((a, b) => (a.status === 'Paid off') - (b.status === 'Paid off'));
    const active = list.filter(l => l.status !== 'Paid off');
    const totalLeft = active.reduce((a, l) => a + D.loanStats(l).remaining, 0);
    const monthly = active.reduce((a, l) => a + num(l.monthly), 0);
    const lastEnd = active.map(l => l.end).filter(Boolean).sort().pop();
    return `
      <div class="page-head">
        <div><h1>Loans</h1><p>Every payment you link moves the bar.</p></div>
        <button class="btn primary" data-new="Loans">+ Loan</button>
      </div>
      <div class="grid g-3">
        <div class="card tile"><div class="t-lbl">Still to pay</div><div class="t-val num">${money(totalLeft)}</div><div class="t-sub">${plural(active.length, 'active loan')}</div></div>
        <div class="card tile"><div class="t-lbl">Every month</div><div class="t-val num">${money(monthly)}</div><div class="t-sub">in loan payments</div></div>
        <div class="card tile"><div class="t-lbl">🏆 Debt-free by</div><div class="t-val">${lastEnd ? fmtDate(lastEnd, { month: 'long', year: 'numeric' }) : '—'}</div><div class="t-sub">if you keep paying on time</div></div>
      </div>
      <div class="grid g-3 mt">
        ${list.map(l => {
          const s = D.loanStats(l);
          const paidOff = l.status === 'Paid off' || s.remaining <= 0;
          return `<div class="card loan" data-edit="Loans" data-id="${esc(l.id)}" style="cursor:pointer">
            <div class="l-top"><div class="ring" style="--p:${s.pct};--c:${paidOff ? 'var(--good)' : 'var(--accent)'}"><span>${Math.round(s.pct)}%</span></div>
              <div><h3>${esc(l.name)}</h3><div class="small muted">${esc(l.lender || '')}${l.interest ? ' · ' + (num(l.interest) * (num(l.interest) < 1 ? 100 : 1)).toFixed(1) + '% interest' : ' · 0% interest'}</div>
              ${paidOff ? '<span class="chip good" style="margin-top:6px">🏆 Paid off</span>' : s.due ? `<span class="chip ${Math.round((s.due - today()) / 864e5) <= 3 ? 'warn' : ''}" style="margin-top:6px">Next ${money(l.monthly, 2)} on ${s.due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>` : ''}</div></div>
            <div class="kv"><div><b class="num">${money(s.remaining, 2)}</b><span>left</span></div><div><b class="num">${money(s.paid, 2)}</b><span>paid</span></div><div><b>${s.monthsLeft}</b><span>${s.monthsLeft === 1 ? 'month' : 'months'} left</span></div></div>
          </div>`;
        }).join('') || `<div class="card">${empty('🎉', 'No loans. Enjoy it!')}</div>`}
      </div>`;
  }

  // Settings ------------------------------------------------------------------
  function settings() {
    const theme = document.documentElement.dataset.theme || 'auto';
    return `
      <div class="page-head"><div><h1>Settings</h1><p>Connect the app to your Google Sheet.</p></div></div>
      <div class="grid g-2">
        <div class="card">
          <div class="card-head"><h2>Connection</h2><span class="chip ${S.mode === 'live' ? 'good' : 'warn'}">${S.mode === 'live' ? 'Connected' : 'Demo mode'}</span></div>
          <form class="stack" id="cfgform">
            <label class="field">Apps Script web app URL<input class="input" name="url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(S.cfg.url)}"></label>
            <label class="field">Token<input class="input" name="token" placeholder="from the 🌙 Life OS menu in your sheet" value="${esc(S.cfg.token)}"></label>
            <div class="row"><button class="btn primary" type="submit">Save & connect</button>
              ${connected() ? '<button class="btn danger" type="button" data-disconnect>Disconnect</button>' : ''}</div>
          </form>
          <p class="small faint mt">The URL and token stay in this browser only. Your data lives in your own Google Sheet.</p>
        </div>
        <div class="card">
          <div class="card-head"><h2>How to connect</h2></div>
          <ol class="steps small">
            <li>Open your <b>Life OS</b> Google Sheet → <b>Extensions → Apps Script</b>.</li>
            <li>Paste <a href="https://github.com/ToomKris/toomkris.github.io/blob/main/life-os/apps-script/Code.gs" target="_blank" rel="noopener">Code.gs</a>, save, then run <code>setup</code> and allow access.</li>
            <li><b>Deploy → New deployment → Web app</b>, execute as <i>Me</i>, access <i>Anyone</i>.</li>
            <li>In the sheet, use <b>🌙 Life OS → Connect the app</b>. It opens this app already connected.</li>
          </ol>
        </div>
        <div class="card">
          <div class="card-head"><h2>Automations</h2></div>
          <div class="stack small">
            <div class="row"><span class="spacer">⟳ Sync with Google Calendar <span class="faint">(runs every hour)</span></span><button class="btn sm" data-run="sync" data-label="Calendar sync">Run now</button></div>
            <div class="row"><span class="spacer">🏋️ Plan training from your template <span class="faint">(Sundays)</span></span><button class="btn sm" data-run="generateTraining" data-label="Training plan">Run now</button></div>
            <div class="row"><span class="spacer">📥 Import CSVs from your Drive folder <span class="faint">(every 6 hours)</span></span></div>
            <div class="row"><span class="spacer">🔔 Reminders for loans, trips & birthdays <span class="faint">(8:00 daily)</span></span></div>
            <div class="row"><span class="spacer">📬 Weekly summary email <span class="faint">(Sunday evening)</span></span></div>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Look</h2></div>
          <div class="seg">${['auto', 'light', 'dark'].map(t => `<button class="${theme === t ? 'on' : ''}" data-theme="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>
          ${S.mode === 'demo' ? '<div class="mt"><button class="btn sm" data-resetdemo>Reset demo data</button></div>' : ''}
        </div>
      </div>`;
  }

  // ─── Forms ─────────────────────────────────────────────────────────────────
  const opt = (list, v) => list.map(o => { const [val, lbl] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(val)}" ${String(v ?? '') === String(val) ? 'selected' : ''}>${esc(lbl)}</option>`; }).join('');

  const FORMS = {
    Events: r => {
      const allDay = r.allDay === 'yes' || (r.start && !hasTime(r.start));
      const type = allDay ? 'date' : 'datetime-local';
      const v = s => s ? (allDay ? String(s).slice(0, 10) : (hasTime(s) ? String(s).slice(0, 16) : String(s).slice(0, 10) + 'T18:00')) : '';
      const training = r.category === 'Gym' || r.category === 'Dance';
      const trip = r.category === 'Travel' || r.category === 'Event';
      return `
        <label class="field full">Title<input class="input" name="title" required value="${esc(r.title)}" placeholder="${training ? 'Leg day' : trip ? 'Athens' : 'What is it?'}"></label>
        <label class="field">Category<select class="input" name="category" data-rerender>${opt(Object.keys(CATS).map(c => [c, CATS[c].emoji + ' ' + c]), r.category)}</select></label>
        <label class="field">Status<select class="input" name="status">${opt(['Planned', 'In progress', 'Done', 'Cancelled'], r.status || 'Planned')}</select></label>
        <label class="field">${r.category === 'Birthday' ? 'Date' : 'Start'}<input class="input" type="${type}" name="start" required value="${v(r.start)}"></label>
        ${r.category === 'Birthday' ? '' : `<label class="field">End<input class="input" type="${type}" name="end" value="${v(r.end)}"></label>`}
        <label class="check full"><input type="checkbox" name="allDay" data-rerender ${allDay ? 'checked' : ''}> All day</label>
        ${r.category === 'Birthday' ? '' : `<label class="field full">Location<input class="input" name="location" value="${esc(r.location)}"></label>`}
        ${training ? `<div class="field full">Workout<div class="chips">${WORKOUTS.map(w => `<label class="chip toggle"><input type="checkbox" name="workout" value="${w}" ${String(r.workout || '').includes(w) ? 'checked' : ''}> ${w}</label>`).join('')}</div></div>
          <label class="field">Duration (min)<input class="input" type="number" name="durationMin" value="${esc(r.durationMin)}"></label>` : ''}
        ${trip || r.category === 'Birthday' ? `<label class="field">Budget (${currency})<input class="input" type="number" step="0.01" name="budget" value="${esc(r.budget)}"></label>` : ''}
        ${r.category === 'Birthday' ? `<label class="field">Gift idea<input class="input" name="giftIdea" value="${esc(r.giftIdea)}"></label>` : ''}
        ${trip ? `<label class="field full">Booking link<input class="input" type="url" name="link" value="${esc(r.link)}"></label>` : ''}
        <label class="field full">Notes<textarea class="input" name="notes" rows="2">${esc(r.notes)}</textarea></label>`;
    },
    Transactions: r => {
      const evs = S.data.events.filter(e => e.category === 'Travel' || e.category === 'Event' || e.category === 'Birthday');
      return `
        <label class="field full">Name<input class="input" name="name" required value="${esc(r.name)}" placeholder="Hotel in Athens"></label>
        <label class="field">Amount (${currency})<input class="input" type="number" step="0.01" name="amount" required value="${esc(r.amount)}"></label>
        <label class="field">Date<input class="input" type="date" name="date" required value="${esc(String(r.date || ymd(new Date())).slice(0, 10))}"></label>
        <label class="field">Type<select class="input" name="type">${opt(TX_TYPES, r.type || 'Expense')}</select></label>
        <label class="field">Category<select class="input" name="category"><option value="">🟠 To categorise</option>${opt(Object.keys(TX_CATS).map(c => [c, TX_CATS[c] + ' ' + c]), r.category)}</select></label>
        <label class="field">Status<select class="input" name="status">${opt([['Paid', '✅ Paid'], ['Planned', '🗓️ Planned']], r.status || 'Paid')}</select></label>
        <label class="field">Account<select class="input" name="account">${opt(['Revolut', 'Cash', 'Other Bank'], r.account || 'Revolut')}</select></label>
        <label class="field">Trip / event<select class="input" name="eventId"><option value="">—</option>${opt(evs.map(e => [e.id, catOf(e.category).emoji + ' ' + e.title]), r.eventId)}</select></label>
        <label class="field">Loan<select class="input" name="loanId"><option value="">—</option>${opt(S.data.loans.map(l => [l.id, '🏦 ' + l.name]), r.loanId)}</select></label>
        <label class="field full">Notes<textarea class="input" name="notes" rows="2">${esc(r.notes)}</textarea></label>
        ${r.name ? `<label class="check full"><input type="checkbox" name="_learn"> Always sort “${esc(String(r.name).slice(0, 40))}” into this category</label>` : ''}`;
    },
    Budgets: r => `
      <label class="field full">Category<select class="input" name="category">${opt(Object.keys(TX_CATS).map(c => [c, TX_CATS[c] + ' ' + c]).concat([['Income', '💰 Income']]), r.category)}</select></label>
      <label class="field">Group<select class="input" name="group">${opt(['Needs', 'Wants', 'Debt', 'Savings', 'Income'], r.group || 'Needs')}</select></label>
      <label class="field">Direction<select class="input" name="direction">${opt([['Out', 'Money out'], ['In', 'Money in']], r.direction || 'Out')}</select></label>
      <label class="field full">Monthly amount (${currency})<input class="input" type="number" step="0.01" name="monthly" value="${esc(r.monthly)}"></label>`,
    Loans: r => `
      <label class="field full">Name<input class="input" name="name" required value="${esc(r.name)}"></label>
      <label class="field">Lender<input class="input" name="lender" value="${esc(r.lender)}"></label>
      <label class="field">Type<select class="input" name="type">${opt(['Personal', 'Student', 'Car', 'Credit Card', 'Mortgage', 'Family / Friend', 'Other'], r.type || 'Personal')}</select></label>
      <label class="field">Original amount<input class="input" type="number" step="0.01" name="original" value="${esc(r.original)}"></label>
      <label class="field">Monthly payment<input class="input" type="number" step="0.01" name="monthly" value="${esc(r.monthly)}"></label>
      <label class="field">Due day of month<input class="input" type="number" min="1" max="31" name="dueDay" value="${esc(r.dueDay)}"></label>
      <label class="field">Interest (e.g. 0.149)<input class="input" type="number" step="0.001" name="interest" value="${esc(r.interest)}"></label>
      <label class="field">First payment<input class="input" type="date" name="start" value="${esc(String(r.start || '').slice(0, 10))}"></label>
      <label class="field">Last payment<input class="input" type="date" name="end" value="${esc(String(r.end || '').slice(0, 10))}"></label>
      <label class="field full">Status<select class="input" name="status">${opt(['Active', 'Paused', 'Paid off'], r.status || 'Active')}</select></label>`,
    Templates: r => `
      <label class="field full">Title<input class="input" name="title" required value="${esc(r.title)}" placeholder="Upper body"></label>
      <label class="field">Day<select class="input" name="weekday">${opt(WEEKDAYS, r.weekday || 'Mon')}</select></label>
      <label class="field">Time<input class="input" type="time" name="time" value="${esc(r.time || '18:00')}"></label>
      <label class="field">Category<select class="input" name="category">${opt([['Gym', '🏋️ Gym'], ['Dance', '💃 Dance']], r.category || 'Gym')}</select></label>
      <label class="field">Duration (min)<input class="input" type="number" name="durationMin" value="${esc(r.durationMin || 60)}"></label>
      <div class="field full">Workout<div class="chips">${WORKOUTS.map(w => `<label class="chip toggle"><input type="checkbox" name="workout" value="${w}" ${String(r.workout || '').includes(w) ? 'checked' : ''}> ${w}</label>`).join('')}</div></div>
      <label class="field">Location<input class="input" name="location" value="${esc(r.location)}"></label>
      <label class="field">Active<select class="input" name="active">${opt([['yes', 'Weekly'], ['no', 'Paused']], r.active || 'yes')}</select></label>`,
  };
  const TITLES = { Events: 'event', Transactions: 'transaction', Budgets: 'budget', Loans: 'loan', Templates: 'template session' };

  let formState = null;
  function openForm(table, row, isNew) {
    formState = { table, row: { ...row }, isNew };
    drawForm();
  }
  function drawForm() {
    const { table, row, isNew } = formState;
    const m = $('#modal');
    m.innerHTML = `<form id="editform">
      <div class="m-head"><h2>${isNew ? 'New' : 'Edit'} ${TITLES[table]}</h2><button type="button" class="btn icon-btn ghost" data-close aria-label="Close">✕</button></div>
      <div class="form">${FORMS[table](row)}</div>
      <div class="m-foot">
        <button class="btn primary" type="submit">Save</button>
        <button class="btn" type="button" data-close>Cancel</button>
        <span class="spacer"></span>
        ${isNew ? '' : '<button class="btn danger" type="button" data-delete>Delete</button>'}
      </div></form>`;
    m.hidden = false; $('#backdrop').hidden = false;
    setTimeout(() => m.querySelector('input:not([type=checkbox]),select')?.focus(), 30);
  }
  function readForm() {
    const f = $('#editform');
    const out = { ...formState.row };
    const fd = new FormData(f);
    const keys = new Set([...f.elements].map(el => el.name).filter(Boolean));
    keys.forEach(k => {
      const els = [...f.elements].filter(el => el.name === k);
      if (els[0].type === 'checkbox' && k === 'workout') out[k] = fd.getAll(k).join(', ');
      else if (els[0].type === 'checkbox') out[k] = els[0].checked ? 'yes' : '';
      else out[k] = fd.get(k);
    });
    return out;
  }
  function closeForm() { $('#modal').hidden = true; $('#backdrop').hidden = true; formState = null; }

  function newRow(table, ds = {}) {
    const now = new Date();
    if (table === 'Events') {
      const cat = ds.cat || (route() === 'training' ? 'Gym' : route() === 'trips' ? 'Travel' : 'Event');
      const date = ds.date || ymd(now);
      const timed = cat === 'Gym' || cat === 'Dance' || cat === 'Event';
      return { category: cat, status: 'Planned', start: timed ? date + 'T18:00' : date, end: timed ? date + 'T19:00' : '', allDay: timed ? '' : 'yes', durationMin: timed && cat !== 'Event' ? 60 : '' };
    }
    if (table === 'Transactions') return { date: ymd(now), type: 'Expense', status: ds.event ? 'Planned' : 'Paid', account: 'Revolut', eventId: ds.event || '', category: ds.event ? 'Travel' : '' };
    if (table === 'Budgets') return { direction: 'Out', group: 'Wants' };
    if (table === 'Loans') return { status: 'Active', type: 'Personal' };
    if (table === 'Templates') return { weekday: 'Mon', time: '18:00', category: 'Gym', durationMin: 60, active: 'yes' };
    return {};
  }

  function quickAdd() {
    const m = $('#modal');
    const opts = [
      ['Events', { cat: 'Gym' }, '🏋️', 'Gym session'], ['Events', { cat: 'Dance' }, '💃', 'Dance class'],
      ['Events', { cat: 'Travel' }, '✈️', 'Trip'], ['Events', { cat: 'Event' }, '🎉', 'Event'],
      ['Events', { cat: 'Birthday' }, '🎂', 'Birthday'], ['Events', { cat: 'Social' }, '📱', 'Content post'],
      ['Transactions', {}, '💸', 'Expense or income'], ['Loans', {}, '🏦', 'Loan'],
    ];
    m.innerHTML = `<div class="m-head"><h2>Add something</h2><button class="btn icon-btn ghost" data-close aria-label="Close">✕</button></div>
      <div class="picker">${opts.map(([t, d, e, l]) => `<button class="btn" data-new="${t}" ${d.cat ? `data-cat="${d.cat}"` : ''}>${e} ${l}</button>`).join('')}</div>`;
    m.hidden = false; $('#backdrop').hidden = false;
  }

  function pickCategory(id) {
    const tx = S.data.transactions.find(t => t.id === id);
    const m = $('#modal');
    m.innerHTML = `<div class="m-head"><h2>${esc(tx.name)}</h2><button class="btn icon-btn ghost" data-close aria-label="Close">✕</button></div>
      <p class="small muted" style="margin-top:-8px">${money(tx.amount, 2)} · ${fmtDate(tx.date)}</p>
      <label class="check" style="margin:8px 0 14px"><input type="checkbox" id="learn" checked> Remember this for “${esc(String(tx.name).slice(0, 40))}”</label>
      <div class="picker">${Object.keys(TX_CATS).map(c => `<button class="btn sm" data-setcat="${esc(c)}" data-tx="${esc(id)}">${TX_CATS[c]} ${esc(c)}</button>`).join('')}</div>`;
    m.hidden = false; $('#backdrop').hidden = false;
  }

  async function learn(name, category, type) {
    if (S.mode === 'demo') {
      const match = String(name).toLowerCase().trim();
      S.data.rules.push({ id: uid(), match, category, type: '' });
      S.data.transactions.forEach(t => { if (needsCat(t) && String(t.name).toLowerCase().includes(match)) t.category = category; });
      store.set(DEMO_KEY, S.data);
      return;
    }
    try { await apiPost('learn', { match: name, category, type: type === 'Expense' || type === 'Income' ? '' : type }); await load(); } catch (err) { toast('Could not save the rule: ' + err.message); }
  }

  // ─── CSV import ────────────────────────────────────────────────────────────
  async function importCsv(file) {
    const text = await file.text();
    if (S.mode === 'demo') {
      const rows = parseCsv(text);
      const head = rows[0]?.map(h => h.trim().toLowerCase()) || [];
      const di = head.indexOf('description'), ai = head.indexOf('amount'), si = head.indexOf('started date'), ti = head.indexOf('type');
      if (di < 0 || ai < 0) { toast('That does not look like a Revolut CSV'); return; }
      let n = 0;
      rows.slice(1).forEach(r => {
        if (!r[di]) return;
        const a = Number(r[ai]);
        const rule = S.data.rules.find(x => String(r[di]).toLowerCase().includes(String(x.match).toLowerCase()));
        S.data.transactions.push({ id: uid(), date: String(r[si] || '').slice(0, 10), name: r[di], amount: Math.abs(a),
          type: /TOPUP|EXCHANGE/.test(r[ti] || '') ? 'Transfer' : a < 0 ? 'Expense' : 'Income', category: rule ? rule.category : '', status: 'Paid', source: 'Revolut CSV' });
        n++;
      });
      store.set(DEMO_KEY, S.data); render(); toast(`Imported ${plural(n, 'transaction')} (demo)`);
      return;
    }
    toast('Importing…');
    try {
      const res = await apiPost('importCsv', { csv: text, filename: file.name });
      toast(`Imported ${plural(res.added, 'new transaction')}${res.skipped ? `, skipped ${res.skipped}` : ''}`);
      await load();
    } catch (err) { toast('Import failed: ' + err.message); }
  }
  function parseCsv(text) {
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  // ─── Events ────────────────────────────────────────────────────────────────
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 3200);
  }

  document.addEventListener('click', async e => {
    const el = e.target.closest('[data-done],[data-pickcat],[data-setcat],[data-new],[data-edit],[data-close],[data-delete],[data-cal],[data-day],[data-calcat],[data-week],[data-month],[data-txf],[data-run],[data-theme],[data-disconnect],[data-resetdemo],[data-stop],[data-filter]');
    if (!el) { if (e.target.id === 'backdrop') closeForm(); return; }
    const d = el.dataset;
    if ('stop' in d) { e.stopPropagation(); return; }
    if ('filter' in d) { S.ui.txFilter = d.filter; return; }
    if ('done' in d) {
      e.stopPropagation();
      const ev = S.data.events.find(x => x.id === d.done);
      save('Events', { id: ev.id, status: isDone(ev) ? 'Planned' : 'Done' });
      if (!isDone(ev)) toast('Nice work 💪');
      return;
    }
    if ('pickcat' in d) { e.stopPropagation(); pickCategory(d.pickcat); return; }
    if ('setcat' in d) {
      const tx = S.data.transactions.find(t => t.id === d.tx);
      const remember = $('#learn')?.checked;
      closeForm();
      await save('Transactions', { id: tx.id, category: d.setcat });
      if (remember) learn(tx.name, d.setcat, tx.type);
      toast(`Sorted into ${d.setcat}`);
      return;
    }
    if ('new' in d) { e.stopPropagation(); openForm(d.new, newRow(d.new, d), true); return; }
    if ('edit' in d) {
      const key = TABLE_KEY[d.edit];
      const row = S.data[key].find(r => r.id === d.id);
      if (row) openForm(d.edit, row, false);
      return;
    }
    if ('close' in d) { closeForm(); return; }
    if ('delete' in d) {
      if (!confirm('Delete this?')) return;
      const { table, row } = formState; closeForm(); remove(table, row.id); toast('Deleted'); return;
    }
    if ('cal' in d) {
      const n = +d.cal;
      if (n === 0) { S.ui.calMonth = ym(new Date()); S.ui.calSel = ymd(new Date()); }
      else { const [y, m] = S.ui.calMonth.split('-').map(Number); S.ui.calMonth = ym(new Date(y, m - 1 + n, 1)); }
      render(); return;
    }
    if ('day' in d) { S.ui.calSel = d.day; render(); return; }
    if ('calcat' in d) { S.ui.calOff[d.calcat] = !S.ui.calOff[d.calcat]; render(); return; }
    if ('week' in d) {
      const n = +d.week;
      S.ui.weekStart = n === 0 ? ymd(mondayOf(new Date())) : ymd(addDays(parseD(S.ui.weekStart), 7 * n));
      render(); return;
    }
    if ('month' in d) { const [y, m] = S.ui.moneyMonth.split('-').map(Number); S.ui.moneyMonth = ym(new Date(y, m - 1 + +d.month, 1)); S.ui.txFilter = 'all'; render(); return; }
    if ('txf' in d) { S.ui.txFilter = d.txf; render(); return; }
    if ('run' in d) { runAction(d.run, d.label); return; }
    if ('theme' in d) {
      if (d.theme === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = d.theme;
      store.set('lifeos.theme', d.theme); render(); return;
    }
    if ('disconnect' in d) { S.cfg = { url: '', token: '' }; store.set(CFG_KEY, S.cfg); store.del(CACHE_KEY); load(); return; }
    if ('resetdemo' in d) { store.del(DEMO_KEY); load(); toast('Demo data reset'); }
  });

  document.addEventListener('change', e => {
    if (e.target.matches('[data-rerender]') && formState) { formState.row = readForm(); if (e.target.name === 'allDay') formState.row.allDay = e.target.checked ? 'yes' : ''; drawForm(); }
    if (e.target.id === 'csvfile' && e.target.files[0]) importCsv(e.target.files[0]);
  });
  document.addEventListener('input', e => {
    if (e.target.matches('[data-txq]')) {
      S.ui.txQuery = e.target.value;
      const pos = e.target.selectionStart;
      render();
      const inp = $('[data-txq]'); inp.focus(); inp.setSelectionRange(pos, pos);
    }
  });
  document.addEventListener('submit', async e => {
    e.preventDefault();
    if (e.target.id === 'cfgform') {
      const fd = new FormData(e.target);
      S.cfg = { url: String(fd.get('url')).trim(), token: String(fd.get('token')).trim() };
      store.set(CFG_KEY, S.cfg); store.del(CACHE_KEY); S.data = null;
      await load();
      if (S.mode === 'live') { toast('Connected to your sheet 🎉'); location.hash = '#/home'; }
      return;
    }
    if (e.target.id === 'editform') {
      const row = readForm();
      const { table } = formState;
      const learnIt = row._learn === 'yes'; delete row._learn;
      ['amount', 'budget', 'monthly', 'original', 'durationMin', 'dueDay', 'interest'].forEach(k => { if (k in row && row[k] !== '') row[k] = Number(row[k]); });
      if (table === 'Events' && row.allDay !== 'yes' && row.start && !hasTime(row.start)) row.start += 'T18:00';
      if (table === 'Events' && row.end && row.end < row.start) row.end = row.start;
      if (table === 'Events' && (row.category === 'Gym' || row.category === 'Dance') && hasTime(row.start) && hasTime(row.end)) row.durationMin = Math.round((parseD(row.end) - parseD(row.start)) / 6e4);
      closeForm();
      await save(table, row);
      if (learnIt && row.category) learn(row.name, row.category, row.type);
      toast('Saved');
    }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) closeForm(); });

  // Drag & drop CSV
  document.addEventListener('dragover', e => { const z = e.target.closest?.('#drop'); if (z) { e.preventDefault(); z.classList.add('over'); } });
  document.addEventListener('dragleave', e => { const z = e.target.closest?.('#drop'); if (z) z.classList.remove('over'); });
  document.addEventListener('drop', e => { const z = e.target.closest?.('#drop'); if (z) { e.preventDefault(); z.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) importCsv(f); } });

  // Tooltips
  const tip = $('#tip');
  document.addEventListener('pointerover', e => {
    const t = e.target.closest('[data-tip]');
    if (!t) { tip.hidden = true; return; }
    const r = t.getBoundingClientRect();
    tip.textContent = t.dataset.tip; tip.hidden = false;
    tip.style.left = Math.min(window.innerWidth - 80, Math.max(80, r.left + r.width / 2)) + 'px';
    tip.style.top = r.top + 'px';
  });

  $('#fab').addEventListener('click', () => {
    const r = route();
    if (r === 'money') openForm('Transactions', newRow('Transactions'), true);
    else if (r === 'loans') openForm('Loans', newRow('Loans'), true);
    else if (r === 'training') openForm('Events', newRow('Events', { cat: 'Gym' }), true);
    else if (r === 'trips') openForm('Events', newRow('Events', { cat: 'Travel' }), true);
    else if (r === 'calendar') openForm('Events', newRow('Events', { date: S.ui.calSel }), true);
    else quickAdd();
  });

  function connectFromLink() {
    const m = location.hash.match(/^#\/connect\?(.*)$/);
    if (!m) return false;
    const q = new URLSearchParams(m[1]);
    if (q.get('url') && q.get('token')) {
      S.cfg = { url: q.get('url'), token: q.get('token') };
      store.set(CFG_KEY, S.cfg); store.del(CACHE_KEY); S.data = null;
    }
    history.replaceState(null, '', location.pathname + '#/home');
    load().then(() => { if (S.mode === 'live' && S.status.startsWith('Synced')) toast('Connected to your sheet 🎉'); });
    return true;
  }

  window.addEventListener('hashchange', () => {
    if (connectFromLink()) return;
    closeForm();
    render(); window.scrollTo(0, 0);
  });

  // ─── Demo data ─────────────────────────────────────────────────────────────
  function demoData() {
    const t = today();
    const d = n => ymd(addDays(t, n));
    const mon = mondayOf(t);
    const w = (n, h) => ymd(addDays(mon, n)) + 'T' + h;
    const ev = [];
    for (let k = -6; k <= 0; k++) {
      [[0, '07:30', 'Upper body', 'Gym', 'Lift'], [1, '18:00', 'Hip-hop class', 'Dance', 'Dance'], [3, '07:30', 'Leg day', 'Gym', 'Lift'], [5, '10:00', 'Mobility flow', 'Gym', 'Mobility']].forEach(([day, h, title, cat, wo], i) => {
        const date = addDays(mon, day + 7 * k);
        const st = ymd(date) + 'T' + h;
        const [hh, mm] = h.split(':').map(Number);
        const en = ymd(date) + 'T' + pad(hh + 1) + ':' + pad(mm);
        const past = date < t;
        ev.push({ id: uid(), title, category: cat, status: past ? ((k + i) % 5 === 0 ? 'Cancelled' : 'Done') : 'Planned', start: st, end: en, workout: wo, durationMin: 60, location: cat === 'Dance' ? 'Dance studio' : 'MyFitness' });
      });
    }
    ev.push({ id: 'trip1', title: 'Lisbon', category: 'Travel', status: 'Planned', start: d(24), end: d(30), allDay: 'yes', location: 'Portugal', budget: 900, link: 'https://www.booking.com' });
    ev.push({ id: 'trip2', title: 'Ski weekend', category: 'Travel', status: 'Planned', start: d(68), end: d(71), allDay: 'yes', location: 'Otepää', budget: 350 });
    ev.push({ id: 'ev1', title: 'Friend’s housewarming', category: 'Event', status: 'Planned', start: d(5) + 'T19:00', end: d(5) + 'T23:00', location: 'Kalamaja', budget: 30 });
    ev.push({ id: 'ev2', title: 'Concert', category: 'Event', status: 'Planned', start: d(12) + 'T20:00', end: d(12) + 'T23:00', location: 'Saku Suurhall' });
    ev.push({ id: uid(), title: 'Mum', category: 'Birthday', status: 'Planned', start: '1970-' + d(9).slice(5), allDay: 'yes', giftIdea: 'Spa voucher', budget: 60 });
    ev.push({ id: uid(), title: 'Best friend', category: 'Birthday', status: 'Planned', start: '1999-' + d(33).slice(5), allDay: 'yes', giftIdea: 'Concert tickets' });
    ev.push({ id: uid(), title: 'Reel: gym routine', category: 'Social', status: 'Planned', start: d(2) + 'T12:00', end: d(2) + 'T13:00', platform: 'Instagram' });

    const m = ym(t);
    const md = n => m + '-' + pad(Math.min(n, t.getDate()));
    const tx = [
      ['Salary', 2875, 'Income', 'Salary', md(1)], ['Rent share', 150, 'Expense', 'Rent & Bills', md(2)],
      ['Rimi', 42.3, 'Expense', 'Groceries', md(3)], ['Selver', 61.9, 'Expense', 'Groceries', md(6)], ['Prisma', 38.4, 'Expense', 'Groceries', md(10)],
      ['Wolt', 18.5, 'Expense', 'Eating Out', md(4)], ['Burger place', 24, 'Expense', 'Eating Out', md(8)], ['Bolt', 7.8, 'Expense', 'Transport', md(5)],
      ['MyFitness membership', 39.9, 'Expense', 'Gym & Health', md(1)], ['Spotify', 11.99, 'Expense', 'Subscriptions', md(2)], ['Netflix', 9.99, 'Expense', 'Subscriptions', md(2)],
      ['Zara', 59.95, 'Expense', 'Shopping', md(9)], ['Savings pot', 800, 'Savings', 'Savings', md(2)], ['ETF', 250, 'Savings', 'Investments', md(2)],
      ['Inbank', 188.37, 'Loan Payment', 'Loan Payments', md(10)], ['Flights to Lisbon', 214.6, 'Expense', 'Travel', md(7)],
      ['TOOMAS K. PARDIPOOD', 23.4, 'Expense', '', md(11)], ['SUMUP *KOHVIK', 4.5, 'Expense', '', md(12)],
    ].map(([name, amount, type, category, date]) => ({ id: uid(), name, amount, type, category, date, status: 'Paid', account: 'Revolut' }));
    tx.find(x => x.name === 'Flights to Lisbon').eventId = 'trip1';
    tx.push({ id: uid(), name: 'Hotel in Lisbon', amount: 420, type: 'Expense', category: 'Travel', date: d(24), status: 'Planned', eventId: 'trip1', account: 'Revolut' });
    tx.find(x => x.name === 'Inbank').loanId = 'loan1';
    tx.push({ id: uid(), name: 'Inbank', amount: 188.37, type: 'Loan Payment', category: 'Loan Payments', date: ymd(addDays(t, -32)), status: 'Paid', loanId: 'loan1' });

    const budgets = [['Rent & Bills', 'Needs', 150], ['Groceries', 'Needs', 300], ['Transport', 'Needs', 50], ['Gym & Health', 'Needs', 60],
      ['Eating Out', 'Wants', 50], ['Shopping', 'Wants', 100], ['Subscriptions', 'Wants', 30], ['Travel', 'Wants', 250], ['Events & Gifts', 'Wants', 20],
      ['Loan Payments', 'Debt', 400], ['Savings', 'Savings', 1000], ['Investments', 'Savings', 250]]
      .map(([category, group, monthly]) => ({ id: uid(), category, group, monthly, direction: 'Out' }));
    budgets.push({ id: uid(), category: 'Income', group: 'Income', monthly: 2875, direction: 'In' });

    const loans = [
      { id: 'loan1', name: 'Camera loan', lender: 'Inbank', type: 'Personal', original: 565.11, monthly: 188.37, dueDay: 14, interest: 0.149, start: d(-40), end: d(50), status: 'Active' },
      { id: 'loan2', name: 'Phone loan', lender: 'InBank', type: 'Personal', original: 469.5, monthly: 78.25, dueDay: 10, interest: 0, start: d(-3), end: d(150), status: 'Active' },
    ];
    const templates = [['Mon', '07:30', 'Upper body', 'Gym', 'Lift'], ['Tue', '18:00', 'Hip-hop class', 'Dance', 'Dance'], ['Thu', '07:30', 'Leg day', 'Gym', 'Lift'], ['Sat', '10:00', 'Mobility flow', 'Gym', 'Mobility']]
      .map(([weekday, time, title, category, workout]) => ({ id: uid(), weekday, time, title, category, workout, durationMin: 60, active: 'yes', location: category === 'Dance' ? 'Dance studio' : 'MyFitness' }));
    const rules = [{ id: uid(), match: 'rimi', category: 'Groceries' }, { id: uid(), match: 'bolt', category: 'Transport' }];
    return { events: ev, transactions: tx, budgets, loans, templates, rules, settings: { currency: 'EUR' } };
  }

  function demoGenerateTraining() {
    const have = new Set(S.data.events.map(e => String(e.start).slice(0, 10) + '|' + String(e.title).toLowerCase()));
    for (let i = 1; i <= 14; i++) {
      const day = addDays(today(), i);
      const wd = WEEKDAYS[(day.getDay() + 6) % 7];
      S.data.templates.filter(t => t.weekday === wd && t.active !== 'no').forEach(t => {
        const key = ymd(day) + '|' + t.title.toLowerCase();
        if (have.has(key)) return;
        have.add(key);
        const st = parseD(ymd(day) + 'T' + (t.time || '18:00'));
        const en = new Date(st.getTime() + num(t.durationMin || 60) * 6e4);
        S.data.events.push({ id: uid(), title: t.title, category: t.category, status: 'Planned', start: ymd(st) + 'T' + hm(st), end: ymd(en) + 'T' + hm(en), workout: t.workout, durationMin: t.durationMin, location: t.location });
      });
    }
  }

  // ─── Boot ──────────────────────────────────────────────────────────────────
  const savedTheme = store.get('lifeos.theme');
  if (savedTheme && savedTheme !== 'auto') document.documentElement.dataset.theme = savedTheme;
  if (!connectFromLink()) load();
})();
