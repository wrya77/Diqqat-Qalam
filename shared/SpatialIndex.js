/**
 * SpatialIndex.js — فهرس مكاني (Quadtree على مستطيلات محيطة AABB) — المرحلة P3
 *
 * يعيش في shared/ لأنه منطق هندسي محض قابل للاختبار في Node، ويخدم الواجهة
 * (hit-test والتحديد المستطيلي O(log n) بدل المسح الخطي O(n) لكل استعلام).
 *
 * كل عنصر: { id, minX, minY, maxX, maxY }. الشجرة تُبنى من مصفوفة عناصر،
 * وتدعم الإدراج/الحذف التزايُدي كي تبقى صالحة عبر استعلامات إطار السحب المتعدّدة.
 *
 * قرار التصميم: العنصر الذي يعبر حدّ التقسيم يبقى في العقدة الأمّ (لا يُكرَّر في
 * الأبناء) — يمنع الازدواج ويضمن أن كل عنصر يُزار مرة واحدة في الاستعلام.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  const DQ = (root.DQ = root.DQ || {});
  DQ.SpatialIndex = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_ITEMS = 8;   // سعة العقدة قبل الانقسام
  const MAX_DEPTH = 8;   // أقصى عمق (يمنع الانقسام اللانهائي عند التكدّس)

  function intersects(a, b) {
    return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
  }
  // هل يحتوي الوعاء box العنصرَ it احتواءً تامّاً؟
  function contains(box, it) {
    return it.minX >= box.minX && it.maxX <= box.maxX && it.minY >= box.minY && it.maxY <= box.maxY;
  }

  class QuadNode {
    constructor(bounds, depth) {
      this.bounds = bounds;      // {minX,minY,maxX,maxY}
      this.depth  = depth;
      this.items  = [];          // عناصر هذه العقدة (عابرة الحدّ أو ورقة)
      this.children = null;      // [NW, NE, SW, SE] أو null
    }

    _split() {
      const b = this.bounds;
      const mx = (b.minX + b.maxX) / 2, my = (b.minY + b.maxY) / 2;
      const d = this.depth + 1;
      this.children = [
        new QuadNode({ minX: b.minX, minY: b.minY, maxX: mx, maxY: my }, d), // NW
        new QuadNode({ minX: mx, minY: b.minY, maxX: b.maxX, maxY: my }, d), // NE
        new QuadNode({ minX: b.minX, minY: my, maxX: mx, maxY: b.maxY }, d), // SW
        new QuadNode({ minX: mx, minY: my, maxX: b.maxX, maxY: b.maxY }, d), // SE
      ];
      // أعِد توزيع العناصر الحالية على الأبناء إن أمكن احتواؤها تماماً
      const keep = [];
      for (const it of this.items) {
        const c = this._childFor(it);
        if (c) c.insert(it); else keep.push(it);
      }
      this.items = keep;
    }

    _childFor(it) {
      if (!this.children) return null;
      for (const c of this.children) if (contains(c.bounds, it)) return c;
      return null;  // يعبر حدّ التقسيم → يبقى في الأمّ
    }

    insert(it) {
      if (this.children) {
        const c = this._childFor(it);
        if (c) { c.insert(it); return; }
        this.items.push(it);
        return;
      }
      this.items.push(it);
      if (this.items.length > MAX_ITEMS && this.depth < MAX_DEPTH) this._split();
    }

    remove(id) {
      const i = this.items.findIndex(it => it.id === id);
      if (i >= 0) { this.items.splice(i, 1); return true; }
      if (this.children) for (const c of this.children) if (c.remove(id)) return true;
      return false;
    }

    query(range, out) {
      if (!intersects(this.bounds, range)) return;
      for (const it of this.items) if (intersects(it, range)) out.push(it);
      if (this.children) for (const c of this.children) c.query(range, out);
    }
  }

  class SpatialIndex {
    /** @param {{minX,minY,maxX,maxY}} [bounds] حدود عامة؛ إن غابت تُشتقّ من build. */
    constructor(bounds) {
      this._byId = new Map();
      this._root = bounds ? new QuadNode(_pad(bounds), 0) : null;
    }

    get size() { return this._byId.size; }

    /** يبني الفهرس من مصفوفة عناصر {id,minX,minY,maxX,maxY}. */
    build(items) {
      let b = null;
      for (const it of items) {
        if (!_valid(it)) continue;
        b = b ? _union(b, it) : { minX: it.minX, minY: it.minY, maxX: it.maxX, maxY: it.maxY };
      }
      this._byId.clear();
      this._root = new QuadNode(_pad(b || { minX: 0, minY: 0, maxX: 1, maxY: 1 }), 0);
      for (const it of items) if (_valid(it)) { this._byId.set(it.id, it); this._root.insert(it); }
      return this;
    }

    insert(it) {
      if (!_valid(it) || !this._root) return this;
      if (this._byId.has(it.id)) this.remove(it.id);
      if (!contains(this._root.bounds, it)) { this._grow(it); }
      this._byId.set(it.id, it);
      this._root.insert(it);
      return this;
    }

    remove(id) {
      if (!this._byId.has(id)) return false;
      this._byId.delete(id);
      return this._root ? this._root.remove(id) : false;
    }

    /** تحديث موضع عنصر (حذف ثم إدراج) — يُبقي الفهرس صالحاً أثناء السحب. */
    update(it) { return this.insert(it); }

    /** كل العناصر التي يتقاطع مستطيلها مع range. */
    queryRegion(range) {
      const out = [];
      if (this._root) this._root.query(_norm(range), out);
      return out;
    }

    /** مرشّحون قرب نقطة (± pad) — للـhit-test الدقيق لاحقاً على مجموعة صغيرة. */
    queryPoint(x, y, pad) {
      pad = pad || 0;
      return this.queryRegion({ minX: x - pad, minY: y - pad, maxX: x + pad, maxY: y + pad });
    }

    /** يوسّع الجذر ليحتوي عنصراً خارج الحدود (نادر: إضافة أبعد من المشهد المبني). */
    _grow(it) {
      const b = _pad(_union(this._root.bounds, it));
      const items = Array.from(this._byId.values());
      this._root = new QuadNode(b, 0);
      for (const e of items) this._root.insert(e);
    }
  }

  function _valid(it) {
    return it && it.id != null &&
      Number.isFinite(it.minX) && Number.isFinite(it.minY) &&
      Number.isFinite(it.maxX) && Number.isFinite(it.maxY);
  }
  function _union(a, b) {
    return {
      minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY),
      maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY),
    };
  }
  function _pad(b) {
    // هامش صغير يمنع انهيار الحدّ عند مشهد بمحور واحد (كل الأشكال على خط)
    const dx = (b.maxX - b.minX) || 1, dy = (b.maxY - b.minY) || 1;
    const p = Math.max(dx, dy) * 0.01 + 1;
    return { minX: b.minX - p, minY: b.minY - p, maxX: b.maxX + p, maxY: b.maxY + p };
  }
  function _norm(r) {
    return {
      minX: Math.min(r.minX, r.maxX), minY: Math.min(r.minY, r.maxY),
      maxX: Math.max(r.minX, r.maxX), maxY: Math.max(r.minY, r.maxY),
    };
  }

  return SpatialIndex;
});
