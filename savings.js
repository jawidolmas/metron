// Metron savings (Settings page).
// Saved money is never an expense. It is tracked per place (Ziraat card, Vakıfbank card, cash) and,
// when the option is on, held out of the monthly budget until it is withdrawn.
// Needs the metron.savings table (savings.sql). app.js calls load(), render() and held().
(() => {
  const M = () => window.Metron;
  const $ = s => document.querySelector(s);
  const DAY = 864e5;

  const PLACES = [['ziraat', 'Ziraat card', '#30d158'], ['vakif', 'Vakıfbank card', '#ff9f0a'], ['cash', 'Cash', '#8e8e93']];
  const SOURCES = PLACES.concat([['outside', 'Outside my budget (gift, extra income)', '#8e8e93']]);
  const USES = [['budget', 'Add it back to my budget'], ['out', 'Take it out only']];
  const name = k => (PLACES.find(p => p[0] === k) || [])[1] || k;
  const colorOf = k => (PLACES.find(p => p[0] === k) || [])[2] || '#8e8e93';
  const DISC = ['Coffee & Drinks', 'Social & Entertainment', 'Shopping', 'Subscriptions'];

  let rows = [], ready = true, kind = 'deposit', busy = false, showAll = false;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  const store = {
    get(k) { try { return localStorage.getItem('metron.sv.' + k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem('metron.sv.' + k, v); } catch { /* ignore */ } }
  };
  const deductOn = () => store.get('deduct') !== 'off';
  const cents = r => Math.round(Number(r.amount) * 100);

  // ---------- Data ----------
  async function load() {
    const { data, error } = await window.sb.from('savings').select('*').order('saved_at', { ascending: false }).limit(1000);
    if (error) { console.warn('Savings not loaded:', error.message); ready = false; rows = []; return; }
    ready = true;
    rows = data || [];
  }

  function balances() {
    const b = { ziraat: 0, vakif: 0, cash: 0 };
    for (const r of rows) {
      const v = cents(r);
      if (r.kind === 'deposit') b[r.place] += v;
      else if (r.kind === 'withdraw') b[r.place] -= v;
      else { b[r.place] -= v; b[r.to_place] += v; }
    }
    return b;
  }
  const sum = b => b.ziraat + b.vakif + b.cash;

  // Cents held out of the current budget period: deposits from the budget minus withdrawals released to it.
  function held() {
    if (!ready || !deductOn()) return 0;
    const p0 = M().periodStart();
    let h = 0;
    for (const r of rows) {
      if (new Date(r.saved_at) < p0) continue;
      if (r.kind === 'deposit' && r.source !== 'outside') h += cents(r);
      else if (r.kind === 'withdraw' && r.to_budget) h -= cents(r);
    }
    return h;
  }

  // ---------- Suggestions ----------
  function tips() {
    const { S, money, cents: cts, periodStart } = M();
    const list = [], bal = balances(), total = sum(bal);
    const today0 = new Date(); today0.setHours(0, 0, 0, 0);
    const day0 = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
    const back = n => { const x = new Date(today0); x.setDate(x.getDate() - n); return x; };

    let earliest = null;
    for (const t of S.tx) { const d = new Date(t.transaction_date); if (!earliest || d < earliest) earliest = d; }
    const tracked = earliest ? Math.round((today0 - day0(earliest)) / DAY) + 1 : 0;
    const win = Math.min(30, tracked), scale = win ? 30 / win : 0, start = back(Math.max(win, 1) - 1);
    const span = win < 30 ? 'in the ' + win + ' days you have tracked' : 'in the last 30 days';

    let spend = 0;
    const cat = new Map(), kd = { need: 0, want: 0, impulse: 0 };
    for (const t of S.tx) {
      if (t.type !== 'expense' || new Date(t.transaction_date) < start) continue;
      const v = cts(t.amount);
      spend += v;
      cat.set(t.category, (cat.get(t.category) || 0) + v);
      if (kd[t.purchase_type] !== undefined) kd[t.purchase_type] += v;
    }

    const s30 = back(29);
    let dep30 = 0, wd30 = 0;
    for (const r of rows) {
      if (new Date(r.saved_at) < s30) continue;
      if (r.kind === 'deposit') dep30 += cents(r); else if (r.kind === 'withdraw') wd30 += cents(r);
    }

    // Where spending could shrink
    let pot = 0;
    if (tracked >= 7 && spend > 0) {
      if (kd.impulse > 0 && kd.impulse * 20 >= spend)
        list.push('Purchases marked impulse came to ' + money(kd.impulse) + ' ' + span + '. Skipping half of them would free about ' +
          money(Math.round(kd.impulse / 2 * scale)) + ' a month.');
      if (kd.want > 0 && kd.want * 10 >= spend)
        list.push('Wants came to ' + money(kd.want) + ' ' + span + '. Trimming them by a fifth would free about ' +
          money(Math.round(kd.want / 5 * scale)) + ' a month.');
      pot = (kd.impulse / 2 + kd.want / 5) * scale;

      const disc = DISC.map(n => [n, cat.get(n) || 0]).sort((a, b) => b[1] - a[1])[0];
      if (disc && disc[1] * 100 / spend >= 8) {
        list.push(disc[0] + ' took ' + money(disc[1]) + ' (' + Math.round(disc[1] * 100 / spend) + '% of spending) ' + span +
          '. Cutting it by a third would free about ' + money(Math.round(disc[1] / 3 * scale)) + ' a month.');
        if (!pot) pot = disc[1] / 3 * scale;
      }

      const fx = S.fixed.reduce((a, c) => a + cts(c.amount), 0);
      if (S.budget && fx * 100 / S.budget >= 25) {
        const big = S.fixed.slice().sort((a, b) => cts(b.amount) - cts(a.amount))[0];
        list.push('Fixed costs add up to ' + money(fx) + ' a month, ' + Math.round(fx * 100 / S.budget) + '% of your monthly budget. ' +
          big.name + ' is the largest. Dropping one you rarely use saves that amount every month.');
      }

      if (S.budget) {
        const p0 = periodStart(), next = new Date(p0.getFullYear(), p0.getMonth() + 1, S.startDay);
        const len = Math.round((next - p0) / DAY), into = Math.round((today0 - day0(p0)) / DAY) + 1;
        let sp = 0;
        for (const t of S.tx) if (t.type === 'expense' && new Date(t.transaction_date) >= p0) sp += cts(t.amount);
        if (into >= 5) {
          const left = S.budget - held() - Math.round(sp / into * len);
          if (left >= S.budget * 0.05)
            list.push('At your current pace you will end this budget period with about ' + money(left) +
              ' unspent. Moving part of it into savings now keeps it from being spent by accident.');
          else if (left < 0)
            list.push('At your current pace you will finish this budget period about ' + money(-left) +
              ' over budget. Cutting back first would make room to save.');
        }
      }

      if (S.weekly && tracked >= 14) {
        const wk0 = back((today0.getDay() + 6) % 7), lw = new Date(wk0);
        lw.setDate(lw.getDate() - 7);
        if (day0(earliest) <= lw) {
          let v = 0;
          for (const t of S.tx) {
            const d = new Date(t.transaction_date);
            if (t.type === 'expense' && d >= lw && d < wk0) v += cts(t.amount);
          }
          const gap = S.weekly - v;
          if (gap >= S.weekly * 0.05)
            list.push('Last week you spent ' + money(v) + ', ' + money(gap) + ' under your weekly limit. Saving that gap every week would add up to about ' +
              money(Math.round(gap * 52 / 12)) + ' a month.');
        }
      }
    }

    // How saving itself is going
    if (S.budget > 0) {
      const p = Math.round(dep30 * 100 / S.budget);
      if (dep30 > 0)
        list.push('You set aside ' + money(dep30) + ' in the last 30 days, ' + p + '% of your monthly budget.' +
          (p < 10 ? ' At 10% it would be ' + money(Math.round(S.budget / 10)) + '.' : ''));
      else if (tracked >= 14)
        list.push('You have not saved anything in the last 30 days. A fixed 10% of your monthly budget would be ' +
          money(Math.round(S.budget / 10)) + '. Moving it as soon as the period starts is the easiest habit.');
    }
    if (wd30 > dep30 && wd30 > 0)
      list.push('You withdrew more than you saved in the last 30 days (' + money(wd30) + ' out, ' + money(dep30) + ' in), so your savings shrank by ' +
        money(wd30 - dep30) + '.');
    if (total > 0 && spend > 0 && win >= 7) {
      const daily = spend / win, days = Math.round(total / daily);
      list.push('Your savings cover about ' + days + ' days of spending at your current pace. A common guideline for an emergency fund is 3 to 6 months.' +
        (days < 90 ? ' Reaching 90 days would take ' + money(Math.round(daily * 90)) + '.' : ''));
    }
    if (total > 0) {
      if (bal.cash * 100 / total >= 30)
        list.push(money(bal.cash) + ' of your savings (' + Math.round(bal.cash * 100 / total) +
          '%) is in cash. Cash is easy to spend and cannot earn interest. Moving it to your Ziraat card keeps it apart and safer.');
      if (bal.vakif * 100 / total >= 30)
        list.push(money(bal.vakif) + ' of your savings (' + Math.round(bal.vakif * 100 / total) +
          '%) sits on your Vakıfbank card, the one you spend from. Moving it to Ziraat keeps it out of reach of everyday purchases.');
      if (bal.ziraat > 0)
        list.push('Check whether the money on your Ziraat card can sit in an interest-bearing savings account (vadeli hesap). Idle lira loses value to inflation.');
    }

    const head = pot > 0
      ? 'Based on ' + (win < 30 ? 'the ' + win + ' days you have tracked' : 'the last 30 days') + ', the changes below could free about ' +
        money(Math.round(pot)) + ' a month for savings.'
      : '';
    return { head, list: list.slice(0, 8) };
  }

  // ---------- Render ----------
  function renderSummary() {
    const box = $('#sv-summary');
    box.replaceChildren();
    if (!ready) {
      box.append(el('div', 'alert bad', 'The savings table was not found. Run savings.sql in the Supabase SQL editor, then reload.'));
      return;
    }
    const { money } = M();
    const bal = balances(), total = sum(bal), h = held();
    const hero = el('div', 'hero');
    hero.append(el('span', 'lbl', 'Total saved'), el('strong', '', money(total)),
      el('span', 'warn', !deductOn() ? 'Savings do not change your budget.'
        : h > 0 ? money(h) + ' of this period is set aside and cannot be spent.'
        : h < 0 ? money(-h) + ' released into this period budget.'
        : 'Nothing set aside from this period budget yet.'));
    const stats = el('div', 'stats places');
    PLACES.forEach(([k, label]) => {
      const d = el('div');
      d.append(el('span', 'lbl', label), el('b', '', money(bal[k])));
      stats.append(d);
    });
    box.append(hero, stats);
    const saved = $('#saved');
    if (saved) saved.textContent = money(total);
  }

  function renderTips() {
    const box = $('#sv-tips');
    box.replaceChildren();
    if (!ready) return;
    box.append(el('h2', '', 'Suggestions'));
    const { head, list } = tips();
    if (!list.length) {
      box.append(el('p', 'lbl', 'Suggestions appear once you have a week of spending or some savings recorded.'));
      return;
    }
    if (head) box.append(el('div', 'alert info', head));
    list.forEach(t => box.append(el('div', 'alert info', t)));
  }

  function renderHist() {
    const box = $('#sv-hist');
    box.replaceChildren();
    $('#sv-save').disabled = !ready;
    if (!ready) return;
    if (!rows.length) { box.append(el('li', 'row empty', 'No savings yet. Your first entry will show here.')); return; }
    const { money } = M();
    (showAll ? rows : rows.slice(0, 15)).forEach(r => {
      const li = el('li', 'row tap'), l = el('div', 'l'), dot = el('span', 'dot');
      dot.style.background = colorOf(r.place);
      const when = new Date(r.saved_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      let title, sub, cls, sign;
      if (r.kind === 'deposit') {
        title = 'Saved to ' + name(r.place);
        sub = r.source === 'outside' ? 'Outside budget' : 'From ' + name(r.source);
        cls = 'amt in'; sign = '+';
      } else if (r.kind === 'withdraw') {
        title = 'Withdrawn from ' + name(r.place);
        sub = r.to_budget ? 'Added back to budget' : 'Taken out';
        cls = 'amt out'; sign = '-';
      } else {
        title = 'Moved ' + name(r.place) + ' to ' + name(r.to_place);
        sub = ''; cls = 'amt'; sign = '';
      }
      l.append(el('b', '', title), el('span', '', [when, sub, r.note].filter(Boolean).join(', ')));
      li.append(dot, l, el('span', cls, sign + money(cents(r))));
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      li.title = 'Tap to delete';
      li.addEventListener('click', () => remove(r));
      li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); remove(r); } });
      box.append(li);
    });
    if (rows.length > 15) {
      const li = el('li', 'row'), b = el('button', 'ghost more', showAll ? 'Show less' : 'Show all ' + rows.length);
      b.type = 'button';
      b.addEventListener('click', () => { showAll = !showAll; renderHist(); });
      li.append(b);
      box.append(li);
    }
  }

  function render() {
    if (!$('#sv-summary')) return;
    renderSummary();
    renderTips();
    renderHist();
  }

  async function remove(r) {
    if (!confirm('Delete this savings entry?')) return;
    const { error } = await window.sb.from('savings').delete().eq('id', r.id);
    if (error) return M().toast('Not deleted: ' + error.message, true);
    M().toast('Deleted.');
    await load();
    M().render();
  }

  // ---------- Form ----------
  function fill(sel, list, val) {
    sel.replaceChildren();
    list.forEach(([k, label]) => { const o = el('option', '', label); o.value = k; sel.append(o); });
    if (val && list.some(x => x[0] === val)) sel.value = val;
  }

  function setKind(k) {
    kind = k;
    document.querySelectorAll('#sv-kind button').forEach(b => b.classList.toggle('on', b.dataset.k === k));
    const A = $('#sv-a'), B = $('#sv-b');
    if (k === 'deposit') {
      $('#sv-a-lbl').textContent = 'Money came from';
      $('#sv-b-lbl').textContent = 'Keep it in';
      fill(A, SOURCES, store.get('src') || 'vakif');
      fill(B, PLACES, store.get('place') || 'ziraat');
    } else if (k === 'withdraw') {
      $('#sv-a-lbl').textContent = 'Take it from';
      $('#sv-b-lbl').textContent = 'What happens to it';
      fill(A, PLACES, 'ziraat');
      fill(B, USES, 'budget');
    } else {
      $('#sv-a-lbl').textContent = 'Move from';
      $('#sv-b-lbl').textContent = 'Move to';
      fill(A, PLACES, 'cash');
      fill(B, PLACES, 'ziraat');
    }
    $('#sv-save').textContent = { deposit: 'Save money', withdraw: 'Withdraw money', transfer: 'Move money' }[k];
  }

  function chosenDate() {
    const v = $('#sv-date').value, now = new Date();
    if (!v) return now;
    const d = new Date(v + 'T00:00:00');
    if (M().dayKey(d) === M().dayKey(now)) return now;
    d.setHours(12, 0, 0, 0);
    return d;
  }

  $('#sv-kind').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setKind(b.dataset.k); });

  $('#sv').addEventListener('submit', async e => {
    e.preventDefault();
    if (busy) return;
    const { S, money, toast } = M();
    const amt = parseFloat($('#sv-amount').value.replace(',', '.'));
    if (!isFinite(amt) || amt <= 0) { $('#sv-amount').focus(); return toast('Enter an amount above 0.', true); }
    const a = $('#sv-a').value, b = $('#sv-b').value, c = Math.round(amt * 100), bal = balances();
    const when = chosenDate();
    if (when > new Date()) return toast('The date cannot be in the future.', true);
    const rec = { user_id: S.user.id, kind, amount: Math.round(amt * 100) / 100,
      note: $('#sv-note').value.trim() || null, saved_at: when.toISOString() };
    if (kind === 'deposit') { rec.source = a; rec.place = b; }
    else {
      if (c > bal[a]) return toast('Not enough in ' + name(a) + '. It holds ' + money(bal[a]) + '.', true);
      rec.place = a;
      if (kind === 'withdraw') rec.to_budget = b === 'budget';
      else { if (a === b) return toast('Choose two different places.', true); rec.to_place = b; }
    }
    busy = true;
    $('#sv-save').disabled = true;
    const { error } = await window.sb.from('savings').insert(rec);
    busy = false;
    $('#sv-save').disabled = !ready;
    if (error) return toast('Not saved: ' + error.message, true);
    if (kind === 'deposit') { store.set('src', a); store.set('place', b); }
    $('#sv-amount').value = '';
    $('#sv-note').value = '';
    $('#sv-date').value = '';
    toast(kind === 'deposit' ? 'Saved.' : kind === 'withdraw' ? 'Withdrawn.' : 'Moved.');
    await load();
    M().render();
  });

  $('#sv-deduct').value = deductOn() ? 'on' : 'off';
  $('#sv-deduct').addEventListener('change', () => {
    store.set('deduct', $('#sv-deduct').value);
    M().render();
  });
  $('#sv-opts').addEventListener('submit', e => e.preventDefault());

  setKind('deposit');
  window.MetronSavings = { load, render, held, balances };
})();
