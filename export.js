// PDF export. Builds the transaction history as a PDF, organized by week. English only.
// The PDF libraries and the font load only when the user asks for a PDF, so the app stays light.
(() => {
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MODES = {
    all: { label: 'All time', slug: 'all-time' },
    month: { label: 'Latest month', slug: 'latest-month' },
    week: { label: 'Latest week', slug: 'latest-week' }
  };

  // ---------- Dates and money ----------
  const pad = n => String(n).padStart(2, '0');
  const day0 = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const weekStart = d => addDays(d, -((d.getDay() + 6) % 7)); // weeks run Monday to Sunday, like the budget
  const short = d => MON[d.getMonth()] + ' ' + d.getDate();
  const range = (a, b) => a.getFullYear() === b.getFullYear()
    ? short(a) + ' \u2013 ' + short(b) + ', ' + b.getFullYear()
    : short(a) + ', ' + a.getFullYear() + ' \u2013 ' + short(b) + ', ' + b.getFullYear();
  const stamp = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const cents = n => Math.round(Number(n) * 100);
  const fmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const num = c => fmt.format(Math.abs(c) / 100);
  const signed = c => (c < 0 ? '-' : c > 0 ? '+' : '') + num(c);
  const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : '');

  // ---------- Planning: which period, which weeks ----------
  function pickPeriod(mode, list, startDay, now) {
    if (mode === 'week') {
      const from = weekStart(day0(now));
      return { from, to: addDays(from, 7) };
    }
    if (mode === 'month') {
      let m = now.getMonth();
      if (now.getDate() < startDay) m--;
      return { from: new Date(now.getFullYear(), m, startDay), to: new Date(now.getFullYear(), m + 1, startDay) };
    }
    const first = list[0].d, last = list[list.length - 1].d;
    return { from: weekStart(day0(first)), to: addDays(weekStart(day0(last)), 7) };
  }

  // Groups transactions by Monday-to-Sunday week. Weeks with no transactions stay in, so the numbering is honest.
  function planWeeks(list, from, to) {
    const buckets = new Map();
    list.forEach(t => {
      const k = weekStart(day0(t.d)).getTime();
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(t);
    });
    const weeks = [];
    for (let ws = weekStart(from); ws < to; ws = addDays(ws, 7)) {
      const end = addDays(ws, 7);
      const a = ws < from ? from : ws;
      const b = addDays(end < to ? end : to, -1);
      weeks.push({ n: weeks.length + 1, a, b, items: buckets.get(ws.getTime()) || [] });
    }
    return weeks;
  }

  const totalsOf = items => items.reduce((o, t) => {
    if (t.type === 'income') o.income += t.c; else o.spent += t.c;
    return o;
  }, { income: 0, spent: 0 });

  // ---------- The PDF itself ----------
  // jsPDF: the jsPDF class (with the autoTable plugin attached). fonts: { regular, bold } as base64 TTF.
  function buildPdf(jsPDF, fonts, o) {
    const now = o.now || new Date();
    const info = MODES[o.mode];
    const all = o.tx.map(t => ({ ...t, d: new Date(t.transaction_date), c: cents(t.amount) }))
      .filter(t => !isNaN(t.d)).sort((a, b) => a.d - b.d);
    if (!all.length) return null;

    const p = pickPeriod(o.mode, all, o.startDay || 1, now);
    const list = o.mode === 'all' ? all : all.filter(t => t.d >= p.from && t.d < p.to);
    if (!list.length) return null;
    const weeks = planWeeks(list, p.from, p.to);
    const sum = totalsOf(list);

    const W = 297, H = 210, M = 14, FONT = 'LiberationSans';
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    doc.addFileToVFS('LiberationSans-Regular.ttf', fonts.regular);
    doc.addFont('LiberationSans-Regular.ttf', FONT, 'normal');
    doc.addFileToVFS('LiberationSans-Bold.ttf', fonts.bold);
    doc.addFont('LiberationSans-Bold.ttf', FONT, 'bold');
    doc.setProperties({ title: 'Metron transaction history', subject: info.label, creator: 'Metron' });

    const ink = [29, 29, 31], mute = [110, 110, 115], green = [36, 138, 61], red = [215, 0, 21];
    const text = (s, x, y, size, style, color, opt) => {
      doc.setFont(FONT, style || 'normal');
      doc.setFontSize(size);
      doc.setTextColor(...(color || ink));
      doc.text(String(s), x, y, opt);
    };

    // Header
    const shown = o.mode === 'all' ? { a: list[0].d, b: list[list.length - 1].d } : { a: p.from, b: addDays(p.to, -1) };
    text('Transaction history', M, 20, 22, 'bold');
    text(info.label + '   \u00B7   ' + range(shown.a, shown.b), M, 27.5, 11, 'normal', mute);
    if (o.name) text(o.name, W - M, 18, 11, 'bold', ink, { align: 'right' });
    text('Generated ' + short(now) + ', ' + now.getFullYear(), W - M, 24, 9, 'normal', mute, { align: 'right' });
    text('All amounts in ' + (o.currency || 'TRY'), W - M, 29, 9, 'normal', mute, { align: 'right' });

    // Saved money note: savings are blocked, so they are not part of the balance or the limits.
    const saved = (o.savings || []).filter(x => x[1] > 0);
    let top = 36;
    if (saved.length) {
      const total = saved.reduce((a, x) => a + x[1], 0);
      doc.setFillColor(232, 242, 253);
      doc.roundedRect(M, top, W - 2 * M, 21, 2.5, 2.5, 'F');
      text(num(total) + ' ' + (o.currency || 'TRY') + ' is saved and blocked', M + 4, top + 6.5, 10.5, 'bold', [0, 90, 190]);
      text(saved.map(x => num(x[1]) + ' in ' + x[0]).join('     \u00B7     '), M + 4, top + 12.5, 9.5, 'normal', ink);
      text('This money is not part of your balance and does not count toward your weekly or monthly limits.', M + 4, top + 17.8, 8.5, 'normal', mute);
      top += 27;
    }

    // Summary boxes
    const net = sum.income - sum.spent;
    const boxes = [
      ['Weeks', String(weeks.length), ink],
      ['Transactions', String(list.length), ink],
      ['Income', '+' + num(sum.income), green],
      ['Spent', '-' + num(sum.spent), red],
      ['Net', signed(net), net < 0 ? red : net > 0 ? green : ink]
    ];
    const gap = 4, bw = (W - 2 * M - gap * (boxes.length - 1)) / boxes.length;
    boxes.forEach((b, i) => {
      const x = M + i * (bw + gap);
      doc.setFillColor(245, 245, 247);
      doc.roundedRect(x, top, bw, 18, 2.5, 2.5, 'F');
      text(b[0], x + 4, top + 6.5, 8.5, 'normal', mute);
      text(b[1], x + 4, top + 14, 14, 'bold', b[2]);
    });

    // Weeks
    let y = top + 26;
    const bottom = H - 16;
    weeks.forEach(w => {
      if (y + 40 > bottom) { doc.addPage(); y = 16; }
      const t = totalsOf(w.items);
      doc.setFillColor(236, 236, 240);
      doc.roundedRect(M, y, W - 2 * M, 10, 2, 2, 'F');
      text('Week ' + w.n, M + 4, y + 6.6, 11, 'bold');
      text(range(w.a, w.b), M + 4 + doc.getTextWidth('Week ' + w.n) + 4, y + 6.6, 10, 'normal', mute);
      const right = w.items.length
        ? 'Spent ' + num(t.spent) + '     Income ' + num(t.income) + '     Net ' + signed(t.income - t.spent)
          + '     \u00B7     ' + w.items.length + (w.items.length === 1 ? ' transaction' : ' transactions')
        : 'No transactions';
      text(right, W - M - 4, y + 6.6, 9, 'normal', mute, { align: 'right' });

      if (!w.items.length) { y += 16; return; }

      const body = w.items.map(x => {
        const out = x.type === 'expense';
        return [
          DOW[x.d.getDay()] + ' ' + x.d.getDate() + ' ' + MON[x.d.getMonth()] + ', ' + pad(x.d.getHours()) + ':' + pad(x.d.getMinutes()),
          x.description || '-',
          x.category || '-',
          x.payment_method || '-',
          cap(x.purchase_type) || '-',
          x.reason || '-',
          out && x.outside_limits ? 'Not counted' : '-',
          (out ? '-' : '+') + num(x.c)
        ];
      });
      doc.autoTable({
        startY: y + 12,
        margin: { left: M, right: M, top: 16, bottom: 16 },
        head: [['Date', 'Description', 'Category', 'Payment', 'Type', 'Reason', 'Limits', 'Amount']],
        body,
        theme: 'grid',
        showHead: 'everyPage',
        rowPageBreak: 'avoid',
        styles: { font: FONT, fontSize: 8.5, cellPadding: { top: 2.2, bottom: 2.2, left: 2.5, right: 2.5 }, textColor: ink,
          lineColor: [226, 226, 231], lineWidth: 0.15, overflow: 'linebreak', valign: 'middle' },
        headStyles: { fillColor: [58, 58, 60], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
        alternateRowStyles: { fillColor: [250, 250, 252] },
        columnStyles: {
          0: { cellWidth: 36 }, 1: { cellWidth: 46 }, 2: { cellWidth: 38 }, 3: { cellWidth: 30 },
          4: { cellWidth: 20 }, 5: { cellWidth: 'auto' }, 6: { cellWidth: 23 },
          7: { cellWidth: 28, halign: 'right', fontStyle: 'bold' }
        },
        didParseCell: d => {
          if (d.section === 'body' && d.column.index === 7) {
            d.cell.styles.textColor = w.items[d.row.index].type === 'income' ? green : red;
          }
        }
      });
      y = doc.lastAutoTable.finalY + 9;
    });

    // Footer on every page
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setDrawColor(226, 226, 231);
      doc.setLineWidth(0.2);
      doc.line(M, H - 12, W - M, H - 12);
      text('Metron', M, H - 7.5, 8, 'normal', mute);
      text('Page ' + i + ' of ' + pages, W - M, H - 7.5, 8, 'normal', mute, { align: 'right' });
    }
    return { doc, count: list.length, weeks: weeks.length, filename: 'Metron-' + info.slug + '-' + stamp(now) + '.pdf' };
  }

  if (typeof module !== 'undefined') module.exports = { buildPdf, pickPeriod, planWeeks, MODES };
  if (typeof document === 'undefined') return;

  // ---------- Screen: Settings > Export ----------
  const LIBS = [
    'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js',
    'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js'
  ];
  const loaded = {};
  const loadScript = src => loaded[src] || (loaded[src] = new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = ok;
    s.onerror = () => { delete loaded[src]; fail(new Error('Could not load ' + src)); };
    document.head.append(s);
  }));

  async function loadTools() {
    await loadScript(LIBS[0]);
    await loadScript(LIBS[1]); // the plugin needs jsPDF to exist first
    await loadScript('pdf-fonts.js');
    return window.jspdf.jsPDF;
  }

  // The app keeps only the latest 1000 transactions in memory, so read the full history for the PDF.
  async function fetchAll() {
    const out = [], step = 1000;
    for (let from = 0; ; from += step) {
      const r = await window.sb.from('transactions').select('*')
        .order('transaction_date', { ascending: true }).range(from, from + step - 1);
      if (r.error) throw r.error;
      out.push(...r.data);
      if (r.data.length < step) break;
    }
    return out;
  }

  // What is saved right now, per card. Same numbers as the Savings tab.
  function savedNow() {
    const api = window.MetronSavings;
    if (!api) return [];
    const b = api.balances();
    return [['Ziraat card', b.ziraat], ['Vak\u0131fbank card', b.vakif], ['Cash', b.cash]];
  }

  async function deliver(result) {
    const blob = result.doc.output('blob');
    const file = new File([blob], result.filename, { type: 'application/pdf' });
    const touch = window.matchMedia('(pointer: coarse)').matches;
    if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: result.filename }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; /* otherwise fall back to a download */ }
    }
    result.doc.save(result.filename);
  }

  const list = document.querySelector('#ex-list');
  if (!list) return;
  const ICON = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/></svg>';
  const SUB = {
    all: 'Every week since your first transaction',
    month: 'Your current budget month, week by week',
    week: 'This week, Monday to Sunday'
  };
  let busy = false;

  Object.keys(MODES).forEach(mode => {
    const li = document.createElement('li');
    li.className = 'row exrow';
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.mode = mode;
    b.innerHTML = '<span class="l"><b></b><span></span></span>' + ICON;
    b.querySelector('b').textContent = MODES[mode].label;
    b.querySelector('.l span').textContent = SUB[mode];
    b.addEventListener('click', () => run(mode, b));
    li.append(b);
    list.append(li);
  });

  async function run(mode, btn) {
    const M = window.Metron;
    if (busy) return;
    busy = true;
    document.querySelectorAll('#ex-list button').forEach(x => { x.disabled = true; });
    const sub = btn.querySelector('.l span');
    sub.textContent = 'Creating your PDF...';
    try {
      const [jsPDF, tx] = await Promise.all([loadTools(), fetchAll()]);
      const result = buildPdf(jsPDF, window.MetronPdfFonts, {
        mode, tx, startDay: M.S.startDay, currency: M.S.currency,
        name: (document.querySelector('#who') || {}).textContent || '',
        savings: savedNow()
      });
      if (!result) { M.toast('No transactions in this period.', true); return; }
      await deliver(result);
      M.toast('PDF ready: ' + result.count + (result.count === 1 ? ' transaction' : ' transactions') + '.');
    } catch (e) {
      console.error(e);
      M.toast('Could not create the PDF. Check your connection and try again.', true, 4000);
    } finally {
      sub.textContent = SUB[mode];
      document.querySelectorAll('#ex-list button').forEach(x => { x.disabled = false; });
      busy = false;
    }
  }
})();