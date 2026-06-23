/**
 * machine-control.js — لوحة التحكم اليدوي بالآلة
 * Jog / E-Stop / Home / WPos display / Serial+TCP connection
 */
class MachineControl {
  constructor(app) {
    this.app        = app;
    this.socket     = null;
    this.connected  = false;
    this.connType   = 'tcp';
    this.jogStep    = 1;      // mm
    this.jogFeed    = 1000;   // mm/min
    this.streaming  = false;
    this._portsLoaded = false;
    this._initSocket();
    this._bindUI();
    // المنافذ التسلسلية تُحمَّل عند الحاجة فقط (اختيار وضع Serial) — لا طلب /api/cnc/ports
    // على كل فتح للتطبيق، خاصة على البيئات بلا منافذ (Vercel) أو لمستخدمي TCP.
  }

  // ── Socket.io ────────────────────────────────────────────────────────────────
  _initSocket() {
    if (typeof io === 'undefined') return;
    this.socket = io();

    this.socket.on('cnc-status', (data) => {
      this.connected = data.connected;
      this._updateConnectionUI(data);
    });

    this.socket.on('cnc-position', (data) => {
      this._updatePosition(data);
    });

    this.socket.on('cnc-sent-line', (data) => {
      if (data.progress !== undefined) {
        this._updateStreamProgress(data.progress, data.index, data.total);
      }
    });

    this.socket.on('cnc-stream-start', (data) => {
      this.streaming = true;
      this._setStreamUI(true, data.total);
    });

    this.socket.on('cnc-stream-end', () => {
      this.streaming = false;
      this._setStreamUI(false);
      this.app?.toast('✅ اكتمل إرسال G-Code إلى الآلة', 'success');
    });

    this.socket.on('cnc-stream-stopped', () => {
      this.streaming = false;
      this._setStreamUI(false);
      this.app?.toast('⏹ تم إيقاف الإرسال', 'warn');
    });

    this.socket.on('cnc-alarm', (data) => {
      this.app?.toast('🚨 تحذير آلة: ' + data.message, 'error');
      this._log('🚨 ' + data.message);
    });

    this.socket.on('cnc-response', (data) => {
      this._log(data.line);
    });

    this.socket.on('cnc-estop', () => {
      this.app?.toast('🛑 E-STOP تم إرسال أمر الإيقاف الطارئ', 'error');
    });
  }

