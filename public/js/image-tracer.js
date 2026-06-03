/**
 * image-tracer.js — تحويل الصور النقطية إلى مسارات CNC
 * خوارزمية: Contour Tracing + Ramer-Douglas-Peucker simplification
 */
class ImageTracer {
  constructor() {
    this.threshold = 128;
    this.simplify  = 1.5;   // RDP epsilon (pixels)
    this.invert    = false;
    this.minPts    = 4;     // حذف المسارات الأقصر من N نقطة
    this.blur      = true;  // تمويه بسيط لتقليل الضجيج
  }

  /* ── رسم الخطوط الناتجة على canvas للمعاينة ── */
  preview(shapes, canvas) {
    if (!canvas || !shapes.length) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // حساب Bounding box
    let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity;
    for (const s of shapes) {
      for (const p of s.points) {
        minX=Math.min(minX,p.x); maxX=Math.max(maxX,p.x);
        minY=Math.min(minY,p.y); maxY=Math.max(maxY,p.y);
      }
    }
    const pad=10, dw=maxX-minX||1, dh=maxY-minY||1;
    const sc=Math.min((canvas.width-pad*2)/dw,(canvas.height-pad*2)/dh);
    const ox=pad-minX*sc, oy=pad-minY*sc;

    ctx.strokeStyle = '#3fb950';
    ctx.lineWidth   = 1;
    for (const s of shapes) {
      if (!s.points.length) continue;
      ctx.beginPath();
      ctx.moveTo(s.points[0].x*sc+ox, s.points[0].y*sc+oy);
      for (let i=1;i<s.points.length;i++) ctx.lineTo(s.points[i].x*sc+ox, s.points[i].y*sc+oy);
      if (s.closed) ctx.closePath();
      ctx.stroke();
    }
  }

  /* ── نقطة الدخول الرئيسية ── */
  trace(imgEl, opts = {}) {
    this.threshold = opts.threshold ?? 128;
    this.simplify  = opts.simplify  ?? 1.5;
    this.invert    = opts.invert    ?? false;

    const MAX = 1000;
    let w = imgEl.naturalWidth  || imgEl.width;
    let h = imgEl.naturalHeight || imgEl.height;
    const ratio = Math.min(MAX/w, MAX/h, 1);
    w = Math.round(w * ratio);
    h = Math.round(h * ratio);

    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    const ctx = off.getContext('2d');
    ctx.drawImage(imgEl, 0, 0, w, h);
    const imgData = ctx.getImageData(0, 0, w, h);

    const bin  = this._toBinary(imgData.data, w, h);
    const cont = this._traceContours(bin, w, h);
    const shapes = this._toShapes(cont, opts.scale || 1, ratio);
    return shapes;
  }

  /* ── تحويل بيانات البيكسل إلى ثنائي ── */
  _toBinary(data, w, h) {
    const bin = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      const gray = 0.299*data[o] + 0.587*data[o+1] + 0.114*data[o+2];
      const alpha = data[o+3];
      let v = (alpha > 20 && gray < this.threshold) ? 1 : 0;
      if (this.invert) v ^= 1;
      bin[i] = v;
    }
    if (this.blur) this._simpleBlur(bin, w, h);
    return bin;
  }

  /* تمويه 3×3 لإزالة الضجيج */
  _simpleBlur(bin, w, h) {
    const tmp = new Uint8Array(w * h);
    for (let y = 1; y < h-1; y++) {
      for (let x = 1; x < w-1; x++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++)
            sum += bin[(y+dy)*w+(x+dx)];
        tmp[y*w+x] = sum >= 5 ? 1 : 0;
      }
    }
    for (let i = 0; i < w*h; i++) bin[i] = tmp[i];
  }

  /* ── خوارزمية Square Tracing لاستخراج الحدود ── */
  _traceContours(bin, w, h) {
    const visited = new Uint8Array(w * h);
    const contours = [];
    const get = (x, y) => x>=0 && x<w && y>=0 && y<h ? bin[y*w+x] : 0;

    // الاتجاهات: يمين، أسفل-يمين، أسفل، أسفل-يسار، يسار، أعلى-يسار، أعلى، أعلى-يمين
    const DX = [1, 1, 0,-1,-1,-1, 0, 1];
    const DY = [0, 1, 1, 1, 0,-1,-1,-1];

    for (let sy = 0; sy < h; sy++) {
      for (let sx = 0; sx < w; sx++) {
        if (!bin[sy*w+sx] || visited[sy*w+sx]) continue;

        // تحقق من أنها بكسل حدود
        const isEdge = !get(sx-1,sy) || !get(sx+1,sy) || !get(sx,sy-1) || !get(sx,sy+1);
        if (!isEdge) continue;

        const pts = [];
        let x = sx, y = sy, dir = 0;
        let steps = 0;
        const MAX_STEPS = 50000;

        do {
          if (!visited[y*w+x]) { visited[y*w+x] = 1; pts.push(x, y); }
          // استدر يساراً حتى تجد بكسل ممتلئ
          const left = (dir + 6) & 7;
          let found = false;
          for (let t = 0; t < 8; t++) {
            const d = (left + t) & 7;
            const nx = x + DX[d], ny = y + DY[d];
            if (get(nx, ny)) { x=nx; y=ny; dir=d; found=true; break; }
          }
          if (!found) break;
          steps++;
        } while ((x !== sx || y !== sy) && steps < MAX_STEPS);

        // حوّل البيانات الخام إلى [{x,y}]
        const points = [];
        for (let i = 0; i < pts.length; i += 2) points.push({ x: pts[i], y: pts[i+1] });

        if (points.length >= this.minPts) contours.push(points);
      }
    }

    return contours;
  }

  /* ── تحويل الحدود إلى أشكال مع التبسيط والتحجيم ── */
  _toShapes(contours, scaleMM, resizeRatio) {
    const s = scaleMM / resizeRatio; // تصحيح تقليص الصورة
    return contours.map(pts => {
      const simple = this._rdp(pts, this.simplify);
      const closed = simple.length > 3 &&
        Math.hypot(simple[0].x - simple[simple.length-1].x,
                   simple[0].y - simple[simple.length-1].y) < 3;
      return {
        type: 'polyline',
        points: simple.map(p => ({ x: p.x * s, y: p.y * s })),
        closed,
      };
    }).filter(s => s.points.length >= 2);
  }

  /* ── Ramer-Douglas-Peucker ── */
  _rdp(pts, eps) {
    if (pts.length <= 2) return pts;
    let dmax = 0, idx = 0;
    const end = pts.length - 1;
    for (let i = 1; i < end; i++) {
      const d = this._pdist(pts[i], pts[0], pts[end]);
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax > eps) {
      const r1 = this._rdp(pts.slice(0, idx+1), eps);
      const r2 = this._rdp(pts.slice(idx), eps);
      return [...r1.slice(0,-1), ...r2];
    }
    return [pts[0], pts[end]];
  }

  _pdist(p, a, b) {
    const dx=b.x-a.x, dy=b.y-a.y, len=Math.hypot(dx,dy);
    if (!len) return Math.hypot(p.x-a.x, p.y-a.y);
    return Math.abs(dx*(a.y-p.y)-(a.x-p.x)*dy)/len;
  }
}

window.ImageTracer = ImageTracer;
