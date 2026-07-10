/**
 * image-tracer.js — تحويل الصور النقطية إلى مسارات CNC (محرك احترافي)
 *
 * الخوارزمية: Suzuki–Abe border following (نفس أساس OpenCV findContours)
 *   • يستخرج كل الحدود الخارجية *و* الداخلية (الثقوب) — لا تختفي الأشكال المفرّغة
 *   • بلا تمويه مدمِّر — الخطوط الرفيعة تبقى محفوظة
 *   • إزالة ضجيج غير مؤذية (نقاط معزولة فقط) بدل التآكل الشامل
 *   • تبسيط Ramer–Douglas–Peucker ثم تنعيم Chaikin اختياري
 */
class ImageTracer {
  constructor() {
    this.threshold = 128;
    this.simplify  = 1.5;   // RDP epsilon (بالبكسل)
    this.invert    = false;
    this.smooth    = true;  // تنعيم منحنيات الإخراج (Chaikin)
    this.minPts    = 3;     // أقل عدد نقاط لمسار صالح
    this.minLen    = 6;     // أقل محيط (بالبكسل) — يحذف الشوائب الصغيرة فقط
    this.MAX       = 1500;  // أقصى بُعد للمعالجة (تفاصيل أدق من 1000 السابقة)
  }

  /* ── رسم الخطوط الناتجة على canvas للمعاينة ── */
  preview(shapes, canvas) {
    if (!canvas || !shapes.length) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

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

  /* ── عتبة Otsu التلقائية: تفصل المقدمة عن الخلفية إحصائياً ── */
  computeOtsu(imgEl) {
    const MAX = 400;
    let w = imgEl.naturalWidth || imgEl.width, h = imgEl.naturalHeight || imgEl.height;
    const r = Math.min(MAX / w, MAX / h, 1);
    w = Math.round(w * r); h = Math.round(h * r);
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    const ctx = off.getContext('2d');
    ctx.drawImage(imgEl, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;

    const hist = new Float64Array(256);
    const n = w * h;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      hist[Math.round(0.299 * d[o] + 0.587 * d[o+1] + 0.114 * d[o+2])]++;
    }
    let sum = 0;
    for (let t = 0; t < 256; t++) sum += t * hist[t];

    let sumB = 0, wB = 0, best = 128, maxVar = 0;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (!wB) continue;
      const wF = n - wB;
      if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const v = wB * wF * (mB - mF) ** 2;
      if (v > maxVar) { maxVar = v; best = t; }
    }
    return best;
  }

  /* ── نقطة الدخول الرئيسية ── */
  trace(imgEl, opts = {}) {
    this.threshold = opts.threshold ?? 128;
    this.simplify  = opts.simplify  ?? 1.5;
    this.invert    = opts.invert    ?? false;
    this.smooth    = opts.smooth    ?? true;

    let w = imgEl.naturalWidth  || imgEl.width;
    let h = imgEl.naturalHeight || imgEl.height;
    const ratio = Math.min(this.MAX/w, this.MAX/h, 1);
    w = Math.round(w * ratio);
    h = Math.round(h * ratio);

    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    const ctx = off.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(imgEl, 0, 0, w, h);
    const imgData = ctx.getImageData(0, 0, w, h);

    const bin = this._toBinary(imgData.data, w, h);
    this._removeIsolated(bin, w, h);           // إزالة نقاط الضجيج المعزولة فقط
    const contours = this._findBorders(bin, w, h);   // Suzuki–Abe
    return this._toShapes(contours, opts.scale || 1, ratio);
  }

