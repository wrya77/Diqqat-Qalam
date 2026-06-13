'use strict';

/**
 * PostProcessors.js — معالجات خاصة لكل نوع تحكم CNC
 * يحوّل G-code العام إلى صيغة تناسب المتحكم المحدد
 */

// ── GRBL ───────────────────────────────────────────────────────────────────────
function processGRBL(gcode, config) {
  const lines = gcode.split('\n');
  const out   = [];

  for (const raw of lines) {
    let line = raw.trim();
    if (!line) continue;
    const isComment = line.startsWith(';');

    if (!isComment) {
      // GRBL يرفض هذه الأوامر بخطأ صريح — يجب إزالتها كلياً:
      //   M06/T (تغيير أداة) · G41/G42 (تعويض قطر) · G43 (تعويض طول)
      if (/\bM0?6\b/i.test(line) || /\bG4[123](\.\d)?\b/.test(line)) {
        const cmt = line.split(';')[1];
        if (cmt) out.push(';' + cmt + ' (أُزيل — غير مدعوم في GRBL)');
        continue;
      }
      // كلمة T وحدها (بدون M6) تُتجاهل لكن الأنظف إزالتها
      line = line.replace(/\bT\d+\b/gi, '').trim();
    }

    // تحويل Laser: M03 Sxxx بدلاً من M03 + G04 منفصلة
    if (!isComment && config.toolType === 'laser') {
      line = line.replace(/M03(?!\s*S)/g, `M03 S${config.spindleSpeed || 1000}`);
      line = line.replace(/M04(?!\s*S)/g, `M04 S${config.spindleSpeed || 1000}`);
    }

    if (line) out.push(line);
  }

  return out.join('\n');
}

// ── Mach3 ─────────────────────────────────────────────────────────────────────
function processMach3(gcode, config) {
  const lines = gcode.split('\n');
  const out   = [];

  // Mach3 يحتاج % في البداية والنهاية
  out.push('%');

  let seqNum = 10;
  for (const raw of lines) {
    let line = raw.trim();
    if (!line) continue;
    if (line.startsWith(';')) { out.push(line); continue; }

    // تغيير أداة يتطلب M00 للإيقاف
    if (/M06/i.test(line)) {
      out.push(`M00  ; توقف لتغيير الأداة`);
    }

    // إضافة أرقام تسلسلية
    if (!line.startsWith('N')) {
      line = `N${seqNum} ${line}`;
      seqNum += 10;
    }

    out.push(line);
  }

  out.push('%');
  return out.join('\n');
}

// ── Fanuc / HAAS ──────────────────────────────────────────────────────────────
function processFanuc(gcode, config, programNumber = 1000) {
  const lines = gcode.split('\n');
  const out   = [];

  // شريط Fanuc يبدأ بـ % ثم رقم البرنامج
  out.push('%');
  out.push(`O${String(programNumber).padStart(4, '0')} (DIQQAT QALAM)`);

  let seqNum = 10;
  for (const raw of lines) {
    let line = raw.trim();
    if (!line) continue;
    if (line.startsWith(';')) {
      // Fanuc يستخدم ( ) بدلاً من ;
      const comment = line.replace(/^;\s*/, '');
      out.push(`(${comment})`);
      continue;
    }

    // تحويل التعليقات المضمّنة ; → ()
    line = line.replace(/;\s*(.*)/, '($1)').trim();

    // التوقف: في Fanuc «P» بالميلي ثانية — مولّدنا يقصد ثوانٍ ⇒ صيغة X بالثواني
    line = line.replace(/\bG0?4\s+P(\d+(?:\.\d+)?)\b/i, (_, sec) => `G04 X${parseFloat(sec).toFixed(1)}`);

    // أرقام تسلسلية إلزامية
    if (!line.startsWith('N')) {
      line = `N${seqNum} ${line}`;
      seqNum += 10;
    }

    out.push(line);
  }

  // Fanuc يستخدم M30 ثم % للنهاية
  if (!out.some(l => /M30/i.test(l))) out.push(`N${seqNum} M30`);
  out.push('%');
  return out.join('\n');
}

