// Metron analytics, phase 4: spending patterns (a section inside the Stats tab).
// Purchase behavior, spending by weekday and by time of day. Follows the Stats range selector.
(() => {
  const M = () => window.Metron;
  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const PARTS = [['Morning', '05:00 to 11:00'], ['Afternoon', '11:00 to 17:00'],
    ['Evening', '17:00 to 22:00'], ['Night', '22:00 to 05:00']];
  const partOf = h => h >= 5 && h < 11 ? 0 : h >= 11 && h < 17 ? 1 : h >= 17 && h < 22 ? 2 : 3;

  function render() {
    const { S, $, el, money, cents, dayKey, draw } = M();
    const box = $('#a-patterns');
    if (!box) return;
    box.replaceChildren();
    const { start, days } = window.MetronAnalytics.util.statsRange();

    // ---------- Collect ----------
    const dow = Array.from({ length: 7 }, () => 0);
    const part = PARTS.map(() => ({ amt: 0, n: 0 }));
    const spendDays = new Set();
    let total = 0, count = 0, biggest = null;
    for (const t of S.tx) {
      const d = new Date(t.transaction_date);
      if (t.type !== 'expense' || d < start) continue;
      const c = cents(t.amount), p = part[partOf(d.getHours())];
      dow[(d.getDay() + 6) % 7] += c;
      p.amt += c; p.n++;
      spendDays.add(dayKey(d));
      total += c; count++;
      if (!biggest || c > biggest.c) biggest = { c, t, d };
    }

    box.append(el('h2', '', 'Spending patterns'));
    if (!count) {
      box.append(el('p', 'empty', 'No spending in this period.'));
      return;
    }

    // ---------- Purchase behavior ----------
    const stats = el('div', 'stats');
    const card = (k, v, sub) => {
      const d = el('div');
      d.append(el('span', 'lbl', k), el('b', '', v));
      if (sub) d.append(el('span', 'lbl', sub));
      stats.append(d);
    };
    card('Average purchase', money(Math.round(total / count)));
    card('Largest purchase', money(biggest.c), biggest.t.description);
    card('Purchases per day', (count / days).toFixed(1));
    card('Days with spending', spendDays.size + ' of ' + days);
    box.append(stats);

    // ---------- By day of the week ----------
    // Average per occurrence of that weekday, so a weekday that appears five times in the
    // period is not unfairly ahead of one that appears four times.
    const occ = Array.from({ length: 7 }, () => 0);
    for (let i = 0; i < days; i++) occ[(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i).getDay() + 6) % 7]++;
    const avg = dow.map((v, i) => occ[i] ? v / occ[i] : 0);

    box.append(el('h2', '', 'By day of the week'));
    const wrap = el('div', 'chart'), canvas = el('canvas');
    canvas.id = 'c-dow';
    wrap.append(canvas);
    box.append(wrap);
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue('--accent').trim(), mute = css.getPropertyValue('--mute').trim(),
      line = css.getPropertyValue('--line').trim();
    draw('c-dow', {
      type: 'bar',
      data: { labels: WEEKDAYS, datasets: [{ data: avg.map(v => Math.round(v) / 100), backgroundColor: accent, borderRadius: 6 }] },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false },
          tooltip: { callbacks: { title: i => WEEKDAYS_LONG[i[0].dataIndex],
            label: c => ' Average ' + money(Math.round(c.parsed.y * 100)) } } },
        scales: { x: { ticks: { color: mute }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: mute }, grid: { color: line } } } }
    });

    const top = avg.indexOf(Math.max(...avg)), daily = total / days;
    if (avg[top] > 0 && daily > 0) {
      const over = Math.round((avg[top] - daily) * 100 / daily);
      let msg = 'You spend the most on ' + WEEKDAYS_LONG[top] + 's: about ' + money(Math.round(avg[top])) + ' each' +
        (over > 0 ? ', ' + over + '% above your daily average.' : '.');
      if (days < 14) msg += ' This is based on ' + days + ' days, so treat it as an early pattern.';
      const note = el('div', 'alert info', msg);
      note.style.marginTop = '12px';
      box.append(note);
    }

    // ---------- By time of day ----------
    box.append(el('h2', '', 'By time of day'));
    const max = Math.max(1, ...part.map(p => p.amt));
    const ul = el('ul', 'list');
    PARTS.forEach(([name, hours], i) => {
      const row = el('li', 'row'), l = el('div', 'l');
      const bar = el('div', 'bar'), fill = el('i');
      bar.style.marginTop = '8px';
      fill.style.width = (part[i].amt * 100 / max) + '%';
      bar.append(fill);
      l.append(el('b', '', name),
        el('span', '', hours + ', ' + part[i].n + (part[i].n === 1 ? ' purchase' : ' purchases')), bar);
      row.append(l, el('span', 'amt', money(part[i].amt)));
      ul.append(row);
    });
    box.append(ul);
  }

  window.MetronAnalytics.extend('stats', render);
})();
