// Metron analytics. Tabs: Weekly (phase 1, insights in phase 6), Categories (phase 2), Stats and History (moved in).
//
// Later phases live in their own files and add a tab like this:
//   MetronAnalytics.register({ key: 'categories', label: 'Categories', order: 20, render(root) { ... } });
// Load them before app.js. Each tab receives a container element and fills it.
(() => {
  const DAY = 864e5;
  const tabs = [];
  let active = null;
  const M = () => window.Metron; // exposed by app.js, read lazily

  // ---------- Date helpers (weeks start on Monday, same as the Overview page) ----------
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const weekStart = d => { const s = startOfDay(d); return addDays(s, -((s.getDay() + 6) % 7)); };
  const short = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

  // The period the Stats tab is currently set to: { start, today0, days } (days counts today).
  function statsRange() {
    const { S, periodStart } = M();
    const today0 = startOfDay(new Date());
    const start = S.range ? addDays(today0, 1 - S.range) : periodStart();
    return { start, today0, days: Math.max(1, Math.round((today0 - start) / DAY) + 1) };
  }

  // ---------- Weekly numbers ----------
  // sums[0] = this week so far, sums[1] = last week, ... sums[4].
  // lastSame = last week's spending up to the same weekday, for a fair comparison.
  function weekData() {
    const { S, cents } = M();
    const now = new Date(), wk0 = weekStart(now);
    const elapsed = Math.round((startOfDay(now) - wk0) / DAY) + 1; // 1 (Mon) .. 7 (Sun)
    const cutoff = addDays(wk0, elapsed - 7);
    const sums = [0, 0, 0, 0, 0];
    let lastSame = 0, earliest = null;
    for (const t of S.tx) {
      const d = new Date(t.transaction_date);
      if (!earliest || d < earliest) earliest = d;
      if (t.type !== 'expense') continue;
      const back = Math.round((wk0 - weekStart(d)) / (7 * DAY));
      if (back < 0 || back > 4) continue;
      const c = cents(t.amount);
      sums[back] += c;
      if (back === 1 && d < cutoff) lastSame += c;
    }
    return { elapsed, wk0, cutoff, sums, lastSame, earliest };
  }

  // ---------- Overview tab ----------
  function renderOverview(root) {
    const { S, el, money } = M();
    if (!S.tx.some(t => t.type === 'expense')) {
      root.append(el('p', 'empty', 'No expenses yet. Analytics appears once you add some.'));
      return;
    }
    const w = weekData();
    const spent = w.sums[0], limit = S.weekly;
    const avg = Math.round(spent / w.elapsed);
    const projected = Math.round(spent * 7 / w.elapsed);

    // Hero: spent this week against the weekly limit
    const hero = el('div', 'hero');
    hero.append(el('span', 'lbl', 'Spent this week'), el('strong', '', money(spent)));
    if (limit) {
      const pct = spent * 100 / limit;
      const bar = el('div', pct >= 100 ? 'bar over' : pct >= S.alert ? 'bar near' : 'bar');
      const fill = el('i');
      fill.style.width = Math.min(pct, 100) + '%';
      bar.append(fill);
      const left = limit - spent;
      hero.append(bar, el('span', 'warn', Math.round(pct) + '% of ' + money(limit) + ' used, ' +
        (left >= 0 ? money(left) + ' left' : money(-left) + ' over')));
    } else {
      hero.append(el('span', 'warn', 'Set a weekly budget in Settings to track progress.'));
    }
    root.append(hero);

    // Key numbers
    const stats = el('div', 'stats');
    [['Average per day', money(avg)],
     ['Projected for the week', money(projected)],
     ['Weekly limit', limit ? money(limit) : 'Not set'],
     ['Day of the week', w.elapsed + ' of 7']].forEach(([k, v]) => {
      const d = el('div');
      d.append(el('span', 'lbl', k), el('b', '', v));
      stats.append(d);
    });
    root.append(stats);

    // Plain-language reading of the numbers
    if (spent > 0) {
      let msg = 'At ' + money(avg) + ' a day, you are on track to spend about ' + money(projected) + ' by Sunday';
      let over = false;
      if (limit) {
        const diff = limit - projected;
        over = diff < 0;
        msg += diff >= 0 ? ', ' + money(diff) + ' under your limit.' : ', ' + money(-diff) + ' over your limit.';
      } else msg += '.';
      if (w.elapsed < 3) msg += ' It is early in the week, so treat this as a rough estimate.';
      const note = el('div', over ? 'alert' : 'alert info', msg);
      note.style.marginTop = '12px';
      root.append(note);
    }

    // Previous weeks. Weeks before the first recorded entry are skipped, not shown as 0.
    root.append(el('h2', '', 'Previous weeks'));
    const rows = [{ label: 'This week so far', sub: short(w.wk0) + ' to ' + short(addDays(w.wk0, 6)), amt: spent }];
    for (let i = 1; i <= 4; i++) {
      const s = addDays(w.wk0, -7 * i);
      if (w.earliest && w.earliest >= addDays(s, 7)) continue;
      rows.push({ label: short(s) + ' to ' + short(addDays(s, 6)), sub: w.earliest > s ? 'Partial week' : '', amt: w.sums[i] });
    }
    if (rows.length === 1) {
      root.append(el('p', 'empty', 'Last week and earlier will show here once you have more history.'));
      return;
    }
    if (w.earliest < w.cutoff && w.lastSame > 0) {
      const pct = Math.round((spent - w.lastSame) * 100 / w.lastSame);
      const cmp = el('p', 'lbl', 'Last week at this point: ' + money(w.lastSame) + '. ' +
        (pct === 0 ? 'About the same so far.' : 'This week is ' + Math.abs(pct) + '% ' + (pct > 0 ? 'higher.' : 'lower.')));
      cmp.style.margin = '0 0 10px';
      root.append(cmp);
    }
    const max = Math.max(1, ...rows.map(r => r.amt));
    const ul = el('ul', 'list');
    rows.forEach(r => {
      const li = el('li', 'row'), l = el('div', 'l');
      l.append(el('b', '', r.label));
      if (r.sub) l.append(el('span', '', r.sub));
      const bar = el('div', 'bar'), fill = el('i');
      bar.style.marginTop = '8px';
      fill.style.width = (r.amt * 100 / max) + '%';
      bar.append(fill);
      l.append(bar);
      li.append(l, el('span', 'amt', money(r.amt)));
      ul.append(li);
    });
    root.append(ul);
  }

  // ---------- Tab shell ----------
  // Each tab owns a pane (#a-<key>). Tabs with `static: true` have their markup in index.html
  // and only need a render call; other tabs get their pane cleared and refilled each time.
  function register(tab) {
    const i = tabs.findIndex(t => t.key === tab.key);
    if (i >= 0) tabs[i] = tab; else tabs.push(tab);
    tabs.sort((a, b) => (a.order || 0) - (b.order || 0));
    if (!active) active = tabs[0].key;
  }

  function paneFor(tab) {
    const { $, el } = M();
    let p = $('#a-' + tab.key);
    if (!p) {
      p = el('div', 'apane');
      p.id = 'a-' + tab.key;
      p.hidden = true;
      $('#v-analytics').append(p);
    }
    return p;
  }

  // Other files can add sections to a tab: MetronAnalytics.extend('stats', fn). app.js calls runExtras after renderStats.
  const extras = {};
  function extend(key, fn) { (extras[key] = extras[key] || []).push(fn); }
  function runExtras(key) {
    (extras[key] || []).forEach(fn => { try { fn(); } catch (e) { console.warn('Analytics extra failed:', e); } });
  }

  function open(key) { if (tabs.some(t => t.key === key)) active = key; }

  function render() {
    const { $, el } = M();
    const bar = $('#atabs');
    if (!bar || !tabs.length) return;
    if (!tabs.some(t => t.key === active)) active = tabs[0].key;
    bar.replaceChildren();
    tabs.forEach(t => {
      const b = el('button', t.key === active ? 'on' : '', t.label);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', t.key === active);
      b.addEventListener('click', () => { active = t.key; render(); });
      bar.append(b);
    });
    tabs.forEach(t => { paneFor(t).hidden = t.key !== active; });
    const tab = tabs.find(t => t.key === active), pane = paneFor(tab);
    if (!tab.static) pane.replaceChildren();
    tab.render(pane);
  }

  // Weekly: an empty slot at the top for insights (analytics-insights.js), then the weekly overview.
  function renderWeekly(root) {
    const slot = M().el('div');
    slot.id = 'a-insights';
    root.append(slot);
    renderOverview(root);
    runExtras('weekly');
  }

  register({ key: 'weekly', label: 'Weekly', order: 10, render: renderWeekly });
  register({ key: 'stats', label: 'Stats', order: 30, static: true, render: () => M().renderStats() });
  register({ key: 'history', label: 'History', order: 40, static: true, render: () => M().renderHistory() });
  window.MetronAnalytics = { register, render, open, extend, runExtras, util: { startOfDay, addDays, weekStart, short, statsRange, DAY } };
})();