/**
 * editor-core.js — بنية أوامر مركزية للمحرر (المرحلة P1)
 *
 * ثلاث لبنات مستقلّة عن DOM، قابلة للاختبار في Node:
 *   • EditorEvents — ناقل أحداث بسيط (scene:changed / selection:changed / history:changed).
 *   • CommandBus   — سجلّ تراجع/إعادة قائم على أوامر: لقطة (snapshot) للتوافق الرجعي،
 *                    وأوامر دلتا (move) لا تنسخ المشهد → تراجع فوري O(المتأثّر) لا O(المشهد).
 *   • ToolManager  — تسجيل الأدوات ذاتياً؛ يُنهي الاعتماد على ترتيب تحميل السكربتات.
 *
 * القديم يبقى يعمل: `_saveHistory()` يُترجَم إلى لقطة، و`editor.history`/`redoStack`
 * تبقى مصفوفات حيّة (طولها = توفّر التراجع) كما يقرؤها app.js و tools-effects.js.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  const DQ = (root.DQ = root.DQ || {});
  DQ.EditorCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ════════════════════════ EditorEvents ════════════════════════ */
  class EditorEvents {
    constructor() { this._map = new Map(); }

    /** يشترك في حدث؛ يُعيد دالة إلغاء الاشتراك. */
    on(type, fn) {
      if (typeof fn !== 'function') return () => {};
      let set = this._map.get(type);
      if (!set) { set = new Set(); this._map.set(type, set); }
      set.add(fn);
      return () => this.off(type, fn);
    }

    once(type, fn) {
      const off = this.on(type, (p) => { off(); fn(p); });
      return off;
    }

    off(type, fn) {
      const set = this._map.get(type);
      if (set) { set.delete(fn); if (!set.size) this._map.delete(type); }
    }

    /** يُطلق الحدث؛ خطأ مستمع واحد لا يُسقط البقية. */
    emit(type, payload) {
      const set = this._map.get(type);
      if (!set) return;
      for (const fn of Array.from(set)) {
        try { fn(payload); }
        catch (err) { try { console.error('[EditorEvents] ' + type, err); } catch (_) {} }
      }
    }
  }

  /* ════════════════════════ الأوامر ════════════════════════ */
  // كل أمر: { apply(ctx), invert(ctx), [mergeKey], [absorb(next)→bool] }
  // ctx (يوفّره المحرر): { shapes, cloneShapes(), setShapes(arr), offsetShape(s,dx,dy) }

  /** أمر دلتا: إزاحة مجموعة أشكال — لا ينسخ المشهد إطلاقاً. */
  function moveCommand(indices, dx, dy) {
    return {
      kind: 'move',
      mergeKey: 'move:' + indices.join(','),
      idx: indices.slice(),
      dx, dy,
      apply(ctx)  { for (const i of this.idx) { const s = ctx.shapes[i]; if (s) ctx.offsetShape(s,  this.dx,  this.dy); } },
      invert(ctx) { for (const i of this.idx) { const s = ctx.shapes[i]; if (s) ctx.offsetShape(s, -this.dx, -this.dy); } },
      absorb(next) {
        if (!next || next.mergeKey !== this.mergeKey) return false;
        this.dx += next.dx; this.dy += next.dy; return true;
      },
    };
  }

  /** أمر لقطة كاملة — جسر التوافق مع `_saveHistory()`. before ثابت، after يُغلق لاحقاً. */
  function snapshotCommand(before) {
    return {
      kind: 'snapshot',
      before,
      after: null,
      apply(ctx)  { ctx.setShapes(this.after != null ? this.after : this.before); },
      invert(ctx) { ctx.setShapes(this.before); },
    };
  }

  /* ════════════════════════ CommandBus ════════════════════════ */
  class CommandBus {
    /** @param {{ctx:object, events?:EditorEvents, limit?:number, mergeMs?:number}} opts */
    constructor(opts) {
      opts = opts || {};
      this.ctx    = opts.ctx;
      this.events = opts.events || null;
      this.limit  = opts.limit || 100;
      this.mergeMs = opts.mergeMs != null ? opts.mergeMs : 500;
      this.undoStack = [];
      this.redoStack = [];
      this._open = null;          // لقطة مفتوحة بانتظار إغلاق after
      this._mergeUntil = 0;
      this._now = () => (typeof Date !== 'undefined' ? Date.now() : 0);
    }

    get canUndo() { return this.undoStack.length > 0 || this._open != null; }
    get canRedo() { return this.redoStack.length > 0; }

    /** يُغلق لقطة مفتوحة بقراءة الحالة النهائية؛ يُسقطها إن لم يتغيّر شيء. */
    _finalizeOpen() {
      const o = this._open;
      if (!o) return;
      this._open = null;
      // إن أُزيلت اللقطة من القمة (مثلاً history.pop في tools-effects) فلا تُكمِلها
      if (this.undoStack[this.undoStack.length - 1] !== o) return;
      o.after = this.ctx.cloneShapes();
      if (_sameShapes(o.before, o.after)) this.undoStack.pop();  // تعديل صِفري → أسقطه
    }

    /** يفتح لقطة (نظير `_saveHistory`): تُدفع فوراً كي يعكس طول المكدس التوفّر. */
    openSnapshot() {
      this._finalizeOpen();
      const cmd = snapshotCommand(this.ctx.cloneShapes());
      this.undoStack.push(cmd);
      if (this.undoStack.length > this.limit) this.undoStack.shift();
      this.redoStack.length = 0;
      this._open = cmd;
      this._mergeUntil = 0;
      this._emit();
      return cmd;
    }

    /** يسجّل أمراً *نُفّذ مسبقاً* (المشهد تغيّر فعلاً)؛ يدمج المتتالي داخل النافذة الزمنية. */
    run(cmd, o) {
      const merge = !o || o.merge !== false;
      this._finalizeOpen();
      const now = this._now();
      const top = this.undoStack[this.undoStack.length - 1];
      if (merge && top && cmd.mergeKey != null && top.mergeKey === cmd.mergeKey &&
          now <= this._mergeUntil && typeof top.absorb === 'function' && top.absorb(cmd)) {
        // دُمج داخل القمة — لا مُدخل جديد
      } else {
        this.undoStack.push(cmd);
        if (this.undoStack.length > this.limit) this.undoStack.shift();
      }
      this.redoStack.length = 0;
      this._mergeUntil = now + this.mergeMs;
      this._emit();
      return cmd;
    }

    undo() {
      this._finalizeOpen();
      const cmd = this.undoStack.pop();
      if (!cmd) return false;
      cmd.invert(this.ctx);
      this.redoStack.push(cmd);
      this._mergeUntil = 0;
      this._emit();
      return true;
    }

    redo() {
      this._finalizeOpen();
      const cmd = this.redoStack.pop();
      if (!cmd) return false;
      cmd.apply(this.ctx);
      this.undoStack.push(cmd);
      this._mergeUntil = 0;
      this._emit();
      return true;
    }

    clear() {
      this.undoStack.length = 0;
      this.redoStack.length = 0;
      this._open = null;
      this._mergeUntil = 0;
      this._emit();
    }

    _emit() {
      if (this.events) this.events.emit('history:changed', { canUndo: this.canUndo, canRedo: this.canRedo });
    }
  }

  function _sameShapes(a, b) {
    try { return JSON.stringify(a) === JSON.stringify(b); }
    catch (_) { return false; }
  }

  /* ════════════════════════ ToolManager ════════════════════════ */
  class ToolManager {
    constructor(opts) {
      this._tools = new Map();
      this.events = (opts && opts.events) || null;
    }

    /**
     * تسجيل أداة ذاتياً — بلا حاجة لمعرفة أي وحدة تُحمَّل قبلها.
     * def: { cursor?, onDown?(pt,e)→bool, onMove?(pt,e)→bool, onUp?(pt,e)→bool, onDraw?(ctx) }
     * إرجاع المعالِج false يعني «لم أتعامل — كمّل السلوك الأساسي».
     */
    register(name, def) {
      if (!name || typeof name !== 'string') throw new Error('ToolManager: اسم الأداة مطلوب');
      this._tools.set(name, Object.assign({ name }, def || {}));
      if (this.events) this.events.emit('tool:registered', { name });
      return this;
    }

    unregister(name) { this._tools.delete(name); }
    has(name) { return this._tools.has(name); }
    get(name) { return this._tools.get(name) || null; }
    names()   { return Array.from(this._tools.keys()); }
  }

  return { EditorEvents, CommandBus, ToolManager, moveCommand, snapshotCommand, _sameShapes };
});
