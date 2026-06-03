'use strict';

/**
 * PostProcessors.js — معالجات خاصة لكل نوع تحكم CNC
 * يحوّل G-code العام إلى صيغة تناسب المتحكم المحدد
 */

// ── GRBL ───────────────────────────────────────────────────────────────────────
function processGRBL(gcode, config) {
  const lines = gcode.split('\n');
  const out   = [];

  // GRBL header: % للبداية، بلا G17 (يُفترض دائماً XY)
  out.push('%');

  for (const raw of lines) {
    let line = raw.trim();
    if (!line) continue;

    // إزالة G17 (GRBL لا يدعمها في بعض الإصدارات)
    line = line.replace(/\bG17\b/g, '').trim();

    // تحويل Laser: M03 Sxxx بدلاً من M03 + G04 منفصلة
    if (config.toolType === 'laser') {
      line = line.replace(/M03/g, `M03 S${config.spindleSpeed || 1000}`);
      line = line.replace(/M04/g, `M04 S${config.spindleSpeed || 1000}`);
    }

    // تنظيف الأسطر الفارغة الناتجة
    if (line) out.push(line);
  }

  out.push('%');
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

  // رقم البرنامج إلزامي في Fanuc
  out.push(`O${String(programNumber).padStart(4, '0')} (Diqqat Qalam)`);

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
  grbl:     processGRBL,
  mach3:    processMach3,
  fanuc:    processFanuc,
  haas:     (g, c) => processFanuc(g, c, 2000),
  linuxcnc: processLinuxCNC,
  generic:  processGeneric,
};

function applyPostProcessor(gcode, config, profile = 'generic') {
  const fn = PROCESSORS[profile?.toLowerCase()] || processGeneric;
  return fn(gcode, config);
}

module.exports = { applyPostProcessor, PROCESSORS };
