// Metron analytics, phase 2: Categories tab.
// Answers "where does my money go?" and "is any category creeping up?".
// Needs analytics.js loaded first; reads app.js data lazily through window.Metron.
(() => {
  const M = () => window.Metron;
  const U = () => window.MetronAnalytics.util;

  // One fixed color per category (by its position in app.js CATS), so a category keeps its color everywhere.
  const PALETTE = ['#0a84ff', '#ff9f0a', '#30d158', '#bf5af2', '#ff453a',
    '#64d2ff', '#ffd60a', '#ff6482', '#5e5ce6', '#8e8e93'];
  const colorOf = cat => PALETTE[Math.max(0, M().CATS.indexOf(cat)) % PALETTE.length];

  let range = 30; // 7 days, 30 days, or 0 = budget period (same options as Stats)

  function rangeStart() {
    const { startOfDay, addDays } = U();
    return range ? addDays(startOfDay(new Date()), 1 - range) : M().periodStart();
  }

  function render(root) {
    const { S, el, money, cents, draw } = M();
    const { startOfDay, addDays, weekStart, short, DAY } = U();

    // ---------- Period selector ----------
    const segs = el('div', 'segs');
    [[7, '7 days'], [30, '30 days'], [0, 'Budget period']].forEach(([d, label]) => {
      const b = el('button', d === range ? 'on' : '', label);
      b.type = 'button';
      b.addEventListener('click', () => { range = d; window.MetronAnalytics.render(); });
      segs.append(b);
    });
    root.append(segs);

    // ---------- Spending by category in the period ----------
    const start = rangeStart();
    const byCat = new Map();
    let total = 0;
    for (const t of S.tx) {
      if (t.type !== 'expense' || new Date(t.transaction_date) < start) continue;
      const c = cents(t.amount), cur = byCat.get(t.category) || { amt: 0, n: 0 };
      cur.amt += c; cur.n++; total += c;
      byCat.set(t.category, cur);
    }
    const items = [...byCat.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.amt - a.amt);

    if (!items.length) {
      root.append(el('p', 'empty', 'No spending in this period.'));
    } else {
      const box = el('div', 'chart');
      const canvas = el('canvas');
      canvas.id = 'c-donut';
      box.append(canvas);
      root.append(box);
      const card = getComputedStyle(document.documentElement).getPropertyValue('--card').trim();
      draw('c-donut', {
        type: 'doughnut',
        data: { labels: items.map(i => i.name),
          datasets: [{ data: items.map(i => i.amt / 100), backgroundColor: items.map(i => colorOf(i.name)),
            borderColor: card, borderWidth: 2 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '62%',
          plugins: { legend: { display: false },
            tooltip: { callbacks: { label: c => ' ' + c.label + ': ' + money(Math.round(c.parsed * 100)) } } } }
      });

      root.append(el('h2', '', 'Where it went'));
      const ul = el('ul', 'list');
      items.forEach(i => {
        const pct = i.amt * 100 / total;
        const li = el('li', 'row'), l = el('div', 'l'), dot = el('span', 'dot');
        dot.style.background = colorOf(i.name);
        l.append(el('b', '', i.name),
          el('span', '', (pct < 1 ? '<1' : Math.round(pct)) + '% of spending, ' + i.n + (i.n === 1 ? ' purchase' : ' purchases')));
        li.append(dot, l, el('span', 'amt', money(i.amt)));
        ul.append(li);
      });
      root.append(ul);
    }

    // ---------- Weekly trend per category ----------
    root.append(el('h2', '', 'Weekly trend'));
    const now = new Date(), wk0 = weekStart(now);
    let earliest = null;
    const wk = new Map(); // category -> cents per week, index 0 = this week ... 4
    for (const t of S.tx) {
      const d = new Date(t.transaction_date);
      if (!earliest || d < earliest) earliest = d;
      if (t.type !== 'expense') continue;
      const back = Math.round((wk0 - weekStart(d)) / (7 * DAY));
      if (back < 0 || back > 4) continue;
      if (!wk.has(t.category)) wk.set(t.category, [0, 0, 0, 0, 0]);
      wk.get(t.category)[back] += cents(t.amount);
    }
    // Weeks that have any recorded history (oldest first, this week last). Full = began after the first entry.
    const weeks = [];
    for (let i = 4; i >= 0; i--) {
      const s = addDays(wk0, -7 * i);
      if (earliest && earliest < addDays(s, 7)) weeks.push({ i, s, full: i > 0 && earliest <= s });
    }
    const fullCount = weeks.filter(w => w.full).length;
    if (weeks.length < 2 || !wk.size) {
      root.append(el('p', 'empty', 'Weekly trends appear after your first full week of history.'));
      return;
    }
    root.append(el('p', 'lbl', 'The lighter bar is this week so far. Change compares last week with the week before' +
      (fullCount < 2 ? ', which needs two full weeks of history.' : '.')));
    const list = el('ul', 'list');
    list.style.marginTop = '10px';
    [...wk.entries()]
      .filter(([, a]) => weeks.some(w => a[w.i] > 0))
      .sort((a, b) => weeks.reduce((x, w) => x + b[1][w.i], 0) - weeks.reduce((x, w) => x + a[1][w.i], 0))
      .forEach(([name, a]) => {
        const li = el('li', 'row'), l = el('div', 'l'), dot = el('span', 'dot');
        dot.style.background = colorOf(name);
        l.append(el('b', '', name));
        const fulls = weeks.filter(w => w.full);
        if (fulls.length) l.append(el('span', '', 'Avg ' + money(Math.round(fulls.reduce((x, w) => x + a[w.i], 0) / fulls.length)) + ' a week'));

        const spark = el('div', 'spark'), max = Math.max(...weeks.map(w => a[w.i]), 1);
        weeks.forEach(w => {
          const bar = el('i');
          bar.style.height = Math.max(a[w.i] ? 8 : 2, a[w.i] * 100 / max) + '%';
          bar.style.background = colorOf(name);
          if (w.i === 0) bar.style.opacity = '.45';
          bar.title = short(w.s) + ': ' + money(a[w.i]);
          spark.append(bar);
        });

        let change = '';
        const w1 = weeks.find(w => w.i === 1), w2 = weeks.find(w => w.i === 2);
        if (w1 && w2 && w1.full && w2.full) {
          if (a[2] > 0) {
            const p = Math.round((a[1] - a[2]) * 100 / a[2]);
            change = p === 0 ? 'No change' : (p > 0 ? '+' : '\u2212') + Math.abs(p) + '%';
          } else if (a[1] > 0) change = 'New';
        }
        li.append(dot, l, spark, el('span', 'chg', change));
        list.append(li);
      });
    root.append(list);
  }

  window.MetronAnalytics.register({ key: 'categories', label: 'Categories', order: 20, render });
})();
