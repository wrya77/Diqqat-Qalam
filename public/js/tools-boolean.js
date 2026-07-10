/**
 * tools-boolean.js — العمليات المنطقية على الأشكال المحددة
 *
 *   توحيد (union) · تقاطع (intersect) · طرح (difference) · استبعاد (xor)
 *
 * تأخذ شكلين فأكثر من التحديد المتعدد، تحوّلها إلى مسارات مغلقة، تطبّق العملية
 * عبر DQ.PolyBoolean، وتُنتج شكلاً مركّباً واحداً (compound) — قد يحوي ثقوباً.
 * النتيجة تُقطع وتُصدَّر كـ G-Code تماماً مثل بقية الأشكال.
 *
 * يُحمَّل بعد tools-cnc.js (يستعمل _selIndices و _toClosedPoints) وقبل menu-bar.js.
 * يعتمد على shared/PolyBoolean.js (DQ.PolyBoolean).
 */
(function booleanTools() {
  'use strict';
  const P = CanvasEditor.prototype;
  const toast = (m, t) => window.app?.toast?.(m, t || 'info');

  const OP_LABEL = {
    union:      'التوحيد',
    intersect:  'التقاطع',
    difference: 'الطرح',
    xor:        'الاستبعاد',
  };

  function lib() {
    return (typeof DQ !== 'undefined' && DQ.PolyBoolean)
      || (typeof window !== 'undefined' && window.DQ && window.DQ.PolyBoolean)
      || null;
  }

  /* تحويل أي شكل مغلق إلى مصفوفة مسارات [[{x,y}…], …] */
  P._shapeToContours = function (s) {
    if (!s) return null;
    if (s.type === 'compound') {
      return (s.contours || []).map(r => r.map(p => ({ x: p.x, y: p.y })));
    }
    if (s.type === 'slot') return [this._slotPoints(s)];
    const pts = this._toClosedPoints ? this._toClosedPoints(s, 1.0) : null;
    return (pts && pts.length >= 3) ? [pts] : null;
  };

  /* نقاط مغلقة لشكل slot (كبسولة) — _toClosedPoints لا يدعمه */
  P._slotPoints = function (s) {
    const { cx1, cy1, cx2, cy2, r } = s;
    const ang = Math.atan2(cy2 - cy1, cx2 - cx1), segs = 24, pts = [];
    for (let i = 0; i <= segs; i++) { const a = ang - Math.PI / 2 + (i / segs) * Math.PI; pts.push({ x: cx2 + r * Math.cos(a), y: cy2 + r * Math.sin(a) }); }
    for (let i = 0; i <= segs; i++) { const a = ang + Math.PI / 2 + (i / segs) * Math.PI; pts.push({ x: cx1 + r * Math.cos(a), y: cy1 + r * Math.sin(a) }); }
    return pts;
  };

  /**
   * العملية المنطقية الرئيسية
   * @param {'union'|'intersect'|'difference'|'xor'} op
   *
   * الاصطلاح (كما في Illustrator): الأشكال الأحدث (الأعلى ترتيباً) تُطرح من
   * الأقدم (الأسفل). التوحيد/التقاطع/الاستبعاد مستقلّة عن الترتيب فعلياً.
   */
  P.booleanOp = function (op) {
    const PB = lib();
    if (!PB) return toast('محرّك العمليات المنطقية غير مُحمَّل', 'error');
    if (!OP_LABEL[op]) return;

    const idx = (this._selIndices ? this._selIndices() : [])
      .slice().sort((a, b) => a - b);
    if (idx.length < 2) {
      return toast('حدّد شكلين أو أكثر أولاً (Shift+نقر أو Ctrl+A)', 'warn');
    }

    // حوّل كل شكل إلى مسارات مغلقة
    const polys = [];
    for (const i of idx) {
      const c = this._shapeToContours(this.shapes[i]);
      if (!c) return toast('تعذّر: بعض الأشكال مفتوحة (خط/قوس/مسار مفتوح)', 'warn');
      polys.push(c);
    }

    // اطوِ العملية تباعاً على كل الأشكال
    let result;
    try {
      result = polys[0];
      for (let k = 1; k < polys.length; k++) {
        result = PB.operate(result, polys[k], op);
        if (!result.length && op === 'intersect') break;
      }
    } catch (e) {
      console.error('[boolean]', e);
      return toast('تعذّرت العملية على هذه الأشكال', 'error');
    }

    if (!result || !result.length) {
      return toast(`نتيجة ${OP_LABEL[op]} فارغة`, 'warn');
    }

    // ابنِ شكلاً مركّباً واحداً واستبدل به الأصول
    this._saveHistory();
    const compound = { type: 'compound', contours: result, op };
    idx.slice().sort((a, b) => b - a).forEach(i => this.shapes.splice(i, 1)); // من الأعلى للأسفل
    this.shapes.push(compound);

    const newIdx = this.shapes.length - 1;
    if (this.msel) { this.msel.clear(); this.msel.add(newIdx); }
    this.selectedIdx = newIdx;
    this._updateShapeToolbar?.();
    this.render(); this._updateStatus();

    const extra = result.length > 1 ? ` — ${result.length} مسارات` : '';
    toast(`✓ ${OP_LABEL[op]}${extra}`, 'success');
  };

  /* تفكيك شكل مركّب إلى مسارات polyline منفصلة (عملية عكسية مفيدة) */
  P.breakCompound = function () {
    if (this.selectedIdx < 0) return toast('حدّد شكلاً مركّباً', 'warn');
    const s = this.shapes[this.selectedIdx];
    if (s.type !== 'compound') return toast('الشكل المحدد ليس مركّباً', 'warn');
    this._saveHistory();
    const parts = (s.contours || [])
      .filter(r => r && r.length >= 3)
      .map(r => ({ type: 'polyline', points: r.map(p => ({ x: p.x, y: p.y })), closed: true }));
    this.shapes.splice(this.selectedIdx, 1, ...parts);
    this.selectedIdx = -1;
    if (this.msel) this.msel.clear();
    this._updateShapeToolbar?.();
    this.render(); this._updateStatus();
    toast(`✓ فُكّك إلى ${parts.length} مسار`, 'success');
  };
})();
