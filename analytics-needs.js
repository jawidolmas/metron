// Metron analytics, phase 3: needs, wants and impulses (a section inside the Stats tab).
// Follows the Stats range selector (7 days, 30 days, budget period). Aim: awareness, not guilt,
// so no good/bad coloring and no verdicts.
(() => {
  const M = () => window.Metron;
  const KINDS = [['need', 'Need', '#0a84ff'], ['want', 'Want', '#ff9f0a'],
    ['impulse', 'Impulse', '#bf5af2'], ['unmarked', 'Not marked', '#8e8e93']];

  function render() {
    const { S, $, el, money, cents } = M();
    const box = $('#a-needs');
    if (!box) return;
    box.replaceChildren();

    const { start, days } = window.MetronAnalytics.util.statsRange();

    const by = Object.fromEntries(KINDS.map(([k]) => [k, { amt: 0, n: 0 }]));
    const reasons = new Map();
    let total = 0, count = 0;
    for (const t of S.tx) {
      if (t.type !== 'expense' || new Date(t.transaction_date) < start) continue;
      const c = cents(t.amount), k = by[t.purchase_type] ? t.purchase_type : 'unmarked';
      by[k].amt += c; by[k].n++; total += c; count++;
      const why = (t.reason || '').trim().replace(/\s+/g, ' ');
      if (why) {
        const key = why.toLowerCase(), r = reasons.get(key) || { label: why, amt: 0, n: 0 };
        r.amt += c; r.n++;
        reasons.set(key, r);
      }
    }

    box.append(el('h2', '', 'Need, want, impulse'));
    if (!count) {
      box.append(el('p', 'empty', 'No spending in this period.'));
      return;
    }
    const pct = a => total ? a * 100 / total : 0;
    const fmt = p => (p > 0 && p < 1 ? '<1' : Math.round(p)) + '%';

    // Proportion bar + breakdown
    const stack = el('div', 'stack');
    KINDS.forEach(([k, , color]) => {
      if (!by[k].amt) return;
      const seg = el('span');
      seg.style.width = pct(by[k].amt) + '%';
      seg.style.background = color;
      stack.append(seg);
    });
    box.append(stack);

    const ul = el('ul', 'list');
    KINDS.forEach(([k, label, color]) => {
      const row = el('li', 'row'), l = el('div', 'l'), dot = el('span', 'dot');
      dot.style.background = color;
      l.append(el('b', '', label),
        el('span', '', fmt(pct(by[k].amt)) + ' of spending, ' + by[k].n + (by[k].n === 1 ? ' purchase' : ' purchases')));
      row.append(dot, l, el('span', 'amt', money(by[k].amt)));
      ul.append(row);
    });
    box.append(ul);

    // Plain-language reading
    const marked = total - by.unmarked.amt;
    const parts = [];
    if (marked > 0) {
      // Largest-remainder rounding so the three shares always add up to 100.
      const ks = ['need', 'want', 'impulse'], raw = ks.map(k => by[k].amt * 100 / marked);
      const share = raw.map(Math.floor);
      let left = 100 - share.reduce((a, b) => a + b, 0);
      raw.map((r, i) => [r - share[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left-- > 0) share[i]++; });
      parts.push('Of the spending you marked, ' + share[0] + '% was needs, ' + share[1] + '% wants and ' +
        share[2] + '% impulse.');
    }
    if (pct(by.unmarked.amt) >= 30) {
      parts.push(fmt(pct(by.unmarked.amt)) + ' of your spending is not marked yet, so these shares are incomplete.');
    }
    if (parts.length) {
      const note = el('div', 'alert info', parts.join(' '));
      note.style.marginTop = '12px';
      box.append(note);
    }

    // Impulse frequency
    const imp = by.impulse;
    const stats = el('div', 'stats');
    [['Impulse purchases', String(imp.n)],
     ['Per week', imp.n && days >= 7 ? (imp.n * 7 / days).toFixed(1) : '\u2014'],
     ['Average impulse', imp.n ? money(Math.round(imp.amt / imp.n)) : '\u2014']].forEach(([k, v]) => {
      const d = el('div');
      d.append(el('span', 'lbl', k), el('b', '', v));
      stats.append(d);
    });
    box.append(stats);

    // Why purchases happened (free text in "Why did you buy it?", grouped by identical wording)
    if (reasons.size) {
      box.append(el('h2', '', 'Why you bought'));
      const rl = el('ul', 'list');
      [...reasons.values()].sort((a, b) => b.n - a.n || b.amt - a.amt).slice(0, 5).forEach(r => {
        const row = el('li', 'row'), l = el('div', 'l');
        l.append(el('b', '', r.label), el('span', '', r.n + (r.n === 1 ? ' purchase' : ' purchases')));
        row.append(l, el('span', 'amt', money(r.amt)));
        rl.append(row);
      });
      box.append(rl);
    }
  }

  window.MetronAnalytics.extend('stats', render);
})();