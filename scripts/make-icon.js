#!/usr/bin/env node
'use strict';
/**
 * make-icon.js — يولّد أيقونة سطح المكتب من علامة دقة قلم.
 * بلا أي تبعيات: يرسم نفس عناصر public/images/icon.svg إلى صورة مربعة،
 * ثم يحفظها PNG (build/icon.png) و ICO (build/icon.ico) لـ electron-builder.
 *
 * (logo.png أفقي 2560×1440 فلا يصلح أيقونةً — لذا نرسم العلامة مربعةً هنا.)
 */
const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, '..', 'build');
const SIZE    = 256;          // مقاس الأيقونة النهائي
const SS      = 3;            // تنعيم بالإفراط في العيّنات (3×3)
const N       = SIZE * SS;    // 768 داخلياً
const F       = N / 64;       // مقياس viewBox 64

const hex = (h) => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
const C0 = hex('#388bfd');   // تدرّج البداية
const C1 = hex('#1f6feb');   // تدرّج النهاية
const WHITE = [255,255,255];
const LIGHT = hex('#cfe3ff');
const GREEN = hex('#5bf2b8');

// ── اختبارات هندسية (إحداثيات viewBox 0..64) ─────────────────────────────────
function inRoundRect(x, y) {                       // rect 2,2 60×60 r15
  const qx = Math.abs(x - 32) - 15, qy = Math.abs(y - 32) - 15;
  const d = Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx,0), Math.max(qy,0)) - 15;
  return d <= 0;
}
function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function inCircle(x, y, cx, cy, r) { const dx=x-cx, dy=y-cy; return dx*dx+dy*dy <= r*r; }

const DIAMOND = [[32,12],[43,30],[32,50],[21,30]];
const FACET   = [[32,12],[43,30],[32,35],[21,30]];

// مسار الأداة: منحنى تربيعي مزدوج — نقرّبه بنقاط ونرسمه شريطاً نصف-شفاف
function quadPts(p0, p1, p2, steps) {
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, u = 1 - t;
    out.push([u*u*p0[0] + 2*u*t*p1[0] + t*t*p2[0], u*u*p0[1] + 2*u*t*p1[1] + t*t*p2[1]]);
  }
  return out;
}
const PATH = [
  ...quadPts([13,53],[23,45],[32,50], 24),
  ...quadPts([32,50],[41,55],[51,53], 24),
];
function nearPath(x, y, w) {
  const w2 = w * w;
  for (let i = 1; i < PATH.length; i++) {
    const ax=PATH[i-1][0], ay=PATH[i-1][1], bx=PATH[i][0], by=PATH[i][1];
    const dx=bx-ax, dy=by-ay, len=dx*dx+dy*dy || 1e-6;
    let t = ((x-ax)*dx + (y-ay)*dy) / len; t = Math.max(0, Math.min(1, t));
    const px=ax+t*dx, py=ay+t*dy, ddx=x-px, ddy=y-py;
    if (ddx*ddx + ddy*ddy <= w2) return true;
  }
  return false;
}

// ── رسم عند الدقة الداخلية ثم تصغير بالمتوسط ─────────────────────────────────
const big = Buffer.alloc(N * N * 4);            // RGBA
for (let py = 0; py < N; py++) {
  for (let px = 0; px < N; px++) {
    const x = px / F, y = py / F;
    let r = 0, g = 0, b = 0, a = 0;
    if (inRoundRect(x, y)) {
      const t = Math.max(0, Math.min(1, ((x-2)/60 + (y-2)/60) / 2));
      r = C0[0] + (C1[0]-C0[0]) * t;
      g = C0[1] + (C1[1]-C0[1]) * t;
      b = C0[2] + (C1[2]-C0[2]) * t;
      a = 255;
      if (nearPath(x, y, 1.5)) { r = r + (255-r)*0.5; g = g + (255-g)*0.5; b = b + (255-b)*0.5; }
      if (inPoly(x, y, DIAMOND)) { [r,g,b] = WHITE; }
      if (inPoly(x, y, FACET))   { [r,g,b] = LIGHT; }
      if (inCircle(x, y, 32, 50, 3.2)) { [r,g,b] = GREEN; }
    }
    const o = (py * N + px) * 4;
    big[o] = r; big[o+1] = g; big[o+2] = b; big[o+3] = a;
  }
}

// تصغير SS×SS بالمتوسط (تنعيم الحواف + الزوايا)
const rgba = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r=0,g=0,b=0,a=0;
    for (let sy=0; sy<SS; sy++) for (let sx=0; sx<SS; sx++) {
      const o = ((y*SS+sy)*N + (x*SS+sx)) * 4;
      r+=big[o]; g+=big[o+1]; b+=big[o+2]; a+=big[o+3];
    }
    const n = SS*SS, o = (y*SIZE + x)*4;
    rgba[o]=Math.round(r/n); rgba[o+1]=Math.round(g/n); rgba[o+2]=Math.round(b/n); rgba[o+3]=Math.round(a/n);
  }
}

// ── ترميز PNG ────────────────────────────────────────────────────────────────
const CRC = (() => { const t=[]; for(let n=0;n<256;n++){let c=n; for(let k=0;k<8;k++) c=c&1?0xEDB88320^(c>>>1):c>>>1; t[n]=c>>>0;} return t; })();
function crc32(buf){ let c=0xFFFFFFFF; for(let i=0;i<buf.length;i++) c=CRC[(c^buf[i])&0xFF]^(c>>>8); return (c^0xFFFFFFFF)>>>0; }
function chunk(type, data){
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(width, height, rgbaBuf){
  const sig = Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width,0); ihdr.writeUInt32BE(height,4);
  ihdr[8]=8; ihdr[9]=6; ihdr[10]=0; ihdr[11]=0; ihdr[12]=0;   // 8-bit RGBA
  const raw = Buffer.alloc(height * (1 + width*4));
  for (let y=0; y<height; y++){
    raw[y*(1+width*4)] = 0;                                    // filter: none
    rgbaBuf.copy(raw, y*(1+width*4)+1, y*width*4, (y+1)*width*4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ── تغليف ICO حول PNG (مدعوم منذ Windows Vista) ──────────────────────────────
function encodeICO(pngBuf){
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0,0); header.writeUInt16LE(1,2); header.writeUInt16LE(1,4); // type=icon, count=1
  const entry = Buffer.alloc(16);
  entry[0]=0; entry[1]=0;            // 0 = 256px
  entry[2]=0; entry[3]=0;            // لا جدول ألوان
  entry.writeUInt16LE(1,4);          // planes
  entry.writeUInt16LE(32,6);         // bpp
  entry.writeUInt32LE(pngBuf.length,8);
  entry.writeUInt32LE(6+16,12);      // إزاحة البيانات
  return Buffer.concat([header, entry, pngBuf]);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const png = encodePNG(SIZE, SIZE, rgba);
fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), png);
fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), encodeICO(png));
console.log(`✓ أيقونة ${SIZE}×${SIZE}  →  build/icon.png  +  build/icon.ico`);
