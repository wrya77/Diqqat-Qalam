/**
 * tools-pathfinder.js — لوحة مكتشف المسارات الكاملة + أقنعة القصّ + المسارات المركّبة
 *
 *   الصفّ الأول (أوضاع الشكل):
 *     التوحيد · الطرح الأمامي · التقاطع · الاستبعاد
 *   الصفّ الثاني (مكتشف المسارات):
 *     التقسيم · القصّ · الدمج · المحاصرة · المخطّط · الطرح الخلفي
 *
 *   إضافةً إلى:
 *     قناع قصّ (Ctrl+7)         — الشكل الأعلى يقصّ ما تحته
 *     مسار مركّب (Ctrl+8)       — دمج مسارات في شكل واحد بثقوب حقيقية
 *     تمديد المظهر              — تسطيح الحدّ والتأثيرات إلى مسارات نقية
 *
 * البناء فوق DQ.PolyBoolean الموجود، وفوق P.booleanOp المُختبَر — العمليات
 * الستّ الجديدة تُشتقّ منه تركيباً لا تكراراً، فلا يصير للمحرّك مصدران.
 *
 * لا يغيّر أي id/class ولا يمسّ منطق G-Code في shared/.
 */
(function pathfinderTools() {
  'use strict';
  if (typeof CanvasEditor === 'undefined') return;
  const P = CanvasEditor.prototype;
  const toast = (m, t) => { try { window.app?.toast?.(m, t || 'info'); } catch (_) {} };
  const PB = () => (typeof DQ !== 'undefined' && DQ.PolyBoolean) || (window.DQ && window.DQ.PolyBoolean) || null;

  const sel = ed => (ed._selIndices ? ed._selIndices() : []).slice().sort((a, b) => a - b);

  /* مساحة مضلّع بصيغة Shoelace — تُستعمل لترتيب النتائج وتمييز الثقوب */
  function area(ring) {
    let a = 0;
    for (let i = 0, n = ring.length; i < n; i++) {
      const p = ring[i], q = ring[(i + 1) % n];
      a += p.x * q.y - q.x * p.y;
    }
    return a / 2;
  }
  const absArea = r => Math.abs(area(r));

  /* يحوّل كل الأشكال المحددة إلى مسارات؛ يعيد null إن كان فيها مفتوح */
  function contoursOf(ed, idx) {
    const out = [];
    for (const i of idx) {
      const c = ed._shapeToContours(ed.shapes[i]);
      if (!c || !c.length) return null;
      out.push(c);
    }
    return out;
  }

  /* يستبدل الأشكال المحددة بمجموعة نتائج، ويحدّد الجديد */
  function replaceWith(ed, idx, results, label) {
    if (!results.length) { toast(`نتيجة ${label} فارغة`, 'warn'); return false; }
    ed._saveHistory();
    const src = ed.shapes[idx[0]] || {};
    const carry = { layer: src.layer, stroke: src.stroke, sw: src.sw, maxDepth: src.maxDepth };
    idx.slice().sort((a, b) => b - a).forEach(i => ed.shapes.splice(i, 1));
    const first = ed.shapes.length;
    results.forEach(r => ed.shapes.push(Object.assign({}, carry, r)));
    if (ed.msel) { ed.msel.clear(); for (let i = first; i < ed.shapes.length; i++) ed.msel.add(i); }
    ed.selectedIdx = ed.shapes.length - 1;
    ed._updateShapeToolbar?.();
    ed.render(); ed._updateStatus?.();
    toast(`✓ ${label} — ${results.length} ${results.length === 1 ? 'مسار' : 'مسارات'}`, 'success');
    return true;
  }

  const asCompound = rings => ({ type: 'compound', contours: rings });

  /* ═══════════════ مكتشف المسارات: العمليات الستّ ═══════════════ */

  /**
   * التقسيم — كل تقاطع يفصل منطقة مستقلة.
   * الخوارزمية: لكل شكل، تقاطعه مع كل شكل آخر (منطقة مشتركة) وما تبقّى منه
   * بعد طرح الجميع (منطقة خاصّة). المناطق المشتركة تُنتَج مرّة واحدة فقط.
   */
  P.pfDivide = function () {
    const B = PB(); if (!B) return toast('محرّك العمليات غير مُحمَّل', 'error');
    const idx = sel(this);
    if (idx.length < 2) return toast('حدّد شكلين أو أكثر أولاً', 'warn');
    const cs = contoursOf(this, idx);
    if (!cs) return toast('تعذّر: بعض الأشكال مفتوحة', 'warn');

    const pieces = [];
    const push = rings => { if (rings && rings.length) pieces.push(asCompound(rings)); };

    for (let i = 0; i < cs.length; i++) {
      // ما يخصّ i وحده = i ناقص اتحاد البقية
      let own = cs[i];
      for (let j = 0; j < cs.length; j++) {
        if (i === j) continue;
        own = B.operate(own, cs[j], 'difference');
        if (!own.length) break;
      }
      push(own);
      // المناطق المشتركة: زوجاً زوجاً، ومن i إلى j فقط (i<j) فلا تتكرّر
      for (let j = i + 1; j < cs.length; j++) {
        const both = B.operate(cs[i], cs[j], 'intersect');
        if (!both.length) continue;
        // اطرح منها أي شكل ثالث لتصير المنطقة حصريّة للزوج
        let excl = both;
        for (let k = 0; k < cs.length; k++) {
          if (k === i || k === j) continue;
          excl = B.operate(excl, cs[k], 'difference');
          if (!excl.length) break;
        }
        push(excl);
        // ومنطقة الثلاثة فأكثر تظهر كقطعة مستقلّة عبر التقاطع التراكمي
        if (cs.length > 2 && i === 0 && j === 1) {
          let all = cs[0];
          for (let k = 1; k < cs.length; k++) all = B.operate(all, cs[k], 'intersect');
          push(all);
        }
      }
    }
    return replaceWith(this, idx, pieces, 'التقسيم');
  };

  /**
   * القصّ — يُبقي أجزاء الأشكال السفلى الواقعة داخل الشكل الأعلى، ويحذف الأعلى.
   * (الأعلى = آخر المحددين ترتيباً في المصفوفة.)
   */
  P.pfCrop = function () {
    const B = PB(); if (!B) return toast('محرّك العمليات غير مُحمَّل', 'error');
    const idx = sel(this);
    if (idx.length < 2) return toast('حدّد شكلين أو أكثر — الأعلى هو القاطع', 'warn');
    const cs = contoursOf(this, idx);
    if (!cs) return toast('تعذّر: بعض الأشكال مفتوحة', 'warn');
    const top = cs[cs.length - 1];
    const out = [];
    for (let i = 0; i < cs.length - 1; i++) {
      const r = B.operate(cs[i], top, 'intersect');
      if (r.length) out.push(asCompound(r));
    }
    return replaceWith(this, idx, out, 'القصّ');
  };

  /**
   * المحاصرة (Trim) — يزيل من كل شكل ما يخفيه ما فوقه، بلا دمج ألوان.
   * النتيجة: أشكال لا تتراكب أبداً، وهو ما يمنع القطع المزدوج في CNC.
   */
  P.pfTrim = function () {
    const B = PB(); if (!B) return toast('محرّك العمليات غير مُحمَّل', 'error');
    const idx = sel(this);
    if (idx.length < 2) return toast('حدّد شكلين أو أكثر أولاً', 'warn');
    const cs = contoursOf(this, idx);
    if (!cs) return toast('تعذّر: بعض الأشكال مفتوحة', 'warn');
    const out = [];
    for (let i = 0; i < cs.length; i++) {
      let r = cs[i];
      for (let j = i + 1; j < cs.length; j++) {      // كل ما فوقه
        r = B.operate(r, cs[j], 'difference');
        if (!r.length) break;
      }
      if (r.length) out.push(asCompound(r));
    }
    return replaceWith(this, idx, out, 'المحاصرة');
  };

  /**
   * الدمج (Merge) — كالمحاصرة، ثم توحيد ما تلاصق من الأجزاء الناتجة.
   * في Illustrator يوحّد المتشابه لوناً؛ هنا لا لون للقطع، فنوحّد ما تماسّ.
   */
  P.pfMerge = function () {
    const B = PB(); if (!B) return toast('محرّك العمليات غير مُحمَّل', 'error');
    const idx = sel(this);
    if (idx.length < 2) return toast('حدّد شكلين أو أكثر أولاً', 'warn');
    const cs = contoursOf(this, idx);
    if (!cs) return toast('تعذّر: بعض الأشكال مفتوحة', 'warn');
    let all = cs[0];
    for (let k = 1; k < cs.length; k++) all = B.operate(all, cs[k], 'union');
    // الاتحاد قد يعيد عدّة حلقات منفصلة — كلٌّ منها شكل مستقلّ
    const outer = all.filter(r => area(r) > 0);
    const holes = all.filter(r => area(r) <= 0);
    const out = outer.length
      ? outer.map(o => asCompound([o, ...holes.filter(h => inside(h[0], o))]))
      : [asCompound(all)];
    return replaceWith(this, idx, out, 'الدمج');
  };

  /* اختبار احتواء نقطة في حلقة (ray casting) — لإسناد الثقوب لحلقاتها */
  function inside(pt, ring) {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a.y > pt.y) !== (b.y > pt.y) &&
          pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  }

  /**
   * المخطّط (Outline) — يحوّل كل حدود النتيجة إلى خطوط مفتوحة بلا تعبئة.
   * مفيد لمعاينة مسار القطع النهائي قبل التوليد.
   */
  P.pfOutline = function () {
    const idx = sel(this);
    if (!idx.length) return toast('حدّد شكلاً أولاً', 'warn');
    const cs = contoursOf(this, idx);
    if (!cs) return toast('تعذّر: بعض الأشكال مفتوحة', 'warn');
    const out = [];
    cs.forEach(shape => shape.forEach(ring => {
      out.push({ type: 'polyline', points: ring.map(p => ({ x: p.x, y: p.y })), closed: true });
    }));
    return replaceWith(this, idx, out, 'المخطّط');
  };

  /** الطرح الخلفي — الشكل الأعلى يبقى، ويُطرح منه كل ما تحته. */
  P.pfMinusBack = function () {
    const B = PB(); if (!B) return toast('محرّك العمليات غير مُحمَّل', 'error');
    const idx = sel(this);
    if (idx.length < 2) return toast('حدّد شكلين أو أكثر أولاً', 'warn');
    const cs = contoursOf(this, idx);
    if (!cs) return toast('تعذّر: بعض الأشكال مفتوحة', 'warn');
    let r = cs[cs.length - 1];                       // الأعلى
    for (let i = cs.length - 2; i >= 0; i--) {
      r = B.operate(r, cs[i], 'difference');
      if (!r.length) break;
    }
    return replaceWith(this, idx, r.length ? [asCompound(r)] : [], 'الطرح الخلفي');
  };

  /* ═══════════════ المسار المركّب (Ctrl+8) ═══════════════ */

  /**
   * يدمج المحدد في شكل واحد بقاعدة even-odd: الحلقة داخل حلقة تصير ثقباً.
   * يختلف عن التوحيد المنطقي: لا يحسب تقاطعاً، بل يعلن العلاقة الهرمية فقط —
   * وهو ما يجعل حرفاً كـ«ه» يُقطَع بثقبه لا مصمتاً.
   */
  P.makeCompoundPath = function () {
    const idx = sel(this);
    if (idx.length < 2) return toast('حدّد مسارين أو أكثر (Ctrl+8)', 'warn');
    const cs = contoursOf(this, idx);
    if (!cs) return toast('تعذّر: بعض الأشكال مفتوحة', 'warn');

    const rings = [];
    cs.forEach(shape => shape.forEach(r => rings.push(r)));
    if (rings.length < 2) return toast('يلزم مساران مغلقان على الأقلّ', 'warn');

    // الأكبر مساحةً هو الغلاف؛ ما بداخله ثقب، وما بداخل الثقب مصمت (تعشيش)
    rings.sort((a, b) => absArea(b) - absArea(a));
    const depth = rings.map(r => rings.reduce((d, o) => (o !== r && inside(r[0], o) ? d + 1 : d), 0));
    // الاتجاه يحدّد الملء: زوجيّ = عكس عقارب، فرديّ (ثقب) = مع عقارب
    const out = rings.map((r, i) => {
      const want = depth[i] % 2 === 0 ? 1 : -1;
      return (area(r) > 0 ? 1 : -1) === want ? r : r.slice().reverse();
    });
    return replaceWith(this, idx, [asCompound(out)], 'المسار المركّب');
  };

  /** فكّ المسار المركّب إلى مسارات مستقلّة (Alt+Ctrl+8) */
  P.releaseCompoundPath = function () {
    const idx = sel(this);
    const targets = idx.filter(i => this.shapes[i] && this.shapes[i].type === 'compound');
    if (!targets.length) return toast('حدّد مساراً مركّباً أولاً', 'warn');
    const parts = [];
    targets.forEach(i => (this.shapes[i].contours || []).forEach(r => {
      if (r && r.length >= 3) parts.push({ type: 'polyline', points: r.map(p => ({ x: p.x, y: p.y })), closed: true });
    }));
    return replaceWith(this, targets, parts, 'فكّ المسار المركّب');
  };

  /* ═══════════════ قناع القصّ (Ctrl+7) ═══════════════ */

  /**
   * الشكل الأعلى يصير قناعاً: كل ما تحته يُقصّ عليه هندسياً.
   * الفرق عن «القصّ» في مكتشف المسارات أن القناع **قابل للفكّ**: نحتفظ
   * بالأشكال الأصلية داخل الشكل الناتج فيمكن استرجاعها كما كانت.
   */
  P.makeClipMask = function () {
    const B = PB(); if (!B) return toast('محرّك العمليات غير مُحمَّل', 'error');
    const idx = sel(this);
    if (idx.length < 2) return toast('حدّد الشكل المُقنَّع ثم القناع فوقه (Ctrl+7)', 'warn');
    const cs = contoursOf(this, idx);
    if (!cs) return toast('القناع وما تحته يجب أن تكون مسارات مغلقة', 'warn');

    const mask = cs[cs.length - 1];
    const originals = idx.map(i => JSON.parse(JSON.stringify(this.shapes[i])));
    const clipped = [];
    for (let i = 0; i < cs.length - 1; i++) {
      const r = B.operate(cs[i], mask, 'intersect');
      if (r.length) clipped.push(r);
    }
    if (!clipped.length) return toast('لا تقاطع بين القناع وما تحته', 'warn');

    // كل الأجزاء المقصوصة في شكل واحد يحمل ذاكرة أصله
    const rings = [];
    clipped.forEach(c => c.forEach(r => rings.push(r)));
    const out = asCompound(rings);
    out.__clip = { originals, maskIdxInSel: idx.length - 1 };
    return replaceWith(this, idx, [out], 'قناع القصّ');
  };

  /** فكّ القناع — يعيد الأشكال الأصلية والقناع كما كانا */
  P.releaseClipMask = function () {
    const idx = sel(this);
    const i = idx.find(k => this.shapes[k] && this.shapes[k].__clip);
    if (i === undefined) return toast('حدّد شكلاً مقنَّعاً أولاً', 'warn');
    const originals = this.shapes[i].__clip.originals || [];
    return replaceWith(this, [i], originals, 'فكّ القناع');
  };

  /* ═══════════════ تمديد المظهر ═══════════════ */

  /**
   * يسطّح الشكل إلى مسارات نقية: الأشكال الأوّلية (دائرة/نجمة/نصّ) تصير
   * polyline بنقاط صريحة، والحدّ السميك يصير شكلاً مملوءاً عبر outlineStroke.
   * بعد التمديد يصير كل شيء قابلاً لتحرير النقاط والعمليات المنطقية.
   */
  P.expandAppearance = function () {
    const idx = sel(this);
    if (!idx.length) return toast('حدّد شكلاً أولاً', 'warn');
    const out = [];
    let converted = 0;
    for (const i of idx) {
      const s = this.shapes[i];
      if (!s) continue;
      if (s.type === 'polyline' || s.type === 'polygon' || s.type === 'compound') {
        out.push(JSON.parse(JSON.stringify(s)));      // ممدَّد سلفاً
        continue;
      }
      const c = this._shapeToContours(s);
      if (c && c.length === 1) {
        out.push({ type: 'polyline', points: c[0].map(p => ({ x: p.x, y: p.y })), closed: true,
                   layer: s.layer, stroke: s.stroke, sw: s.sw, maxDepth: s.maxDepth });
        converted++;
      } else if (c && c.length > 1) {
        out.push(Object.assign(asCompound(c), { layer: s.layer, stroke: s.stroke, sw: s.sw, maxDepth: s.maxDepth }));
        converted++;
      } else {
        out.push(JSON.parse(JSON.stringify(s)));      // مفتوح: يُترك كما هو
      }
    }
    if (!converted) return toast('كل المحدد ممدَّد سلفاً', 'info');
    return replaceWith(this, idx, out, 'تمديد المظهر');
  };

  /* ═══════════════ اختصارات لوحة المفاتيح ═══════════════ */
  document.addEventListener('keydown', e => {
    const ed = window.app && window.app.editor;
    if (!ed) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (!e.ctrlKey && !e.metaKey) return;
    if (e.key === '7') { e.preventDefault(); e.altKey ? ed.releaseClipMask() : ed.makeClipMask(); }
    else if (e.key === '8') { e.preventDefault(); e.altKey ? ed.releaseCompoundPath() : ed.makeCompoundPath(); }
  });

  window.DQPathfinder = {
    ops: ['union', 'difference', 'intersect', 'xor',
          'divide', 'trim', 'merge', 'crop', 'outline', 'minusBack'],
  };
})();
