/**
 * file-importer.js — Handles SVG/DXF/PNG import
 */
class FileImporter {
  constructor(app) {
    this.app    = app;
    this.loaded = null; // { type, shapes/gcode }
    this._init();
  }

  _init() {
    document.getElementById('btn-import')?.addEventListener('click', ()=>this.openDialog());
    document.getElementById('cls-import')?.addEventListener('click', ()=>this.closeDialog());
    document.getElementById('btn-import-cancel')?.addEventListener('click', ()=>this.closeDialog());
    document.getElementById('btn-import-ok')?.addEventListener('click', ()=>this.confirmImport());
    document.getElementById('btn-browse')?.addEventListener('click', ()=>document.getElementById('file-input').click());
    document.getElementById('file-input')?.addEventListener('change', e=>this._handleFile(e.target.files[0]));

    // Drag & Drop on drop-zone
    const dz = document.getElementById('drop-zone');
    if(dz){
      dz.addEventListener('dragover', e=>{ e.preventDefault(); dz.classList.add('dragover'); });
      dz.addEventListener('dragleave',()=>dz.classList.remove('dragover'));
      dz.addEventListener('drop', e=>{
        e.preventDefault(); dz.classList.remove('dragover');
        const f=e.dataTransfer.files[0];
        if(f) this._handleFile(f);
      });
    }

    // Global drag & drop on canvas
    const area = document.getElementById('canvas-area');
    if(area){
      area.addEventListener('dragover',e=>e.preventDefault());
      area.addEventListener('drop',e=>{
        e.preventDefault();
        const f=e.dataTransfer.files[0];
        if(f){ this.openDialog(); this._handleFile(f); }
      });
    }
  }

  openDialog() {
    this.loaded = null;
    document.getElementById('import-preview-area').textContent='';
    document.getElementById('btn-import-ok').disabled=true;
    document.getElementById('dlg-import').showModal();
  }

  closeDialog() {
    document.getElementById('dlg-import').close();
    document.getElementById('file-input').value='';
    this.loaded=null;
  }

  async _handleFile(file) {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    const prev = document.getElementById('import-preview-area');

    prev.textContent = `⏳ جاري قراءة "${file.name}"...`;

    try {
      if (ext==='svg') {
        const text = await file.text();
        const parser = new SVGParser();
        const shapes = parser.parse(text);
        this.loaded = { type:'shapes', shapes, name:file.name };
        prev.textContent = `✅ تم التعرف على ${shapes.length} شكل من SVG`;

      } else if (ext==='dxf') {
        // Try server-side parsing
        const fd = new FormData(); fd.append('file',file);
        const res = await fetch('/api/import',{method:'POST',body:fd});
        const data = await res.json();
        if(!data.success) throw new Error(data.error);
        this.loaded = { type:'shapes', shapes:data.shapes, name:file.name };
        prev.textContent = `✅ تم استيراد ${data.count} شكل من DXF`;

      } else if (['nc','gcode','tap'].includes(ext)) {
        const text = await file.text();
        this.loaded = { type:'gcode', gcode:text, name:file.name };
        const lines = text.split('\n').length;
        prev.textContent = `✅ ملف G-Code: ${lines} سطر`;

      } else if (['png','jpg','jpeg'].includes(ext)) {
        prev.textContent = `⚠ الصور تتطلب تحويل يدوي — استخدم SVG بدلاً من ذلك`;
        return;

      } else {
        throw new Error(`نوع الملف غير مدعوم: .${ext}`);
      }

      document.getElementById('btn-import-ok').disabled = false;

    } catch(err) {
      prev.textContent = `❌ خطأ: ${err.message}`;
    }
  }

  confirmImport() {
    if (!this.loaded) return;

    if (this.loaded.type === 'shapes') {
      if(!this.loaded.shapes.length){ this.app.toast('لا أشكال للاستيراد!','warn'); return; }
      this.app.editor.addShapesFromSVG(this.loaded.shapes);
      this.app.toast(`✅ تم استيراد ${this.loaded.shapes.length} شكل`, 'success');

    } else if (this.loaded.type === 'gcode') {
      this.app.setGCode(this.loaded.gcode);
      this.app.toast('✅ تم تحميل ملف G-Code', 'success');
    }

    this.closeDialog();
  }
}
