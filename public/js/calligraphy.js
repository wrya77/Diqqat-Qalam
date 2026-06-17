/* محرك الخط العربي — واجهة المتصفح
 * HarfBuzz (تشكيل) + opentype (مخططات) + CalligraphyEngine (هندسة) + GCodeGenerator
 */
(function () {
  'use strict';
  const CE = (window.DQ && DQ.CalligraphyEngine);
  const $  = id => document.getElementById(id);

  const state = { hb: null, fonts: {}, lastGcode: '', lastSvg: '', ready: false };

  // ── تحميل HarfBuzz مرة واحدة ──────────────────────────────
  async function ensureHB() {
    if (state.hb) return state.hb;
    const buf = await fetch('/vendor/hb.wasm').then(r => r.arrayBuffer());
    const { instance } = await WebAssembly.instantiate(buf, {});
    state.hb = hbjs(instance);
    return state.hb;
  }

  // ── تحميل خط (ttf) عند الطلب ───────────────────────────────
  async function loadFont(id) {
    if (state.fonts[id]) return state.fonts[id];
    const meta = CE.getFont(id);
    const ab   = await fetch('/fonts/' + meta.file).then(r => r.arrayBuffer());
    const ot   = opentype.parse(ab);
    const hb   = await ensureHB();
    const blob = hb.createBlob(new Uint8Array(ab));
    const face = hb.createFace(blob, 0);
    const font = hb.createFont(face);
    const obj  = { meta, ot, hb, font, face, blob };
    state.fonts[id] = obj;
    return obj;
  }

  // ── تشكيل سطر واحد → run + glyphPaths ─────────────────────
  function shapeLine(text, f) {
    const hb = f.hb;
    const buf = hb.createBuffer();
    buf.addText(text);
    buf.guessSegmentProperties();
    hb.shape(f.font, buf);
    const out = buf.json();
    buf.destroy();
    const run = out.map(r => ({ glyphId: r.g, ax: r.ax, ay: r.ay, dx: r.dx, dy: r.dy }));
    const glyphPaths = {};
    for (const r of run) {
      if (!(r.glyphId in glyphPaths)) {
        try { glyphPaths[r.glyphId] = f.ot.glyphs.get(r.glyphId).path.commands; }
        catch (e) { glyphPaths[r.glyphId] = []; }
      }
    }
    return { run, glyphPaths };
  }

  // ── تخطيط متعدد الأسطر (محاذاة يمين RTL، مقياس موحّد) ──────
  function composeText(text, f, heightMM, spacing) {
    const lines = String(text).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!lines.length) return null;

    const upm = f.ot.unitsPerEm;
    const laid = lines.map(line => {
      const { run, glyphPaths } = shapeLine(line, f);
      return CE.layout({ run, glyphPaths, unitsPerEm: upm, heightMM });
    });

    // توحيد المقياس على مقياس السطر الأول
    const scale0 = laid[0].scale || 1;
    laid.forEach(res => {
      const fac = res.scale ? scale0 / res.scale : 1;
      if (Math.abs(fac - 1) > 1e-9) {
        res.contours = res.contours.map(c => c.map(p => ({ x: p.x * fac, y: p.y * fac })));
        res.width  *= fac;
        res.height *= fac;
      }
    });

    const maxW = Math.max(...laid.map(r => r.width));
    const step = heightMM * spacing;
    const contours = [];
    laid.forEach((res, i) => {
      const xo = maxW - res.width;                 // محاذاة لليمين
      const yo = (laid.length - 1 - i) * step;      // السطر الأول للأعلى
      for (const c of res.contours) contours.push(c.map(p => ({ x: p.x + xo, y: p.y + yo })));
    });

    // محيط كلي
    let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
    for (const c of contours) for (const p of c) {
      if (p.x < mnx) mnx = p.x; if (p.x > mxx) mxx = p.x;
      if (p.y < mny) mny = p.y; if (p.y > mxy) mxy = p.y;
    }
    // النقل للأصل (0,0)
    const out = contours.map(c => c.map(p => ({ x: p.x - mnx, y: p.y - mny })));
    return { contours: out, width: mxx - mnx, height: mxy - mny, lines: lines.length };
  }

  // ── معاينة SVG ─────────────────────────────────────────────
  function renderSVG(comp) {
    const W = comp.width, H = comp.height;
    const pad = Math.max(2, Math.max(W, H) * 0.04);
    const vbW = W + pad * 2, vbH = H + pad * 2;
    let d = '';
    for (const c of comp.contours) {
      if (c.length < 2) continue;
      d += 'M' + c.map(p => `${(p.x + pad).toFixed(2)},${(H - p.y + pad).toFixed(2)}`).join('L') + 'Z';
    }
    const svg =
      `<svg viewBox="0 0 ${vbW.toFixed(2)} ${vbH.toFixed(2)}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">` +
      `<path d="${d}" fill="rgba(96,165,250,0.18)" stroke="#60a5fa" stroke-width="${(Math.max(W,H)/400).toFixed(3)}" fill-rule="evenodd" stroke-linejoin="round"/>` +
      `</svg>`;
    return svg;
  }

  function svgExport(comp) {
    const W = comp.width, H = comp.height;
    let d = '';
    for (const c of comp.contours) {
      if (c.length < 2) continue;
      d += 'M' + c.map(p => `${p.x.toFixed(3)},${(H - p.y).toFixed(3)}`).join('L') + 'Z';
    }
    return `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(2)}mm" height="${H.toFixed(2)}mm" viewBox="0 0 ${W.toFixed(2)} ${H.toFixed(2)}">\n` +
      `  <path d="${d}" fill="black" fill-rule="evenodd"/>\n</svg>\n`;
  }

  // ── التوليد ────────────────────────────────────────────────
  async function generate() {
    const err = $('err'); err.style.display = 'none';
    const text = $('txt').value;
    if (!text.trim()) { showErr('الرجاء إدخال نص.'); return; }

    $('gen').disabled = true;
    const oldLabel = $('gen').textContent;
    $('gen').textContent = '⏳ جارٍ التوليد…';
    try {
      const f = await loadFont($('font').value);
      const h = Math.max(2, parseFloat($('h').value) || 30);
      const spacing = parseFloat($('ls').value) || 1.35;
      const comp = composeText(text, f, h, spacing);
      if (!comp || !comp.contours.length) { showErr('تعذّر تشكيل النص — جرّب نصاً آخر أو خطاً مختلفاً.'); return; }

      // معاينة
      $('stage').innerHTML = renderSVG(comp);
      state.lastSvg = svgExport(comp);

      // أشكال + G-Code
      let shapes = CE.contoursToShapes(comp.contours, {});
      if (window.DQ && DQ.PathSort) { try { shapes = DQ.PathSort.optimize(shapes).shapes; } catch (e) {} }

      const cfg = {
        toolDiameter: +$('tool').value || 3,
        totalDepth:   +$('depth').value || 3,
        passDepth:    +$('pass').value || 1.5,
        feedRateXY:   +$('fxy').value || 1000,
        feedRateZ:    +$('fz').value || 300,
        spindleSpeed: +$('rpm').value || 0,
        safeHeight:   +$('safe').value || 5,
        origin:       $('origin').value || 'bottom-left',
        toolType:     'flat',
      };
      const result = new GCodeGenerator(cfg).generate(shapes);
      state.lastGcode = result.gcode;

      // إحصاءات
      $('s-dim').textContent  = `${comp.width.toFixed(0)} × ${comp.height.toFixed(0)}`;
      $('s-time').textContent = result.stats.estimatedTime;
      $('s-cont').textContent = comp.contours.length;
      $('s-lines').textContent = result.stats.lines;
      $('stats').style.display = 'grid';
      $('actions').style.display = 'flex';
    } catch (e) {
      console.error(e);
      showErr('خطأ: ' + (e && e.message ? e.message : e));
    } finally {
      $('gen').disabled = false;
      $('gen').textContent = oldLabel;
    }
  }

  function showErr(msg) { const e = $('err'); e.textContent = msg; e.style.display = 'block'; }

  function download(name, content, mime) {
    const blob = new Blob([content], { type: mime || 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 100);
  }

  function fileBase() {
    const t = ($('txt').value || 'calligraphy').trim().split(/\r?\n/)[0].slice(0, 24).replace(/[^؀-ۿ\w]+/g, '_');
    return 'diqqat_' + (t || 'text');
  }

  // ── الإقلاع ───────────────────────────────────────────────
  function init() {
    if (!CE) { $('empty').textContent = 'فشل تحميل المحرك.'; return; }
    const sel = $('font');
    CE.listFonts().forEach(ff => {
      const o = document.createElement('option');
      o.value = ff.id; o.textContent = ff.name;
      sel.appendChild(o);
    });
    $('ls').addEventListener('input', () => { $('ls-val').textContent = (+$('ls').value).toFixed(2) + '×'; });
    $('gen').addEventListener('click', generate);
    $('dl').addEventListener('click', () => download(fileBase() + '.nc', state.lastGcode, 'text/plain'));
    $('svg').addEventListener('click', () => download(fileBase() + '.svg', state.lastSvg, 'image/svg+xml'));
    $('copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(state.lastGcode); $('copy').textContent = '✓ نُسخ'; setTimeout(() => $('copy').textContent = 'نسخ', 1500); }
      catch (e) { showErr('تعذّر النسخ.'); }
    });

    // تسخين المحرك + معاينة افتراضية
    ensureHB()
      .then(() => loadFont('amiri'))
      .then(() => { state.ready = true; $('empty').textContent = 'اكتب نصاً واضغط «توليد المسار».'; return generate(); })
      .catch(e => { console.error(e); $('empty').textContent = 'فشل تحميل المحرك أو الخطوط.'; });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