  /* ── تحويل بيانات البيكسل إلى ثنائي (بلا تآكل) ── */
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
    return bin;
  }

  /* إزالة النقاط المعزولة تماماً (0 جيران) — لا تمسّ الخطوط الرفيعة */
  _removeIsolated(bin, w, h) {
    const toClear = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!bin[y*w+x]) continue;
        let n = 0;
        for (let dy = -1; dy <= 1 && n === 0; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x+dx, ny = y+dy;
            if (nx>=0 && nx<w && ny>=0 && ny<h && bin[ny*w+nx]) { n = 1; break; }
          }
        }
        if (!n) toClear.push(y*w+x);
      }
    }
    for (const i of toClear) bin[i] = 0;
  }

  /* ══ Suzuki–Abe: تتبّع كل الحدود (خارجية + ثقوب داخلية) ══ */
  _findBorders(bin, w, h) {
    const W = w + 2, H = h + 2;            // إطار صفري يلغي فحوص الحدود
    const f = new Int32Array(W * H);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (bin[y*w+x]) f[(y+1)*W + (x+1)] = 1;

    // جيران باتجاه عقارب الساعة: شرق، جنوب-شرق، جنوب، ... [dy, dx]
    const cw = [[0,1],[1,1],[1,0],[1,-1],[0,-1],[-1,-1],[-1,0],[-1,1]];
    // خريطة (dy,dx) → فهرس الاتجاه
    const DIRMAP = new Int8Array(9);
    DIRMAP[5]=0; DIRMAP[8]=1; DIRMAP[7]=2; DIRMAP[6]=3;
    DIRMAP[3]=4; DIRMAP[0]=5; DIRMAP[1]=6; DIRMAP[2]=7;
    const dirOf = (dy, dx) => DIRMAP[(dy+1)*3 + (dx+1)];

    const contours = [];
    let NBD = 1;
    const GMAX = W * H * 4;

    for (let i = 1; i <= h; i++) {
      for (let j = 1; j <= w; j++) {
        const p = i*W + j;
        const fij = f[p];
        if (fij === 0) continue;

        let i2, j2, isStart = false;
        // بداية حدّ خارجي
        if (fij === 1 && f[p-1] === 0) { NBD++; i2 = i; j2 = j-1; isStart = true; }
        // بداية حدّ ثقب داخلي
        else if (fij >= 1 && f[p+1] === 0) { NBD++; i2 = i; j2 = j+1; isStart = true; }
        if (!isStart) continue;

        const pts = [];

        // 3.1 — بحث باتجاه عقارب الساعة عن أول بكسل ممتلئ حول (i,j)
        let i1 = -1, j1 = -1;
        {
          const s = dirOf(i2 - i, j2 - j);
          for (let k = 0; k < 8; k++) {
            const d = (s + k) & 7;
            const ny = i + cw[d][0], nx = j + cw[d][1];
            if (f[ny*W + nx] !== 0) { i1 = ny; j1 = nx; break; }
          }
        }
        if (i1 < 0) {                      // بكسل معزول (نظرياً — أُزيل مسبقاً)
          f[p] = -NBD;
          continue;
        }

        // 3.2 — تتبّع الحدّ
        let i2b = i1, j2b = j1, i3 = i, j3 = j, guard = 0;
        while (guard++ < GMAX) {
          // 3.3 — بحث عكس عقارب الساعة من التالي لـ(i2b,j2b)
          const s = dirOf(i2b - i3, j2b - j3);
          let i4 = -1, j4 = -1, rightZero = false;
          for (let k = 1; k <= 8; k++) {
            const d = (s - k) & 7;
            const dy = cw[d][0], dx = cw[d][1];
            const ny = i3 + dy, nx = j3 + dx;
            if (dy === 0 && dx === 1 && f[ny*W + nx] === 0) rightZero = true;
            if (f[ny*W + nx] !== 0) { i4 = ny; j4 = nx; break; }
          }
          // 3.4 — وسم البكسل الحالي
          const q = i3*W + j3;
          if (rightZero) f[q] = -NBD;
          else if (f[q] === 1) f[q] = NBD;

          pts.push(j3 - 1, i3 - 1);        // إحداثيات بلا الإطار

          // 3.5 — شرط التوقّف (عودة لنقطة البداية)
          if (i4 === i && j4 === j && i3 === i1 && j3 === j1) break;
          i2b = i3; j2b = j3; i3 = i4; j3 = j4;
        }

        contours.push(pts);
      }
    }

    // تحويل المصفوفات المسطّحة إلى نقاط {x,y}
    return contours.map(flat => {
      const a = [];
      for (let k = 0; k < flat.length; k += 2) a.push({ x: flat[k], y: flat[k+1] });
      return a;
    });
  }

  /* ── تبسيط + تنعيم + تحجيم + قلب المحور ── */
  _toShapes(contours, scaleMM, resizeRatio) {
    const s = scaleMM / resizeRatio;       // تصحيح تقليص الصورة
    // إحداثيات الصورة Y نازل بينما عالم CNC صاعد — اقلب رأسياً حول أعلى المحتوى
    let maxY = 0;
    for (const c of contours) for (const p of c) if (p.y > maxY) maxY = p.y;

    const shapes = [];
    for (const c of contours) {
      if (c.length < this.minPts) continue;
      if (this._perimeter(c) < this.minLen) continue;   // حذف الشوائب الصغيرة فقط
      let pts = this._rdp(c, this.simplify);
      if (pts.length < this.minPts) continue;
      if (this.smooth) pts = this._chaikin(pts, true);
      shapes.push({
        type: 'polyline',
        closed: true,                       // حدود Suzuki–Abe حلقات مغلقة دائماً
        points: pts.map(p => ({ x: p.x * s, y: (maxY - p.y) * s })),
      });
    }
    return shapes;
  }

  _perimeter(pts) {
    let d = 0;
    for (let i = 1; i < pts.length; i++)
      d += Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y);
    return d;
  }

  /* ── تنعيم Chaikin (تمرير واحد، يحافظ على الإغلاق) ── */
  _chaikin(points, closed) {
    const n = points.length;
    if (n < 3) return points;
    const out = [];
    const lim = closed ? n : n - 1;
    for (let i = 0; i < lim; i++) {
      const a = points[i], b = points[(i+1) % n];
      out.push({ x: a.x*0.75 + b.x*0.25, y: a.y*0.75 + b.y*0.25 });
      out.push({ x: a.x*0.25 + b.x*0.75, y: a.y*0.25 + b.y*0.75 });
    }
    if (!closed) { out.unshift(points[0]); out.push(points[n-1]); }
    return out;
  }

  /* ── Ramer–Douglas–Peucker ── */
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
