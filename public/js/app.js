/**
 * app.js — Diqqat Qalam — Main Application Coordinator
 */
class DiqqatQalamApp {
  constructor() {
    this.editor    = null;
    this.preview   = null;
    this.simulator = null;
    this.importer  = null;
    this.controls  = null;
    this.gcode     = '';
  }

  init() {
    try { this.editor    = new CanvasEditor('main-canvas'); } catch(e) { console.error('CanvasEditor failed:', e); }
    try { this.preview   = new GCodePreview('gc-pre','gc-line-count'); } catch(e) { console.error('GCodePreview failed:', e); }
    try { this.simulator = new GCodeSimulator('sim-canvas'); } catch(e) { console.error('GCodeSimulator failed:', e); }
    try { this.importer  = new FileImporter(this); } catch(e) { console.error('FileImporter failed:', e); }
    try { this.controls  = new UIControls(this); } catch(e) { console.error('UIControls failed:', e); }
    try { this.machineCtrl = new MachineControl(this); } catch(e) { console.error('MachineControl failed:', e); }

    this._bindMain();
    this._checkServer();
    console.log('✏ دقة قلم — Diqqat Qalam v1.1 ready');
  }

  _bindMain() {
    document.getElementById('btn-generate')?.addEventListener('click', ()=>this.generate());
    document.getElementById('btn-simulate')?.addEventListener('click', ()=>this.simulate());
    document.getElementById('btn-clear')?.addEventListener('click',    ()=>{ this.editor.clear(); this.toast('تم المسح','info'); });
    document.getElementById('btn-undo')?.addEventListener('click',     ()=>this.editor.undo());
    document.getElementById('btn-redo')?.addEventListener('click',     ()=>this.editor.redo());
    document.getElementById('btn-validate-gcode')?.addEventListener('click', ()=>this.validateGCode());
    document.getElementById('btn-pocket-toggle')?.addEventListener('click',  ()=>this._togglePocketMode());
    this._bindImageTrace();

    // Machine Control Panel
    document.getElementById('btn-machine-panel')?.addEventListener('click', ()=>document.getElementById('dlg-machine')?.showModal());
    document.getElementById('cls-machine')?.addEventListener('click',       ()=>document.getElementById('dlg-machine')?.close());

    // Tool Library
    document.getElementById('btn-tool-library')?.addEventListener('click', ()=>this._openToolLibrary());
    document.getElementById('cls-tools')?.addEventListener('click',         ()=>document.getElementById('dlg-tools')?.close());
    document.getElementById('btn-add-tool')?.addEventListener('click',      ()=>this._openToolEdit(null));
    document.getElementById('cls-tool-edit')?.addEventListener('click',     ()=>document.getElementById('dlg-tool-edit')?.close());
    document.getElementById('btn-tool-save')?.addEventListener('click',     ()=>this._saveTool());
    document.getElementById('btn-tool-cancel')?.addEventListener('click',   ()=>document.getElementById('dlg-tool-edit')?.close());

    // Projects
    document.getElementById('btn-save-project')?.addEventListener('click',  ()=>this._openProjects());
    document.getElementById('btn-load-project')?.addEventListener('click',  ()=>this._openProjects());
    document.getElementById('cls-projects')?.addEventListener('click',      ()=>document.getElementById('dlg-projects')?.close());
    document.getElementById('btn-project-save-ok')?.addEventListener('click', ()=>this._saveProject());

    // Plunge strategy toggle
    document.getElementById('plunge-strategy')?.addEventListener('change', (e)=>{
      const row = document.getElementById('ramp-angle-row');
      if (row) row.style.display = e.target.value === 'ramp' ? '' : 'none';
    });
    const rampRow = document.getElementById('ramp-angle-row');
    if (rampRow) rampRow.style.display = 'none';

    // ── Shape Transform Toolbar ──
    document.getElementById('st-copy')?.addEventListener('click',      ()=>this.editor._copy());
    document.getElementById('st-paste')?.addEventListener('click',     ()=>this.editor._paste());
    document.getElementById('st-duplicate')?.addEventListener('click', ()=>this.editor._duplicate());
    document.getElementById('st-mirror-h')?.addEventListener('click',  ()=>this.editor.mirrorSelected('h'));
    document.getElementById('st-mirror-v')?.addEventListener('click',  ()=>this.editor.mirrorSelected('v'));
    document.getElementById('st-rotate')?.addEventListener('click',    ()=>document.getElementById('dlg-rotate')?.showModal());
    document.getElementById('st-scale')?.addEventListener('click',     ()=>document.getElementById('dlg-scale')?.showModal());
    document.getElementById('st-array')?.addEventListener('click',     ()=>document.getElementById('dlg-array')?.showModal());
    document.getElementById('st-delete')?.addEventListener('click',    ()=>this.editor._deleteSelected());

    // Rotate dialog
    document.querySelectorAll('.mini-preset[data-angle]').forEach(btn=>{
      btn.addEventListener('click',()=>{
        this.editor.rotateSelected(parseFloat(btn.dataset.angle));
        document.getElementById('dlg-rotate')?.close();
      });
    });
    document.getElementById('btn-rotate-apply')?.addEventListener('click',()=>{
      const a=parseFloat(document.getElementById('rotate-angle')?.value||'0');
      this.editor.rotateSelected(a);
      document.getElementById('dlg-rotate')?.close();
    });

    // Scale dialog
    document.getElementById('scale-uniform')?.addEventListener('change',(e)=>{
      const yr=document.getElementById('scale-y-row');
      if(yr) yr.style.display=e.target.checked?'none':'';
    });
    document.getElementById('btn-scale-apply')?.addEventListener('click',()=>{
      const x=parseFloat(document.getElementById('scale-x')?.value||'100')/100;
      const uniform=document.getElementById('scale-uniform')?.checked!==false;
      const y=uniform?x:parseFloat(document.getElementById('scale-y')?.value||'100')/100;
      this.editor.scaleSelected(x,y);
      document.getElementById('dlg-scale')?.close();
    });

    // Array dialog tabs
    document.querySelectorAll('.mini-tab[data-arr]').forEach(btn=>{
      btn.addEventListener('click',()=>{
        document.querySelectorAll('.mini-tab[data-arr]').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        const t=btn.dataset.arr;
        const ro=document.getElementById('arr-rect-opts'),co=document.getElementById('arr-circ-opts');
        if(ro) ro.style.display=t==='rect'?'':'none';
        if(co) co.style.display=t==='circular'?'':'none';
      });
    });
    document.getElementById('btn-array-apply')?.addEventListener('click',()=>{
      const activeTab=document.querySelector('.mini-tab[data-arr].active')?.dataset.arr||'rect';
      let opts;
      if(activeTab==='rect'){
        opts={type:'rect',
          rows:parseInt(document.getElementById('arr-rows')?.value||'3'),
          cols:parseInt(document.getElementById('arr-cols')?.value||'3'),
          spacingX:parseFloat(document.getElementById('arr-sx')?.value||'20'),
          spacingY:parseFloat(document.getElementById('arr-sy')?.value||'20')};
      } else {
        opts={type:'circular',
          count:parseInt(document.getElementById('arr-count')?.value||'6'),
          radius:parseFloat(document.getElementById('arr-radius')?.value||'30')};
      }
      this.editor.arraySelected(opts);
      document.getElementById('dlg-array')?.close();
    });
  }

