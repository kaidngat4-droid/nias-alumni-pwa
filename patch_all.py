import re

# ═══════════════════════════════════════════════════════════
# 1. تعديل auth.js — استبدال كامل (لأنه سهل بدقة)
# ═══════════════════════════════════════════════════════════

print("=" * 55)
print("📝 تعديل auth.js")
print("=" * 55)

AUTH_FILE = 'public/auth.js'
with open(AUTH_FILE, 'r', encoding='utf-8') as f:
    auth = f.read()

original_auth = auth
auth_changes = []

# 1.1 رفع إصدار DB إلى 2
if "indexedDB.open(DB_NAME, 1)" in auth:
    auth = auth.replace("indexedDB.open(DB_NAME, 1)", "indexedDB.open(DB_NAME, 2)", 1)
    auth_changes.append("✅ رفع إصدار DB إلى 2")

# 1.2 onupgradeneeded — التحقق من وجود الجداول + إضافة session
old_upgrade = """    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('users', { keyPath: 'id', autoIncrement: true }).createIndex('username', 'username', { unique: true });
      db.createObjectStore('audit', { keyPath: 'id', autoIncrement: true });
    };"""

new_upgrade = """    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('users')) {
        db.createObjectStore('users', { keyPath: 'id', autoIncrement: true })
          .createIndex('username', 'username', { unique: true });
      }
      if (!db.objectStoreNames.contains('audit')) {
        db.createObjectStore('audit', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('session')) {
        db.createObjectStore('session', { keyPath: 'key' });
      }
    };"""

if old_upgrade in auth:
    auth = auth.replace(old_upgrade, new_upgrade, 1)
    auth_changes.append("✅ إضافة جدول session في onupgradeneeded")

# 1.3 استبدال دوال الجلسة
old_session_block = """  function readSession() {
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
  }"""

new_session_block = """  /* الجلسة الآن مخزّنة في IndexedDB (نفس قاعدة البيانات) */
  async function readSession() {
    try {
      const item = await req('session', 'readonly', s => s.get('current'));
      return item && item.data ? item.data : null;
    } catch { return null; }
  }
  async function clearSession() {
    try { await req('session', 'readwrite', s => s.delete('current')); } catch { /* */ }
  }
  async function startSession(u, remember) {
    // الجلسة دائمة (7 أيام) داخل IndexedDB لتفادي إعادة الدخول في APK
    const s = {
      uid: u.id,
      username: u.username,
      name: u.name,
      role: u.role,
      remember: true,
      exp: Date.now() + REMEMBER_MS
    };
    await clearSession();
    try {
      await req('session', 'readwrite', s => s.put({ key: 'current', data: s }));
    } catch { /* */ }
    cur = s;
    return s;
  }"""

if old_session_block in auth:
    auth = auth.replace(old_session_block, new_session_block, 1)
    auth_changes.append("✅ استبدال دوال الجلسة بـ IndexedDB")

# 1.4 requireSession — await
old_req = "    const s = readSession();\n    if (!s || s.exp < Date.now()) { clearSession(); return go(); }"
new_req = "    const s = await readSession();\n    if (!s || s.exp < Date.now()) { await clearSession(); return go(); }"
if old_req in auth:
    auth = auth.replace(old_req, new_req, 1)
    auth_changes.append("✅ requireSession: await readSession")

# 1.5 logout — await
old_logout = "    clearSession(); cur = null;\n    location.replace('login.html');"
new_logout = "    await clearSession();\n    cur = null;\n    location.replace('login.html');"
if old_logout in auth:
    auth = auth.replace(old_logout, new_logout, 1)
    auth_changes.append("✅ logout: await clearSession")

# 1.6 verify — await startSession
old_verify = "    const s = startSession(u, remember);"
new_verify = "    const s = await startSession(u, remember);"
if old_verify in auth:
    auth = auth.replace(old_verify, new_verify, 1)
    auth_changes.append("✅ verify: await startSession")

