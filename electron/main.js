'use strict';
/**
 * دقة قلم — عملية Electron الرئيسية (تطبيق سطح المكتب)
 * ──────────────────────────────────────────────────────────────────────────
 *  • يشغّل خادم Express المحلي (server.js) داخل عملية Electron نفسها.
 *  • يفتح نافذة على http://127.0.0.1:<port>/app
 *  • يعمل بلا إنترنت: يُجبَر الوضع المحلي (بلا Supabase) فيفتح مباشرة دون تسجيل دخول،
 *    والتخزين على ملفات الجهاز.
 *  • تحكم USB/Serial: نقاط /api/cnc/* تستخدم حزمة serialport في عملية Node نفسها،
 *    فلا حاجة لجسر IPC — الواجهة تطلبها عبر fetch كالمعتاد.
 */
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');
const http = require('http');

// منفذ محلي ثابت بعيد عن المنافذ الشائعة (يمكن تجاوزه بـ DQ_PORT)
const PORT = parseInt(process.env.DQ_PORT, 10) || 38217;

// إجبار الوضع المحلي قبل تحميل الخادم.
// dotenv (داخل server.js) لا يستبدل المتغيرات الموجودة مسبقاً، فضبطها هنا
// يضمن عدم طلب تسجيل الدخول حتى لو وُجد ملف .env فيه مفاتيح Supabase.
process.env.PORT             = String(PORT);
process.env.SUPABASE_URL     = '';
process.env.SUPABASE_ANON_KEY = '';
process.env.NODE_ENV         = process.env.NODE_ENV || 'production';
process.env.DQ_DESKTOP       = '1';
delete process.env.VERCEL;

let mainWindow = null;
let serverRef  = null;

// ── تشغيل خادم Express (يبدأ الاستماع تلقائياً عند تحميله) ───────────────────
function startServer() {
  return new Promise((resolve, reject) => {
    try {
      // الخادم ينشئ مجلدات بيانات (uploads/data/projects…) بمسارات نسبية.
      // عند التثبيت في Program Files يكون مجلد التطبيق للقراءة فقط، فنحوّل
      // مجلد العمل إلى userData القابل للكتابة قبل تحميل الخادم.
      try { process.chdir(app.getPath('userData')); } catch (_) {}
      const mod = require(path.join(__dirname, '..', 'server.js'));
      const server = mod && mod.server;
      if (!server) return reject(new Error('تعذّر تحميل الخادم المحلي'));
      serverRef = server;
      if (server.listening) return resolve();
      server.once('listening', resolve);
      server.once('error', reject);
      setTimeout(resolve, 4000); // مهلة احتياطية إن لم يصدر حدث listening
    } catch (e) { reject(e); }
  });
}

// ── انتظار جاهزية HTTP فعلياً قبل فتح النافذة ────────────────────────────────
function waitForHttp(retries = 40) {
  return new Promise((resolve) => {
    const tryOnce = (n) => {
      const req = http.get(
        { host: '127.0.0.1', port: PORT, path: '/api/info', timeout: 1000 },
        (res) => { res.resume(); resolve(true); }
      );
      const retry = () => { if (n <= 0) return resolve(false); setTimeout(() => tryOnce(n - 1), 250); };
      req.on('error', retry);
      req.on('timeout', () => { req.destroy(); retry(); });
    };
    tryOnce(retries);
  });
}

function appUrl() { return `http://127.0.0.1:${PORT}/app`; }

function createWindow() {
  mainWindow = new BrowserWindow({
    width:  1280,
    height: 820,
    minWidth:  960,
    minHeight: 600,
    backgroundColor: '#0d1117',
    title: 'دقة قلم — مولّد G-Code',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          false,
      spellcheck:       false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow && mainWindow.show());
  mainWindow.loadURL(appUrl());

  // الروابط الخارجية تُفتح في المتصفح لا داخل النافذة
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'deny' };
  });

  // إعادة المحاولة إن فشل التحميل لأن الخادم ما زال يُقلع
  mainWindow.webContents.on('did-fail-load', (_e, _code, _desc, validatedURL) => {
    if (validatedURL && validatedURL.includes(`:${PORT}`)) {
      setTimeout(() => { if (mainWindow) mainWindow.loadURL(appUrl()); }, 600);
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── قائمة عربية مختصرة ──────────────────────────────────────────────────────
function buildMenu() {
  return Menu.buildFromTemplate([
    { label: 'ملف', submenu: [ { role: 'quit', label: 'خروج' } ] },
    { label: 'تحرير', submenu: [
      { role: 'undo', label: 'تراجع' }, { role: 'redo', label: 'إعادة' }, { type: 'separator' },
      { role: 'cut', label: 'قص' }, { role: 'copy', label: 'نسخ' },
      { role: 'paste', label: 'لصق' }, { role: 'selectAll', label: 'تحديد الكل' },
    ] },
    { label: 'عرض', submenu: [
      { role: 'reload', label: 'إعادة تحميل' },
      { role: 'forceReload', label: 'إعادة تحميل كاملة' },
      { role: 'toggleDevTools', label: 'أدوات المطور' },
      { type: 'separator' },
      { role: 'resetZoom', label: 'حجم افتراضي' },
      { role: 'zoomIn', label: 'تكبير' }, { role: 'zoomOut', label: 'تصغير' },
      { type: 'separator' },
      { role: 'togglefullscreen', label: 'ملء الشاشة' },
    ] },
    { label: 'مساعدة', submenu: [
      { label: 'عن دقة قلم', click() {
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'عن دقة قلم',
          message: 'دقة قلم — مولّد G-Code الاحترافي لآلات CNC',
          detail: 'إصدار سطح المكتب 2.0.0\nيعمل بلا إنترنت مع دعم التحكم بالآلة عبر USB/Serial.',
          buttons: ['حسناً'],
        });
      } },
    ] },
  ]);
}

// ── دورة حياة التطبيق (قفل نسخة واحدة) ───────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(buildMenu());
    try {
      await startServer();
      await waitForHttp();
    } catch (e) {
      dialog.showErrorBox('تعذّر بدء التطبيق', String((e && e.message) || e));
    }
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    try { if (serverRef) serverRef.close(); } catch (_) {}
    app.quit();
  });
}
