/**
 * CalligraphyEngine.js — محرك الخط العربي
 * يحوّل تتابع المحارف المُشكَّلة (HarfBuzz) + مخططات الحروف (opentype)
 * إلى كنتورات مغلقة بوحدة mm جاهزة لتوليد G-Code.
 *
 * نقي تماماً: لا DOM، لا شبكة. الإدخال:
 *   run        : مصفوفة { glyphId, ax, ay, dx, dy }  (مخرجات HarfBuzz، وحدات الخط، y لأعلى)
 *   glyphPaths : خريطة glyphId -> { commands:[...] } (مخطط الحرف الخام، وحدات الخط، y لأعلى — opentype glyph.path)
 *
 * المخرجات: كنتورات بوحدة mm، الأصل أسفل-يسار (0,0)، y لأعلى — اصطلاح CNC.
 *
 * وحدة مشتركة (UMD): الخادم require، المتصفح DQ.CalligraphyEngine.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DQ = root.DQ || {};
    root.DQ.CalligraphyEngine = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

// ── أنماط الخطوط المضمَّنة (OFL) ─────────────────────────────────
// كل الخطوط حرّة بالكامل (OFL ما لم يُذكر Apache-2.0) — راجع public/fonts/FONTS-LICENSES.txt.
// script: 'arabic' | 'latin' — تستعمله الواجهة للتجميع، والجسر لاختيار نصّ اختبارٍ مناسب.
const FONTS = [
  { id: 'amiri',   name: 'نسخ — Amiri',       file: 'Amiri-Regular.ttf',     style: 'نسخ',   note: 'كلاسيكي احترافي للنصوص',     script: 'arabic' },
  { id: 'cairo',   name: 'حديث — Cairo',      file: 'Cairo-Regular.ttf',     style: 'حديث',  note: 'هندسي نظيف للأسماء واللوحات', script: 'arabic' },
  { id: 'reem',    name: 'كوفي — Reem Kufi',  file: 'ReemKufi-Regular.ttf',  style: 'كوفي',  note: 'هندسي للشعارات واللافتات',   script: 'arabic' },
  { id: 'ruqaa',   name: 'رقعة — Aref Ruqaa', file: 'ArefRuqaa-Regular.ttf', style: 'رقعة',  note: 'زخرفي تقليدي أنيق',          script: 'arabic' },
  { id: 'alkalami', name: 'القلمي — Alkalami', file: 'Alkalami-Regular.ttf', style: 'عرض', note: 'خطّي تقليدي للعناوين', script: 'arabic' },
  { id: 'almarai', name: 'المراعي — Almarai', file: 'Almarai-Bold.ttf', style: 'حديث', note: 'عريض واضح للعناوين', script: 'arabic' },
  { id: 'arefruqaaink', name: 'Aref Ruqaa Ink', file: 'ArefRuqaaInk-Bold.ttf', style: 'رقعة', note: 'رقعة بأثر الحبر', script: 'arabic' },
  { id: 'baloobhaijaan', name: 'Baloo Bhaijaan 2', file: 'BalooBhaijaan2-Bold.ttf', style: 'عرض', note: 'مستدير ودود للعلامات', script: 'arabic' },
  { id: 'blaka', name: 'بلاكة — Blaka', file: 'Blaka-Regular.ttf', style: 'عرض', note: 'زخرفي ثقيل للّافتات', script: 'arabic' },
  { id: 'cairoplay', name: 'Cairo Play', file: 'CairoPlay-Bold.ttf', style: 'عرض', note: 'نسخة مرحة من كايرو', script: 'arabic' },
  { id: 'changa', name: 'تشانجا — Changa', file: 'Changa-Bold.ttf', style: 'حديث', note: 'قويّ هندسي للعناوين الكبيرة', script: 'arabic' },
  { id: 'elmessiri', name: 'المسيري — El Messiri', file: 'ElMessiri-Bold.ttf', style: 'حديث', note: 'أنيق للعناوين والشعارات', script: 'arabic' },
  { id: 'gulzar', name: 'گلزار — Gulzar', file: 'Gulzar-Regular.ttf', style: 'نستعليق', note: 'نستعليق عرضيّ للعناوين الفاخرة', script: 'arabic' },
  { id: 'harmattan', name: 'هرمتان — Harmattan', file: 'Harmattan-Bold.ttf', style: 'حديث', note: 'غربي أفريقي واضح', script: 'arabic' },
  { id: 'ibmplexarabic', name: 'IBM Plex Sans Arabic', file: 'IBMPlexSansArabic-Bold.ttf', style: 'حديث', note: 'هندسي مؤسّسي للّوحات', script: 'arabic' },
  { id: 'jomhuria', name: 'جمهورية — Jomhuria', file: 'Jomhuria-Regular.ttf', style: 'عرض', note: 'ضخم للعناوين الصحفية والإعلان', script: 'arabic' },
  { id: 'katibeh', name: 'كتيبة — Katibeh', file: 'Katibeh-Regular.ttf', style: 'عرض', note: 'عرضيّ رفيع للعناوين', script: 'arabic' },
  { id: 'kufam', name: 'كُفام — Kufam', file: 'Kufam-Bold.ttf', style: 'كوفي', note: 'كوفي عصري للّافتات', script: 'arabic' },
  { id: 'lalezar', name: 'لاله‌زار — Lalezar', file: 'Lalezar-Regular.ttf', style: 'عرض', note: 'عريض عرضيّ ممتاز للإعلانات', script: 'arabic' },
  { id: 'lateef', name: 'لطيف — Lateef', file: 'Lateef-Bold.ttf', style: 'نسخ', note: 'نسخي للنصوص والعناوين', script: 'arabic' },
  { id: 'lemonada', name: 'ليمونادة — Lemonada', file: 'Lemonada-Bold.ttf', style: 'حديث', note: 'ودود مستدير للعلامات', script: 'arabic' },
  { id: 'mada', name: 'مدى — Mada', file: 'Mada-Bold.ttf', style: 'حديث', note: 'نظيف محايد للنصوص والعناوين', script: 'arabic' },
  { id: 'marhey', name: 'مرحّة — Marhey', file: 'Marhey-Bold.ttf', style: 'عرض', note: 'مرح ديناميكي للإعلانات', script: 'arabic' },
  { id: 'markazi', name: 'مركزي — Markazi Text', file: 'MarkaziText-Bold.ttf', style: 'حديث', note: 'نسخي معاصر أنيق', script: 'arabic' },
  { id: 'mirza', name: 'ميرزا — Mirza', file: 'Mirza-Bold.ttf', style: 'عرض', note: 'نستعليق للعناوين', script: 'arabic' },
  { id: 'notokufi', name: 'Noto Kufi Arabic', file: 'NotoKufiArabic-Bold.ttf', style: 'كوفي', note: 'كوفي حديث عريض للعناوين', script: 'arabic' },
  { id: 'notonaskh', name: 'Noto Naskh Arabic', file: 'NotoNaskhArabic-Bold.ttf', style: 'نسخ', note: 'نسخي قياسي واضح', script: 'arabic' },
  { id: 'qahiri', name: 'قاهري — Qahiri', file: 'Qahiri-Regular.ttf', style: 'كوفي', note: 'كوفي عرضيّ جريء', script: 'arabic' },
  { id: 'rakkas', name: 'ركّاس — Rakkas', file: 'Rakkas-Regular.ttf', style: 'عرض', note: 'زخرفي جريء للّافتات', script: 'arabic' },
  { id: 'readexpro', name: 'Readex Pro', file: 'ReadexPro-Bold.ttf', style: 'حديث', note: 'عصري متعدّد اللغات', script: 'arabic' },
  { id: 'reemkufifun', name: 'Reem Kufi Fun', file: 'ReemKufiFun-Bold.ttf', style: 'كوفي', note: 'كوفي مرح للإعلانات', script: 'arabic' },
  { id: 'reemkufiink', name: 'Reem Kufi Ink', file: 'ReemKufiInk-Regular.ttf', style: 'كوفي', note: 'كوفي بأثر الحبر', script: 'arabic' },
  { id: 'scheherazade', name: 'شهرزاد — Scheherazade New', file: 'ScheherazadeNew-Bold.ttf', style: 'نسخ', note: 'نسخي كلاسيكي عريض', script: 'arabic' },
  { id: 'tajawal', name: 'تجوال — Tajawal', file: 'Tajawal-Bold.ttf', style: 'حديث', note: 'هندسي نظيف للإعلانات واللوحات', script: 'arabic' },
  { id: 'vazirmatn', name: 'وزيرمتن — Vazirmatn', file: 'Vazirmatn-Bold.ttf', style: 'حديث', note: 'عصري نظيف جداً للعناوين والعلامات', script: 'arabic' },
  { id: 'vibes', name: 'فايبس — Vibes', file: 'Vibes-Regular.ttf', style: 'عرض', note: 'عرضيّ أنيق للإعلانات', script: 'arabic' },
  { id: 'abrilfatface', name: 'Abril Fatface', file: 'AbrilFatface-Regular.ttf', style: 'display', note: 'High-contrast didone — elegant ads', script: 'latin' },
  { id: 'alfaslabone', name: 'Alfa Slab One', file: 'AlfaSlabOne-Regular.ttf', style: 'slab', note: 'Ultra-bold slab — maximum impact', script: 'latin' },
  { id: 'anton', name: 'Anton', file: 'Anton-Regular.ttf', style: 'display', note: 'Heavy condensed — bold headlines', script: 'latin' },
  { id: 'archivoblack', name: 'Archivo Black', file: 'ArchivoBlack-Regular.ttf', style: 'display', note: 'Grotesque black — strong titles', script: 'latin' },
  { id: 'audiowide', name: 'Audiowide', file: 'Audiowide-Regular.ttf', style: 'display', note: 'Techno rounded — tech brands', script: 'latin' },
  { id: 'bangers', name: 'Bangers', file: 'Bangers-Regular.ttf', style: 'display', note: 'Comic punch — loud posters', script: 'latin' },
  { id: 'bebasneue', name: 'Bebas Neue', file: 'BebasNeue-Regular.ttf', style: 'display', note: 'Tall condensed caps — poster staple', script: 'latin' },
  { id: 'blackopsone', name: 'Black Ops One', file: 'BlackOpsOne-Regular.ttf', style: 'display', note: 'Stencil military — bold statement', script: 'latin' },
  { id: 'bowlbyone', name: 'Bowlby One', file: 'BowlbyOne-Regular.ttf', style: 'display', note: 'Ultra-bold rounded — big and loud', script: 'latin' },
  { id: 'bungee', name: 'Bungee', file: 'Bungee-Regular.ttf', style: 'display', note: 'Urban signage — vertical-ready', script: 'latin' },
  { id: 'chewy', name: 'Chewy', file: 'Chewy-Regular.ttf', style: 'display', note: 'Soft bubbly — friendly promos', script: 'latin' },
  { id: 'fjallaone', name: 'Fjalla One', file: 'FjallaOne-Regular.ttf', style: 'display', note: 'Sturdy condensed — titles', script: 'latin' },
  { id: 'kanit', name: 'Kanit', file: 'Kanit-Bold.ttf', style: 'geometric', note: 'Loopless geometric — modern signage', script: 'latin' },
  { id: 'lobster', name: 'Lobster', file: 'Lobster-Regular.ttf', style: 'script', note: 'Bold cursive — logos & signs', script: 'latin' },
  { id: 'luckiestguy', name: 'Luckiest Guy', file: 'LuckiestGuy-Regular.ttf', style: 'display', note: 'Cartoon bold — fun promos', script: 'latin' },
  { id: 'monoton', name: 'Monoton', file: 'Monoton-Regular.ttf', style: 'display', note: 'Neon lines — retro light signs', script: 'latin' },
  { id: 'montserrat', name: 'Montserrat', file: 'Montserrat-Bold.ttf', style: 'geometric', note: 'Geometric bold — modern brands', script: 'latin' },
  { id: 'orbitron', name: 'Orbitron', file: 'Orbitron-Bold.ttf', style: 'display', note: 'Futuristic geometric — sci-fi look', script: 'latin' },
  { id: 'oswald', name: 'Oswald', file: 'Oswald-Bold.ttf', style: 'condensed', note: 'Condensed bold — classic signage', script: 'latin' },
  { id: 'pacifico', name: 'Pacifico', file: 'Pacifico-Regular.ttf', style: 'script', note: 'Brush script — friendly brands', script: 'latin' },
  { id: 'passionone', name: 'Passion One', file: 'PassionOne-Bold.ttf', style: 'display', note: 'Rounded heavy — headlines', script: 'latin' },
  { id: 'permanentmarker', name: 'Permanent Marker', file: 'PermanentMarker-Regular.ttf', style: 'script', note: 'Marker hand — casual promos', script: 'latin' },
  { id: 'poppins', name: 'Poppins', file: 'Poppins-Bold.ttf', style: 'geometric', note: 'Rounded geometric — clean ads', script: 'latin' },
  { id: 'righteous', name: 'Righteous', file: 'Righteous-Regular.ttf', style: 'display', note: 'Retro geometric display', script: 'latin' },
  { id: 'russoone', name: 'Russo One', file: 'RussoOne-Regular.ttf', style: 'display', note: 'Wide techno — sporty titles', script: 'latin' },
  { id: 'shrikhand', name: 'Shrikhand', file: 'Shrikhand-Regular.ttf', style: 'display', note: 'Vintage display — bold flair', script: 'latin' },
  { id: 'sigmarone', name: 'Sigmar One', file: 'SigmarOne-Regular.ttf', style: 'display', note: 'Fat rounded — attention-grabbing', script: 'latin' },
  { id: 'staatliches', name: 'Staatliches', file: 'Staatliches-Regular.ttf', style: 'display', note: 'Condensed caps — editorial posters', script: 'latin' },
  { id: 'teko', name: 'Teko', file: 'Teko-Bold.ttf', style: 'condensed', note: 'Tight condensed — compact signage', script: 'latin' },
  { id: 'titanone', name: 'Titan One', file: 'TitanOne-Regular.ttf', style: 'display', note: 'Chunky rounded — playful ads', script: 'latin' },
];

function listFonts() { return FONTS.map(f => ({ ...f })); }
function getFont(id) { return FONTS.find(f => f.id === id) || FONTS[0]; }

// ── تسطيح منحنيات بيزييه ──────────────────────────────────────────
// اختبار الاستواء الكلاسيكي (AGG): أقصى انحراف لنقاط التحكم عن الوتر.
function _cubicFlat(p0, p1, p2, p3, tol) {
  const ux = 3 * p1.x - 2 * p0.x - p3.x;
  const uy = 3 * p1.y - 2 * p0.y - p3.y;
  const vx = 3 * p2.x - p0.x - 2 * p3.x;
  const vy = 3 * p2.y - p0.y - 2 * p3.y;
  return (Math.max(ux * ux, vx * vx) + Math.max(uy * uy, vy * vy)) <= 16 * tol * tol;
}

function _flattenCubic(p0, p1, p2, p3, tol, out, depth) {
  if (depth >= 24 || _cubicFlat(p0, p1, p2, p3, tol)) { out.push({ x: p3.x, y: p3.y }); return; }
  // تقسيم de Casteljau عند 0.5
  const p01  = _mid(p0, p1),  p12 = _mid(p1, p2),  p23 = _mid(p2, p3);
  const p012 = _mid(p01, p12), p123 = _mid(p12, p23);
  const m    = _mid(p012, p123);
  _flattenCubic(p0, p01, p012, m, tol, out, depth + 1);
  _flattenCubic(m, p123, p23, p3, tol, out, depth + 1);
}
function _mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

// رفع منحنى تربيعي إلى تكعيبي ثم تسطيحه
function _flattenQuad(p0, c, p3, tol, out) {
  const c1 = { x: p0.x + (2 / 3) * (c.x - p0.x), y: p0.y + (2 / 3) * (c.y - p0.y) };
  const c2 = { x: p3.x + (2 / 3) * (c.x - p3.x), y: p3.y + (2 / 3) * (c.y - p3.y) };
  _flattenCubic(p0, c1, c2, p3, tol, out, 0);
}

/**
 * تسطيح أوامر مسار opentype إلى كنتورات.
 * @returns {Array<Array<{x,y}>>} كل كنتور مصفوفة نقاط (مغلق ضمنياً)
 */
