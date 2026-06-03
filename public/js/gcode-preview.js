/**
 * gcode-preview.js — Syntax-highlighted G-Code Display
 */
class GCodePreview {
  constructor(preId, countId) {
    this.pre   = document.getElementById(preId   || 'gc-pre');
    this.countEl = document.getElementById(countId || 'gc-line-count');
    this.ph    = document.getElementById('gc-placeholder');
    this.raw   = '';
    this._setupSearch();
  }

  display(gcodeText) {
    this.raw = gcodeText || '';
    if (!this.raw.trim()) { this.clear(); return; }
    const lines = this.raw.split('\n');
    const MAX_LINES = 1000;
    const displayLines = lines.slice(0, MAX_LINES);
    let html = displayLines.map(l => this._highlight(l)).join('\n');
    if (lines.length > MAX_LINES) {
      html += `\n<span style="color:#8b949e">... تم إخفاء ${lines.length - MAX_LINES} سطر إضافي لتحسين الأداء ...</span>`;
    }
    this.pre.innerHTML = html;
    if (this.ph) this.ph.style.display = 'none';
    if (this.countEl) this.countEl.textContent = lines.length.toLocaleString() + ' سطر';
  }

  clear() {
    this.raw = '';
    this.pre.innerHTML = '';
    if (this.ph) this.ph.style.display = '';
    if (this.countEl) this.countEl.textContent = '0 سطر';
  }

  _highlight(line) {
    const esc = line.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    // Comments (;...)
    if (esc.trim().startsWith(';'))
      return `<span class="g-comment">${esc}</span>`;

    // Split code / comment
    const semi = esc.indexOf(';');
    const code = semi>=0 ? esc.slice(0,semi) : esc;
    const comm = semi>=0 ? `<span class="g-comment">${esc.slice(semi)}</span>` : '';

    const styled = code
      // G00 rapid
      .replace(/(G0*0\b)/g,'<span class="g-rapid">$1</span>')
      // G01 cut
      .replace(/(G0*1\b)/g,'<span class="g-cut">$1</span>')
      // G02/G03 arc
      .replace(/(G0*[23]\b)/g,'<span class="g-arc">$1</span>')
      // M codes
      .replace(/(M0*[034356789]\b)/g,'<span class="g-spindle">$1</span>')
      // G20/21/90/91/17/40/41/42/54-59
      .replace(/(G[12][07]|G[49][01]|G1[7]|G4[012]|G5[4-9]|G04)\b/g,'<span class="g-setup">$1</span>')
      // N line numbers
      .replace(/(N\d+)/g,'<span style="color:var(--text3)">$1</span>');

    return styled + comm;
  }

  copyToClipboard() {
    if (!this.raw) return false;
    navigator.clipboard.writeText(this.raw).catch(()=>{
      const ta = document.createElement('textarea');
      ta.value = this.raw; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy'); ta.remove();
    });
    return true;
  }

  _setupSearch() {
    const inp = document.getElementById('gc-search');
    const info = document.getElementById('gc-search-info');
    if (!inp) return;

    let marks = [], markIdx = 0;

    const clearMarks = () => {
      this.pre.querySelectorAll('mark').forEach(m => {
        m.replaceWith(document.createTextNode(m.textContent));
      });
      this.pre.normalize();
      marks = []; markIdx = 0;
      if (info) info.textContent = '';
    };

    inp.addEventListener('input', () => {
      clearMarks();
      const q = inp.value.trim();
      if (!q) return;

      const walker = document.createTreeWalker(this.pre, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);

      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'gi');
      nodes.forEach(node => {
        const txt = node.nodeValue;
        let m, parts = [], last = 0;
        while ((m = re.exec(txt)) !== null) {
          if (m.index > last) parts.push(document.createTextNode(txt.slice(last, m.index)));
          const mark = document.createElement('mark');
          mark.style.cssText = 'background:#d29922;color:#000;border-radius:2px';
          mark.textContent = m[0];
          marks.push(mark);
          parts.push(mark);
          last = m.index + m[0].length;
        }
        if (parts.length) {
          if (last < txt.length) parts.push(document.createTextNode(txt.slice(last)));
          node.replaceWith(...parts);
        }
      });
      if (info) info.textContent = marks.length ? `${marks.length} نتيجة` : 'لا نتائج';
    });

    inp.addEventListener('keydown', e => {
      if (!marks.length) return;
      if (e.key === 'Enter') {
        markIdx = (markIdx + (e.shiftKey ? -1 : 1) + marks.length) % marks.length;
        marks.forEach((m,i) => m.style.background = i===markIdx ? '#f78166' : '#d29922');
        marks[markIdx].scrollIntoView({ block:'nearest' });
      }
    });
  }
}