// ── NcStudio / Weihong (وييهونغ — أشهر متحكم راوترات صينية في العراق) ────────
function processNcStudio(gcode, config) {
  const lines = gcode.split('\n');
  const out = [];
  for (const raw of lines) {
    let line = raw.trim();
    if (!line) continue;
    // NcStudio يقبل تعليقات الأقواس فقط — حوّل ; إلى ()
    if (line.startsWith(';')) { out.push(`(${line.replace(/^;\s*/, '')})`); continue; }
    line = line.replace(/;\s*(.*)$/, '($1)').trim();
    // لا تغيير أداة ولا تعويض قطر/طول في الراوترات أحادية الأداة
    if (/\bM0?6\b/i.test(line) || /\bG4[123](\.\d)?\b/.test(line)) continue;
    line = line.replace(/\bT\d+\b/gi, '').trim();
    if (line) out.push(line);
  }
  return out.join('\n');
}

// ── RichAuto DSP A11/A18 (المتحكم اليدوي الشائع على الراوترات الصينية) ────────
function processRichAuto(gcode, _config) {
  const lines = gcode.split('\n');
  const out = [];
  for (const raw of lines) {
    // DSP يقرأ من فلاشة USB ويتعثر بالتعليقات وغير ASCII — جرّد كل شيء
    let line = raw.replace(/\(.*?\)/g, '').split(';')[0].trim();
    if (!line) continue;
    if (/\bM0?6\b/i.test(line) || /\bG4[123](\.\d)?\b/.test(line)) continue;
    line = line.replace(/\bT\d+\b/gi, '').trim();
    // يتجاهل أنظمة الإحداثيات — إحداثياته من شاشته اليدوية
    line = line.replace(/\bG5[4-9]\b/g, '').trim();
    if (line) out.push(line);
  }
  return out.join('\n');
}

// ── Syntec (سينتك — تايواني/صيني شائع في المخارط والراوترات الصناعية) ─────────
function processSyntec(gcode, config) {
  // متوافق مع نمط Fanuc إلى حد كبير
  return processFanuc(gcode, config, 3000);
}

// ── Mach4 ─────────────────────────────────────────────────────────────────────
function processMach4(gcode, config) {
  return processMach3(gcode, config);
}

// ── Siemens Sinumerik 808D/828D (شائع في الورش الصناعية العربية) ──────────────
function processSinumerik(gcode, _config) {
  const lines = gcode.split('\n');
  const out = [];
  for (const raw of lines) {
    let line = raw.trim();
    if (!line) continue;
    // سيمنز يقبل تعليقات ; أصلاً — أبقها
    // التوقف بصيغة G4 F<ثوانٍ>
    line = line.replace(/\bG0?4\s+P(\d+(?:\.\d+)?)\b/i, (_, s) => `G4 F${parseFloat(s).toFixed(1)}`);
    // أرقام الأدوات بصيغة T= ثم M6 مدعومة؛ نبقيها كما هي
    out.push(line);
  }
  if (!out.some(l => /\bM30\b/.test(l))) out.push('M30');
  return out.join('\n');
}

// ── LinuxCNC ──────────────────────────────────────────────────────────────────
function processLinuxCNC(gcode, _config) {
  // LinuxCNC متوافق مع G-code العام إلى حد كبير
  // فقط نتحقق من وجود M2 أو M30 للنهاية
  const lines = gcode.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.some(l => /M2\b|M30\b/i.test(l))) lines.push('M2');
  return lines.join('\n');
}

// ── Generic (بدون تحويل) ─────────────────────────────────────────────────────
function processGeneric(gcode, _config) {
  return gcode;
}

// ── واجهة موحّدة ──────────────────────────────────────────────────────────────
const PROCESSORS = {
  grbl:      processGRBL,
  mach3:     processMach3,
  mach4:     processMach4,
  fanuc:     processFanuc,
  haas:      (g, c) => processFanuc(g, c, 2000),
  ncstudio:  processNcStudio,
  richauto:  processRichAuto,
  syntec:    processSyntec,
  sinumerik: processSinumerik,
  linuxcnc:  processLinuxCNC,
  generic:   processGeneric,
};

function applyPostProcessor(gcode, config, profile = 'generic') {
  const fn = PROCESSORS[profile?.toLowerCase()] || processGeneric;
  return fn(gcode, config);
}

module.exports = { applyPostProcessor, PROCESSORS };