# 1.7 إضافة دالة seedDefaultUsers قبل window.NIASAuth
if 'seedDefaultUsers' not in auth:
    seed_func = """  /* ───────── بذور الحسابات الافتراضية ───────── */
  async function seedDefaultUsers() {
    if (await countUsers() > 0) return { created: 0, skipped: true };

    const defaults = [
      { username: 'admin',  name: 'مدير النظام', role: 'admin',  password: 'NIAS@2026' },
      { username: 'editor', name: 'محرر',         role: 'editor', password: 'Nias@Edit26' },
      { username: 'viewer', name: 'مطالع',        role: 'viewer', password: 'Nias@View26' },
    ];

    let created = 0;
    for (const d of defaults) {
      try {
        if (await getByName(d.username)) continue;
        const u = {
          username: d.username,
          name: d.name,
          role: d.role,
          status: 'active',
          ...(await makeCred(d.password)),
          created: Date.now(),
          lastLogin: 0,
          failed: 0,
          lockUntil: 0,
        };
        u.id = await saveUser(u);
        created++;
      } catch (e) { /* تجاهل الأخطاء الفردية */ }
    }
    if (created > 0) await log('seed', { created });
    return { created, skipped: false };
  }

"""
    marker = '  window.NIASAuth = {'
    if marker in auth:
        auth = auth.replace(marker, seed_func + marker, 1)
        auth_changes.append("✅ إضافة seedDefaultUsers")

# 1.8 إضافة seedDefaultUsers إلى التصدير
old_export = "    listUsers, addUser, updateUser, removeUser, changeOwnPassword\n  };"
new_export = "    listUsers, addUser, updateUser, removeUser, changeOwnPassword,\n    seedDefaultUsers\n  };"
if old_export in auth:
    auth = auth.replace(old_export, new_export, 1)
    auth_changes.append("✅ إضافة seedDefaultUsers إلى NIASAuth")

# 1.9 تعديل session() المُصدَّرة (لا داعي لـ readSession)
old_session_export = "session: () => cur || readSession(),"
new_session_export = "session: () => cur,"
if old_session_export in auth:
    auth = auth.replace(old_session_export, new_session_export, 1)
    auth_changes.append("✅ session() المُصدَّرة")

if auth != original_auth:
    with open(AUTH_FILE, 'w', encoding='utf-8') as f:
        f.write(auth)
    for c in auth_changes:
        print(c)
else:
    print("⚠️  لم يتم تعديل auth.js")


# ═══════════════════════════════════════════════════════════
# 2. تعديل login.html — إضافة استدعاء seedDefaultUsers
# ═══════════════════════════════════════════════════════════

print()
print("=" * 55)
print("📝 تعديل login.html")
print("=" * 55)

LOGIN_FILE = 'public/login.html'
with open(LOGIN_FILE, 'r', encoding='utf-8') as f:
    login = f.read()

original_login = login
login_changes = []

# 2.1 استدعاء seedDefaultUsers قبل hasUsers
old_boot = """    try {

      const hasUsers =
        await NIASAuth.hasUsers();


      if (!hasUsers) {

        showSection(
          'setup'
        );

      } else {

        showSection(
          'login'
        );

      }

    } catch (error) {"""

new_boot = """    try {

      // ✨ إنشاء الحسابات الافتراضية عند أول تشغيل
      if (typeof NIASAuth.seedDefaultUsers === 'function') {

        await NIASAuth.seedDefaultUsers();

      }


      const hasUsers =
        await NIASAuth.hasUsers();


      if (!hasUsers) {

        showSection(
          'setup'
        );

      } else {

        showSection(
          'login'
        );

      }

    } catch (error) {"""

if old_boot in login:
    login = login.replace(old_boot, new_boot, 1)
    login_changes.append("✅ استدعاء seedDefaultUsers في boot()")
else:
    print("⚠️  لم أجد كتلة hasUsers — سأحاول نمطًا بديلًا")
    # نمط بديل
    old_boot2 = """      const hasUsers =
        await NIASAuth.hasUsers();"""
    new_boot2 = """      if (typeof NIASAuth.seedDefaultUsers === 'function') {
        await NIASAuth.seedDefaultUsers();
      }

      const hasUsers =
        await NIASAuth.hasUsers();"""
    if old_boot2 in login:
        login = login.replace(old_boot2, new_boot2, 1)
        login_changes.append("✅ استدعاء seedDefaultUsers في boot() (نمط بديل)")

