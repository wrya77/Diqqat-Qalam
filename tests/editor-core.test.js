'use strict';
/**
 * اختبارات بنية الأوامر المركزية (P1): EditorEvents · CommandBus · ToolManager.
 * منطق خالص بلا DOM — نُحاكي editor عبر ctx بسيط.
 */
const Core = require('../public/js/editor-core');
const { EditorEvents, CommandBus, ToolManager, moveCommand } = Core;

/* ctx وهمي يماثل عقد المحرر مع CommandBus */
function makeCtx(shapes) {
  const ctx = {
    shapes,
    cloneShapes: () => JSON.parse(JSON.stringify(ctx.shapes)),
    setShapes:   (arr) => { ctx.shapes = JSON.parse(JSON.stringify(arr)); },
    offsetShape: (s, dx, dy) => { s.x += dx; s.y += dy; },
  };
  return ctx;
}

describe('EditorEvents', () => {
  test('on/emit يوصّل الحمولة، وoff يوقف', () => {
    const ev = new EditorEvents();
    const seen = [];
    const off = ev.on('x', (p) => seen.push(p));
    ev.emit('x', 1); ev.emit('x', 2);
    off();
    ev.emit('x', 3);
    expect(seen).toEqual([1, 2]);
  });

  test('once يُستدعى مرة واحدة فقط', () => {
    const ev = new EditorEvents();
    let n = 0;
    ev.once('y', () => n++);
    ev.emit('y'); ev.emit('y');
    expect(n).toBe(1);
  });

  test('خطأ مستمع لا يُسقط البقية', () => {
    const ev = new EditorEvents();
    let reached = false;
    ev.on('z', () => { throw new Error('boom'); });
    ev.on('z', () => { reached = true; });
    expect(() => ev.emit('z')).not.toThrow();
    expect(reached).toBe(true);
  });
});

describe('CommandBus — لقطات (جسر _saveHistory)', () => {
  test('openSnapshot ثم تعديل ثم undo يستعيد الحالة السابقة', () => {
    const ctx = makeCtx([{ x: 0, y: 0 }]);
    const bus = new CommandBus({ ctx });
    bus.openSnapshot();
    ctx.shapes.push({ x: 5, y: 5 });
    bus.undo();
    expect(ctx.shapes).toHaveLength(1);
    bus.redo();
    expect(ctx.shapes).toHaveLength(2);
  });

  test('طول undoStack يعكس التوفّر (يقرؤه app.js عبر history.length)', () => {
    const ctx = makeCtx([]);
    const bus = new CommandBus({ ctx });
    expect(bus.undoStack.length).toBe(0);
    bus.openSnapshot(); ctx.shapes.push({ x: 1, y: 1 });
    expect(bus.undoStack.length).toBe(1);
  });

  test('history.pop() يُلغي لقطة صِفرية بلا إفساد (نمط tools-effects)', () => {
    const ctx = makeCtx([{ x: 0, y: 0 }]);
    const bus = new CommandBus({ ctx });
    bus.openSnapshot();           // لا تغيير فعلي بعدها
    bus.undoStack.pop();          // tools-effects: لا تلوّث السجل
    bus.openSnapshot(); ctx.shapes[0].x = 9;  // تعديل حقيقي لاحق
    bus.undo();
    expect(ctx.shapes[0].x).toBe(0);   // التراجع يعكس التعديل الحقيقي لا الملغى
  });

  test('لقطة صِفرية (before==after) تُسقَط تلقائياً عند الإغلاق', () => {
    const ctx = makeCtx([{ x: 0, y: 0 }]);
    const bus = new CommandBus({ ctx });
    bus.openSnapshot();           // لم يتغيّر شيء
    bus.openSnapshot();           // الإغلاق يُسقط الأولى الفارغة
    expect(bus.undoStack.length).toBe(1);
  });
});

describe('CommandBus — أوامر الدلتا (move)', () => {
  test('undo/redo لأمر move يعكس الإزاحة بلا نسخ المشهد', () => {
    const ctx = makeCtx([{ x: 10, y: 10 }]);
    const bus = new CommandBus({ ctx });
    ctx.offsetShape(ctx.shapes[0], 5, -3);        // السحب الحيّ حدث
    bus.run(moveCommand([0], 5, -3));
    expect(ctx.shapes[0]).toEqual({ x: 15, y: 7 });
    bus.undo();
    expect(ctx.shapes[0]).toEqual({ x: 10, y: 10 });
    bus.redo();
    expect(ctx.shapes[0]).toEqual({ x: 15, y: 7 });
  });

  test('دمج أوامر move المتتالية لنفس التحديد داخل النافذة الزمنية', () => {
    const ctx = makeCtx([{ x: 0, y: 0 }]);
    const bus = new CommandBus({ ctx, mergeMs: 10000 });
    bus.run(moveCommand([0], 1, 0));
    bus.run(moveCommand([0], 2, 0));
    bus.run(moveCommand([0], 3, 0));
    expect(bus.undoStack.length).toBe(1);         // دُمجت في أمر واحد
    ctx.shapes[0].x = 6;                            // (الحيّ جمع 1+2+3)
    bus.undo();
    expect(ctx.shapes[0].x).toBe(0);               // تراجع واحد يعكس الكل
  });

  test('تعديل جديد يمسح مكدس الإعادة', () => {
    const ctx = makeCtx([{ x: 0, y: 0 }]);
    const bus = new CommandBus({ ctx });
    ctx.offsetShape(ctx.shapes[0], 1, 0); bus.run(moveCommand([0], 1, 0));
    bus.undo();
    expect(bus.canRedo).toBe(true);
    ctx.offsetShape(ctx.shapes[0], 0, 1); bus.run(moveCommand([0], 0, 1));
    expect(bus.canRedo).toBe(false);
  });

  // معيار القبول P1: undo لتحريك 500 شكل فوري (<16ms)
  test('معيار القبول: undo لتحريك 500 شكل يتم في < 16ms', () => {
    const shapes = Array.from({ length: 500 }, (_, i) => ({ x: i, y: i }));
    const ctx = makeCtx(shapes);
    const bus = new CommandBus({ ctx });
    const idx = shapes.map((_, i) => i);
    for (const i of idx) ctx.offsetShape(shapes[i], 7, 7);   // السحب الجماعي الحيّ
    bus.run(moveCommand(idx, 7, 7));
    const t0 = Date.now();
    bus.undo();
    const dt = Date.now() - t0;
    expect(shapes[0]).toEqual({ x: 0, y: 0 });
    expect(shapes[499]).toEqual({ x: 499, y: 499 });
    expect(dt).toBeLessThan(16);
  });
});

describe('ToolManager', () => {
  test('register/has/get/names — تسجيل ذاتي بلا ترتيب تحميل', () => {
    const tm = new ToolManager({});
    expect(tm.has('pen')).toBe(false);
    tm.register('pen', { cursor: 'crosshair', onDown() { return true; } });
    expect(tm.has('pen')).toBe(true);
    expect(tm.get('pen').cursor).toBe('crosshair');
    expect(tm.names()).toContain('pen');
  });

  test('يُطلق tool:registered عبر ناقل الأحداث', () => {
    const ev = new EditorEvents();
    const tm = new ToolManager({ events: ev });
    const names = [];
    ev.on('tool:registered', (p) => names.push(p.name));
    tm.register('a', {}); tm.register('b', {});
    expect(names).toEqual(['a', 'b']);
  });

  test('اسم فارغ يرمي خطأً', () => {
    const tm = new ToolManager({});
    expect(() => tm.register('', {})).toThrow();
  });
});
