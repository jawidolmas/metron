// Metron analytics, phase 6: automatic insights (top of the Weekly tab).
// Short written findings from the last 30 days. Every insight has a data guard: if there is not
// enough history behind it, it is not shown. Wording is neutral (rose, fell), never good or bad.
(() => {
  const M = () => window.Metron;
  const U = () => window.MetronAnalytics.util;
  const MIN_DAYS = 3, MIN_PURCHASES = 5, WINDOW = 30;

  // ---------- Numbers ----------
  function build() {
    const { S, cents } = M();
    const { startOfDay, addDays, DAY } = U();
    let earliest = null;
    for (const t of S.tx) {
      const d = new Date(t.transaction_date);
      if (!earliest || d < earliest) earliest = d;
    }
    if (!earliest) return null;

    const today0 = startOfDay(new Date());
    const tracked = Math.round((today0 - startOfDay(earliest)) / DAY) + 1;
    const win = Math.min(WINDOW, tracked);
    const curStart = addDays(today0, 1 - win);
    const prevStart = addDays(today0, 1 - 2 * WINDOW);
    const hasPrev = tracked >= 2 * WINDOW; // the previous window must be fully covered by history

    const cur = { total: 0, n: 0, cat: new Map(), kind: { need: 0, want: 0, impulse: 0, unmarked: 0 },
      kn: { need: 0, want: 0, impulse: 0, unmarked: 0 } };
    const prev = { total: 0, cat: new Map() };
    for (const t of S.tx) {
      if (t.type !== 'expense') continue;
      const d = new Date(t.transaction_date), c = cents(t.amount);
      if (d >= curStart) {
        const k = cur.kind[t.purchase_type] !== undefined && t.purchase_type ? t.purchase_type : 'unmarked';
        cur.total += c; cur.n++; cur.kind[k] += c; cur.kn[k]++;
        cur.cat.set(t.category, (cur.cat.get(t.category) || 0) + c);
      } else if (hasPrev && d >= prevStart) {
        prev.total += c;
        prev.cat.set(t.category, (prev.cat.get(t.category) || 0) + c);
      }
    }
    return { tracked, win, hasPrev, cur, prev };
  }

  // ---------- Insights ----------
  function insights(r) {
    const { money } = M();
    const { cur, prev, win, hasPrev } = r;
    const pct = (a, b) => Math.round((a - b) * 100 / b);
    const out = [];
    const span = win < WINDOW ? 'the ' + win + ' days you have tracked' : 'the last ' + WINDOW + ' days';

    // 1. Total, with a comparison once the previous 30 days are fully covered
    let msg = 'You spent ' + money(cur.total) + ' over ' + span + '.';
    if (hasPrev && prev.total > 0) {
      const p = pct(cur.total, prev.total);
      msg += p === 0 ? ' That is the same as the previous ' + WINDOW + ' days.'
        : ' That is ' + Math.abs(p) + '% ' + (p > 0 ? 'more' : 'less') + ' than the previous ' + WINDOW + ' days (' + money(prev.total) + ').';
    }
    out.push(msg);

    // 2. Biggest category rise and fall against the previous 30 days (needs a real size and a real change)
    if (hasPrev && prev.total > 0) {
      const floor = 0.05 * Math.max(cur.total, prev.total);
      const moves = [...new Set([...cur.cat.keys(), ...prev.cat.keys()])]
        .map(name => ({ name, a: cur.cat.get(name) || 0, b: prev.cat.get(name) || 0 }))
        .filter(m => m.b > 0 && Math.abs(m.a - m.b) >= floor && Math.abs(pct(m.a, m.b)) >= 25)
        .sort((x, y) => Math.abs(y.a - y.b) - Math.abs(x.a - x.b));
      const rise = moves.find(m => m.a > m.b), fall = moves.find(m => m.a < m.b);
      if (rise) out.push(rise.name + ' spending rose ' + pct(rise.a, rise.b) + '% compared with the previous ' +
        WINDOW + ' days (' + money(rise.b) + ' to ' + money(rise.a) + ').');
      if (fall) out.push(fall.name + ' spending fell ' + Math.abs(pct(fall.a, fall.b)) + '% compared with the previous ' +
        WINDOW + ' days (' + money(fall.b) + ' to ' + money(fall.a) + ').');
    }

    // 3. Needs share, only when most of the spending is marked
    const marked = cur.total - cur.kind.unmarked, markedN = cur.n - cur.kn.unmarked;
    if (markedN >= MIN_PURCHASES && marked >= 0.5 * cur.total && marked > 0) {
      out.push(Math.round(cur.kind.need * 100 / marked) + '% of your marked spending went to needs.');
    }

    // 4. Impulse purchases
    if (cur.kn.impulse >= 2) {
      out.push(cur.kn.impulse + ' purchases were marked impulse, totalling ' + money(cur.kind.impulse) +
        ' (' + Math.round(cur.kind.impulse * 100 / cur.total) + '% of spending).');
    }

    // 5. Dominant category
    const top = [...cur.cat.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top && cur.n >= MIN_PURCHASES && top[1] * 100 / cur.total >= 40) {
      out.push(top[0] + ' is your biggest category at ' + Math.round(top[1] * 100 / cur.total) + '% of spending.');
    }

    const list = out.slice(0, 5);
    // Not capped: tells the person why some insights are missing.
    if (cur.n >= MIN_PURCHASES && cur.kind.unmarked * 2 > cur.total) {
      list.push('More than half of your spending is not marked as need, want or impulse, so insights about those stay limited.');
    }
    return list;
  }

  // ---------- Render ----------
  function render() {
    const { $, el } = M();
    const box = $('#a-insights');
    if (!box) return;
    box.replaceChildren();
    const r = build();
    if (!r) return;

    const head = el('h2', '', 'Insights');
    head.style.marginTop = '8px';
    box.append(head);
    if (r.tracked < MIN_DAYS || r.cur.n < MIN_PURCHASES) {
      box.append(el('p', 'lbl', 'Insights appear once you have at least ' + MIN_DAYS + ' days and ' + MIN_PURCHASES + ' purchases recorded.'));
      box.lastChild.style.marginBottom = '24px';
      return;
    }
    insights(r).forEach(text => box.append(el('div', 'alert info', text)));
    if (!r.hasPrev) {
      const note = el('p', 'lbl', 'Comparisons with earlier periods appear after ' + (2 * WINDOW) + ' days of history.');
      note.style.margin = '0 0 24px';
      box.append(note);
    } else box.lastChild.style.marginBottom = '24px';
  }

  window.MetronAnalytics.extend('weekly', render);
})();
