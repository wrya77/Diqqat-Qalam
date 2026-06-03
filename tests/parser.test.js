'use strict';
const { JSDOM } = require('jsdom');
global.DOMParser = new JSDOM('').window.DOMParser;
const SVGParser = require('../src/parsers/SVGParser');
const DXFParser = require('../src/parsers/DXFParser');

describe('SVGParser', () => {
  let p;
  beforeEach(() => { p = new SVGParser(); });

  const wrap = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">${inner}</svg>`;

  test('parses line', () => {
    const s = p.parse(wrap('<line x1="10" y1="20" x2="50" y2="60"/>'));
    expect(s[0]).toMatchObject({type:'line',x1:10,y1:20,x2:50,y2:60});
  });

  test('parses rect', () => {
    const s = p.parse(wrap('<rect x="5" y="5" width="90" height="40"/>'));
    expect(s[0]).toMatchObject({type:'rect',w:90,h:40});
  });

  test('parses circle', () => {
    const s = p.parse(wrap('<circle cx="50" cy="50" r="30"/>'));
    expect(s[0]).toMatchObject({type:'circle',cx:50,cy:50,r:30});
  });

  test('parses polyline', () => {
    const s = p.parse(wrap('<polyline points="0,0 50,0 50,50"/>'));
    expect(s[0].type).toBe('polyline');
    expect(s[0].points.length).toBe(3);
  });

  test('parses polygon as closed polyline', () => {
    const s = p.parse(wrap('<polygon points="0,0 100,0 50,100"/>'));
    expect(s[0].closed).toBe(true);
  });

  test('parses path M L Z', () => {
    const s = p.parse(wrap('<path d="M 10 10 L 90 10 L 90 90 Z"/>'));
    expect(s.length).toBeGreaterThan(0);
    expect(s[0].type).toBe('polyline');
  });

  test('throws on invalid SVG', () => {
    expect(()=>p.parse('not svg at all <<<')).toThrow();
  });
});

describe('DXFParser', () => {
  let p;
  beforeEach(() => { p = new DXFParser(); });

  test('parses LINE entity', () => {
    const dxf = `0\nSECTION\n2\nENTITIES\n0\nLINE\n8\n0\n10\n5.0\n20\n10.0\n11\n50.0\n21\n60.0\n0\nENDSEC\n0\nEOF`;
    const s = p.parse(dxf);
    expect(s.length).toBeGreaterThan(0);
    expect(s[0].type).toBe('line');
  });

  test('returns empty array for empty DXF', () => {
    expect(p.parse('')).toEqual([]);
  });
});
