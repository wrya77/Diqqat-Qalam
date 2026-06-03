/**
 * DXFParser.js — تحليل ملفات DXF (AutoCAD)
 * يدعم: LINE, CIRCLE, ARC, POLYLINE, LWPOLYLINE, SPLINE (تقريب)
 */

class DXFParser {
  parse(content) {
    const shapes  = [];
    const lines   = content.split('\n').map(l => l.trim());
    let i = 0;

    while (i < lines.length) {
      const code = parseInt(lines[i]);
      const val  = (lines[i + 1] || '').trim();
      i += 2;

      if (code === 0) {
        switch (val) {
          case 'LINE':       { const s = this._readLine(lines, i);       if (s) { shapes.push(s.shape); i = s.nextI; } break; }
          case 'CIRCLE':     { const s = this._readCircle(lines, i);     if (s) { shapes.push(s.shape); i = s.nextI; } break; }
          case 'ARC':        { const s = this._readArc(lines, i);        if (s) { shapes.push(s.shape); i = s.nextI; } break; }
          case 'LWPOLYLINE': { const s = this._readLWPolyline(lines, i); if (s) { shapes.push(s.shape); i = s.nextI; } break; }
          case 'POLYLINE':   { const s = this._readPolyline(lines, i);   if (s) { shapes.push(s.shape); i = s.nextI; } break; }
          case 'SPLINE':     { const s = this._readSpline(lines, i);     if (s) { shapes.push(s.shape); i = s.nextI; } break; }
          case 'ELLIPSE':    { const s = this._readEllipse(lines, i);    if (s) { shapes.push(s.shape); i = s.nextI; } break; }
        }
      }
    }

    return shapes;
  }

  _readParams(lines, startI, stopCodes = [0]) {
    const params = {};
    let i = startI;
    while (i < lines.length) {
      const code = parseInt(lines[i]);
      const val  = (lines[i + 1] || '').trim();
      if (stopCodes.includes(code)) break;
      if (!params[code]) params[code] = [];
      params[code].push(val);
      i += 2;
    }
    return { params, nextI: i };
  }

  _v(params, code, idx = 0, def = 0) {
    return parseFloat((params[code] && params[code][idx]) || def);
  }

  _readLine(lines, i) {
    const { params, nextI } = this._readParams(lines, i);
    return {
      shape: {
        type: 'line',
        x1: this._v(params, 10), y1: this._v(params, 20),
        x2: this._v(params, 11), y2: this._v(params, 21),
      },
      nextI,
    };
  }

  _readCircle(lines, i) {
    const { params, nextI } = this._readParams(lines, i);
    return {
      shape: {
        type: 'circle',
        cx: this._v(params, 10), cy: this._v(params, 20),
        r:  this._v(params, 40),
      },
      nextI,
    };
  }

  _readArc(lines, i) {
    const { params, nextI } = this._readParams(lines, i);
    const startDeg = this._v(params, 50);
    const endDeg   = this._v(params, 51);
    return {
      shape: {
        type: 'arc',
        cx: this._v(params, 10), cy: this._v(params, 20),
        r:  this._v(params, 40),
        startAngle: startDeg * Math.PI / 180,
        endAngle:   endDeg   * Math.PI / 180,
        clockwise: false,
      },
      nextI,
    };
  }

  _readLWPolyline(lines, i) {
    const { params, nextI } = this._readParams(lines, i);
    const xs     = params[10] || [];
    const ys     = params[20] || [];
    const closed = ((params[70] && params[70][0]) || '0') === '1';
    const points = xs.map((x, idx) => ({ x: parseFloat(x), y: parseFloat(ys[idx] || 0) }));
    return {
      shape: { type: 'polyline', points, closed },
      nextI,
    };
  }

  _readPolyline(lines, i) {
    // POLYLINE يتبعه سجلات VERTEX
    const { params: polyParams, nextI: afterPoly } = this._readParams(lines, i);
    const closed = ((polyParams[70] && polyParams[70][0]) || '0') === '1';
    const points = [];
    let j = afterPoly;

    while (j < lines.length) {
      const code = parseInt(lines[j]);
      const val  = (lines[j + 1] || '').trim();
      j += 2;

      if (code === 0) {
        if (val === 'VERTEX') {
          const { params: vp, nextI: vNext } = this._readParams(lines, j);
          points.push({ x: this._v(vp, 10), y: this._v(vp, 20) });
          j = vNext;
        } else if (val === 'SEQEND') {
          break;
        }
      }
    }

    return {
      shape: { type: 'polyline', points, closed },
      nextI: j,
    };
  }

  _readSpline(lines, i) {
    const { params, nextI } = this._readParams(lines, i);
    // نقاط التحكم
    const xs = params[10] || [];
    const ys = params[20] || [];
    const points = xs.map((x, idx) => ({
      x: parseFloat(x), y: parseFloat(ys[idx] || 0)
    }));
    // تقريب Catmull-Rom
    const smooth = this._catmullRom(points);
    return {
      shape: { type: 'polyline', points: smooth, closed: false },
      nextI,
    };
  }

  _readEllipse(lines, i) {
    const { params, nextI } = this._readParams(lines, i);
    const cx  = this._v(params, 10), cy  = this._v(params, 20);
    const mex = this._v(params, 11), mey = this._v(params, 21);
    const rx  = Math.sqrt(mex * mex + mey * mey);
    const ratio = this._v(params, 40, 0, 1);
    const ry    = rx * ratio;
    const pts   = [];
    const segs  = 72;
    for (let k = 0; k <= segs; k++) {
      const a = (k / segs) * 2 * Math.PI;
      pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
    }
    return {
      shape: { type: 'polyline', points: pts, closed: true },
      nextI,
    };
  }

  // تمليس Catmull-Rom
  _catmullRom(pts, tension = 0.5) {
    if (pts.length < 2) return pts;
    const out = [pts[0]];
    const segs = 10;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[Math.min(pts.length - 1, i + 1)];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      for (let t = 1 / segs; t <= 1; t += 1 / segs) {
        const t2 = t * t, t3 = t2 * t;
        const x = 0.5 * ((2*p1.x) + (-p0.x+p2.x)*t + (2*p0.x-5*p1.x+4*p2.x-p3.x)*t2 + (-p0.x+3*p1.x-3*p2.x+p3.x)*t3);
        const y = 0.5 * ((2*p1.y) + (-p0.y+p2.y)*t + (2*p0.y-5*p1.y+4*p2.y-p3.y)*t2 + (-p0.y+3*p1.y-3*p2.y+p3.y)*t3);
        out.push({ x, y });
      }
    }
    return out;
  }
}

if (typeof module !== 'undefined') module.exports = DXFParser;