function flatten(commands, tol) {
  const contours = [];
  let cur = null, start = null, pen = null;
  const t = Math.max(0.01, tol || 1);
  for (const cmd of (commands || [])) {
    switch (cmd.type) {
      case 'M':
        if (cur && cur.length > 1) contours.push(cur);
        cur = [{ x: cmd.x, y: cmd.y }];
        start = { x: cmd.x, y: cmd.y };
        pen = start;
        break;
      case 'L':
        cur.push({ x: cmd.x, y: cmd.y });
        pen = { x: cmd.x, y: cmd.y };
        break;
      case 'Q': {
        const end = { x: cmd.x, y: cmd.y };
        _flattenQuad(pen, { x: cmd.x1, y: cmd.y1 }, end, t, cur);
        pen = end;
        break;
      }
      case 'C': {
        const end = { x: cmd.x, y: cmd.y };
        _flattenCubic(pen, { x: cmd.x1, y: cmd.y1 }, { x: cmd.x2, y: cmd.y2 }, end, t, cur, 0);
        pen = end;
        break;
      }
      case 'Z':
        if (cur && start) { cur.push({ x: start.x, y: start.y }); }
        if (cur && cur.length > 1) contours.push(cur);
        cur = null;
        break;
      default: break;
    }
  }
  if (cur && cur.length > 1) contours.push(cur);
  return contours;
}

