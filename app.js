'use strict';
(() => {
  const VERSION = '1.1.1';
  const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  const PAGE = 50;

  /* ───────── أدوات عامة ───────── */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => Number(n).toLocaleString('en-US');
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const store = {
    get: k => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* تجاهل */ } }
  };

  // توحيد النص العربي للبحث
  function norm(s) {
    return String(s ?? '')
      .replace(/[\u064B-\u0652\u0640]/g, '')
      .replace(/[إأآٱ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 1632))
      .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 1776))
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /* ───────── نموذج البيانات ───────── */
  const FIELDS = ['serial', 'name', 'program', 'acadNo', 'gender', 'spec', 'batch', 'gpa', 'grade', 'year', 'certNo', 'workplace', 'job', 'phone', 'notes', 'demo'];
  const LABELS = { serial: 'م', name: 'الاسم', program: 'البرنامج', acadNo: 'الرقم الأكاديمي', gender: 'الجنس', spec: 'التخصص', batch: 'الدفعة', gpa: 'المعدل', grade: 'التقدير', year: 'عام التخرج', certNo: 'رقم الشهادة', workplace: 'جهة العمل', job: 'الوظيفة', phone: 'رقم الهاتف', notes: 'ملاحظات' };
  const EXPORT_COLS = FIELDS.filter(f => f !== 'demo');
  const ALIASES = {
    serial: ['م', '#', 'serial', 'تسلسل'],
    name: ['الاسم', 'الاسم الرباعي', 'الاسم الكامل', 'name', 'full name'],
    program: ['البرنامج', 'program'],
    acadNo: ['الرقم الاكاديمي', 'رقم اكاديمي', 'الرقم الجامعي', 'acadno', 'academic'],
    gender: ['الجنس', 'gender', 'sex'],
    spec: ['التخصص', 'القسم', 'spec', 'specialization'],
    batch: ['الدفعه', 'batch'],
    gpa: ['المعدل', 'gpa', 'avg'],
    grade: ['التقدير', 'grade'],
    year: ['عام التخرج', 'عام التخر', 'سنه التخرج', 'year', 'graduation year'],
    certNo: ['رقم الشهاده', 'certno', 'certificate'],
    workplace: ['جهه العمل', 'مكان العمل', 'workplace', 'employer'],
    job: ['الوظيفه', 'الوظيفه الحاليه', 'job'],
    phone: ['رقم التلفون', 'رقم الهاتف', 'التلفون', 'الهاتف', 'الجوال', 'phone'],
    notes: ['ملاحظات', 'ملاحظه', 'notes']
  };
  const FLAGS = {
    noAcad: 'بدون رقم أكاديمي',
    noCert: 'بدون رقم شهادة',
    dupAcad: 'رقم أكاديمي مكرر',
    dupName: 'اسم متطابق مع سجل آخر',
    grade: 'التقدير لا يطابق المعدل',
    noGpa: 'بدون معدل',
    verify: 'ملاحظة تطلب التأكد'
  };
  const FLAG_HINT = {
    noAcad: 'سجلات لا تحمل رقماً أكاديمياً',
    noCert: 'سجلات ناقصة رقم الشهادة',
    dupAcad: 'أكثر من سجل بالرقم الأكاديمي نفسه',
    dupName: 'قد تكون تكراراً أو تشابه أسماء',
    grade: 'يُقارن المعدل بسلّم التقدير: 90+ ممتاز، 80+ جيد جداً، 65+ جيد، 50+ مقبول',
    noGpa: 'سجلات ليس فيها معدل',
    verify: 'ملاحظاتها تحتوي «التأكد» أو «مكرر»'
  };

  function expectedGrade(g) {
    if (g == null) return '';
    if (g >= 90) return 'ممتاز';
    if (g >= 80) return 'جيد جداً';
    if (g >= 65) return 'جيد';
    if (g >= 50) return 'مقبول';
    return 'راسب';
  }

  const ORD = [
    ['الاولي'], ['الثانيه'], ['الثالثه', 'ثالث'], ['الرابعه'], ['الخامسه'], ['السادسه'], ['السابعه'], ['الثامنه'], ['التاسعه'], ['العاشره'],
    ['الحاديه عشر', 'الحادي عشر'], ['الثانيه عشر'], ['الثالثه عشر'], ['الرابعه عشر'], ['الخامسه عشر'], ['السادسه عشر'], ['السابعه عشر'],
    ['الثامنه عشر', 'ثمانيه عشر'], ['التاسعه عشر', 'تسعه عشر'], ['العشرون', 'عشرون'],
    ['الحاديه والعشرون', 'الحادي والعشرون', 'الواحد والعشرون', 'واحد وعشرون'],
    ['الثانيه والعشرون', 'اثنان وعشرون'], ['الثالثه والعشرون', 'ثلاثه وعشرون'], ['الرابعه والعشرون', 'اربعه وعشرون'],
    ['الخامسه والعشرون', 'خمسه وعشرون'], ['سته وعشرون', 'السادسه والعشرون']
  ];
  function batchKey(b) {
    const n = norm(b);
    let best = -1, len = 0;
    ORD.forEach((alts, i) => alts.forEach(a => { if (n.includes(a) && a.length > len) { best = i; len = a.length; } }));
    const suffix = /تصفيه/.test(n) ? 1 : /مستشفيات/.test(n) ? 2 : 0;
    return (best < 0 ? 99 : best + 1) * 10 + suffix;
  }

  /* ───────── قاعدة البيانات المحلية (IndexedDB) ───────── */
  const DB_NAME = 'nias-alumni', STORE = 'alumni';
  let dbp;
  function openDB() {
    return dbp || (dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true }); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
  }
  async function tx(mode, fn) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const t = db.transaction(STORE, mode);
      const s = t.objectStore(STORE);
      let out;
      try { out = fn(s); } catch (e) { rej(e); return; }
      t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }
  const dbAll = () => tx('readonly', s => s.getAll());
  const dbPut = rec => tx('readwrite', s => s.put(rec));
  const dbDelete = ids => tx('readwrite', s => { [].concat(ids).forEach(id => s.delete(id)); });
  const dbClear = () => tx('readwrite', s => { s.clear(); });

  // ✅ إصلاح: حذف id قبل الإضافة لتفادي ConstraintError
  const dbAdd = recs => tx('readwrite', s => {
    recs.forEach(r => {
      const copy = { ...r };
      delete copy.id;
      s.add(copy);
    });
  });

  const pick = r => { const o = {}; FIELDS.forEach(f => { if (r[f] !== undefined) o[f] = r[f]; }); if (r.id != null) o.id = r.id; return o; };

  /* ───────── الحالة ───────── */
  let ALL = [];
  let FILTERED = [];
  const S = { q: '', spec: '', batch: '', gender: '', grade: '', year: '', work: '', flag: '', sort: 'serial', page: 1, tab: 'records' };

  function decorate(r) {
    r._q = norm([r.name, r.acadNo, r.certNo, r.workplace, r.job, r.phone, r.notes, r.spec, r.batch].join(' '));
    r._n = norm(r.name);
    r._b = batchKey(r.batch);
    r._f = [];
    return r;
  }

  function analyze() {
    const acad = new Map(), names = new Map();
    const push = (m, k, r) => { let a = m.get(k); if (!a) { a = []; m.set(k, a); } a.push(r); };
    for (const r of ALL) {
      r._f = [];
      if (r.acadNo) push(acad, r.acadNo, r);
      if (r._n) push(names, r._n, r);
    }
    for (const r of ALL) {
      if (!r.acadNo) r._f.push('noAcad');
      else if (acad.get(r.acadNo).length > 1) r._f.push('dupAcad');
      if (!r.certNo) r._f.push('noCert');
      if (r._n && names.get(r._n).length > 1) r._f.push('dupName');
      if (r.gpa == null) r._f.push('noGpa');
      else if (r.grade && expectedGrade(r.gpa) !== r.grade) r._f.push('grade');
      if (/التأكد|التاكد|مكرر/.test(norm(r.notes) + ' ' + String(r.notes || ''))) r._f.push('verify');
    }
  }

  async function reload() {
    ALL = (await dbAll()).map(decorate);
    analyze();
    renderAll();
  }

  /* ───────── تنظيف القيم ───────── */
  const toNum = v => { const n = parseFloat(norm(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
  const toInt = v => { const n = toNum(v); return n == null ? null : Math.round(n); };
  const cleanId = v => String(v ?? '').trim().replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 1632)).replace(/\.0+$/, '');
  function normGender(g) {
    const n = norm(g);
    if (!n) return '';
    if (/^(ذكر|ذ|male|m)$/.test(n)) return 'ذكر';
    if (/^(انثي|انثى|f|female)$/.test(n)) return 'أنثى';
    return String(g).trim();
  }
  function normGrade(g) {
    const n = norm(g).replace(/[\/\\]+/g, '').trim();
    if (!n) return '';
    if (n.startsWith('ممتاز')) return 'ممتاز';
    if (/^جيد جد/.test(n)) return 'جيد جداً';
    if (n.startsWith('جيد')) return 'جيد';
    if (n.startsWith('مقبول')) return 'مقبول';
    if (/^(راسب|ضعيف)/.test(n)) return 'راسب';
    return String(g).trim();
  }
  function cleanRec(o) {
    const r = {};
    for (const f of EXPORT_COLS) r[f] = o[f] == null ? '' : String(o[f]).trim();
    r.acadNo = cleanId(r.acadNo);
    r.certNo = cleanId(r.certNo);
    r.gender = normGender(r.gender);
    r.grade = normGrade(r.grade);
    r.gpa = toNum(r.gpa);
    r.year = toInt(r.year);
    r.serial = toInt(r.serial);
    r.program = r.program || 'دبلوم';
    return r;
  }

  /* ───────── قراءة الملفات ───────── */
  function parseCSV(text) {
    text = text.replace(/^\uFEFF/, '');
    const first = text.split(/\r?\n/, 1)[0] || '';
    const delim = [',', ';', '\t'].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = [];
    let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); cur = '';
        if (row.some(x => x !== '')) rows.push(row);
        row = [];
      } else cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); if (row.some(x => x !== '')) rows.push(row); }
    return rows;
  }

  function jsonToRows(j) {
    const arr = Array.isArray(j) ? j : (j.records || j.data || []);
    if (!Array.isArray(arr) || !arr.length) return [];
    const keys = [...new Set(arr.flatMap(o => Object.keys(o || {})))];
    return [keys, ...arr.map(o => keys.map(k => o[k]))];
  }

  function mapHeaders(row) {
    const map = new Array(row.length).fill(null);
    const used = new Set();
    const heads = row.map(h => norm(h));
    heads.forEach((h, i) => {
      if (!h) return;
      for (const f of EXPORT_COLS) {
        if (used.has(f)) continue;
        const names = [norm(LABELS[f]), norm(f), ...ALIASES[f].map(norm)];
        if (names.includes(h)) { map[i] = f; used.add(f); break; }
      }
    });
    heads.forEach((h, i) => {
      if (!h || map[i]) return;
      for (const f of EXPORT_COLS) {
        if (used.has(f)) continue;
        if (ALIASES[f].map(norm).some(a => a.length >= 5 && h.includes(a))) { map[i] = f; used.add(f); break; }
      }
    });
    return map;
  }

  function tableToRecs(rows) {
    let hi = -1, map = null;
    for (let i = 0; i < Math.min(10, rows.length); i++) {
      const m = mapHeaders(rows[i]);
      if (m.filter(Boolean).length >= 2 && m.includes('name')) { hi = i; map = m; break; }
    }
    if (hi < 0) return { recs: [], bad: 0 };
    const recs = []; let bad = 0;
    for (const row of rows.slice(hi + 1)) {
      const o = {};
      map.forEach((f, i) => { if (f) o[f] = row[i]; });
      if (!String(o.name ?? '').trim()) { if (row.some(x => String(x ?? '').trim())) bad++; continue; }
      recs.push(cleanRec(o));
    }
    return { recs, bad };
  }

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('offline'));
      document.head.appendChild(s);
    });
  }
  async function needXLSX() {
    if (window.XLSX) return window.XLSX;
    await loadScript(XLSX_URL);
    return window.XLSX;
  }

  async function readFileTables(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.json')) {
      const txt = await file.text();
      let j;
      try { j = JSON.parse(txt); } catch { throw new Error('JSON غير صالح'); }
      return [jsonToRows(j)];
    }
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      const X = await needXLSX();
      const wb = X.read(await file.arrayBuffer(), { type: 'array' });
      return wb.SheetNames.map(n => X.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' }));
    }
    return [parseCSV(await file.text())];
  }

  /* ───────── التصفية والترتيب ───────── */
  const SORTS = {
    serial: (a, b) => (a.serial ?? 1e9) - (b.serial ?? 1e9) || a.id - b.id,
    name: (a, b) => a.name.localeCompare(b.name, 'ar'),
    yearDesc: (a, b) => (b.year ?? 0) - (a.year ?? 0),
    yearAsc: (a, b) => (a.year ?? 1e9) - (b.year ?? 1e9),
    gpaDesc: (a, b) => (b.gpa ?? -1) - (a.gpa ?? -1),
    batch: (a, b) => a._b - b._b
  };
  function apply() {
    const toks = norm(S.q).split(' ').filter(Boolean);
    const L = ALL.filter(r => {
      if (S.spec && r.spec !== S.spec) return false;
      if (S.batch && r.batch !== S.batch) return false;
      if (S.gender && r.gender !== S.gender) return false;
      if (S.grade && r.grade !== S.grade) return false;
      if (S.year && String(r.year) !== S.year) return false;
      if (S.work === 'yes' && !(r.workplace || r.job)) return false;
      if (S.work === 'no' && (r.workplace || r.job)) return false;
      if (S.flag && !r._f.includes(S.flag)) return false;
      for (const t of toks) if (!r._q.includes(t)) return false;
      return true;
    });
    L.sort(SORTS[S.sort] || SORTS.serial);
    return L;
  }

  /* ───────── العرض: السجل ───────── */
  const gradeCls = g => ({ 'ممتاز': 'gx', 'جيد جداً': 'gv', 'جيد': 'gg', 'مقبول': 'ga', 'راسب': 'gf' }[g] || 'ga');
  function rowHTML(r) {
    const batch = r.batch ? 'الدفعة ' + r.batch.replace(/^الدفعة\s*/, '') : '';
    const sub = [r.spec, batch, r.year].filter(Boolean).join('، ');
    const work = [r.job, r.workplace].filter(Boolean).join(' — ');
    const flag = r._f.length ? `<span class="flag" title="${esc(r._f.map(f => FLAGS[f]).join('، '))}" aria-label="ملاحظات على البيانات">!</span>` : '';
    return `<button class="row" data-id="${r.id}">
      <span class="sn">${esc(r.serial ?? '')}</span>
      <span class="main"><b class="nm">${esc(r.name)}${flag}</b><span class="sub">${esc(sub)}</span>${work ? `<span class="work">${esc(work)}</span>` : ''}</span>
      <span class="gr ${gradeCls(r.grade)}"><i>${r.gpa ?? '–'}</i><small>${esc(r.grade || '—')}</small></span>
    </button>`;
  }

  const SEL = { spec: 'fSpec', batch: 'fBatch', year: 'fYear', grade: 'fGrade', gender: 'fGender', work: 'fWork' };
  function fillOptions(id, vals, label) {
    const el = document.getElementById(id);
    const cur = el.value;
    el.innerHTML = `<option value="">${label}</option>` + vals.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    el.value = vals.map(String).includes(cur) ? cur : '';
    return el.value;
  }
  const uniq = key => [...new Set(ALL.map(r => r[key]).filter(v => v !== '' && v != null))];
  function fillSelects() {
    S.spec = fillOptions('fSpec', uniq('spec').sort((a, b) => a.localeCompare(b, 'ar')), 'الكل');
    const batches = uniq('batch').sort((a, b) => batchKey(a) - batchKey(b));
    S.batch = fillOptions('fBatch', batches, 'الكل');
    S.year = fillOptions('fYear', uniq('year').sort((a, b) => b - a).map(String), 'الكل');
    const grades = ['ممتاز', 'جيد جداً', 'جيد', 'مقبول', 'راسب'].filter(g => uniq('grade').includes(g));
    S.grade = fillOptions('fGrade', grades, 'الكل');
    $('#dlSpec').innerHTML = uniq('spec').map(v => `<option value="${esc(v)}">`).join('');
    $('#dlBatch').innerHTML = batches.map(v => `<option value="${esc(v)}">`).join('');
  }

  const CHIP = { spec: v => v, batch: v => 'الدفعة ' + v, year: v => 'عام ' + v, grade: v => v, gender: v => v, work: v => v === 'yes' ? 'لديه جهة عمل' : 'بدون جهة عمل', flag: v => FLAGS[v] };

  function renderList() {
    FILTERED = apply();
    const total = FILTERED.length;
    const pages = Math.max(1, Math.ceil(total / PAGE));
    S.page = Math.min(Math.max(1, S.page), pages);
    const from = (S.page - 1) * PAGE;
    const slice = FILTERED.slice(from, from + PAGE);
    const list = $('#list');

    $('#chips').innerHTML = Object.keys(CHIP).filter(k => S[k]).map(k => `<button class="chip" data-clear="${k}">${esc(CHIP[k](S[k]))} ✕</button>`).join('');

    if (!ALL.length) {
      $('#count').textContent = '';
      list.innerHTML = `<div class="empty"><h3>السجل فارغ</h3><p>استورد ملف الخريجين (Excel أو CSV) أو أضف أول خريج. يمكنك أيضاً تجربة التطبيق ببيانات وهمية.</p>
        <div class="btns"><button class="primary" data-act="import">استيراد ملف</button><button class="ghost" data-act="add">إضافة خريج</button><button class="ghost" data-act="sample">بيانات تجريبية</button></div></div>`;
      $('#pager').innerHTML = '';
      return;
    }
    $('#count').textContent = total === ALL.length ? `${fmt(total)} خريج` : `${fmt(total)} من ${fmt(ALL.length)} خريج`;
    if (!total) {
      list.innerHTML = `<div class="empty"><h3>لا توجد نتائج</h3><p>جرّب كلمات أقل أو أزل بعض عوامل التصفية.</p><div class="btns"><button class="ghost" data-act="reset">مسح البحث والتصفية</button></div></div>`;
      $('#pager').innerHTML = '';
      return;
    }
    list.innerHTML = slice.map(rowHTML).join('');
    $('#pager').innerHTML = pages > 1
      ? `<button class="ghost" data-page="${S.page - 1}" ${S.page === 1 ? 'disabled' : ''}>السابق</button>
         <span>${fmt(from + 1)}–${fmt(from + slice.length)} من ${fmt(total)}</span>
         <button class="ghost" data-page="${S.page + 1}" ${S.page === pages ? 'disabled' : ''}>التالي</button>`
      : '';
  }

  function setFilter(k, v) {
    S[k] = v;
    const id = SEL[k];
    if (id) {
      const el = document.getElementById(id);
      if (v && ![...el.options].some(o => o.value === v)) el.add(new Option(v, v));
      el.value = v;
    }
    S.page = 1;
  }
  function resetFilters() {
    ['spec', 'batch', 'year', 'grade', 'gender', 'work', 'flag'].forEach(k => setFilter(k, ''));
    S.q = ''; $('#q').value = '';
  }

  /* ───────── العرض: الإحصاءات ───────── */
  function tally(list, key) {
    const m = new Map();
    list.forEach(r => { const k = r[key]; if (k !== '' && k != null) m.set(k, (m.get(k) || 0) + 1); });
    return [...m.entries()];
  }
  function bars(title, entries, field, opt = {}) {
    if (!entries.length) return '';
    const max = opt.max || Math.max(1, ...entries.map(e => e[1]));
    return `<section class="card"><h3>${title}</h3>${entries.map(([k, v]) =>
      `<button class="bar" data-f="${field}" data-v="${esc(k)}"><span class="bk">${esc(k)}</span><span class="bt"><i style="width:${(v / max * 100).toFixed(1)}%"></i></span><span class="bv">${opt.fmtv ? opt.fmtv(v) : fmt(v)}</span></button>`).join('')}</section>`;
  }
  function renderStats() {
    const L = $('#statsFiltered').checked ? apply() : ALL;
    const body = $('#statsBody');
    if (!L.length) { body.innerHTML = '<div class="empty"><h3>لا توجد بيانات</h3><p>أضف سجلات أولاً لتظهر الإحصاءات.</p></div>'; return; }
    const n = L.length;
    const male = L.filter(r => r.gender === 'ذكر').length;
    const female = L.filter(r => r.gender === 'أنثى').length;
    const withGpa = L.filter(r => r.gpa != null);
    const avg = withGpa.length ? withGpa.reduce((a, r) => a + r.gpa, 0) / withGpa.length : null;
    const emp = L.filter(r => r.workplace || r.job).length;
    const pct = x => Math.round(x / n * 100) + '%';
    const gradeOrder = ['ممتاز', 'جيد جداً', 'جيد', 'مقبول', 'راسب'];

    const bySpec = tally(L, 'spec').sort((a, b) => b[1] - a[1]);
    const byYear = tally(L, 'year').sort((a, b) => a[0] - b[0]).map(([k, v]) => [String(k), v]);
    const byGrade = tally(L, 'grade').sort((a, b) => gradeOrder.indexOf(a[0]) - gradeOrder.indexOf(b[0]));
    const byBatch = tally(L, 'batch').sort((a, b) => batchKey(a[0]) - batchKey(b[0]));
    const gpaBySpec = bySpec.map(([s]) => {
      const xs = L.filter(r => r.spec === s && r.gpa != null);
      return [s, xs.length ? Math.round(xs.reduce((a, r) => a + r.gpa, 0) / xs.length * 10) / 10 : 0];
    }).filter(e => e[1] > 0);

    body.innerHTML = `
      <dl class="ledger">
        <div><dt>إجمالي الخريجين</dt><dd>${fmt(n)}</dd></div>
        <div><dt>متوسط المعدل</dt><dd>${avg == null ? '–' : avg.toFixed(1)}</dd></div>
        <div><dt>الذكور</dt><dd>${fmt(male)} <small>${pct(male)}</small></dd></div>
        <div><dt>الإناث</dt><dd>${fmt(female)} <small>${pct(female)}</small></dd></div>
        <div><dt>لديهم جهة عمل مسجلة</dt><dd>${fmt(emp)} <small>${pct(emp)}</small></dd></div>
        <div><dt>عدد التخصصات</dt><dd>${fmt(bySpec.length)}</dd></div>
      </dl>
      ${bars('الخريجون حسب التخصص', bySpec, 'spec')}
      ${bars('الخريجون حسب عام التخرج', byYear, 'year')}
      ${bars('التقديرات', byGrade, 'grade')}
      ${bars('متوسط المعدل حسب التخصص', gpaBySpec, 'spec', { max: 100, fmtv: v => v.toFixed(1) })}
      ${bars('الخريجون حسب الدفعة', byBatch, 'batch')}`;
  }

  /* ───────── العرض: تدقيق البيانات ───────── */
  function renderQuality() {
    const counts = {};
    Object.keys(FLAGS).forEach(k => counts[k] = 0);
    ALL.forEach(r => r._f.forEach(f => counts[f]++));
    const body = $('#qualityBody');
    if (!ALL.length) { body.innerHTML = '<div class="empty"><h3>لا توجد بيانات للتدقيق</h3></div>'; return; }
    body.innerHTML = Object.keys(FLAGS).map(k => {
      const c = counts[k];
      return `<button class="qrow ${c ? '' : 'ok'}" ${c ? `data-flag="${k}"` : 'disabled'}><span>${FLAGS[k]}<small>${FLAG_HINT[k]}</small></span><b>${c ? fmt(c) : '✓'}</b></button>`;
    }).join('');
  }

  function renderAbout() {
    const el = $('#about');
    el.textContent = `الإصدار ${VERSION} — ${fmt(ALL.length)} سجل على هذا الجهاز. على iPhone: زر المشاركة ثم «إضافة إلى الشاشة الرئيسية».`;
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then(e => {
        if (e.usage != null) el.textContent += ` المساحة المستخدمة ${(e.usage / 1048576).toFixed(1)} م.ب.`;
      }).catch(() => {});
    }
  }

  function renderAll() {
    fillSelects();
    renderList();
    renderQuality();
    renderAbout();
    if (S.tab === 'stats') renderStats();
  }

  /* ───────── التبويبات ───────── */
  function showTab(name) {
    S.tab = name;
    $$('.tab').forEach(s => s.hidden = s.id !== 'tab-' + name);
    $$('.tabs button').forEach(b => b.setAttribute('aria-current', b.dataset.tab === name ? 'page' : 'false'));
    $('#fab').hidden = name !== 'records';
    if (name === 'stats') renderStats();
    if (name === 'records') renderList();
    window.scrollTo({ top: 0 });
  }

  /* ───────── التنبيهات ───────── */
  let toastT;
  function toast(msg, actionLabel, fn) {
    const t = $('#toast');
    t.innerHTML = '';
    const s = document.createElement('span'); s.textContent = msg; t.append(s);
    if (actionLabel) {
      const b = document.createElement('button'); b.textContent = actionLabel;
      b.onclick = () => { t.classList.remove('show'); if (fn) fn(); };
      t.append(b);
    }
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), actionLabel ? 7000 : 4000);
  }

  /* ───────── نافذة التحرير ───────── */
  const dlg = $('#editor'), form = $('#form');
  let editing = null, gradeTouched = false;
  const nextSerial = () => ALL.reduce((m, r) => Math.max(m, r.serial || 0), 0) + 1;

  function openEditor(id) {
    editing = id ? ALL.find(r => r.id === id) : null;
    const r = editing || { program: 'دبلوم', serial: nextSerial() };
    for (const f of EXPORT_COLS) {
      const el = form.elements[f];
      if (!el) continue;
      if (el.tagName === 'SELECT') {
        [...el.options].filter(o => o.dataset.tmp).forEach(o => o.remove());
        const v = r[f] ?? '';
        if (v && ![...el.options].some(o => o.value === String(v))) { const o = new Option(v, v); o.dataset.tmp = '1'; el.add(o); }
      }
      el.value = r[f] ?? '';
    }
    gradeTouched = !!r.grade;
    $('#edTitle').textContent = editing ? 'تعديل بيانات خريج' : 'إضافة خريج';
    $('#edDelete').hidden = !editing;
    $('#edFlags').textContent = editing && editing._f.length ? 'ملاحظات على البيانات: ' + editing._f.map(f => FLAGS[f]).join('، ') : '';
    dlg.showModal();
    if (!editing) form.elements.name.focus();
  }

  async function saveEditor(e) {
    e.preventDefault();
    const v = n => form.elements[n].value.trim();
    if (!v('name')) { toast('الاسم مطلوب'); form.elements.name.focus(); return; }
    const gpa = toNum(v('gpa'));
    if (gpa != null && (gpa < 0 || gpa > 100)) { toast('المعدل يجب أن يكون بين 0 و100'); return; }
    const rec = editing ? pick(editing) : {};
    rec.name = v('name'); rec.acadNo = cleanId(v('acadNo')); rec.certNo = cleanId(v('certNo'));
    rec.gender = v('gender'); rec.spec = v('spec'); rec.batch = v('batch');
    rec.year = toInt(v('year')); rec.gpa = gpa; rec.grade = v('grade');
    rec.program = v('program') || 'دبلوم'; rec.serial = toInt(v('serial')) ?? nextSerial();
    rec.workplace = v('workplace'); rec.job = v('job'); rec.phone = v('phone'); rec.notes = v('notes');
    if (rec.acadNo && ALL.some(x => x.acadNo === rec.acadNo && x.id !== rec.id) &&
        !confirm('هذا الرقم الأكاديمي مستخدم في سجل آخر. هل تريد الحفظ على أي حال؟')) return;
    try {
      const key = await dbPut(rec);
      rec.id = rec.id ?? key;
      decorate(rec);
      const i = ALL.findIndex(x => x.id === rec.id);
      if (i >= 0) ALL[i] = rec; else ALL.push(rec);
      analyze();
      renderAll();
      dlg.close();
      toast(editing ? 'تم حفظ التعديلات' : 'تمت إضافة الخريج');
    } catch (err) {
      toast('تعذر الحفظ: ' + (err && err.message ? err.message : 'خطأ غير معروف'));
    }
  }

  async function deleteEditing() {
    if (!editing) return;
    const copy = pick(editing);
    await dbDelete(copy.id);
    ALL = ALL.filter(r => r.id !== copy.id);
    analyze(); renderAll(); dlg.close();
    toast('تم حذف السجل', 'تراجع', async () => {
      const c2 = { ...copy }; delete c2.id;
      await dbPut(c2);
      await reload();
    });
  }

  /* ───────── الاستيراد والتصدير ───────── */
  // ✅ إصلاح كامل لدالة doImport
  async function doImport() {
    const input = $('#file');
    const file = input.files && input.files[0];

    if (!file) {
      toast('اختر ملفاً أولاً من زر «اختيار ملف».');
      input.focus();
      input.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (file.size === 0) { toast('الملف فارغ.'); return; }
    if (file.size > 30 * 1024 * 1024) {
      if (!confirm('الملف كبير (' + (file.size / 1048576).toFixed(1) + ' م.ب). قد يستغرق وقتاً. متابعة؟')) return;
    }

    const btn = $('#btnImport');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'جارٍ الاستيراد…';

    try {
      // 1) قراءة الجداول
      let tables;
      try {
        tables = await readFileTables(file);
      } catch (readErr) {
        if (readErr && readErr.message === 'offline') {
          toast('ملفات Excel تحتاج اتصالاً بالإنترنت أول مرة. استخدم CSV أو اتصل بالإنترنت.');
        } else if (readErr && /JSON/.test(String(readErr.message))) {
          toast('ملف JSON غير صالح. تأكد من تنسيقه.');
        } else {
          toast('تعذرت قراءة الملف: ' + (readErr && readErr.message ? readErr.message : 'خطأ غير معروف'));
        }
        console.error('readFileTables:', readErr);
        return;
      }

      if (!Array.isArray(tables) || !tables.length) {
        toast('لم أجد أي جداول في الملف.'); return;
      }

      // 2) تحويل الجداول إلى سجلات
      let recs = [], bad = 0;
      for (const t of tables) {
        if (!Array.isArray(t) || !t.length) continue;
        const r = tableToRecs(t);
        recs.push(...r.recs);
        bad += r.bad;
      }

      if (!recs.length) {
        toast('لم أجد أعمدة مطابقة. تأكد أن الصف الأول يضم: الاسم، التخصص، المعدل…');
        return;
      }

      // 3) خيارات الاستيراد
      const replace = document.querySelector('input[name=imode]:checked')?.value === 'replace';
      if (replace && !confirm('سيتم حذف كل السجلات الحالية واستبدالها بمحتوى الملف. متابعة؟')) return;

      const base = replace ? [] : ALL;
      let dups = 0;

      if ($('#skipDup').checked) {
        const seen = new Set(base.filter(r => r.acadNo).map(r => r.acadNo));
        recs = recs.filter(r => {
          if (!r.acadNo) return true;
          if (seen.has(r.acadNo)) { dups++; return false; }
          seen.add(r.acadNo);
          return true;
        });
      }

      // 4) ترقيم تلقائي
      let s = base.reduce((m, r) => Math.max(m, r.serial || 0), 0);
      recs.forEach(r => { if (r.serial == null) r.serial = ++s; });

      // 5) الكتابة في قاعدة البيانات
      try {
        if (replace) await dbClear();
        await dbAdd(recs);
      } catch (dbErr) {
        console.error('dbAdd:', dbErr);
        toast('تعذر حفظ السجلات في التخزين: ' + (dbErr && dbErr.message ? dbErr.message : 'خطأ غير معروف'));
        return;
      }

      // 6) إعادة التحميل والعرض
      await reload();
      input.value = '';
      if (navigator.storage && navigator.storage.persist) {
        try { await navigator.storage.persist(); } catch { /* اختياري */ }
      }

      const parts = [`تم استيراد ${fmt(recs.length)} سجل`];
      if (dups) parts.push(`تخطي ${fmt(dups)} مكرر`);
      if (bad) parts.push(`تجاهل ${fmt(bad)} صفاً بلا اسم`);
      toast(parts.join('، '));
      showTab('records');

    } catch (err) {
      console.error('Import error:', err);
      toast('خطأ غير متوقع أثناء الاستيراد: ' + (err && err.message ? err.message : 'غير معروف'));
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  function download(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const stamp = () => new Date().toISOString().slice(0, 10);
  const safeCell = v => { const s = String(v ?? ''); return /^[=\-@]|^\+(?![\d\s])/.test(s) ? "'" + s : s; };
  const csvCell = v => '"' + safeCell(v).replace(/"/g, '""') + '"';
  const listForExport = () => { FILTERED = apply(); return FILTERED; };

  function exportCSV() {
    const L = listForExport();
    if (!L.length) { toast('لا توجد سجلات للتصدير'); return; }
    const lines = [EXPORT_COLS.map(f => csvCell(LABELS[f])).join(',')]
      .concat(L.map(r => EXPORT_COLS.map(f => csvCell(r[f])).join(',')));
    download(`graduates-${stamp()}.csv`, new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    toast(`تم تصدير ${fmt(L.length)} سجل`);
  }
  async function exportXLSX() {
    const L = listForExport();
    if (!L.length) { toast('لا توجد سجلات للتصدير'); return; }
    try {
      const X = await needXLSX();
      const ws = X.utils.aoa_to_sheet([EXPORT_COLS.map(f => LABELS[f])].concat(L.map(r => EXPORT_COLS.map(f => r[f] ?? ''))));
      const wb = X.utils.book_new();
      X.utils.book_append_sheet(wb, ws, 'الخريجون');
      wb.Workbook = { Views: [{ RTL: true }] };
      X.writeFile(wb, `graduates-${stamp()}.xlsx`);
      toast(`تم تصدير ${fmt(L.length)} سجل`);
    } catch {
      toast('تصدير Excel يحتاج اتصالاً بالإنترنت مرة واحدة. جرّب CSV الآن.');
    }
  }
  function exportJSON() {
    if (!ALL.length) { toast('لا توجد سجلات للنسخ الاحتياطي'); return; }
    const payload = { app: 'nias-alumni', version: VERSION, exportedAt: new Date().toISOString(), records: ALL.map(r => { const o = pick(r); delete o.id; return o; }) };
    download(`graduates-backup-${stamp()}.json`, new Blob([JSON.stringify(payload)], { type: 'application/json' }));
    toast('تم إنشاء النسخة الاحتياطية');
  }
  function downloadTemplate() {
    const head = EXPORT_COLS.map(f => csvCell(LABELS[f])).join(',');
    const ex = ['1', 'الاسم الرباعي', 'دبلوم', '1001', 'ذكر', 'محاسبة', 'الخامسة', '70', 'جيد', '2004', '1234', '', '', '', ''].map(csvCell).join(',');
    download('graduates-template.csv', new Blob(['\uFEFF' + head + '\r\n' + ex], { type: 'text/csv;charset=utf-8' }));
  }
  function printList() {
    const L = listForExport();
    if (!L.length) { toast('لا توجد سجلات للطباعة'); return; }
    if (L.length > 3000 && !confirm(`سيتم طباعة ${fmt(L.length)} سجل وقد يستغرق ذلك وقتاً. هل تريد المتابعة؟`)) return;
    const cols = ['serial', 'name', 'spec', 'batch', 'gpa', 'grade', 'year', 'certNo', 'workplace', 'job'];
    $('#print').innerHTML = `<h2>سجل خريجي المعهد الوطني للعلوم الإدارية — فرع إب</h2><p>${fmt(L.length)} سجل — ${stamp()}</p>
      <table><thead><tr>${cols.map(c => `<th>${LABELS[c]}</th>`).join('')}</tr></thead>
      <tbody>${L.map(r => `<tr>${cols.map(c => `<td>${esc(r[c] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    window.print();
  }
  window.addEventListener('afterprint', () => { $('#print').innerHTML = ''; });

  /* ───────── بيانات تجريبية ───────── */
  function makeSample() {
    let seed = 7;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const pk = a => a[Math.floor(rnd() * a.length)];
    const M = ['أحمد', 'محمد', 'علي', 'يوسف', 'خالد', 'عبدالله', 'صادق', 'هشام', 'نبيل', 'ياسر', 'عمار', 'ماجد'];
    const F = ['سارة', 'مريم', 'هدى', 'أسماء', 'رنا', 'فاطمة', 'نورا', 'آية', 'سلمى', 'ريم'];
    const MID = ['عبده', 'صالح', 'ناجي', 'قاسم', 'حسن', 'سعيد', 'أحمد', 'علي', 'محمد'];
    const FAM = ['الحداد', 'المقطري', 'العريقي', 'الشرعبي', 'النجار', 'الوصابي', 'القدسي', 'البعداني', 'السنباني', 'الحمادي'];
    const SP = ['حاسوب', 'محاسبة', 'إدارة', 'تسويق', 'إدارة مكاتب', 'إدارة موارد بشرية'];
    const BY = [['الأولى', 2000], ['الخامسة', 2004], ['الثامنة', 2007], ['العاشرة', 2009], ['الثالثة عشر', 2012], ['السابعة عشر', 2016], ['الحادية والعشرون', 2020], ['الثانية والعشرون', 2021]];
    const W = [['مكتب الصحة', 'مدير قسم'], ['مدارس أهلية', 'معلم'], ['بنك محلي', 'محاسب'], ['مكتب المالية', 'مسؤول حسابات'], ['شركة اتصالات', 'فني']];
    const out = [];
    for (let i = 0; i < 60; i++) {
      const female = rnd() < 0.42;
      const [b, y] = pk(BY);
      const gpa = Math.round(52 + rnd() * 40);
      const w = i % 6 === 2 ? pk(W) : ['', ''];
      out.push({
        serial: i + 1, name: `${pk(female ? F : M)} ${pk(MID)} ${pk(MID)} ${pk(FAM)}`, program: 'دبلوم',
        acadNo: String(i % 23 === 11 ? 1000 + i - 1 : 1000 + i), gender: female ? 'أنثى' : 'ذكر',
        spec: y >= 2020 && rnd() < 0.4 ? 'إدارة مستشفيات' : pk(SP), batch: b, gpa,
        grade: i % 29 === 13 ? 'ممتاز' : expectedGrade(gpa), year: y,
        certNo: i % 17 === 5 ? '' : String(100 + Math.floor(rnd() * 4000)),
        workplace: w[0], job: w[1], phone: '', notes: i % 19 === 7 ? 'مراجعة الشهادة' : '', demo: true
      });
    }
    return out;
  }

  /* ───────── الأحداث ───────── */
  $('#q').addEventListener('input', debounce(e => { S.q = e.target.value; S.page = 1; renderList(); }, 120));
  $('#btnFilters').addEventListener('click', e => {
    const box = $('#filters');
    box.hidden = !box.hidden;
    e.currentTarget.setAttribute('aria-expanded', String(!box.hidden));
  });
  Object.entries(SEL).forEach(([k, id]) => document.getElementById(id).addEventListener('change', e => { S[k] = e.target.value; S.page = 1; renderList(); }));
  $('#fSort').addEventListener('change', e => { S.sort = e.target.value; S.page = 1; renderList(); });
  $('#btnReset').addEventListener('click', () => { resetFilters(); renderList(); });
  $('#statsFiltered').addEventListener('change', renderStats);
  $('#fab').addEventListener('click', () => openEditor());
  $('#edClose').addEventListener('click', () => dlg.close());
  $('#edDelete').addEventListener('click', deleteEditing);
  form.addEventListener('submit', saveEditor);
  form.elements.grade.addEventListener('change', () => { gradeTouched = true; });
  form.elements.gpa.addEventListener('input', () => {
    if (gradeTouched) return;
    const g = toNum(form.elements.gpa.value);
    form.elements.grade.value = g == null ? '' : expectedGrade(g);
  });
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });

  // ✅ ربط أحداث الاستيراد مع تحسين التجربة
  $('#btnImport').addEventListener('click', doImport);

  // ✅ إشعار فوري عند اختيار الملف
  $('#file').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const sizeKB = (f.size / 1024).toFixed(1);
    toast(`تم اختيار: ${f.name} (${sizeKB} ك.ب) — اضغط «استيراد الملف»`);
  });

  $('#btnTemplate').addEventListener('click', downloadTemplate);
  $('#btnCsv').addEventListener('click', exportCSV);
  $('#btnXlsx').addEventListener('click', exportXLSX);
  $('#btnJson').addEventListener('click', exportJSON);
  $('#btnPrint').addEventListener('click', printList);
  $('#btnSample').addEventListener('click', loadSample);
  $('#btnClearDemo').addEventListener('click', async () => {
    const ids = ALL.filter(r => r.demo).map(r => r.id);
    if (!ids.length) { toast('لا توجد بيانات تجريبية'); return; }
    await dbDelete(ids); await reload(); toast(`تم حذف ${fmt(ids.length)} سجل تجريبي`);
  });
  $('#btnClearAll').addEventListener('click', async () => {
    if (!ALL.length) { toast('السجل فارغ'); return; }
    if (!confirm(`سيتم حذف ${fmt(ALL.length)} سجل نهائياً من هذا الجهاز. يُنصح بإنشاء نسخة احتياطية أولاً. هل تريد المتابعة؟`)) return;
    await dbClear(); await reload(); toast('تم حذف كل السجلات');
  });

  async function loadSample() {
    if (ALL.length && !confirm('ستُضاف بيانات تجريبية وهمية إلى سجلاتك الحالية، ويمكن حذفها لاحقاً. متابعة؟')) return;
    const base = ALL.reduce((m, r) => Math.max(m, r.serial || 0), 0);
    const recs = makeSample().map(r => ({ ...r, serial: r.serial + base }));
    await dbAdd(recs); await reload(); showTab('records'); toast('تمت إضافة بيانات تجريبية وهمية');
  }

  document.addEventListener('click', e => {
    const t = e.target.closest('[data-id],[data-page],[data-clear],[data-f],[data-flag],[data-act],[data-tab]');
    if (!t) return;
    if (t.dataset.tab) { showTab(t.dataset.tab); return; }
    if (t.dataset.id) { openEditor(Number(t.dataset.id)); return; }
    if (t.dataset.page) { S.page = Number(t.dataset.page); renderList(); window.scrollTo({ top: 0 }); return; }
    if (t.dataset.clear) { setFilter(t.dataset.clear, ''); renderList(); return; }
    if (t.dataset.f) { setFilter(t.dataset.f, t.dataset.v); showTab('records'); return; }
    if (t.dataset.flag) { setFilter('flag', t.dataset.flag); showTab('records'); return; }

    // ✅ إصلاح: زر «استيراد ملف» ينتقل للتبويب ثم يبرز حقل الملف
    if (t.dataset.act === 'import') {
      showTab('data');
      setTimeout(() => {
        const f = $('#file');
        if (f) {
          f.scrollIntoView({ behavior: 'smooth', block: 'center' });
          f.focus({ preventScroll: true });
          f.style.transition = 'box-shadow .3s';
          f.style.boxShadow = '0 0 0 3px var(--gold)';
          setTimeout(() => { f.style.boxShadow = ''; }, 1400);
        }
      }, 80);
    }
    else if (t.dataset.act === 'add') openEditor();
    else if (t.dataset.act === 'sample') loadSample();
    else if (t.dataset.act === 'reset') { resetFilters(); renderList(); }
  });

  document.addEventListener('keydown', e => {
    if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && !dlg.open) {
      e.preventDefault(); showTab('records'); $('#q').focus();
    }
  });

  /* ───────── المظهر والتثبيت والاتصال ───────── */
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    $('meta[name=theme-color]').content = '#07111f';
  }
  applyTheme(store.get('theme') || 'dark');
  $('#verPill').textContent = 'NIAS · v' + VERSION.replace(/\.0$/, '') + ' · 2026';
  $('#btnTheme').addEventListener('click', () => {
    const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    store.set('theme', t); applyTheme(t);
  });

  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; $('#btnInstall').hidden = false; });
  window.addEventListener('appinstalled', () => { $('#btnInstall').hidden = true; deferredPrompt = null; });
  $('#btnInstall').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null; $('#btnInstall').hidden = true;
  });

  const syncNet = () => { $('#net').hidden = navigator.onLine; };
  window.addEventListener('online', syncNet); window.addEventListener('offline', syncNet); syncNet();

  if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').then(reg => {
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              toast('يتوفر إصدار جديد من التطبيق', 'تحديث', () => nw.postMessage('skipWaiting'));
            }
          });
        });
      }).catch(() => {});
    });
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;
      reloaded = true; location.reload();
    });
  }

  /* ───────── البدء ───────── */
  (async () => {
    try { await reload(); }
    catch { toast('تعذر فتح التخزين المحلي. قد يكون المتصفح في وضع التصفح الخاص.'); renderAll(); }
    const p = new URLSearchParams(location.search);
    if (p.get('tab') && $('#tab-' + p.get('tab'))) showTab(p.get('tab'));
    if (p.get('action') === 'add') openEditor();
  })();
})();