  // ── UI binding ───────────────────────────────────────────────────────────────
  _bindUI() {
    // نوع الاتصال
    document.querySelectorAll('.conn-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.conn-type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.connType = btn.dataset.type;
        document.getElementById('tcp-fields')?.classList.toggle('hidden', this.connType !== 'tcp');
        document.getElementById('serial-fields')?.classList.toggle('hidden', this.connType !== 'serial');
        // حمّل المنافذ أول مرة يُختار فيها وضع Serial فقط
        if (this.connType === 'serial' && !this._portsLoaded) { this._portsLoaded = true; this._loadPorts(); }
      });
    });

    // اتصال
    document.getElementById('btn-cnc-connect')?.addEventListener('click', () => this._connect());
    document.getElementById('btn-cnc-disconnect')?.addEventListener('click', () => this._disconnect());

    // تحديث قائمة المنافذ
    document.getElementById('btn-refresh-ports')?.addEventListener('click', () => this._loadPorts());

    // E-Stop
    document.getElementById('btn-estop')?.addEventListener('click', () => this._eStop());

    // Home
    document.getElementById('btn-home')?.addEventListener('click', () => this._sendCmd('$H'));
    document.getElementById('btn-home-xy')?.addEventListener('click', () => this._sendCmd('$HX\n$HY'));
    document.getElementById('btn-zero-work')?.addEventListener('click', () => {
      this._sendCmd('G10 L20 P1 X0 Y0 Z0');
      this.app?.toast('تم ضبط الصفر', 'success');
    });

    // Jog خطوة
    document.querySelectorAll('.jog-step-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.jog-step-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.jogStep = parseFloat(btn.dataset.step);
      });
    });

    // أزرار Jog الاتجاهية
    const jogMap = {
      'jog-x-pos': ['X',  1], 'jog-x-neg': ['X', -1],
      'jog-y-pos': ['Y',  1], 'jog-y-neg': ['Y', -1],
      'jog-z-pos': ['Z',  1], 'jog-z-neg': ['Z', -1],
    };
    Object.entries(jogMap).forEach(([id, [axis, dir]]) => {
      const el = document.getElementById(id);
      if (!el) return;
      // نقر واحد
      el.addEventListener('click', () => this._jog(axis, dir * this.jogStep));
      // ضغط مستمر
      let interval = null;
      const startHold = () => { clearInterval(interval); interval = setInterval(() => this._jog(axis, dir * this.jogStep), 150); };
      const stopHold  = () => { if (interval) { clearInterval(interval); interval = null; this._sendCmd('\x85'); } };
      // Pointer Events يغطّي الفأرة واللمس معاً (ضغط مستمر يعمل على الجوال)
      el.addEventListener('pointerdown',   startHold);
      el.addEventListener('pointerup',     stopHold);
      el.addEventListener('pointercancel', stopHold);
      el.addEventListener('pointerleave',  stopHold);
    });

    // Spindle overrides
    document.getElementById('spindle-override')?.addEventListener('input', (e) => {
      document.getElementById('spindle-override-val').textContent = e.target.value + '%';
    });
    document.getElementById('feed-override')?.addEventListener('input', (e) => {
      document.getElementById('feed-override-val').textContent = e.target.value + '%';
    });

    // إرسال السطر اليدوي
    document.getElementById('btn-send-cmd')?.addEventListener('click', () => this._sendManualCmd());
    document.getElementById('manual-cmd')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._sendManualCmd();
    });

    // إرسال / إيقاف G-Code
    document.getElementById('btn-send-gcode')?.addEventListener('click', () => this._sendGCode());
    document.getElementById('btn-stop-stream')?.addEventListener('click', () => this._stopStream());
  }

  // ── Connection ────────────────────────────────────────────────────────────────
  async _connect() {
    const btn = document.getElementById('btn-cnc-connect');
    if (btn) btn.disabled = true;
    try {
      let body, url = '/api/cnc/connect';
      if (this.connType === 'serial') {
        const port     = document.getElementById('serial-port')?.value;
        const baudRate = +document.getElementById('serial-baud')?.value || 115200;
        if (!port) { this.app?.toast('اختر منفذ Serial أولاً', 'warn'); return; }
        body = { type: 'serial', port, baudRate };
      } else {
        const host = document.getElementById('cnc-host')?.value?.trim();
        const port = +document.getElementById('cnc-port')?.value;
        if (!host || !port) { this.app?.toast('أدخل Host و Port', 'warn'); return; }
        body = { type: 'tcp', host, port };
      }
      const res  = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      this.app?.toast('✅ متصل بالآلة', 'success');
    } catch (err) {
      this.app?.toast('❌ فشل الاتصال: ' + err.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async _disconnect() {
    await fetch('/api/cnc/disconnect', { method: 'POST' });
    this.app?.toast('تم قطع الاتصال', 'info');
  }

  // ── Commands ─────────────────────────────────────────────────────────────────
  async _sendCmd(cmd) {
    if (!this.connected) { this.app?.toast('الآلة غير متصلة', 'warn'); return; }
    for (const line of cmd.split('\n')) {
      await fetch('/api/cnc/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ line }) });
    }
  }

  async _jog(axis, distance) {
    if (!this.connected) return;
    const cmd = `$J=G91 ${axis}${distance > 0 ? '' : ''}${distance} F${this.jogFeed}`;
    await fetch('/api/cnc/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ line: cmd }) });
  }

  async _eStop() {
    await fetch('/api/cnc/estop', { method: 'POST' });
  }

  async _sendGCode() {
    if (!this.app?.gcode) { this.app?.toast('لا يوجد G-Code — ولّد الكود أولاً', 'warn'); return; }
    if (!this.connected)  { this.app?.toast('الآلة غير متصلة', 'warn'); return; }
    const res  = await fetch('/api/cnc/stream', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gcode: this.app.gcode }) });
    const data = await res.json();
    if (!data.success) this.app?.toast('❌ ' + data.error, 'error');
  }

  async _stopStream() {
    await fetch('/api/cnc/stop', { method: 'POST' });
  }

  _sendManualCmd() {
    const el  = document.getElementById('manual-cmd');
    const cmd = el?.value?.trim();
    if (!cmd) return;
    this._sendCmd(cmd);
    el.value = '';
    this._log('→ ' + cmd);
  }

  // ── Ports ─────────────────────────────────────────────────────────────────────
  async _loadPorts() {
    try {
      const res   = await fetch('/api/cnc/ports');
      const data  = await res.json();
      const sel   = document.getElementById('serial-port');
      if (!sel) return;
      sel.innerHTML = '<option value="">-- اختر منفذ --</option>';
      (data.ports || []).forEach(p => {
        const opt = document.createElement('option');
        opt.value       = p.path;
        opt.textContent = p.description || p.path;
        sel.appendChild(opt);
      });
    } catch (_) {}
  }

  // ── UI updates ────────────────────────────────────────────────────────────────
  _updateConnectionUI(data) {
    const pill    = document.getElementById('cnc-conn-pill');
    const btnConn = document.getElementById('btn-cnc-connect');
    const btnDisc = document.getElementById('btn-cnc-disconnect');
    const btnSend = document.getElementById('btn-send-gcode');
    const btnEStop= document.getElementById('btn-estop');

    if (pill) {
      pill.textContent = data.connected ? '🟢 متصل' : '🔴 غير متصل';
      pill.className   = 'cnc-pill ' + (data.connected ? 'conn' : 'disc');
    }
    if (btnConn) btnConn.style.display = data.connected ? 'none' : '';
    if (btnDisc) btnDisc.style.display = data.connected ? '' : 'none';
    if (btnSend) btnSend.disabled = !data.connected;
    if (btnEStop) btnEStop.disabled = !data.connected;

    const typeEl = document.getElementById('cnc-conn-type');
    if (typeEl && data.connected) {
      typeEl.textContent = data.type === 'serial'
        ? `Serial: ${data.port} @ ${data.baudRate}`
        : `TCP: ${data.host}:${data.port}`;
    }
  }

  _updatePosition(data) {
    const fmt = (v) => (v >= 0 ? '+' : '') + v.toFixed(3);
    const set  = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('pos-x', fmt(data.wpos?.x ?? 0));
    set('pos-y', fmt(data.wpos?.y ?? 0));
    set('pos-z', fmt(data.wpos?.z ?? 0));
    set('mpos-x', fmt(data.mpos?.x ?? 0));
    set('mpos-y', fmt(data.mpos?.y ?? 0));
    set('mpos-z', fmt(data.mpos?.z ?? 0));
    const stateEl = document.getElementById('machine-state');
    if (stateEl) {
      stateEl.textContent = data.state || '?';
      stateEl.className   = 'machine-state state-' + (data.state || 'unknown').toLowerCase();
    }
  }

  _setStreamUI(active, total) {
    const btnSend = document.getElementById('btn-send-gcode');
    const btnStop = document.getElementById('btn-stop-stream');
    const prog    = document.getElementById('stream-progress');
    if (btnSend) btnSend.style.display = active ? 'none' : '';
    if (btnStop) btnStop.style.display = active ? '' : 'none';
    if (prog)    prog.style.display    = active ? '' : 'none';
    if (!active) {
      this._updateStreamProgress(0, 0, 0);
    }
  }

  _updateStreamProgress(pct, idx, total) {
    const fill  = document.getElementById('stream-prog-fill');
    const label = document.getElementById('stream-prog-label');
    if (fill)  fill.style.width  = pct + '%';
    if (label) label.textContent = `${idx}/${total} (${pct}%)`;
  }

  _log(line) {
    const box = document.getElementById('cnc-log');
    if (!box) return;
    const div = document.createElement('div');
    div.className   = 'log-line';
    div.textContent = line;
    box.appendChild(div);
    if (box.children.length > 300) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }
}
