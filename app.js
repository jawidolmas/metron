(() => {
  const $ = s => document.querySelector(s);
  const CATS = ['Food & Groceries', 'Coffee & Drinks', 'Transportation', 'Education', 'Personal Care',
    'Shopping', 'Social & Entertainment', 'Subscriptions', 'Health & Fitness', 'Other'];
  const VISIBLE_CATS = 6;
  const S = { tx: [], budget: 0, weekly: 0, alert: 80, fixed: [], startDay: 1, detailId: null, prev: 'analytics', pushed: false, currency: 'TRY', type: 'expense', cat: CATS[0], busy: false,
    user: null, editId: null, range: 30, view: 'overview', order: CATS.slice(), allCats: false, whenTouched: false };
  const charts = {};
  const wide = window.matchMedia('(min-width: 1100px)');

  // Small remembered choices (last category, last payment method). Fails safe if storage is blocked.
  const mem = {
    get(k) { try { return localStorage.getItem('metron.' + k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem('metron.' + k, v); } catch { /* ignore */ } }
  };

  // Money is summed in integer cents. No rounded intermediate totals.
  const cents = n => Math.round(Number(n) * 100);
  const money = c => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: S.currency }).format(c / 100);

  // Money set aside in savings (see savings.js). Held out of the monthly budget when that option is on.
  const savedHeld = () => (window.MetronSavings && window.MetronSavings.held()) || 0;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function toast(msg, bad, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = bad ? 'bad show' : 'show';
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { t.className = ''; }, ms || 2500);
  }

  // ---------- Views ----------
  // Mobile: one view at a time (Add is its own tab).
  // Desktop: the Add panel is always visible beside the content.
  function show(view) {
    if (view === 'add' && wide.matches) { $('#amount').focus(); return; }
    S.view = view;
    document.querySelectorAll('.view').forEach(v => {
      v.hidden = v.id === 'v-add' ? (!wide.matches && view !== 'add') : v.id !== 'v-' + view;
    });
    const navView = view === 'detail' ? S.prev : view;
    document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.v === navView));
    if (view === 'add') { refreshWhen(); $('#amount').focus(); }
    if (view === 'analytics') window.MetronAnalytics?.render();
    if (view === 'detail') {
      renderDetail();
      window.scrollTo(0, 0);
      $('.content').scrollTop = 0;
    }
  }
  function openDetail(id) {
    S.detailId = id;
    if (!['detail', 'add'].includes(S.view)) S.prev = S.view;
    if (!S.pushed) { history.pushState({ metron: 'detail' }, ''); S.pushed = true; }
    show('detail');
  }
  function goBack() {
    if (S.pushed) history.back(); else show(S.prev);
  }
  window.addEventListener('popstate', () => {
    S.pushed = false;
    if (S.user && S.view === 'detail') show(S.prev);
  });
  $('#back').addEventListener('click', goBack);
  wide.addEventListener('change', () => { if (S.user) show(S.view === 'add' ? 'overview' : S.view); });

  // ---------- Auth ----------
  async function route(session) {
    S.user = session ? session.user : null;
    $('#auth').hidden = !!S.user;
    $('#app').hidden = !S.user;
    if (S.user) {
      saveProfile();
      await loadAll();
      show('overview');
      if (wide.matches) $('#amount').focus();
    }
  }

  $('#signout').addEventListener('click', async () => { await sb.auth.signOut(); route(null); });

  $('#google').addEventListener('click', async () => {
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.origin + location.pathname }
    });
    if (error) $('#auth-err').textContent = error.message;
  });

  async function saveProfile() {
    const m = S.user.user_metadata || {};
    const name = m.full_name || m.name || '';
    $('#who').textContent = name;
    const { error } = await sb.from('profiles').upsert({
      user_id: S.user.id,
      full_name: name || null,
      avatar_url: m.avatar_url || null,
      updated_at: new Date().toISOString()
    });
    if (error) console.warn('Profile not saved:', error.message);
  }

  // ---------- Data ----------
  async function loadAll() {
    const [t, s, f] = await Promise.all([
      sb.from('transactions').select('*').order('transaction_date', { ascending: false }).limit(1000),
      sb.from('user_settings').select('*').maybeSingle(),
      sb.from('fixed_costs').select('*').order('created_at')
    ]);
    if (t.error) return toast('Load failed: ' + t.error.message, true);
    S.tx = t.data;
    if (f.error) console.warn('Fixed costs not loaded:', f.error.message);
    S.fixed = f.data || [];
    if (s.data) {
      S.budget = cents(s.data.monthly_budget);
      S.weekly = cents(s.data.weekly_budget || 0);
      S.currency = s.data.currency;
      S.startDay = s.data.budget_start_day;
      $('#budget').value = s.data.monthly_budget || '';
      $('#weekly').value = s.data.weekly_budget || '';
      S.alert = s.data.alert_percent || 80;
      $('#alert').value = String(S.alert);
      $('#startday').value = s.data.budget_start_day;
    }
    sortCategories();
    if (window.MetronSavings) await window.MetronSavings.load();
    render();
  }

  function periodStart() {
    const n = new Date();
    let m = n.getMonth();
    if (n.getDate() < S.startDay) m--;
    return new Date(n.getFullYear(), m, S.startDay);
  }

  // ---------- Render ----------
  async function removeTx(t) {
    if (!confirm('Delete "' + t.description + '"?')) return;
    const { error } = await sb.from('transactions').delete().eq('id', t.id);
    if (error) return toast('Not deleted: ' + error.message, true);
    toast('Deleted.');
    await loadAll();
    goBack();
  }

  function row(t) {
    const r = el('li', 'row tap');
    r.tabIndex = 0;
    r.setAttribute('role', 'button');
    r.addEventListener('click', () => openDetail(t.id));
    r.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(t.id); }
    });
    const l = el('div', 'l');
    const when = new Date(t.transaction_date).toLocaleString('en-GB',
      { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const sub = (t.description === t.category ? '' : t.category + ', ') + when;
    l.append(el('b', '', t.description), el('span', '', sub));
    const out = t.type === 'expense';
    r.append(l, el('span', 'amt ' + (out ? 'out' : 'in'), (out ? '-' : '+') + money(cents(t.amount))));
    const chev = el('span', 'chev', '\u203A');
    chev.setAttribute('aria-hidden', 'true');
    r.append(chev);
    return r;
  }

  function renderDetail() {
    const t = S.tx.find(x => x.id === S.detailId);
    const box = $('#detail');
    if (!t) return;
    box.replaceChildren();
    const out = t.type === 'expense';
    const card = el('div', 'hero');
    card.append(el('span', 'lbl', out ? 'Expense' : 'Income'),
      el('strong', out ? '' : 'in', (out ? '-' : '+') + money(cents(t.amount))),
      el('span', 'lbl', t.description));
    const ul = el('ul', 'list');
    ul.style.marginTop = '12px';
    const kv = (k, v) => {
      if (!v) return;
      const r = el('li', 'row kv');
      r.append(el('span', '', k), el('b', '', v));
      ul.append(r);
    };
    kv('Category', t.category);
    kv('Date', new Date(t.transaction_date).toLocaleString('en-GB',
      { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }));
    kv('Payment method', t.payment_method);
    kv('Need, want or impulse', t.purchase_type ? t.purchase_type[0].toUpperCase() + t.purchase_type.slice(1) : '');
    kv('Reason', t.reason);
    const acts = el('div', 'dactions');
    const ed = el('button', 'primary', 'Edit');
    ed.type = 'button';
    ed.addEventListener('click', () => startEdit(t));
    const del = el('button', 'danger', 'Delete');
    del.type = 'button';
    del.addEventListener('click', () => removeTx(t));
    acts.append(ed, del);
    box.append(card, ul, acts);
  }

  function totals() {
    const now = new Date();
    const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const wk0 = new Date(day0);
    wk0.setDate(day0.getDate() - ((day0.getDay() + 6) % 7));
    const p0 = periodStart();
    let spent = 0, income = 0, today = 0, week = 0;
    for (const t of S.tx) {
      const d = new Date(t.transaction_date), c = cents(t.amount);
      if (t.type === 'income') { if (d >= p0) income += c; continue; }
      if (d >= p0) spent += c;
      if (d >= day0) today += c;
      if (d >= wk0) week += c;
    }
    return { spent, income, today, week };
  }

  function usage() {
    const { spent, week } = totals();
    return { m: S.budget ? (spent + savedHeld()) * 100 / S.budget : 0, w: S.weekly ? week * 100 / S.weekly : 0 };
  }

  function crossMsg(b, a) {
    for (const [k, label] of [['m', 'monthly'], ['w', 'weekly']]) {
      if (a[k] >= 100 && b[k] < 100) return 'Your ' + label + ' budget is exceeded.';
      if (a[k] >= S.alert && b[k] < S.alert) return 'Heads up: ' + Math.round(a[k]) + '% of your ' + label + ' budget used.';
    }
    return null;
  }

  function render() {
    const { spent, income, today, week } = totals();
    const held = savedHeld();
    $('#left').textContent = money(S.budget - spent - held);
    $('#today').textContent = money(today);
    $('#week').textContent = money(week);
    $('#spent').textContent = money(spent);
    $('#income').textContent = money(income);

    const state = p => p >= 100 ? 'bar over' : p >= S.alert ? 'bar near' : 'bar';
    const pct = S.budget ? ((spent + held) / S.budget) * 100 : 0;
    $('#bar').style.width = Math.min(pct, 100) + '%';
    $('#bar').parentElement.className = state(pct);
    $('#warn').textContent = S.budget ? Math.round(pct) + '% of monthly budget used' + (held > 0 ? ' (' + money(held) + ' set aside for savings)' : '') : 'Set a monthly budget in Settings.';

    $('#wcard').hidden = !S.weekly;
    if (S.weekly) {
      const wp = (week / S.weekly) * 100;
      $('#wleft').textContent = money(S.weekly - week);
      $('#wbar').style.width = Math.min(wp, 100) + '%';
      $('#wbar').parentElement.className = state(wp);
      $('#wwarn').textContent = Math.round(wp) + '% of weekly budget used';
    }
    renderFixed();
    renderAlerts(spent + held, week);
    if (window.MetronSavings) window.MetronSavings.render();

    const rec = $('#recent');
    rec.replaceChildren();
    if (!S.tx.length) rec.append(el('li', 'row empty', 'No transactions yet. Type an amount to start.'));
    S.tx.slice(0, 5).forEach(t => rec.append(row(t)));
    renderHistory();
    if (S.view === 'analytics') window.MetronAnalytics?.render();
    if (S.view === 'detail') renderDetail();
  }

  function renderHistory() {
    const q = $('#q').value.trim().toLowerCase();
    const box = $('#hist');
    box.replaceChildren();
    const fc = $('#fcat').value, ft = $('#ftype').value;
    const from = $('#ffrom').value ? new Date($('#ffrom').value + 'T00:00:00') : null;
    const to = $('#fto').value ? new Date($('#fto').value + 'T23:59:59.999') : null;
    const list = S.tx.filter(t => {
      const d = new Date(t.transaction_date);
      const hay = (t.description + ' ' + t.category).toLowerCase();
      return hay.includes(q) && (!fc || t.category === fc) &&
        (!ft || t.type === ft) && (!from || d >= from) && (!to || d <= to);
    });
    if (!list.length) {
      box.append(el('p', 'empty', S.tx.length ? 'No match.' : 'No transactions yet. Add your first one.'));
      return;
    }
    const days = new Map();
    for (const t of list) {
      const k = new Date(t.transaction_date).toDateString();
      if (!days.has(k)) days.set(k, []);
      days.get(k).push(t);
    }
    for (const [k, items] of days) {
      const sub = items.filter(t => t.type === 'expense').reduce((a, t) => a + cents(t.amount), 0);
      const head = el('div', 'day');
      head.append(el('span', '', new Date(k).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })),
        el('span', '', 'Spent ' + money(sub)));
      const ul = el('ul', 'list');
      items.forEach(t => ul.append(row(t)));
      box.append(head, ul);
    }
  }

  // ---------- Add form: categories ----------
  // Most used categories come first, so the usual one is one tap away.
  function sortCategories() {
    const n = Object.fromEntries(CATS.map(c => [c, 0]));
    S.tx.forEach(t => { if (t.type === 'expense' && t.category in n) n[t.category]++; });
    S.order = CATS.slice().sort((a, b) => n[b] - n[a] || CATS.indexOf(a) - CATS.indexOf(b));
    const saved = mem.get('cat');
    if (!S.editId) S.cat = CATS.includes(saved) ? saved : S.order[0];
    renderChips();
  }

  function renderChips() {
    const box = $('#cats');
    box.replaceChildren();
    let list = S.allCats ? S.order : S.order.slice(0, VISIBLE_CATS);
    if (!list.includes(S.cat)) list = list.concat(S.cat);
    list.forEach(c => {
      const b = el('button', c === S.cat ? 'on' : '', c);
      b.type = 'button';
      b.setAttribute('aria-pressed', c === S.cat);
      b.addEventListener('click', () => { S.cat = c; renderChips(); });
      box.append(b);
    });
    if (S.order.length > VISIBLE_CATS) {
      const m = el('button', 'more', S.allCats ? 'Less' : 'More');
      m.type = 'button';
      m.addEventListener('click', () => { S.allCats = !S.allCats; renderChips(); });
      box.append(m);
    }
  }

  // ---------- Add form: type ----------
  function setType(type) {
    S.type = type;
    document.querySelectorAll('.seg button').forEach(x => x.classList.toggle('on', x.dataset.type === type));
    const exp = type === 'expense';
    $('#cats').hidden = !exp;
    $('#ptype-wrap').hidden = !exp;
    setSaveLabel();
  }
  document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
    setType(b.dataset.type);
    $('#amount').focus();
  }));

  // ---------- Add form: date and time ----------
  // Untouched: the entry uses the exact moment of saving. Touched: it uses the chosen value.
  const toLocal = d => {
    const x = new Date(d);
    x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
    return x.toISOString().slice(0, 16);
  };
  function whenText(d) {
    const t = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const b = new Date(); b.setHours(0, 0, 0, 0);
    const diff = Math.round((b.getTime() - a) / 864e5);
    if (diff === 0) return 'Today, ' + t;
    if (diff === 1) return 'Yesterday, ' + t;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ', ' + t;
  }
  function refreshWhen() {
    const v = $('#when').value;
    const d = S.whenTouched && v ? new Date(v) : new Date();
    $('#when-label').textContent = whenText(d);
  }
  function openWhen(open) {
    $('#when-box').hidden = !open;
    $('#when-chip').setAttribute('aria-expanded', open);
  }
  $('#when-chip').addEventListener('click', () => {
    const open = $('#when-box').hidden;
    if (open && !$('#when').value) $('#when').value = toLocal(new Date());
    openWhen(open);
  });
  $('#when').addEventListener('input', () => {
    S.whenTouched = !!$('#when').value;
    refreshWhen();
  });
  $('#when-now').addEventListener('click', () => {
    S.whenTouched = false;
    $('#when').value = '';
    openWhen(false);
    refreshWhen();
  });
  setInterval(() => { if (!S.whenTouched) refreshWhen(); }, 30000);

  // ---------- Add form: save ----------
  $('#add').addEventListener('submit', async e => {
    e.preventDefault();
    if (S.busy) return;
    const amt = parseFloat($('#amount').value.replace(',', '.'));
    if (!isFinite(amt) || amt <= 0) { $('#amount').focus(); return toast('Enter an amount above 0.', true); }
    const exp = S.type === 'expense';
    const rec = {
      type: S.type,
      amount: Math.round(amt * 100) / 100,
      description: $('#desc').value.trim() || (exp ? S.cat : 'Income'),
      category: exp ? S.cat : 'Income',
      payment_method: $('#pay').value || null,
      reason: $('#reason').value.trim() || null,
      purchase_type: exp ? ($('#ptype').value || null) : null
    };
    if (S.whenTouched && $('#when').value) rec.transaction_date = new Date($('#when').value).toISOString();
    else if (S.editId) rec.transaction_date = new Date().toISOString();

    S.busy = true;
    $('#save').disabled = true;
    const wasEdit = !!S.editId;
    const editedId = S.editId;
    let error, alertMsg = null;
    if (wasEdit) {
      ({ error } = await sb.from('transactions').update(rec).eq('id', S.editId));
    } else {
      const r = await sb.from('transactions').insert(rec).select().single();
      error = r.error;
      if (!error && r.data) {
        const before = usage();
        S.tx.unshift(r.data);
        S.tx.sort((a, b) => new Date(b.transaction_date) - new Date(a.transaction_date));
        alertMsg = crossMsg(before, usage());
      }
    }
    S.busy = false;
    $('#save').disabled = false;
    if (error) return toast('Not saved: ' + error.message, true);

    if (exp) { mem.set('cat', S.cat); if (rec.payment_method) mem.set('pay', rec.payment_method); }
    resetEdit();
    if (alertMsg) toast(alertMsg, true, 4500); else toast(wasEdit ? 'Updated.' : 'Saved.');
    if (wasEdit) await loadAll(); else render();
    if (wasEdit) openDetail(editedId);
    else if (wide.matches) $('#amount').focus();
    else show('overview');
  });

  // ---------- Settings ----------
  $('#settings').addEventListener('submit', async e => {
    e.preventDefault();
    const num = v => v.trim() === '' ? 0 : parseFloat(v.replace(',', '.'));
    const b = num($('#budget').value), w = num($('#weekly').value);
    const d = parseInt($('#startday').value, 10);
    if (!isFinite(b) || b < 0) return toast('Enter a valid monthly budget.', true);
    if (!isFinite(w) || w < 0) return toast('Enter a valid weekly budget.', true);
    if (!(d >= 1 && d <= 28)) return toast('Start day must be 1 to 28.', true);
    const { error } = await sb.from('user_settings').upsert({
      user_id: S.user.id, monthly_budget: b, weekly_budget: w, budget_start_day: d, alert_percent: parseInt($('#alert').value, 10) || 80, updated_at: new Date().toISOString()
    });
    if (error) return toast('Not saved: ' + error.message, true);
    toast('Budget saved.');
    loadAll();
  });

  // ---------- Settings tabs ----------
  document.querySelectorAll('#stabs button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#stabs button').forEach(x => {
      x.classList.toggle('on', x === b);
      x.setAttribute('aria-selected', x === b);
    });
    document.querySelectorAll('.spane').forEach(p => { p.hidden = p.id !== 's-' + b.dataset.s; });
  }));

  // ---------- Nav / search / shortcut ----------
  document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.v === 'add') resetEdit();
    show(b.dataset.v);
  }));
  $('#q').addEventListener('input', renderHistory);
  // Press N anywhere to jump to a new entry.
  document.addEventListener('keydown', e => {
    if (e.key.toLowerCase() !== 'n' || e.metaKey || e.ctrlKey || e.altKey || !S.user) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
    e.preventDefault();
    if (!S.editId) show('add'); else $('#amount').focus();
  });

  // ---------- Edit ----------
  function setSaveLabel() {
    $('#save').textContent = (S.editId ? 'Update ' : 'Save ') + (S.type === 'expense' ? 'expense' : 'income');
    $('#add-title').textContent = S.editId ? 'Edit entry' : 'New entry';
  }
  function resetEdit() {
    S.editId = null;
    $('#add').reset();
    $('#more').open = false;
    S.whenTouched = false;
    openWhen(false);
    refreshWhen();
    const pay = mem.get('pay');
    if (pay) $('#pay').value = pay;
    const saved = mem.get('cat');
    if (CATS.includes(saved)) S.cat = saved;
    $('#cancel').hidden = true;
    setType('expense');
    renderChips();
  }
  function startEdit(t) {
    setType(t.type);
    $('#amount').value = t.amount;
    $('#desc').value = t.description === t.category ? '' : t.description;
    if (CATS.includes(t.category)) { S.cat = t.category; renderChips(); }
    $('#pay').value = t.payment_method || '';
    $('#ptype').value = t.purchase_type || '';
    $('#reason').value = t.reason || '';
    $('#more').open = !!(t.payment_method || t.purchase_type || t.reason);
    $('#when').value = toLocal(t.transaction_date);
    S.whenTouched = true;
    refreshWhen();
    S.editId = t.id;
    $('#cancel').hidden = false;
    setSaveLabel();
    show('add');
  }
  $('#cancel').addEventListener('click', () => {
    const id = S.editId;
    resetEdit();
    if (id) openDetail(id); else (window.MetronAnalytics?.open('history'), show(wide.matches ? S.view : 'analytics'));
  });

  // ---------- Filters ----------
  CATS.concat('Income').forEach(c => { const o = el('option', '', c); o.value = c; $('#fcat').append(o); });
  ['#fcat', '#ftype', '#ffrom', '#fto'].forEach(s => $(s).addEventListener('input', renderHistory));

  // ---------- Stats ----------
  const dayKey = d => {
    d = new Date(d);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  function draw(id, cfg) {
    if (!window.Chart) return toast('Chart library failed to load.', true);
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart($('#' + id), cfg);
  }
  function renderStats() {
    const today0 = new Date();
    today0.setHours(0, 0, 0, 0);
    let start;
    if (S.range) { start = new Date(today0); start.setDate(start.getDate() - S.range + 1); }
    else start = periodStart();
    const n = Math.max(1, Math.round((today0 - start) / 864e5) + 1);
    const ex = S.tx.filter(t => t.type === 'expense' && new Date(t.transaction_date) >= start);
    const byDay = new Map(), byCat = new Map();
    let tot = 0;
    for (const t of ex) {
      const c = cents(t.amount), k = dayKey(t.transaction_date);
      tot += c;
      byDay.set(k, (byDay.get(k) || 0) + c);
      byCat.set(t.category, (byCat.get(t.category) || 0) + c);
    }
    const top = m => [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    const tc = top(byCat), td = top(byDay);
    $('#avg').textContent = money(Math.round(tot / n));
    $('#tot').textContent = money(tot);
    $('#topcat').textContent = tc ? tc[0] : 'None';
    $('#topday').textContent = td
      ? new Date(td[0] + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ', ' + money(td[1])
      : 'None';

    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue('--accent').trim(), mute = css.getPropertyValue('--mute').trim(), line = css.getPropertyValue('--line').trim();
    const base = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } };
    const labels = [], vals = [];
    for (let i = 0; i < n; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      labels.push(d.getDate() + '/' + (d.getMonth() + 1));
      vals.push((byDay.get(dayKey(d)) || 0) / 100);
    }
    draw('c-day', { type: 'bar', data: { labels, datasets: [{ data: vals, backgroundColor: accent, borderRadius: 6 }] },
      options: { ...base, scales: { x: { ticks: { color: mute, maxTicksLimit: 8 }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { color: mute }, grid: { color: line } } } } });

    window.MetronAnalytics?.runExtras('stats');
  }
  document.querySelectorAll('#a-stats .segs button').forEach(b => b.addEventListener('click', () => {
    S.range = Number(b.dataset.days);
    document.querySelectorAll('#a-stats .segs button').forEach(x => x.classList.toggle('on', x === b));
    renderStats();
  }));

  // ---------- Fixed costs ----------
  // Logos live in imgs/. If a file is missing, the tile falls back to the first letter.
  const PRESETS = [
    { key: 'youtube', name: 'YouTube', img: 'imgs/youtube.png' },
    { key: 'apple-music', name: 'Apple Music', img: 'imgs/apple-music.jpg' },
    { key: 'icloud', name: 'iCloud', img: 'imgs/icloud.png' },
    { key: 'spotify', name: 'Spotify', img: 'imgs/spotify.jpg' }
  ];
  const FX = { id: null, logo: null };

  function logo(key, name) {
    const box = el('span', 'logo');
    const p = PRESETS.find(x => x.key === key);
    const letter = () => {
      box.replaceChildren();
      box.classList.add('ph');
      box.textContent = ((name || '').trim()[0] || '+').toUpperCase();
    };
    if (p) {
      const i = new Image();
      i.alt = '';
      i.src = p.img;
      i.addEventListener('error', letter);
      box.append(i);
    } else letter();
    return box;
  }

  function nextRenewal(day) {
    const n = new Date(), t0 = new Date(n.getFullYear(), n.getMonth(), n.getDate());
    const pick = (y, m) => new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()));
    let d = pick(t0.getFullYear(), t0.getMonth());
    if (d < t0) d = pick(t0.getFullYear(), t0.getMonth() + 1);
    return { date: d, days: Math.round((d - t0) / 864e5) };
  }
  const inDays = n => n === 0 ? 'today' : n === 1 ? 'tomorrow' : 'in ' + n + ' days';
  const ordinal = n => n + ((n % 100 >= 11 && n % 100 <= 13) ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] || 'th'));

  function renderFixed() {
    const list = S.fixed.map(c => ({ c, r: nextRenewal(c.renew_day) })).sort((a, b) => a.r.days - b.r.days);
    const total = S.fixed.reduce((a, c) => a + cents(c.amount), 0);
    $('#fx-total').textContent = money(total);
    $('#fx-next').textContent = list.length ? list[0].c.name + ', ' + inDays(list[0].r.days) : 'None';

    const box = $('#fixed');
    box.replaceChildren();
    if (!list.length) box.append(el('li', 'row empty', 'No fixed costs yet. Add your first one below.'));
    list.forEach(({ c, r }) => {
      const li = el('li', 'row tap'), l = el('div', 'l');
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      l.append(el('b', '', c.name), el('span', '', 'Renews on the ' + ordinal(c.renew_day) + ', ' + inDays(r.days)));
      const chev = el('span', 'chev', '\u203A');
      chev.setAttribute('aria-hidden', 'true');
      li.append(logo(c.logo, c.name), l, el('span', 'amt', money(cents(c.amount))), chev);
      li.addEventListener('click', () => startFx(c));
      li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startFx(c); } });
      box.append(li);
    });

    const up = $('#upcoming');
    up.replaceChildren();
    if (!list.length) up.append(el('li', 'row empty', 'No fixed costs yet. Add them in Settings.'));
    list.slice(0, 5).forEach(({ c, r }) => {
      const li = el('li', 'row'), l = el('div', 'l');
      l.append(el('b', '', c.name),
        el('span', '', r.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ', ' + inDays(r.days)));
      li.append(logo(c.logo, c.name), l, el('span', 'amt', money(cents(c.amount))));
      up.append(li);
    });
  }

  function renderAlerts(spent, week) {
    const box = $('#alerts');
    box.replaceChildren();
    const add = (cls, text) => box.append(el('div', 'alert ' + cls, text));
    const check = (label, limit, used) => {
      if (!limit) return;
      const p = used * 100 / limit;
      if (p >= 100) add('bad', label + ' budget exceeded by ' + money(used - limit) + '.');
      else if (p >= S.alert) add('', 'You have used ' + Math.round(p) + '% of your ' + label.toLowerCase() +
        ' budget. ' + money(limit - used) + ' left.');
    };
    check('Monthly', S.budget, spent);
    check('Weekly', S.weekly, week);
    S.fixed.forEach(c => {
      const r = nextRenewal(c.renew_day);
      if (r.days <= 3) add('info', c.name + ' renews ' + inDays(r.days) + ' (' + money(cents(c.amount)) + ').');
    });
  }

  function renderSvc() {
    const box = $('#svc');
    box.replaceChildren();
    const mk = (key, name, label) => {
      const b = el('button');
      b.type = 'button';
      b.className = FX.logo === key ? 'on' : '';
      b.setAttribute('aria-pressed', FX.logo === key);
      b.append(logo(key, key ? name : '+'), el('span', '', label));
      b.addEventListener('click', () => {
        const prev = PRESETS.find(p => p.key === FX.logo);
        FX.logo = key;
        const cur = $('#fx-name').value.trim();
        if (key && (!cur || (prev && cur === prev.name))) $('#fx-name').value = name;
        else if (!key && prev && cur === prev.name) $('#fx-name').value = '';
        renderSvc();
        (key ? $('#fx-amount') : $('#fx-name')).focus();
      });
      box.append(b);
    };
    PRESETS.forEach(p => mk(p.key, p.name, p.name));
    mk(null, '', 'Custom');
  }

  function resetFx() {
    FX.id = null;
    FX.logo = null;
    $('#fx').reset();
    $('#fx-day').value = 1;
    $('#fx-title').textContent = 'Add fixed cost';
    $('#fx-save').textContent = 'Add fixed cost';
    $('#fx-cancel').hidden = true;
    $('#fx-del').hidden = true;
    renderSvc();
  }
  function startFx(c) {
    FX.id = c.id;
    FX.logo = PRESETS.some(p => p.key === c.logo) ? c.logo : null;
    $('#fx-name').value = c.name;
    $('#fx-amount').value = c.amount;
    $('#fx-day').value = c.renew_day;
    $('#fx-title').textContent = 'Edit fixed cost';
    $('#fx-save').textContent = 'Update fixed cost';
    $('#fx-cancel').hidden = false;
    $('#fx-del').hidden = false;
    renderSvc();
    $('#stabs [data-s="fixed"]').click();
    $('#fx-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  $('#fx').addEventListener('submit', async e => {
    e.preventDefault();
    if (S.busy) return;
    const name = $('#fx-name').value.trim();
    const amt = parseFloat($('#fx-amount').value.replace(',', '.'));
    const day = parseInt($('#fx-day').value, 10);
    if (!name) { $('#fx-name').focus(); return toast('Enter a name.', true); }
    if (!isFinite(amt) || amt <= 0) { $('#fx-amount').focus(); return toast('Enter an amount above 0.', true); }
    if (!(day >= 1 && day <= 31)) return toast('Renewal day must be 1 to 31.', true);
    const rec = { user_id: S.user.id, name, amount: Math.round(amt * 100) / 100, renew_day: day, logo: FX.logo };
    S.busy = true;
    $('#fx-save').disabled = true;
    const wasEdit = !!FX.id;
    const { error } = wasEdit
      ? await sb.from('fixed_costs').update(rec).eq('id', FX.id)
      : await sb.from('fixed_costs').insert(rec);
    S.busy = false;
    $('#fx-save').disabled = false;
    if (error) return toast('Not saved: ' + error.message, true);
    toast(wasEdit ? 'Updated.' : 'Added.');
    resetFx();
    loadAll();
  });
  $('#fx-cancel').addEventListener('click', resetFx);
  $('#fx-del').addEventListener('click', async () => {
    const c = S.fixed.find(x => x.id === FX.id);
    if (!c || !confirm('Delete "' + c.name + '"?')) return;
    const { error } = await sb.from('fixed_costs').delete().eq('id', c.id);
    if (error) return toast('Not deleted: ' + error.message, true);
    toast('Deleted.');
    resetFx();
    loadAll();
  });

  // Read-only bridge for external modules (analytics*.js).
  window.Metron = { S, $, el, money, cents, dayKey, charts, draw, CATS, periodStart, renderStats, renderHistory, render, toast };

  renderSvc();
  renderChips();
  refreshWhen();
  sb.auth.getSession().then(({ data }) => route(data.session));
})();