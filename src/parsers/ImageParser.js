/**
 * ImageParser.js — تحويل صور PNG/JPG إلى مسارات قابلة للقطع
 * يستخدم Canvas API في المتصفح لاستخراج الحواف
 */

class ImageParser {
  constructor(options = {}) {
    this.threshold     = options.threshold     || 128;   // عتبة التباين
    this.simplify      = options.simplify      || 0.5;   // تبسيط المسار
    this.invert        = options.invert        || false; // عكس الألوان
    this.scale         = options.scale         || 1;     // مقياس mm/pixel
  }

  /**
   * تحليل صورة من Canvas (في المتصفح)
   * @param {HTMLImageElement} img
   * @returns {Array} مسارات
   */
  parseImage(img) {
    const canvas = document.createElement('canvas');
    canvas.width  = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return this.parseImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
  }

  /**
   * تحليل ImageData مباشرة
   */
  parseImageData(imageData) {
    const { width, height, data } = imageData;
    const binary = this._toBinary(data, width, height);
    const edges  = this._detectEdges(binary, width, height);
    const paths  = this._tracePaths(edges, width, height);
    return paths;
  }

  // تحويل إلى صورة ثنائية
  _toBinary(data, width, height) {
    const bin = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const idx  = i * 4;
      const gray = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      const alpha = data[idx + 3];
      let val = (gray < this.threshold && alpha > 128) ? 1 : 0;
      if (this.invert) val = 1 - val;
      bin[i] = val;
    }
    return bin;
  }

  // كشف الحواف (Sobel بسيط)
  _detectEdges(bin, width, height) {
    const edges = new Uint8Array(width * height);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        // إذا البكسل = 1 والجار = 0 → حافة
        if (bin[idx] === 1) {
          const neighbors = [
            bin[idx - 1], bin[idx + 1],
            bin[idx - width], bin[idx + width],
          ];
          if (neighbors.some(n => n === 0)) {
            edges[idx] = 1;
          }
        }
      }
    }
    return edges;
  }

  // تتبع المسارات (Moore Neighbor Tracing بسيط)
  _tracePaths(edges, width, height) {
    const visited = new Uint8Array(width * height);
    const paths   = [];
    const s       = this.scale;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (!edges[idx] || visited[idx]) continue;

        const points = [];
        let cx = x, cy = y;
        let count = 0;

        // تتبع الحافة
        while (count < 10000) {
          visited[cy * width + cx] = 1;
          points.push({ x: cx * s, y: cy * s });
          count++;

          let moved = false;
          const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]];
          for (const [dx, dy] of dirs) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const ni = ny * width + nx;
            if (edges[ni] && !visited[ni]) {
              cx = nx; cy = ny; moved = true; break;
            }
          }
          if (!moved) break;
        }

        if (points.length >= 2) {
          // تبسيط
          const simplified = this._simplifyPath(points, this.simplify);
          paths.push({ type: 'polyline', points: simplified, closed: false });
        }
      }
    }

    return paths;
  }

  // Ramer-Douglas-Peucker
  _simplifyPath(points, epsilon) {
    if (epsilon <= 0 || points.length <= 2) return points;
    let dmax = 0, idx = 0;
    const end = points.length - 1;
    for (let i = 1; i < end; i++) {
      const d = this._ptLineDist(points[i], points[0], points[end]);
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax > epsilon) {
      const r1 = this._simplifyPath(points.slice(0, idx + 1), epsilon);
      const r2 = this._simplifyPath(points.slice(idx), epsilon);
      return [...r1.slice(0, -1), ...r2];
    }
    return [points[0], points[end]];
  }

  _ptLineDist(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.sqrt(dx*dx + dy*dy);
    if (len === 0) return Math.sqrt((p.x-a.x)**2 + (p.y-a.y)**2);
    return Math.abs(dx*(a.y-p.y) - (a.x-p.x)*dy) / len;
  }
}

if (typeof module !== 'undefined') module.exports = ImageParser;