// مساحة موقّعة لكنتور (>0 = عكس عقارب الساعة في نظام y-لأعلى)
function signedArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/**
 * تخطيط تتابع الحروف المُشكَّل إلى كنتورات mm.
 * @param {Object} o
 * @param {Array}  o.run         مخرجات HarfBuzz: [{glyphId, ax, ay, dx, dy}]
 * @param {Object} o.glyphPaths  glyphId -> {commands}
 * @param {Number} o.unitsPerEm
 * @param {Number} o.heightMM    ارتفاع النص الناتج (حسب المحيط الفعلي)
 * @param {Number} [o.letterSpacing] تباعد إضافي بين الحروف (جزء من em)
 * @param {Number} [o.curveTol]  تساهل التسطيح (جزء من em، افتراضي 0.0025)
 * @returns {{contours, width, height, scale, glyphCount, contourCount, pointCount}}
 */
function layout(o) {
  const run        = o.run || [];
  const glyphPaths = o.glyphPaths || {};
  const upm        = o.unitsPerEm || 1000;
  const heightMM   = Math.max(0.1, o.heightMM || 20);
  const spacingU   = (o.letterSpacing || 0) * upm;
  const tolU       = (o.curveTol != null ? o.curveTol : 0.0025) * upm;

  // 1) تجميع الكنتورات في وحدات الخط (y لأعلى)
  //    نحتفظ بتجميع كل حرفٍ على حدة (rawGroups): العرض الصحيح للخطّ المتّصل
  //    يرسم كلّ حرفٍ بمسارٍ مستقلٍّ بقاعدة even-odd، فتظهر تراكبات الوصلات ملأى
  //    (نموذج الرسّام) بدل أن تتلاشى حين تُجمع كلّ الحروف في مسارٍ واحد — وهو
  //    حلٌّ مستقلٌّ عن اصطلاح لفّ الخطّ (يختلف بين الخطوط) وبلا أي حساب boolean.
  let penX = 0;
  const raw = [];
  const rawGroups = [];
  for (const g of run) {
    const cmds = glyphPaths[g.glyphId];
    if (cmds && cmds.length) {
      const cs = flatten(cmds, tolU);
      const ox = penX + (g.dx || 0);
      const oy = (g.dy || 0);
      const grp = [];
      for (const c of cs) {
        const cc = c.map(p => ({ x: p.x + ox, y: p.y + oy }));
        raw.push(cc);
        grp.push(cc);
      }
      if (grp.length) rawGroups.push(grp);
    }
    penX += (g.ax || 0) + spacingU;
  }

  // 2) المحيط
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of raw) for (const p of c) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  if (!isFinite(minX)) {
    return { contours: [], width: 0, height: 0, scale: 0, glyphCount: run.length, contourCount: 0, pointCount: 0 };
  }
  const hU = Math.max(1e-6, maxY - minY);
  const k  = heightMM / hU;

  // 3) القياس + النقل للأصل أسفل-يسار
  const tf = c => c.map(p => ({ x: (p.x - minX) * k, y: (p.y - minY) * k }));
  let pts = 0;
  const contours = raw.map(c => { pts += c.length; return tf(c); });
  const groups = rawGroups.map(grp => grp.map(tf));

  return {
    contours,
    groups,
    width:  (maxX - minX) * k,
    height: (maxY - minY) * k,
    scale:  k,
    glyphCount:   run.length,
    contourCount: contours.length,
    pointCount:   pts,
  };
}

/** تحويل الكنتورات إلى أشكال مضلّع جاهزة لـ GCodeGenerator */
function contoursToShapes(contours, extra) {
  extra = extra || {};
  const shapes = [];
  for (const c of contours) {
    if (!c || c.length < 3) continue;
    // إزالة نقطة الإغلاق المكرّرة إن وُجدت (المضلّع مغلق ضمنياً)
    let points = c;
    const a = c[0], b = c[c.length - 1];
    if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6) points = c.slice(0, -1);
    if (points.length < 3) continue;
    shapes.push(Object.assign({ type: 'polygon', points: points.map(p => ({ x: p.x, y: p.y })) }, extra));
  }
  return shapes;
}

return { FONTS, listFonts, getFont, flatten, signedArea, layout, contoursToShapes };
}));
