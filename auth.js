'use strict';
/* وحدة الدخول والصلاحيات (RBAC) — محلية بالكامل على الجهاز
   - كلمات المرور: PBKDF2-SHA256 (150 ألف دورة) مع ملح عشوائي، ولا تُخزَّن نصاً.
   - الجلسة: sessionStorage (8 ساعات) أو localStorage (7 أيام عند «تذكرني»).
   - قفل الحساب 5 دقائق بعد 5 محاولات فاشلة، وسجل تدقيق لآخر الأحداث.
   ملاحظة: هذه بوابة تطبيق محلية وليست بديلاً عن خادم؛ من يملك الجهاز والمتصفح يستطيع تجاوزها. */
(function () {
  const DB_NAME = 'nias-auth';
  const SESSION_KEY = 'nias_session';
  const MAX_FAILS = 5, LOCK_MS = 5 * 60 * 1000;
  const SESSION_MS = 8 * 3600 * 1000, REMEMBER_MS = 7 * 86400 * 1000, ITER = 150000;

  const ROLES = { admin: 'مدير النظام', editor: 'محرر', viewer: 'مطالع' };
  const PERMS = {
    edit: ['admin', 'editor'],
    import: ['admin', 'editor'],
    export: ['admin', 'editor'],
    print: ['admin', 'editor', 'viewer'],
    manageUsers: ['admin'],
    wipe: ['admin']
  };
  const ACTIONS = {
    setup: 'إعداد النظام', login: 'تسجيل دخول', login_fail: 'محاولة دخول فاشلة', logout: 'تسجيل خروج',
    user_add: 'إضافة مستخدم', user_update: 'تعديل مستخدم', user_delete: 'حذف مستخدم',
    pw_change: 'تغيير كلمة المرور', recover: 'استرداد كلمة المرور',
    records_import: 'استيراد سجلات', records_export: 'تصدير سجلات', records_wipe: 'حذف سجلات'
  };
  const ERR = {
    nosupport: 'هذا المتصفح لا يدعم التشفير المطلوب. افتح التطبيق عبر HTTPS أو localhost.',
    bad: 'اسم المستخدم أو كلمة المرور غير صحيحة.',
    disabled: 'هذا الحساب معطّل. راجع مدير النظام.',
    exists: 'اسم المستخدم مستخدم بالفعل.',
    lastadmin: 'لا يمكن تعطيل أو حذف أو تخفيض آخر مدير نظام.',
    self: 'لا يمكنك حذف حسابك الحالي.',
    notfound: 'المستخدم غير موجود.',
    setupdone: 'تم إعداد النظام مسبقاً.'
  };

  let cur = null;

  /* ───────── أدوات ───────── */
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const fail = (code, extra) => Object.assign(new Error(code), { code }, extra);
  const supported = () => !!(window.crypto && crypto.subtle && window.indexedDB);
  const normName = s => String(s || '').trim().toLowerCase();
  const USER_RE = /^[\p{L}\p{N}._-]{3,40}$/u;
  const b64e = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const eq = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

  async function hashPw(pw, saltB64, iter) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
    return b64e(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: b64d(saltB64), iterations: iter }, key, 256));
  }
  async function makeCred(pw) {
    const salt = b64e(crypto.getRandomValues(new Uint8Array(16)));
    return { salt, iter: ITER, hash: await hashPw(pw, salt, ITER) };
  }

  function checkPassword(pw, username) {
    pw = String(pw || '');
    if (pw.length < 8) return 'كلمة المرور يجب ألا تقل عن 8 أحرف.';
    if (!/\d/.test(pw) || !/\p{L}/u.test(pw)) return 'يجب أن تجمع كلمة المرور بين حروف وأرقام.';
    if (username && pw.toLowerCase().includes(normName(username))) return 'يجب ألا تحتوي كلمة المرور على اسم المستخدم.';
    return '';
  }
  function strength(pw) {
    pw = String(pw || '');
    let s = 0;
    if (pw.length >= 8) s++;
    if (pw.length >= 12) s++;
    if (/\d/.test(pw) && /\p{L}/u.test(pw)) s++;
    if (/[^\p{L}\p{N}]/u.test(pw)) s++;
    return Math.min(4, s);
  }
  function genRecoveryCode() {
    const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const raw = [...bytes].map(b => alpha[b % alpha.length]).join('');
    return raw.match(/.{4}/g).join('-');
  }
  const normCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  /* ───────── قاعدة بيانات الحسابات ───────── */
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('users', { keyPath: 'id', autoIncrement: true }).createIndex('username', 'username', { unique: true });
      db.createObjectStore('audit', { keyPath: 'id', autoIncrement: true });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const req = (store, mode, fn) => open().then(db => new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    let out;
    try { out = fn(t.objectStore(store)); } catch (e) { rej(e); return; }
    t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
  const getById = id => req('users', 'readonly', s => s.get(id));
  const getByName = n => req('users', 'readonly', s => s.index('username').get(n));
  const allUsers = () => req('users', 'readonly', s => s.getAll());
  const saveUser = u => req('users', 'readwrite', s => s.put(u));
  const countUsers = () => req('users', 'readonly', s => s.count());

  async function log(action, detail = {}) {
    try {
      await req('audit', 'readwrite', s => s.add({ t: Date.now(), user: detail.user || (cur && cur.username) || '-', action, detail }));
      const keys = await req('audit', 'readonly', s => s.getAllKeys());
      if (keys.length > 300) await req('audit', 'readwrite', s => { keys.slice(0, keys.length - 200).forEach(k => s.delete(k)); });
    } catch { /* السجل اختياري */ }
  }
  async function recentAudit(n = 30) {
    const all = await req('audit', 'readonly', s => s.getAll());
    return all.slice(-n).reverse();
  }

  /* ───────── الجلسة ───────── */
  function readSession() {
    for (const st of [sessionStorage, localStorage]) {
      try { const v = st.getItem(SESSION_KEY); if (v) return JSON.parse(v); } catch { /* تجاهل */ }
    }
    return null;
  }
  function clearSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* */ }
    try { localStorage.removeItem(SESSION_KEY); } catch { /* */ }
  }
  function startSession(u, remember) {
    const s = { uid: u.id, username: u.username, name: u.name, role: u.role, remember: !!remember, exp: Date.now() + (remember ? REMEMBER_MS : SESSION_MS) };
    clearSession();
    try { (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, JSON.stringify(s)); } catch { /* */ }
    cur = s;
    return s;
  }
  async function requireSession({ redirect = true } = {}) {
    const go = () => { if (redirect) location.replace('login.html'); return null; };
    const s = readSession();
    if (!s || s.exp < Date.now()) { clearSession(); return go(); }
    try {
      const u = await getById(s.uid);
      if (!u || u.status !== 'active') { clearSession(); return go(); }
      s.role = u.role; s.name = u.name;
      cur = s;
      return s;
    } catch { return go(); }
  }
  async function logout() {
    await log('logout');
    clearSession(); cur = null;
    location.replace('login.html');
  }
  function watchIdle(minutes = 30) {
    if (!cur || cur.remember) return;
    let last = Date.now();
    const bump = () => { last = Date.now(); };
    ['click', 'keydown', 'touchstart', 'scroll'].forEach(e => addEventListener(e, bump, { passive: true }));
    setInterval(() => { if (Date.now() - last > minutes * 60000) logout(); }, 30000);
  }
  const can = p => !!cur && (PERMS[p] || []).includes(cur.role);

  /* ───────── تسجيل الدخول ───────── */
  async function verify(username, password, remember) {
    if (!supported()) throw fail('nosupport');
    await sleep(250);
    const u = await getByName(normName(username));
    if (!u) { await makeCred(password || 'x'); throw fail('bad'); }
    if (u.status !== 'active') throw fail('disabled');
    if (u.lockUntil > Date.now()) throw fail('locked', { until: u.lockUntil });
    const h = await hashPw(password || '', u.salt, u.iter);
    if (!eq(h, u.hash)) {
      u.failed = (u.failed || 0) + 1;
      let left = MAX_FAILS - u.failed;
      if (left <= 0) { u.lockUntil = Date.now() + LOCK_MS; u.failed = 0; left = 0; }
      await saveUser(u);
      await log('login_fail', { user: u.username });
      if (left === 0) throw fail('locked', { until: u.lockUntil });
      throw fail('bad', { left });
    }
    u.failed = 0; u.lockUntil = 0; u.lastLogin = Date.now();
    await saveUser(u);
    const s = startSession(u, remember);
    await log('login', { user: u.username });
    return s;
  }

  async function setupAdmin({ name, username, password }) {
    if (!supported()) throw fail('nosupport');
    if (await countUsers() > 0) throw fail('setupdone');
    username = normName(username); name = String(name || '').trim();
    if (name.length < 3) throw fail('invalid', { message: 'أدخل الاسم الكامل (3 أحرف على الأقل).' });
    if (!USER_RE.test(username)) throw fail('invalid', { message: 'اسم المستخدم: 3 إلى 40 حرفاً (حروف وأرقام ونقطة وشرطة).' });
    const pm = checkPassword(password, username);
    if (pm) throw fail('invalid', { message: pm });
    const code = genRecoveryCode();
    const rc = await makeCred(normCode(code));
    const u = { username, name, role: 'admin', status: 'active', ...(await makeCred(password)), recovery: rc, created: Date.now(), lastLogin: 0, failed: 0, lockUntil: 0 };
    u.id = await saveUser(u);
    await log('setup', { user: username });
    return { user: u, code };
  }

  async function recover(username, code, newPassword) {
    if (!supported()) throw fail('nosupport');
    await sleep(250);
    const u = await getByName(normName(username));
    if (!u || !u.recovery || u.status !== 'active') throw fail('bad');
    if (u.lockUntil > Date.now()) throw fail('locked', { until: u.lockUntil });
    const h = await hashPw(normCode(code), u.recovery.salt, u.recovery.iter);
    if (!eq(h, u.recovery.hash)) {
      u.failed = (u.failed || 0) + 1;
      if (u.failed >= MAX_FAILS) { u.lockUntil = Date.now() + LOCK_MS; u.failed = 0; }
      await saveUser(u);
      await log('login_fail', { user: u.username, via: 'recovery' });
      throw fail('bad');
    }
    const pm = checkPassword(newPassword, u.username);
    if (pm) throw fail('invalid', { message: pm });
    Object.assign(u, await makeCred(newPassword));
    const next = genRecoveryCode();
    u.recovery = await makeCred(normCode(next));
    u.failed = 0; u.lockUntil = 0;
    await saveUser(u);
    await log('recover', { user: u.username });
    return next;
  }

  /* ───────── إدارة المستخدمين (للمدير) ───────── */
  const strip = ({ salt, hash, iter, recovery, ...rest }) => rest;
  const listUsers = async () => (await allUsers()).map(strip).sort((a, b) => a.id - b.id);
  async function otherActiveAdmins(exceptId) {
    return (await allUsers()).filter(u => u.role === 'admin' && u.status === 'active' && u.id !== exceptId).length;
  }
  async function addUser({ username, name, role, password }) {
    if (!can('manageUsers')) throw fail('denied', { message: 'ليست لديك صلاحية.' });
    username = normName(username); name = String(name || '').trim();
    if (name.length < 3) throw fail('invalid', { message: 'أدخل الاسم الكامل (3 أحرف على الأقل).' });
    if (!USER_RE.test(username)) throw fail('invalid', { message: 'اسم المستخدم: 3 إلى 40 حرفاً (حروف وأرقام ونقطة وشرطة).' });
    if (!ROLES[role]) throw fail('invalid', { message: 'اختر الدور.' });
    const pm = checkPassword(password, username);
    if (pm) throw fail('invalid', { message: pm });
    if (await getByName(username)) throw fail('exists');
    const u = { username, name, role, status: 'active', ...(await makeCred(password)), created: Date.now(), lastLogin: 0, failed: 0, lockUntil: 0 };
    u.id = await saveUser(u);
    await log('user_add', { target: username, role });
    return u.id;
  }
  async function updateUser(id, { name, role, status, password }) {
    if (!can('manageUsers')) throw fail('denied', { message: 'ليست لديك صلاحية.' });
    const u = await getById(id);
    if (!u) throw fail('notfound');
    const losingAdmin = u.role === 'admin' && u.status === 'active' && ((role && role !== 'admin') || (status && status !== 'active'));
    if (losingAdmin && await otherActiveAdmins(id) === 0) throw fail('lastadmin');
    if (name != null && String(name).trim().length < 3) throw fail('invalid', { message: 'أدخل الاسم الكامل (3 أحرف على الأقل).' });
    if (name) u.name = String(name).trim();
    if (role && ROLES[role]) u.role = role;
    if (status) u.status = status;
    if (password) {
      const pm = checkPassword(password, u.username);
      if (pm) throw fail('invalid', { message: pm });
      Object.assign(u, await makeCred(password));
    }
    u.failed = 0; u.lockUntil = 0;
    await saveUser(u);
    await log('user_update', { target: u.username, role: u.role, status: u.status, pw: !!password });
  }
  async function removeUser(id) {
    if (!can('manageUsers')) throw fail('denied', { message: 'ليست لديك صلاحية.' });
    if (cur && cur.uid === id) throw fail('self');
    const u = await getById(id);
    if (!u) throw fail('notfound');
    if (u.role === 'admin' && u.status === 'active' && await otherActiveAdmins(id) === 0) throw fail('lastadmin');
    await req('users', 'readwrite', s => { s.delete(id); });
    await log('user_delete', { target: u.username });
  }
  async function changeOwnPassword(oldPw, newPw) {
    if (!cur) throw fail('denied', { message: 'انتهت الجلسة.' });
    const u = await getById(cur.uid);
    if (!u || !eq(await hashPw(oldPw || '', u.salt, u.iter), u.hash)) throw fail('invalid', { message: 'كلمة المرور الحالية غير صحيحة.' });
    const pm = checkPassword(newPw, u.username);
    if (pm) throw fail('invalid', { message: pm });
    Object.assign(u, await makeCred(newPw));
    await saveUser(u);
    await log('pw_change', { user: u.username });
  }

  const errorText = e => (e && (e.message && e.code === 'invalid' ? e.message : (e.message && e.code === 'denied' ? e.message : ERR[e && e.code]))) || 'حدث خطأ غير متوقع. أعد المحاولة.';

  window.NIASAuth = {
    ROLES, ACTIONS, supported, checkPassword, strength, errorText,
    hasUsers: async () => (await countUsers()) > 0,
    setupAdmin, verify, recover, startSession, requireSession, logout, watchIdle,
    session: () => cur || readSession(), can, log, recentAudit,
    listUsers, addUser, updateUser, removeUser, changeOwnPassword
  };
})();
