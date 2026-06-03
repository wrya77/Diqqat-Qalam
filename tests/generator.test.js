'use strict';
const GCodeGenerator = require('../src/generators/GCodeGenerator');

describe('GCodeGenerator', () => {
  let gen;
  const baseCfg = {
    units:'mm', toolDiameter:3, totalDepth:5, passDepth:2.5,
    safeHeight:5, feedRateXY:1000, feedRateZ:300,
    spindleSpeed:18000, addComments:false, lineNumbers:false, arcDetect:true
  };

  beforeEach(() => { gen = new GCodeGenerator(baseCfg); });

  test('Header contains G21 + G90 + M03 + M30', () => {
    const { gcode } = gen.generate([]);
    expect(gcode).toContain('G21');
    expect(gcode).toContain('G90');
    expect(gcode).toContain('M03');
    expect(gcode).toContain('M30');
  });

  test('Last line is M30', () => {
    const { gcode } = gen.generate([]);
    const lines = gcode.trim().split('\n').filter(Boolean);
    expect(lines[lines.length-1]).toBe('M30');
  });

  test('Line shape generates G00 + G01', () => {
    const { gcode } = gen.generate([{type:'line',x1:0,y1:0,x2:10,y2:0}]);
    expect(gcode).toContain('G00 X0.000 Y0.000');
    expect(gcode).toContain('G01');
  });

  test('Circle shape generates G02', () => {
    const { gcode } = gen.generate([{type:'circle',cx:0,cy:0,r:5}]);
    expect(gcode).toContain('G02');
  });

  test('Two passes for 5mm depth at 2.5mm per pass', () => {
    const { gcode } = gen.generate([{type:'line',x1:0,y1:0,x2:10,y2:0}]);
    const plunges = (gcode.match(/G01 Z-/g)||[]).length;
    expect(plunges).toBe(2);
  });

  test('Stats returns estimatedTime and moves', () => {
    const { stats } = gen.generate([{type:'rect',x:0,y:0,w:10,h:10}]);
    expect(stats.estimatedTime).toBeTruthy();
    expect(stats.moves).toBeGreaterThan(0);
    expect(stats.lifts).toBeGreaterThan(0);
  });

  test('Rect perimeter ≥ 40mm for 10x10', () => {
    const { stats } = gen.generate([{type:'rect',x:0,y:0,w:10,h:10}]);
    expect(parseFloat(stats.totalXY)).toBeGreaterThanOrEqual(40);
  });

  test('Line numbers N0010 when enabled', () => {
    const g = new GCodeGenerator({...baseCfg, lineNumbers:true });
    const { gcode } = g.generate([]);
    expect(gcode).toMatch(/N\d+/);
  });

  test('Tool compensation G41 and G40', () => {
    const g = new GCodeGenerator({...baseCfg, compensation:'left'});
    const { gcode } = g.generate([]);
    expect(gcode).toContain('G41');
    expect(gcode).toContain('G40');
  });

  test('Polyline with 3 points generates 2 feedmoves', () => {
    const shape = { type:'polyline', points:[{x:0,y:0},{x:5,y:0},{x:5,y:5}], closed:false };
    const { gcode } = gen.generate([shape]);
    const feeds = (gcode.match(/G01 X/g)||[]).length;
    expect(feeds).toBeGreaterThanOrEqual(2);
  });
});

describe('GCodeGenerator — inch mode', () => {
  test('G20 when units=inch', () => {
    const g = new GCodeGenerator({ units:'inch', addComments:false });
    const { gcode } = g.generate([]);
    expect(gcode).toContain('G20');
    expect(gcode).not.toContain('G21');
  });
});
