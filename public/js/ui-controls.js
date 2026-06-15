/**
 * ui-controls.js — All UI event bindings & config reading
 */
class UIControls {
  constructor(app) {
    this.app = app;
    this._devicePollInterval = null;
    this._deviceLastStatus = {};
    this._init();
  }

  _init() {
    // Tool buttons
    document.querySelectorAll('[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.app.editor.setTool(btn.dataset.tool);
        document.querySelectorAll('[data-tool]').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // Canvas controls
    document.getElementById('show-grid')?.addEventListener('change', e=>this.app.editor.setShowGrid(e.target.checked));
    document.getElementById('snap-grid')?.addEventListener('change', e=>this.app.editor.setSnap(e.target.checked));
    document.getElementById('grid-size')?.addEventListener('change', e=>this.app.editor.setGrid(+e.target.value));
    document.getElementById('btn-zoom-in')?.addEventListener('click', ()=>this.app.editor._onWheel({deltaY:-100,clientX:400,clientY:300,preventDefault:()=>{}}));
    document.getElementById('btn-zoom-out')?.addEventListener('click',()=>this.app.editor._onWheel({deltaY:100,clientX:400,clientY:300,preventDefault:()=>{}}));
    document.getElementById('btn-zoom-fit')?.addEventListener('click', ()=>this.app.editor.fitToView());

    // Keyboard shortcuts
    document.addEventListener('keydown', e=>{
      // التراجع/الإعادة (Ctrl+Z/Y) يتكفّل بهما canvas-editor عبر e.code — أُزيلا هنا لمنع التكرار المزدوج
      if(e.ctrlKey && (e.code==='Digit0'||e.code==='Numpad0')){e.preventDefault();this.app.editor.fitToView();}
      if(e.key==='Enter'&&!e.target.matches('input,select,textarea'))this.app.generate();
    });

    // Output tabs
    document.querySelectorAll('.otab').forEach(tab=>{
      tab.addEventListener('click', ()=>this.activateTab(tab.dataset.tab));
    });

    // G-Code actions
    document.getElementById('btn-copy-gcode')?.addEventListener('click', ()=>{
      if(this.app.preview.copyToClipboard()) this.app.toast('✅ تم النسخ!','success');
    });
    document.getElementById('btn-dl-gcode')?.addEventListener('click', ()=>{
      if(this.app.gcode) this.app._downloadBlob(this.app.gcode,'design.nc');
      else this.app.toast('لا يوجد G-Code بعد!','warn');
    });
    document.getElementById('btn-clr-gcode')?.addEventListener('click', ()=>{
      this.app.preview.clear(); this.app.gcode='';
    });

    // Export dialog
    document.getElementById('btn-export')?.addEventListener('click', ()=>{
      if(!this.app.gcode){this.app.toast('ولّد G-Code أولاً!','warn');return;}
      document.getElementById('dlg-export').showModal();
    });
    document.getElementById('cls-export')?.addEventListener('click', ()=>document.getElementById('dlg-export').close());
    document.getElementById('btn-export-cancel')?.addEventListener('click', ()=>document.getElementById('dlg-export').close());
    document.getElementById('btn-export-ok')?.addEventListener('click', ()=>this.app.exportFile());

    // Machine profile
    document.getElementById('machine-profile')?.addEventListener('change', e=>{
      if(e.target.value) this.applyProfile(e.target.value);
    });

    // Depth indicator update
    ['total-depth','pass-depth'].forEach(id=>{
      document.getElementById(id)?.addEventListener('input', ()=>this._updateDepthBar());
    });

    // Device (CNC over Wi-Fi) controls
    document.getElementById('btn-device-connect')?.addEventListener('click', ()=>this.connectDevice());
    document.getElementById('btn-device-disconnect')?.addEventListener('click', ()=>this.disconnectDevice());
    document.getElementById('btn-send-to-device')?.addEventListener('click', ()=>this.sendToDevice());

    // Start polling device status
    this._updateDeviceStatus();
    if (!this._devicePollInterval) this._devicePollInterval = setInterval(()=>this._updateDeviceStatus(), 2500);
  }

  getConfig() {
    return {
      units:          document.getElementById('units')?.value           || 'mm',
      toolDiameter:   +document.getElementById('tool-diameter')?.value  || 3,
      toolType:       document.getElementById('tool-type')?.value       || 'flat',
      toolNumber:     +document.getElementById('tool-number')?.value    || 1,
      compensation:   document.getElementById('tool-compensation')?.value|| 'none',
      totalDepth:     +document.getElementById('total-depth')?.value    || 5,
      passDepth:      +document.getElementById('pass-depth')?.value     || 1,
      safeHeight:     +document.getElementById('safe-height')?.value    || 5,
      feedRateXY:     +document.getElementById('feed-rate-xy')?.value   || 1000,
      feedRateZ:      +document.getElementById('feed-rate-z')?.value    || 300,
      spindleSpeed:   +document.getElementById('spindle-speed')?.value  || 18000,
      spindleDir:     document.getElementById('spindle-dir')?.value     || 'cw',
      material:       document.getElementById('material')?.value        || 'generic',
      coordSystem:    document.getElementById('coord-system')?.value    || 'G54',
      origin:         document.getElementById('origin')?.value          || 'bottom-left',
      arcDetect:      document.getElementById('arc-detect')?.checked    !== false,
      sortPaths:      document.getElementById('sort-paths')?.checked    !== false,
      addComments:    document.getElementById('add-comments')?.checked  !== false,
      lineNumbers:    document.getElementById('line-numbers')?.checked  || false,
      aiOptimize:     document.getElementById('ai-optimize')?.checked   || false,
      machineProfile: document.getElementById('machine-profile')?.value || 'generic',
      plungeStrategy: document.getElementById('plunge-strategy')?.value || 'straight',
      rampAngle:      +document.getElementById('ramp-angle')?.value     || 3,
      travelX:        +document.getElementById('travel-x')?.value       || 0,
      travelY:        +document.getElementById('travel-y')?.value       || 0,
      travelZ:        +document.getElementById('travel-z')?.value       || 0,
    };
  }

  applyConfig(config) {
    const set = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined && val !== null) el.value = val; };
    const chk = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
    set('units',            config.units);
    set('tool-diameter',    config.toolDiameter);
    set('tool-type',        config.toolType);
    set('total-depth',      config.totalDepth);
    set('pass-depth',       config.passDepth);
    set('safe-height',      config.safeHeight);
    set('feed-rate-xy',     config.feedRateXY);
    set('feed-rate-z',      config.feedRateZ);
    set('spindle-speed',    config.spindleSpeed);
    set('spindle-dir',      config.spindleDir);
    set('material',         config.material);
    set('plunge-strategy',  config.plungeStrategy);
    set('ramp-angle',       config.rampAngle);
    set('travel-x',         config.travelX);
    set('travel-y',         config.travelY);
    set('travel-z',         config.travelZ);
    chk('arc-detect',       config.arcDetect);
    chk('add-comments',     config.addComments);
    chk('line-numbers',     config.lineNumbers);
    chk('ai-optimize',      config.aiOptimize);
  }

  updateStats(stats) {
    const set = (id, val) => { const el=document.getElementById(id); if(el) el.textContent=val||'--'; };
    set('st-time',    stats.estimatedTime);
    set('st-xy',      stats.totalXY);
    set('st-z',       stats.totalZ);
    set('st-moves',   stats.moves?.toLocaleString());
    set('st-lifts',   stats.lifts?.toLocaleString());
    set('st-passes',  stats.passes);
    set('st-lines',   stats.lines?.toLocaleString());
    // Update est-time in canvas footer too
    const et=document.getElementById('est-time');
    if(et) et.textContent='وقت: '+(stats.estimatedTime||'--');
  }

  showAISuggestions(suggestions, saving) {
    const box = document.getElementById('ai-box');
    if(!box||!suggestions?.length) return;
    const html=`<b>🤖 اقتراحات AI (توفير: ${saving})</b><ul>${suggestions.map(s=>`<li>${s}</li>`).join('')}</ul>`;
    box.innerHTML=html; box.classList.add('visible');
    const st=document.getElementById('st-saving');
    if(st) st.textContent=saving;
  }

  /**
   * عرض نافذة مراجعة تحليل AI مع إمكانية تعديل feedRate واعتماد التغييرات
   * analysis: array of { index, type, length, feedRate, maxRecommendedFeedRate, forceEstimate, engagement }
   * processedShapes: full shapes array returned by server (possibly reordered)
   */
  showAIAnalysis(analysis, processedShapes, suggestions, saving, aiMetadata) {
    if (!Array.isArray(analysis) || !document.getElementById('dlg-ai-review')) return;
    this._lastAIProcessedShapes = JSON.parse(JSON.stringify(processedShapes || []));

    const meta = document.getElementById('ai-review-meta');
    meta.innerHTML = `<div><b>توفير متوقع:</b> ${saving}</div>` + (aiMetadata?`<div style="font-size:12px;color:var(--muted)">${JSON.stringify(aiMetadata)}</div>`:'');

    const tbody = document.getElementById('ai-analysis-tbody');
    tbody.innerHTML = '';
    analysis.forEach((a, idx) => {
      const r = document.createElement('tr');
      r.innerHTML = `
        <td style="text-align:center"><input type="checkbox" class="ai-apply-checkbox" checked></td>
        <td>${a.index}</td>
        <td>${a.type}</td>
        <td>${(a.length||0).toFixed? (a.length||0).toFixed(1): (a.length||0)}</td>
        <td><input class="ai-feed-input" style="width:90px" type="number" step="1" min="1" value="${a.feedRate||''}"></td>
        <td>${a.maxRecommendedFeedRate||'–'}</td>
        <td>${a.forceEstimate? a.forceEstimate.Ft : '–'}</td>
        <td>${a.forceEstimate? a.forceEstimate.Fr : '–'}</td>
        <td>${a.engagement||'–'}</td>
      `;
      tbody.appendChild(r);
    });

    // Attach hover / checkbox interactivity to highlight shapes in the canvas
    Array.from(tbody.querySelectorAll('tr')).forEach((tr, i) => {
      const aItem = analysis[i];
      if (!aItem) return;
      const idx = aItem.index;
      const checkbox = tr.querySelector('.ai-apply-checkbox');

      tr.addEventListener('mouseenter', () => {
        try { this.app.editor.addHighlightIndex(idx); } catch(e){}
      });
      tr.addEventListener('mouseleave', () => {
        try {
          if (!checkbox.checked) this.app.editor.removeHighlightIndex(idx);
        } catch(e){}
      });

      checkbox.addEventListener('change', (ev) => {
        try {
          if (ev.target.checked) this.app.editor.addHighlightIndex(idx);
          else this.app.editor.removeHighlightIndex(idx);
        } catch(e){}
      });

      // clicking the row toggles the checkbox (unless clicking input)
      tr.addEventListener('click', (ev) => {
        if (ev.target && ev.target.tagName && ev.target.tagName.toLowerCase() === 'input') return;
        checkbox.checked = !checkbox.checked;
        try { if (checkbox.checked) this.app.editor.addHighlightIndex(idx); else this.app.editor.removeHighlightIndex(idx); } catch(e){}
      });
    });

    const dlg = document.getElementById('dlg-ai-review');
    const closeBtn = document.getElementById('cls-ai-review');
    const btnAll = document.getElementById('btn-ai-apply-all');
    const btnFeeds = document.getElementById('btn-ai-apply-feeds');
    const btnIgnore = document.getElementById('btn-ai-ignore');

    const collectEdited = (applyAll) => {
      const rows = Array.from(tbody.querySelectorAll('tr'));
      const ps = JSON.parse(JSON.stringify(this._lastAIProcessedShapes || []));
      rows.forEach((tr,i)=>{
        const checked = tr.querySelector('.ai-apply-checkbox')?.checked;
        const feedVal = tr.querySelector('.ai-feed-input')?.value;
        if (applyAll) {
          if (typeof feedVal !== 'undefined' && feedVal !== '') ps[i].feedRate = Number(feedVal);
        } else {
          // only include feedRates for checked rows; unset others
          if (checked && typeof feedVal !== 'undefined' && feedVal !== '') ps[i].feedRate = Number(feedVal);
          else delete ps[i].feedRate;
        }
      });
      return ps;
    };

    closeBtn.onclick = () => dlg.close();
    btnIgnore.onclick = () => { dlg.close(); this.app.toast('تم تجاهل اقتراحات AI','info'); };
    btnAll.onclick = async () => {
      const ps = collectEdited(true);
      dlg.close();
      await this.app.applyProcessedShapes(ps, { replaceAll: true });
    };
    btnFeeds.onclick = async () => {
      const ps = collectEdited(false);
      dlg.close();
      await this.app.applyProcessedShapes(ps, { replaceAll: false });
    };

    dlg.showModal();
  }


  activateTab(tabName) {
    document.querySelectorAll('.otab').forEach(t=>t.classList.toggle('active', t.dataset.tab===tabName));
    document.querySelectorAll('.out-pane').forEach(p=>p.classList.toggle('active', p.id==='pane-'+tabName));
  }

  setStatus(msg, type='') {
    const pill = document.getElementById('status-pill');
    if(!pill) return;
    pill.textContent = msg;
    pill.className = 'status-pill' + (type?' '+type:'');
  }

  _updateDepthBar() {
    const total = +document.getElementById('total-depth')?.value||5;
    const pass  = +document.getElementById('pass-depth')?.value||1;
    const pct   = Math.min(100, (pass/total)*100);
    const bar   = document.getElementById('depth-bar');
    if(bar){ bar.style.height=pct+'%'; bar.style.background=pct>80?'var(--red)':'var(--accent)'; }
  }

  applyProfile(name) {
    const profiles = {
      generic: { feedRateXY:1000, feedRateZ:300, spindleSpeed:18000 },
      grbl:    { feedRateXY:800,  feedRateZ:200, spindleSpeed:12000 },
      mach3:   { feedRateXY:1500, feedRateZ:500, spindleSpeed:24000 },
      fanuc:   { feedRateXY:2000, feedRateZ:500, spindleSpeed:8000  },
      haas:    { feedRateXY:3000, feedRateZ:800, spindleSpeed:6000  },
    };
    const p = profiles[name];
    if(!p) return;
    if(p.feedRateXY)    document.getElementById('feed-rate-xy').value=p.feedRateXY;
    if(p.feedRateZ)     document.getElementById('feed-rate-z').value=p.feedRateZ;
    if(p.spindleSpeed)  document.getElementById('spindle-speed').value=p.spindleSpeed;
    this.app.toast(`✅ تم تحميل ملف ${name}`, 'success');
  }

  /* ===== CNC Device (Wi-Fi) helpers ===== */
  async connectDevice() {
    const host = document.getElementById('machine-host')?.value?.trim();
    const port = +(document.getElementById('machine-port')?.value || 23);
    if (!host) { this.app.toast('أدخل عنوان IP للجهاز','warn'); return; }
    try {
      this.app.toast('🔌 جارٍ الاتصال بالجهاز...','info');
      const res = await fetch('/api/cnc/connect', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ host, port })});
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      this.app.toast('✅ تم الاتصال بالجهاز','success');
      this.updateDeviceUI(data.status || data);
    } catch (err) {
      this.app.toast('❌ '+err.message,'error');
      this.updateDeviceUI({ connected: false });
    }
  }

  async disconnectDevice() {
    try {
      const res = await fetch('/api/cnc/disconnect', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      this.app.toast('⛔ تم قطع الاتصال','success');
      this.updateDeviceUI({ connected: false });
    } catch (err) {
      this.app.toast('❌ '+err.message,'error');
    }
  }

  async sendToDevice() {
    const gcode = this.app.gcode || '';
    if (!gcode.trim()) { this.app.toast('لا يوجد G-Code لإرساله — ولّده أولاً','warn'); return; }
    if (!confirm || confirm('إرسال G-Code كامل إلى الجهاز عبر الشبكة؟')) {
      try {
        this.app.toast('📤 بدء الإرسال...','info');
        const res = await fetch('/api/cnc/stream', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ gcode }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);
        this.app.toast('✅ بدأ البث إلى الجهاز','success');
        this._updateDeviceStatus();
      } catch (err) {
        this.app.toast('❌ '+err.message,'error');
      }
    }
  }

  async _updateDeviceStatus() {
    try {
      const res = await fetch('/api/cnc/status');
      if (!res.ok) { this.updateDeviceUI({ connected: false }); return; }
      const data = await res.json();
      const status = data.status || data;
      this._deviceLastStatus = status;
      this.updateDeviceUI(status);
    } catch (err) {
      this.updateDeviceUI({ connected: false });
    }
  }

  updateDeviceUI(status) {
    const el = document.getElementById('device-status');
    const btnConnect = document.getElementById('btn-device-connect');
    const btnDisconnect = document.getElementById('btn-device-disconnect');
    const btnSend = document.getElementById('btn-send-to-device');
    if (!el) return;
    if (status?.connected) {
      let txt = `متصل`;
      if (status.host) txt += ` — ${status.host}:${status.port}`;
      if (status.streaming && status.progress) txt += ` — بث: ${status.progress.index}/${status.progress.total}`;
      else if (status.streaming) txt += ` — بث جارٍ`;
      el.textContent = txt;
      if (btnConnect) btnConnect.disabled = true;
      if (btnDisconnect) btnDisconnect.disabled = false;
      if (btnSend) btnSend.disabled = false;
    } else {
      el.textContent = 'غير متصل';
      if (btnConnect) btnConnect.disabled = false;
      if (btnDisconnect) btnDisconnect.disabled = true;
      if (btnSend) btnSend.disabled = true;
    }
  }
}
