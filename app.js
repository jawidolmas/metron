(() => {
  const $ = s => document.querySelector(s);
  const CATS = ['Food & Groceries', 'Coffee & Drinks', 'Transportation', 'Education', 'Personal Care',
    'Shopping', 'Social & Entertainment', 'Subscriptions', 'Health & Fitness', 'Other'];
  const VISIBLE_CATS = 6;
  const S = { tx: [], budget: 0, startDay: 1, currency: 'TRY', type: 'expense', cat: CATS[0], busy: false,
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

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function toast(msg, bad) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = bad ? 'bad show' : 'show';
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { t.className = ''; }, 2500);
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
    document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.v === view));
    if (view === 'add') { refreshWhen(); $('#amount').focus(); }
    if (view === 'stats') renderStats();
  }
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

  $('#login').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.submitter;
    btn.disabled = true;
    const { data, error } = await sb.auth.signInWithPassword({
      email: $('#email').value.trim(), password: $('#password').value
    });
    btn.disabled = false;
    if (error) { $('#auth-err').textContent = error.message; return; }
    $('#auth-err').textContent = '';
    route(data.session);
  });

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
    const [t, s] = await Promise.all([
      sb.from('transactions').select('*').order('transaction_date', { ascending: false }).limit(1000),
      sb.from('user_settings').select('*').maybeSingle()
    ]);
    if (t.error) return toast('Load failed: ' + t.error.message, true);
    S.tx = t.data;
    if (s.data) {
      S.budget = cents(s.data.monthly_budget);
      S.currency = s.data.currency;
      S.startDay = s.data.budget_start_day;
      $('#budget').value = s.data.monthly_budget;
      $('#startday').value = s.data.budget_start_day;
    }
    sortCategories();
    render();
  }

  function periodStart() {
    const n = new Date();
    let m = n.getMonth();
    if (n.getDate() < S.startDay) m--;
    return new Date(n.getFullYear(), m, S.startDay);
  }

  // ---------- Render ----------
  function row(t, withDelete) {
    const r = el('li', 'row');
    const l = el('div', 'l');
    const when = new Date(t.transaction_date).toLocaleString('en-GB',
      { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const sub = (t.description === t.category ? '' : t.category + ', ') + when;
    l.append(el('b', '', t.description), el('span', '', sub));
    const out = t.type === 'expense';
    r.append(l, el('span', 'amt ' + (out ? 'out' : 'in'), (out ? '-' : '+') + money(cents(t.amount))));
    if (withDelete) {
      const ed = el('button', 'del', 'Edit');
      ed.addEventListener('click', () => startEdit(t));
      r.append(ed);
      const d = el('button', 'del', 'Delete');
      d.addEventListener('click', async () => {
        if (!confirm('Delete "' + t.description + '"?')) return;
        const { error } = await sb.from('transactions').delete().eq('id', t.id);
        if (error) return toast('Not deleted: ' + error.message, true);
        toast('Deleted.');
        loadAll();
      });
      r.append(d);
    }
    return r;
  }

  function render() {
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
    $('#left').textContent = money(S.budget - spent);
    $('#today').textContent = money(today);
    $('#week').textContent = money(week);
    $('#spent').textContent = money(spent);
    $('#income').textContent = money(income);

    const pct = S.budget ? (spent / S.budget) * 100 : 0;
    $('#bar').style.width = Math.min(pct, 100) + '%';
    $('#warn').textContent = !S.budget ? 'Set a monthly budget below.'
      : pct >= 100 ? 'Budget exceeded.'
      : pct >= 85 ? '85% of budget used.'
      : pct >= 70 ? '70% of budget used.' : '';

    const rec = $('#recent');
    rec.replaceChildren();
    if (!S.tx.length) rec.append(el('li', 'row empty', 'No transactions yet. Type an amount to start.'));
    S.tx.slice(0, 5).forEach(t => rec.append(row(t, false)));
    renderHistory();
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
      items.forEach(t => ul.append(row(t, true)));
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
    let error;
    if (wasEdit) {
      ({ error } = await sb.from('transactions').update(rec).eq('id', S.editId));
    } else {
      const r = await sb.from('transactions').insert(rec).select().single();
      error = r.error;
      if (!error && r.data) {
        S.tx.unshift(r.data);
        S.tx.sort((a, b) => new Date(b.transaction_date) - new Date(a.transaction_date));
      }
    }
    S.busy = false;
    $('#save').disabled = false;
    if (error) return toast('Not saved: ' + error.message, true);

    if (exp) { mem.set('cat', S.cat); if (rec.payment_method) mem.set('pay', rec.payment_method); }
    resetEdit();
    toast(wasEdit ? 'Updated.' : 'Saved.');
    if (wasEdit) await loadAll(); else render();
    if (wide.matches) $('#amount').focus(); else show('overview');
  });

  // ---------- Settings ----------
  $('#settings').addEventListener('submit', async e => {
    e.preventDefault();
    const b = parseFloat($('#budget').value.replace(',', '.'));
    const d = parseInt($('#startday').value, 10);
    if (!isFinite(b) || b < 0) return toast('Enter a valid budget.', true);
    if (!(d >= 1 && d <= 28)) return toast('Start day must be 1 to 28.', true);
    const { error } = await sb.from('user_settings').upsert({
      user_id: S.user.id, monthly_budget: b, budget_start_day: d, updated_at: new Date().toISOString()
    });
    if (error) return toast('Not saved: ' + error.message, true);
    toast('Budget saved.');
    loadAll();
  });

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
  $('#cancel').addEventListener('click', () => { resetEdit(); show(wide.matches ? S.view : 'history'); });

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
    const byDay = new Map(), byCat = new Map(), pt = { need: 0, want: 0, impulse: 0, unmarked: 0 };
    let tot = 0;
    for (const t of ex) {
      const c = cents(t.amount), k = dayKey(t.transaction_date);
      tot += c;
      byDay.set(k, (byDay.get(k) || 0) + c);
      byCat.set(t.category, (byCat.get(t.category) || 0) + c);
      pt[t.purchase_type || 'unmarked'] += c;
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
    const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
    draw('c-cat', { type: 'bar', data: { labels: cats.map(c => c[0]), datasets: [{ data: cats.map(c => c[1] / 100), backgroundColor: accent, borderRadius: 6 }] },
      options: { ...base, indexAxis: 'y', scales: { x: { beginAtZero: true, ticks: { color: mute }, grid: { color: line } },
        y: { ticks: { color: mute }, grid: { display: false } } } } });

    const box = $('#ptypes');
    box.replaceChildren();
    [['need', 'Need'], ['want', 'Want'], ['impulse', 'Impulse'], ['unmarked', 'Not marked']].forEach(([k, label]) => {
      const r = el('li', 'row'), l = el('div', 'l');
      l.append(el('b', '', label), el('span', '', (tot ? Math.round(pt[k] * 100 / tot) : 0) + '% of spending'));
      r.append(l, el('span', 'amt', money(pt[k])));
      box.append(r);
    });
  }
  document.querySelectorAll('#v-stats .segs button').forEach(b => b.addEventListener('click', () => {
    S.range = Number(b.dataset.days);
    document.querySelectorAll('#v-stats .segs button').forEach(x => x.classList.toggle('on', x === b));
    renderStats();
  }));

  renderChips();
  refreshWhen();
  sb.auth.getSession().then(({ data }) => route(data.session));
})();