# 2.2 إضافة قسم عرض الحسابات الافتراضية (قبل زر btnRecovery)
creds_html = '''
      <!-- بيانات الدخول الافتراضية -->
      <div class="default-creds" style="
        margin:14px 18px 0;
        padding:12px 14px;
        background:rgba(212,175,55,.08);
        border:1px solid rgba(212,175,55,.25);
        border-radius:10px;
        font-size:12px;
        color:#d4af37;
        direction:rtl;
        line-height:1.85;
      ">
        <div style="font-weight:700;margin-bottom:6px;font-size:13px;">🔐 بيانات الدخول الافتراضية</div>
        <div style="opacity:.9;">
          <div>👤 مدير: <code style="background:rgba(0,0,0,.35);padding:1px 5px;border-radius:4px;">admin</code> / <code style="background:rgba(0,0,0,.35);padding:1px 5px;border-radius:4px;">NIAS@2026</code></div>
          <div>✏️ محرر: <code style="background:rgba(0,0,0,.35);padding:1px 5px;border-radius:4px;">editor</code> / <code style="background:rgba(0,0,0,.35);padding:1px 5px;border-radius:4px;">Nias@Edit26</code></div>
          <div>👁️ مطالع: <code style="background:rgba(0,0,0,.35);padding:1px 5px;border-radius:4px;">viewer</code> / <code style="background:rgba(0,0,0,.35);padding:1px 5px;border-radius:4px;">Nias@View26</code></div>
        </div>
      </div>

'''

# نضعها قبل آخر زر في loginSection (قبل </div> الأخير لـ loginSection)
# لكن ذلك صعب تحديده بدقة. نضعها بدلاً من ذلك بعد نموذج تسجيل الدخول
# نبحث عن زر btnRecovery داخل loginSection ونضع البيانات قبله

if 'data-role="default-creds"' not in login:
    # ابحث عن آخر وسم <div> قبل زر تسجيل الدخول
    pattern = r'(<button\s+form="authForm"\s+id="btnLogin")'
    match = re.search(pattern, login, re.DOTALL)
    if match:
        insert_pos = match.start()
        # ابحث عن بداية الكتلة .auth-foot قبل الزر
        auth_foot_pattern = r'<div\s+class="auth-foot">\s*$'
        # ابحث للخلف عن أقرب <div class="auth-foot">
        before = login[:insert_pos]
        foot_match = re.search(r'<div\s+class="auth-foot">\s*$', before, re.MULTILINE)
        if foot_match:
            insert_pos2 = foot_match.start()
            login = login[:insert_pos2] + creds_html + '    ' + login[insert_pos2:]
            login_changes.append("✅ أضفت عرض الحسابات الافتراضية")
        else:
            # ضعها قبل الزر
            login = login[:insert_pos] + creds_html + '      ' + login[insert_pos:]
            login_changes.append("✅ أضفت عرض الحسابات الافتراضية (نمط بديل)")

if login != original_login:
    with open(LOGIN_FILE, 'w', encoding='utf-8') as f:
        f.write(login)
    for c in login_changes:
        print(c)
else:
    print("⚠️  لم يتم تعديل login.html")


# ═══════════════════════════════════════════════════════════
# التحقق النهائي
# ═══════════════════════════════════════════════════════════

print()
print("=" * 55)
print("🔍 التحقق النهائي")
print("=" * 55)

with open(AUTH_FILE, 'r', encoding='utf-8') as f:
    auth = f.read()
with open(LOGIN_FILE, 'r', encoding='utf-8') as f:
    login = f.read()

checks = [
    (auth, 'indexedDB.open(DB_NAME, 2)', 'auth.js: DB v2'),
    (auth, "createObjectStore('session'", 'auth.js: جدول session'),
    (auth, 'async function readSession', 'auth.js: readSession async'),
    (auth, 'async function startSession', 'auth.js: startSession async'),
    (auth, 'seedDefaultUsers', 'auth.js: seedDefaultUsers'),
    (auth, 'await startSession(u, remember)', 'auth.js: await في verify'),
    (login, 'seedDefaultUsers', 'login.html: استدعاء seedDefaultUsers'),
    (login, 'بيانات الدخول الافتراضية', 'login.html: عرض الحسابات'),
]

all_ok = True
for content, pattern, label in checks:
    if pattern in content:
        print(f"   ✅ {label}")
    else:
        print(f"   ❌ {label} مفقود")
        all_ok = False

print()
if all_ok:
    print("🎉 كل التعديلات نجحت!")
else:
    print("⚠️  بعض التعديلات لم تكتمل — راجع أعلاه")
