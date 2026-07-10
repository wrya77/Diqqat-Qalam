'use strict';
const GCodeValidator = require('../src/utils/GCodeValidator');

/**
 * GCodeValidator drives a physical CNC machine — bad G-code can crash the
 * spindle or ruin material. These tests pin the safety rules.
 */
describe('GCodeValidator', () => {
  const validate = (gcode, cfg) => new GCodeValidator(cfg).validate(gcode);

  test('clean program: spindle on, feed set, homed at end → valid, no findings', () => {
    const r = validate([
      'G21', 'G90',
      'M03 S1000',
      'G0 X0 Y0 Z5',
      'G1 Z-1 F100',
      'G1 X10 Y10 F300',
      'G0 Z5',
      'M05', 'M30',
    ].join('\n'));
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
    expect(r.summary).toBe('0 خطأ, 0 تحذير');
  });

  test('cutting move (G1) with no feed rate anywhere → error', () => {
    const r = validate(['M03', 'G1 X10 Y10', 'M05'].join('\n'));
    expect(r.valid).toBe(false);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].line).toBe(2);
    expect(r.errors[0].msg).toMatch(/بدون تغذية/);
  });

  test('a feed rate seen earlier suppresses the missing-F error', () => {
    const r = validate(['M03', 'G1 Z-1 F120', 'G1 X10 Y10', 'M05'].join('\n'));
    expect(r.errors).toHaveLength(0);
  });

  test('cutting move while spindle is off → warning', () => {
    const r = validate('G1 X10 Y10 F100');
    expect(r.errors).toHaveLength(0);
    expect(r.warnings.some(w => /بدون تشغيل المغزل/.test(w.msg))).toBe(true);
  });

  test('spindle left running at end of program → warning', () => {
    const r = validate(['M03', 'G1 X10 F100'].join('\n'));
    expect(r.warnings.some(w => /المغزل لا يزال يعمل/.test(w.msg))).toBe(true);
  });

  test('travel beyond machine X limit → warning', () => {
    const r = validate(['M03', 'G1 X500 Y0 F100', 'M05'].join('\n'), { travelX: 300 });
    expect(r.warnings.some(w => /يتجاوز الحد/.test(w.msg))).toBe(true);
  });

  test('Z deeper than the Z limit → warning', () => {
    const r = validate(['M03', 'G1 Z-50 F100', 'M05'].join('\n'), { travelZ: 40 });
    expect(r.warnings.some(w => /أعمق من حد Z/.test(w.msg))).toBe(true);
  });

  test('comment-only lines (parentheses and semicolons) are ignored', () => {
    const r = validate(['(header comment)', '; a note', 'M03', 'M05'].join('\n'));
    expect(r.errors).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });

  test('modal G persists: a G1 keeps subsequent bare coordinate lines as cutting', () => {
    // no spindle → each cutting line warns; line 2 has no G word but inherits G1
    const r = validate(['G1 X0 Y0 F100', 'X10 Y10'].join('\n'));
    const cutWarnings = r.warnings.filter(w => /بدون تشغيل المغزل/.test(w.msg));
    expect(cutWarnings).toHaveLength(2);
  });

  test('no travel limits given → coordinates never trigger travel warnings', () => {
    const r = validate(['M03', 'G1 X99999 Y99999 Z-99999 F100', 'M05'].join('\n'));
    expect(r.warnings.some(w => /يتجاوز الحد|أعمق من حد/.test(w.msg))).toBe(false);
  });
});
