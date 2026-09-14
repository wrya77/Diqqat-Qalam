'use strict';
/**
 * security.test.js — اختبارات انحدار لثغراتٍ أُصلحت فعلاً.
 *
 * كلّ حالةٍ هنا كانت تنجح (أي: الهجوم يعمل) قبل الإصلاح. الغرض ألّا تعود صامتةً
 * مع إعادة هيكلةٍ لاحقة — فهذه أعطالٌ لا يكشفها الاستعمال العاديّ إطلاقاً.
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const BackupManager = require('../src/core/BackupManager');

describe('BackupManager.restore — اجتياز المسار والكتابة العشوائية', () => {
  let tmp, bdir, pdir, mgr;

  beforeEach(() => {
    tmp  = fs.mkdtempSync(path.join(os.tmpdir(), 'dq-sec-'));
    bdir = path.join(tmp, 'backups');
    pdir = path.join(tmp, 'projects');
    fs.mkdirSync(bdir);
    fs.mkdirSync(pdir);
    mgr = new BackupManager({ backupDir: bdir, projectsDir: pdir });
  });

  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  test('يرفض معرّفاً يخرج من مجلّد النسخ', () => {
    // ملفٌّ صالح البنية خارج المجلّد — قبل الإصلاح كان يُقرأ بنجاح
    fs.writeFileSync(path.join(tmp, 'secret.json'),
      JSON.stringify({ projects: {}, timestamp: 'x' }));

    for (const id of ['../secret', '..\\secret', 'a/../../secret', '../../etc/passwd', '', null]) {
      expect(() => mgr.restore(id)).toThrow();
    }
  });

  test('لا يكتب خارج مجلّد المشاريع مهما كانت مفاتيح الملفّ', () => {
    fs.writeFileSync(path.join(bdir, 'evil.json'), JSON.stringify({
      timestamp: 't',
      projects: {
        '../pwned.js':      { a: 1 },   // كتابة فوق شيفرةٍ = تنفيذ عن بُعد
        '..\\pwned2.js':    { a: 1 },
        'sub/deep.cncp':    { a: 1 },
        'notes.txt':        { a: 1 },   // امتدادٌ غير مسموح
        'good.cncp':        { a: 1 },   // الوحيد المشروع
      },
    }));

    const r = mgr.restore('evil');

    expect(r.restored).toBe(1);
    expect(r.skipped).toBe(4);
    expect(fs.existsSync(path.join(pdir, 'good.cncp'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'pwned.js'))).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'pwned2.js'))).toBe(false);
    expect(fs.readdirSync(tmp).sort()).toEqual(['backups', 'projects']);
  });

  test('الاسترجاع المشروع ما يزال يعمل', () => {
    fs.writeFileSync(path.join(pdir, 'p1.cncp'), JSON.stringify({ id: 'p1' }));
    const bk = mgr.backup();
    const id = path.basename(bk.file, '.json');

    fs.rmSync(path.join(pdir, 'p1.cncp'));
    const r = mgr.restore(id);

    expect(r.restored).toBe(1);
    expect(fs.existsSync(path.join(pdir, 'p1.cncp'))).toBe(true);
  });
});

describe('المصادقة — الفشل مغلقاً بلا إعدادات', () => {
  const ENV = process.env;

  /** يُحمّل الوسيط من جديد ببيئةٍ معيّنة (الوحدة تقرأ البيئة وقت التحميل) */
  function load(env) {
    jest.resetModules();
    process.env = { ...ENV, ...env };
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    return require('../src/middleware/auth');
  }

  afterEach(() => { process.env = ENV; });

  test('الإنتاج بلا Supabase: لا مستخدم وهميّ، والنقاط المحميّة ترفض', async () => {
    const auth = load({ NODE_ENV: 'production' });
    const req = { headers: {} };
    let code = 0, body = null;
    const res = { status(c) { code = c; return this; }, json(o) { body = o; return this; } };

    await new Promise(done => auth.attachUser(req, res, done));
    expect(req.user).toBeNull();                 // كان { id: 'dev-user' }

    let passed = false;
    auth.requireAuth(req, res, () => { passed = true; });
    expect(passed).toBe(false);                  // كان يمرّ — كلّ النقاط مفتوحة
    expect(code).toBe(503);
    expect(body).toHaveProperty('error');
  });

  test('التطوير المحلّي يبقى صالحاً بلا مصادقة', async () => {
    const auth = load({ NODE_ENV: 'development' });
    const req = { headers: {} };
    const res = { status() { return this; }, json() { return this; } };

    await new Promise(done => auth.attachUser(req, res, done));
    expect(req.user && req.user.id).toBe('dev-user');

    let passed = false;
    auth.requireAuth(req, res, () => { passed = true; });
    expect(passed).toBe(true);
  });
});

describe('تعقيم أسماء المستخدم قبل الإقحام في HTML', () => {
  /* الاسم يصل من إعادة تسمية، أو اسم ملفٍّ مستورَد، أو ملفّ مشروعٍ يُشارَك.
     نتحقّق أنّ كلّ موضع إقحامٍ في الواجهة يمرّ بتعقيم. */
  const SINKS = [
    ['public/js/layers-panel.js', /\$\{esc\(L\.name\)\}/],
    ['public/js/layers-panel.js', /\$\{esc\(L\.color\)\}/],
    ['public/js/object-dock.js',  /\$\{esc\(s\.name \|\|/],
  ];

  test.each(SINKS)('%s يعقّم قبل الإقحام', (file, re) => {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    expect(src).toMatch(re);
  });

  test('شجرة الميزات تبني الاسم عقدةً نصّية لا innerHTML', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/cad3d.js'), 'utf8');
    expect(src).toMatch(/nameEl\.textContent\s*=/);
    // الصيغة القديمة الخطرة يجب ألّا تعود
    expect(src).not.toMatch(/<span class="n" title="\$\{f\.error \|\| f\.name\}">/);
  });
});