  /* ══ GENERATE ══ */
  async generate() {
    const shapes = this.editor.getShapes();
    if (!shapes.length) { this.toast('الرجاء رسم تصميم أولاً!','warn'); return; }

    const config = this.controls.getConfig();
    this.controls.setStatus('⏳ جاري التوليد...','active');
    document.getElementById('btn-generate').disabled = true;

    try {
      // Instant client-side generation
      const gen = new GCodeGenerator(config);
      const result = gen.generate(shapes);
      this.gcode = result.gcode;
      this.preview.display(this.gcode);
      this.controls.updateStats(result.stats);
      this.controls.setStatus('✅ تم التوليد','active');
      this.toast('✅ تم توليد G-Code!','success');

      // If AI optimization & server available
      if (config.aiOptimize) {
        await this._generateWithAI(shapes, config);
      }
    } catch(err) {
      this.toast('❌ خطأ: '+err.message,'error');
      this.controls.setStatus('خطأ','error');
    } finally {
      document.getElementById('btn-generate').disabled = false;
    }
  }

  async _generateWithAI(shapes, config) {
    this.controls.setStatus('🤖 تحسين AI...','active');
    try {
      const res = await fetch('/api/generate',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ shapes, config, useAI:true })
      });
      const data = await res.json();
      if(!data.success) throw new Error(data.error);

      // عرض اقتراحات AI للمراجعة قبل تطبيقها
      this.controls.showAISuggestions(data.suggestions, data.estimatedSaving);
      this.controls.showAIAnalysis(data.analysis || [], data.processedShapes || [], data.suggestions || [], data.estimatedSaving || '0%', data.aiMetadata || null);
      this.controls.setStatus('🤖 جاهز للمراجعة','active');
    } catch(err) {
      console.warn('AI optimization failed (server offline?):', err.message);
      this.controls.setStatus('✅ تم (بدون AI)');
    }
  }

  async applyProcessedShapes(processedShapes, options = { replaceAll: true }) {
    this.controls.setStatus('⏳ تطبيق اقتراحات AI...','active');
    try {
      // apply to editor
      if (options.replaceAll) {
        try { this.app?.editor; } catch(e){}
        this.editor._saveHistory?.();
        this.editor.shapes = JSON.parse(JSON.stringify(processedShapes || []));
        this.editor.render();
        this.editor._updateStatus?.();
      } else {
        // فقط تطبيق تغذيات (feedRate) دون تغيير الترتيب
        const curr = this.editor.shapes || [];
        for (let i = 0; i < (processedShapes || []).length && i < curr.length; i++) {
          if (processedShapes[i] && typeof processedShapes[i].feedRate !== 'undefined') {
            curr[i].feedRate = processedShapes[i].feedRate;
            // also copy reversed flag if present
            if (typeof processedShapes[i].reversed !== 'undefined') curr[i].reversed = processedShapes[i].reversed;
          }
        }
        this.editor.render(); this.editor._updateStatus?.();
      }

      // توليد G-Code محلياً باستخدام الأشكال المحدثة
      const config = this.controls.getConfig();
      const gen = new GCodeGenerator(config);
      const { gcode, stats } = gen.generate(this.editor.getShapes());
      this.gcode = gcode;
      this.preview.display(this.gcode);
      this.controls.updateStats(stats);
      this.toast('✅ تم تطبيق اقتراحات AI وتحديث G-Code','success');
      this.controls.setStatus('✅ تم تطبيق AI','active');
    } catch (e) {
      console.error('applyProcessedShapes error:', e);
      this.toast('❌ فشل تطبيق اقتراحات AI: '+e.message,'error');
      this.controls.setStatus('خطأ','error');
    }
  }

  /* ══ SIMULATE ══ */
  simulate() {
    if (!this.gcode) { this.generate(); return; }
    this.controls.activateTab('sim');
    this.simulator.load(this.gcode);
    this.simulator.play();
  }

  /* ══ EXPORT ══ */
  exportFile() {
    const filename = document.getElementById('exp-filename')?.value || 'design';
    const ext      = document.getElementById('exp-ext')?.value      || '.nc';

    if (ext === '.dxf') { this.exportDXF(filename); return; }
    if (ext === '.pdf') { this.printCanvas(); return; }

    const comments = document.getElementById('exp-comments')?.checked !== false;
    const lineNums = document.getElementById('exp-linenums')?.checked || false;
    const config = this.controls.getConfig();
    config.addComments = comments; config.lineNumbers = lineNums;
    const { gcode } = new GCodeGenerator(config).generate(this.editor.getShapes());
    this._downloadBlob(gcode, filename + ext);
    document.getElementById('dlg-export')?.close();
    this.toast(`💾 تم تصدير ${filename}${ext}`, 'success');
  }

  async exportDXF(filename = 'design') {
    const shapes = this.editor.getShapes();
    if (!shapes.length) { this.toast('ارسم تصميماً أولاً', 'warn'); return; }
    try {
      const res = await fetch('/api/export/dxf', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shapes, filename, units: 'mm' })
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const safe = filename.replace(/[^a-zA-Z0-9_-]/g, '_');
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = safe + '.dxf';
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
      document.getElementById('dlg-export')?.close();
      this.toast('💾 تم تصدير DXF', 'success');
    } catch (err) { this.toast('❌ ' + err.message, 'error'); }
  }

  printCanvas() {
    const canvas = document.getElementById('main-canvas');
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    const win = window.open('');
    win.document.write(`<html><body style="margin:0;background:#000">
      <img src="${dataUrl}" style="max-width:100%;max-height:100vh;display:block;margin:auto">
      </body></html>`);
    win.document.close();
    win.onload = () => win.print();
    document.getElementById('dlg-export')?.close();
  }

  async validateGCode() {
    if (!this.gcode) { this.toast('لا يوجد G-Code للتحقق', 'warn'); return; }
    try {
      const config = this.controls.getConfig();
      const res  = await fetch('/api/validate-gcode', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gcode: this.gcode, machineConfig: config })
      });
      const data = await res.json();
      this._showValidationResult(data);
    } catch (err) { this.toast('❌ ' + err.message, 'error'); }
  }

  _showValidationResult(r) {
    const lines = [];
    if (r.errors?.length)   r.errors.forEach(e   => lines.push(`🔴 سطر ${e.line}: ${e.msg}`));
    if (r.warnings?.length) r.warnings.forEach(w => lines.push(`🟡 سطر ${w.line}: ${w.msg}`));
    if (!lines.length)      lines.push('✅ G-Code صحيح — لا أخطاء');
    const msg = lines.slice(0, 5).join('\n') + (lines.length > 5 ? `\n...و${lines.length-5} أكثر` : '');
    const type = r.errors?.length ? 'error' : r.warnings?.length ? 'warn' : 'success';
    // Show as extended toast (or alert for now)
    if (lines.length <= 3) {
      lines.forEach(l => this.toast(l, type));
    } else {
      alert(msg);
    }
  }

  /* ══ HELPERS ══ */
  setGCode(gcode) {
    this.gcode = gcode;
    this.preview.display(gcode);
    this.controls.activateTab('gcode');
  }

  loadProfile(name) {
    if(!name) return;
    this.controls.applyProfile(name);
  }

  _downloadBlob(text, filename) {
    const blob = new Blob([text],{type:'text/plain;charset=utf-8'});
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href=url; a.download=filename;
    document.body.appendChild(a); a.click();
    setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); },100);
  }

  toast(msg, type='info') {
    const container = document.getElementById('toasts');
    if(!container) return;
    const t = document.createElement('div');
    t.className=`toast toast-${type}`;
    t.textContent=msg;
    container.appendChild(t);
    setTimeout(()=>t.remove(), 3000);
  }

  /* ══ TOOL LIBRARY ══ */
  async _openToolLibrary() {
    const dlg  = document.getElementById('dlg-tools');
    const list = document.getElementById('tool-list');
    if (!dlg || !list) return;
    try {
      const res   = await fetch('/api/tools');
      const data  = await res.json();
      list.innerHTML = '';
      (data.tools || []).forEach(tool => {
        const row = document.createElement('div');
        row.className = 'tool-row';
        row.innerHTML = `
          <div class="tool-info">
            <b>${tool.name}</b>
            <span>⌀${tool.diameter}mm · ${tool.type} · ${tool.flutes} شفرات</span>
            <span>${tool.notes || ''}</span>
          </div>
          <div class="tool-actions">
            <button class="tbtn primary" data-id="${tool.id}">✓ اختيار</button>
            <button class="tbtn" data-edit="${tool.id}">✏</button>
            <button class="tbtn danger" data-del="${tool.id}">🗑</button>
          </div>`;
        // اختيار الأداة
        row.querySelector('[data-id]').addEventListener('click', () => {
          this._applyTool(tool);
          dlg.close();
        });
        // تعديل
        row.querySelector('[data-edit]').addEventListener('click', () => this._openToolEdit(tool));
        // حذف
        row.querySelector('[data-del]').addEventListener('click', async () => {
          if (!confirm(`حذف "${tool.name}"?`)) return;
          await fetch(`/api/tools/${tool.id}`, { method: 'DELETE' });
          this._openToolLibrary();
        });
        list.appendChild(row);
      });
    } catch (err) { this.toast('❌ ' + err.message, 'error'); }
    dlg.showModal();
  }

  _applyTool(tool) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    set('tool-diameter', tool.diameter);
    set('tool-type',     tool.type);
    const speeds = tool.speeds?.generic || Object.values(tool.speeds || {})[0] || {};
    if (speeds.rpm)    set('spindle-speed',  speeds.rpm);
    if (speeds.feedXY) set('feed-rate-xy',   speeds.feedXY);
    if (speeds.feedZ)  set('feed-rate-z',    speeds.feedZ);
    this.toast(`✅ تم تحميل إعدادات "${tool.name}"`, 'success');
  }

  _openToolEdit(tool) {
    const dlg = document.getElementById('dlg-tool-edit');
    if (!dlg) return;
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
    document.getElementById('tool-edit-title').textContent = tool ? 'تعديل الأداة' : 'إضافة أداة جديدة';
    set('tool-edit-id',      tool?.id || '');
    set('tool-edit-name',    tool?.name || '');
    set('tool-edit-dia',     tool?.diameter || 6);
    set('tool-edit-type',    tool?.type || 'flat');
    set('tool-edit-flutes',  tool?.flutes || 2);
    const spd = tool?.speeds?.generic || {};
    set('tool-edit-rpm',     spd.rpm     || 18000);
    set('tool-edit-feed-xy', spd.feedXY  || 1000);
    set('tool-edit-feed-z',  spd.feedZ   || 300);
    set('tool-edit-notes',   tool?.notes || '');
    dlg.showModal();
  }

  async _saveTool() {
    const get = (id) => document.getElementById(id)?.value?.trim();
    const id  = get('tool-edit-id');
    const payload = {
      name:     get('tool-edit-name'),
      diameter: +get('tool-edit-dia'),
      type:     get('tool-edit-type'),
      flutes:   +get('tool-edit-flutes'),
      notes:    get('tool-edit-notes'),
      speeds: {
        generic: {
          rpm:    +get('tool-edit-rpm'),
          feedXY: +get('tool-edit-feed-xy'),
          feedZ:  +get('tool-edit-feed-z'),
        }
      }
    };
    try {
      if (id) {
        await fetch(`/api/tools/${id}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      } else {
        await fetch('/api/tools', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      }
      document.getElementById('dlg-tool-edit')?.close();
      this._openToolLibrary();
      this.toast('✅ تم حفظ الأداة', 'success');
    } catch (err) { this.toast('❌ ' + err.message, 'error'); }
  }

  /* ══ PROJECTS ══ */
  async _openProjects() {
    const dlg  = document.getElementById('dlg-projects');
    const list = document.getElementById('project-list');
    if (!dlg || !list) return;
    try {
      const res  = await fetch('/api/projects');
      const data = await res.json();
      list.innerHTML = '';
      if (!(data.projects || []).length) {
        list.innerHTML = '<p style="color:var(--text3);text-align:center;padding:16px">لا توجد مشاريع محفوظة</p>';
      } else {
        (data.projects || []).forEach(p => {
          const row = document.createElement('div');
          row.className = 'project-row';
          const date = new Date(p.savedAt).toLocaleDateString('ar-EG', { year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
          row.innerHTML = `
            <div class="proj-info">
              <b>${p.name}</b>
              <span>${p.shapeCount} شكل · ${date}</span>
            </div>
            <div class="proj-actions">
              <button class="tbtn primary" data-id="${p.id}">📂 فتح</button>
              <button class="tbtn danger"  data-del="${p.id}">🗑</button>
            </div>`;
          row.querySelector('[data-id]').addEventListener('click', () => this._loadProject(p.id, dlg));
          row.querySelector('[data-del]').addEventListener('click', async () => {
            if (!confirm(`حذف "${p.name}"?`)) return;
            await fetch(`/api/project/${p.id}`, { method: 'DELETE' });
            this._openProjects();
          });
          list.appendChild(row);
        });
      }
    } catch (err) { this.toast('❌ ' + err.message, 'error'); }
    dlg.showModal();
  }

  async _saveProject() {
    const name = document.getElementById('save-project-name')?.value?.trim();
    if (!name) { this.toast('أدخل اسم المشروع', 'warn'); return; }
    const shapes = this.editor?.getShapes() || [];
    const config = this.controls?.getConfig() || {};
    const data   = { shapes, config, gcode: this.gcode };
    try {
      const res  = await fetch('/api/project/save', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name, data }) });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      this.toast(`✅ تم حفظ "${name}"`, 'success');
      document.getElementById('dlg-projects')?.close();
    } catch (err) { this.toast('❌ ' + err.message, 'error'); }
  }

  async _loadProject(id, dlg) {
    try {
      const res  = await fetch(`/api/project/${id}`);
      const data = await res.json();
      const proj = data.project;
      if (!proj) throw new Error('مشروع غير موجود');

      if (proj.shapes?.length) {
        this.editor._saveHistory?.();
        this.editor.shapes = JSON.parse(JSON.stringify(proj.shapes));
        this.editor.render();
        this.editor._updateStatus?.();
      }
      if (proj.config && this.controls?.applyConfig) {
        this.controls.applyConfig(proj.config);
      }
      if (proj.gcode) {
        this.gcode = proj.gcode;
        this.preview.display(proj.gcode);
      }
      dlg?.close();
      this.toast(`✅ تم فتح "${proj.name}"`, 'success');
    } catch (err) { this.toast('❌ ' + err.message, 'error'); }
  }

  /* ══ IMAGE TRACE ══ */
  _openImageTrace() {
    const dlg = document.getElementById('dlg-image-trace');
    if (!dlg) return;
    this._traceImg     = null;
    this._tracedShapes = null;
    // Reset UI
    const origCanvas   = document.getElementById('trace-orig-canvas');
    const resultCanvas = document.getElementById('trace-result-canvas');
    if (origCanvas)   { const ctx=origCanvas.getContext('2d'); ctx.clearRect(0,0,origCanvas.width,origCanvas.height); }
    if (resultCanvas) { const ctx=resultCanvas.getContext('2d'); ctx.clearRect(0,0,resultCanvas.width,resultCanvas.height); }
    const stats = document.getElementById('trace-stats');
    if (stats) { stats.textContent='لم تُتبع صورة بعد'; stats.className='trace-stats'; }
    const dz = document.getElementById('trace-drop-zone');
    if (dz) dz.classList.remove('has-image');
    document.getElementById('btn-trace-import').disabled = true;
    dlg.showModal();
  }

  _loadTraceImage(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        this._traceImg = img;
        // Show original
        const canvas = document.getElementById('trace-orig-canvas');
        if (canvas) {
          canvas.width  = canvas.offsetWidth  || 300;
          canvas.height = canvas.offsetHeight || 200;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#0a0e14';
          ctx.fillRect(0,0,canvas.width,canvas.height);
          // fit image
          const scaleX = canvas.width  / img.naturalWidth;
          const scaleY = canvas.height / img.naturalHeight;
          const scale  = Math.min(scaleX, scaleY, 1);
          const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
          ctx.drawImage(img, (canvas.width-dw)/2, (canvas.height-dh)/2, dw, dh);
        }
        const dz = document.getElementById('trace-drop-zone');
        if (dz) {
          dz.classList.add('has-image');
          const icon = dz.querySelector('.trace-dz-icon');
          if (icon) icon.textContent = '✅';
          const p = dz.querySelector('p');
          if (p) p.textContent = file.name;
        }
        // Auto trace on load
        this._runTrace();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  _runTrace() {
    if (!this._traceImg) { this.toast('اختر صورة أولاً', 'warn'); return; }

    const threshold = parseInt(document.getElementById('trace-threshold')?.value || '128');
    const simplify  = parseFloat(document.getElementById('trace-simplify')?.value || '1.5');
    const widthMM   = parseFloat(document.getElementById('trace-width-mm')?.value || '100');
    const invert    = document.getElementById('trace-invert')?.checked || false;

    const img = this._traceImg;
    const scale = widthMM / img.naturalWidth; // mm per pixel

    const stats = document.getElementById('trace-stats');
    if (stats) { stats.textContent = '⏳ جاري التتبع...'; stats.className = 'trace-stats'; }

    // Run in next tick so UI updates
    setTimeout(() => {
      try {
        const tracer = new window.ImageTracer();
        const t0 = performance.now();
        const shapes = tracer.trace(img, { threshold, simplify, invert, scale });
        const ms = Math.round(performance.now() - t0);

        this._tracedShapes = shapes;

        // Draw preview
        const resultCanvas = document.getElementById('trace-result-canvas');
        if (resultCanvas) {
          resultCanvas.width  = resultCanvas.offsetWidth  || 300;
          resultCanvas.height = resultCanvas.offsetHeight || 200;
          tracer.preview(shapes, resultCanvas);
        }

        if (stats) {
          stats.textContent = `✅ ${shapes.length} مسار · ${shapes.reduce((n,s)=>n+s.points.length,0)} نقطة · ${ms}ms`;
          stats.className = 'trace-stats ok';
        }
        document.getElementById('btn-trace-import').disabled = !shapes.length;
      } catch (err) {
        if (stats) { stats.textContent = '❌ ' + err.message; stats.className = 'trace-stats err'; }
        console.error('Trace error:', err);
      }
    }, 20);
  }

  _importTraced() {
    if (!this._tracedShapes || !this._tracedShapes.length) return;
    this.editor._saveHistory?.();
    this.editor.shapes.push(...this._tracedShapes);
    this.editor.fitToView?.();
    this.editor._updateStatus?.();
    document.getElementById('dlg-image-trace')?.close();
    this.toast(`✅ تم استيراد ${this._tracedShapes.length} مسار`, 'success');
    this._tracedShapes = null;
    this._traceImg = null;
  }

  _bindImageTrace() {
    const dlg = document.getElementById('dlg-image-trace');
    if (!dlg) return;

    document.getElementById('cls-image-trace')?.addEventListener('click', () => dlg.close());
    document.getElementById('btn-trace-cancel')?.addEventListener('click', () => dlg.close());
    document.getElementById('btn-image-trace')?.addEventListener('click',  () => this._openImageTrace());
    document.getElementById('btn-trace-run')?.addEventListener('click',    () => this._runTrace());
    document.getElementById('btn-trace-import')?.addEventListener('click', () => this._importTraced());

    // File input
    const fileInput = document.getElementById('trace-file-input');
    document.getElementById('btn-trace-browse')?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', e => { if (e.target.files[0]) this._loadTraceImage(e.target.files[0]); });

    // Drag & drop on drop zone
    const dz = document.getElementById('trace-drop-zone');
    dz?.addEventListener('click', () => fileInput?.click());
    dz?.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
    dz?.addEventListener('dragleave', () => dz.classList.remove('dragover'));
    dz?.addEventListener('drop', e => {
      e.preventDefault(); dz.classList.remove('dragover');
      if (e.dataTransfer.files[0]) this._loadTraceImage(e.dataTransfer.files[0]);
    });

    // Live preview on slider change (debounced)
    let debounce;
    const rerun = () => { clearTimeout(debounce); debounce = setTimeout(() => this._runTrace(), 300); };
    ['trace-threshold','trace-simplify','trace-invert'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', e => {
        const val = document.getElementById(id+'_val') || document.getElementById(id+'-val');
        // Update display value
        if (id === 'trace-threshold') {
          const v = document.getElementById('trace-threshold-val');
          if (v) v.textContent = e.target.value;
        } else if (id === 'trace-simplify') {
          const v = document.getElementById('trace-simplify-val');
          if (v) v.textContent = parseFloat(e.target.value).toFixed(1);
        }
        if (this._traceImg) rerun();
      });
    });
    document.getElementById('trace-width-mm')?.addEventListener('change', () => { if (this._traceImg) rerun(); });
  }

  /* ══ POCKET MODE ══ */
  _togglePocketMode() {
    const btn = document.getElementById('btn-pocket-toggle');
    const idx = this.editor?.selectedIdx;
    if (idx < 0 || idx === undefined) { this.toast('حدد شكلاً أولاً', 'warn'); return; }
    const s = this.editor.shapes[idx];
    if (!s) return;
    const isPocket = s.machineOp === 'pocket';
    s.machineOp = isPocket ? undefined : 'pocket';
    if (btn) { btn.classList.toggle('active', !isPocket); btn.title = !isPocket ? 'إلغاء وضع الجيب' : 'وضع حفر الجيوب'; }
    this.toast(!isPocket ? '⬛ تم تفعيل وضع الجيب' : '▭ تم إلغاء وضع الجيب', 'info');
    this.editor.render();
  }

  async _checkServer() {
    try {
      const res = await fetch('/api/info');
      const info = await res.json();
      if(info.aiEnabled){
        this.controls.setStatus('✅ متصل + AI','active');
      } else {
        this.controls.setStatus('✅ متصل');
      }
    } catch(_) {
      this.controls.setStatus('📡 وضع محلي');
    }
  }
}

// Bootstrap
const app = new DiqqatQalamApp();
document.addEventListener('DOMContentLoaded', () => app.init());
