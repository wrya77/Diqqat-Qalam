'use strict';
const net          = require('net');
const EventEmitter = require('events');

// Serial port — optional dependency; works without if not installed
let SerialPort, ReadlineParser;
try {
  ({ SerialPort } = require('serialport'));
  ({ ReadlineParser } = require('@serialport/parser-readline'));
} catch (_) { /* serialport not installed — TCP-only mode */ }

class CNCConnector extends EventEmitter {
  constructor(io) {
    super();
    this.io          = io;
    this.socket      = null;   // TCP socket
    this.serial      = null;   // SerialPort instance
    this.connType    = null;   // 'tcp' | 'serial'
    this.host        = null;
    this.port        = null;
    this.serialPort  = null;
    this.baudRate    = 115200;
    this.connected   = false;
    this.buffer      = '';
    this.logs        = [];
    this.stream      = null;
    this.waitingAck  = false;
    this.fallbackMs  = 200;
    this._fallbackTimer = null;
    this._statusTimer   = null;   // GRBL polling timer
    this.machinePos  = { x: 0, y: 0, z: 0 };
    this.workPos     = { x: 0, y: 0, z: 0 };
    this.machineState = 'Disconnected';
    this._stopStream = false;
  }

  _emit(name, data) {
    try { this.emit(name, data); } catch (_) {}
    if (this.io) this.io.emit(name, data);
  }

  // ── TCP connection ──────────────────────────────────────────────────────────
  connectTCP(host, port, timeout = 5000) {
    return new Promise((resolve, reject) => {
      if (this.connected && this.connType === 'tcp' && this.host === host && this.port === port)
        return resolve({ connected: true });
      this._destroyConnection();

      const socket = new net.Socket();
      socket.setEncoding('utf8');
      let settled = false;

      socket.on('error', (err) => {
        if (!settled) { settled = true; reject(err); }
        this._emit('cnc-error', { error: err.message });
      });
      socket.on('close', () => {
        this.connected = false; this.socket = null;
        this._stopStatusPolling();
        this._emit('cnc-status', { connected: false, type: 'tcp' });
      });
      socket.on('data', (d) => this._onData(d.toString()));

      socket.connect(port, host, () => {
        this.socket   = socket;
        this.connType = 'tcp';
        this.connected = true;
        this.host = host; this.port = port;
        this._emit('cnc-status', { connected: true, type: 'tcp', host, port });
        if (!settled) { settled = true; resolve({ connected: true, type: 'tcp', host, port }); }
        this._startStatusPolling();
      });

      setTimeout(() => {
        if (!settled) { settled = true; try { socket.destroy(); } catch (_) {} reject(new Error('connect timeout')); }
      }, timeout);
    });
  }

  // ── Serial connection ───────────────────────────────────────────────────────
  connectSerial(portPath, baudRate = 115200) {
    return new Promise((resolve, reject) => {
      if (!SerialPort) return reject(new Error('serialport package غير مثبّت. شغّل: npm install serialport'));
      this._destroyConnection();

      try {
        const sp = new SerialPort({ path: portPath, baudRate, autoOpen: false });
        const parser = sp.pipe(new ReadlineParser({ delimiter: '\n' }));

        sp.on('error', (err) => {
          this._emit('cnc-error', { error: err.message });
          if (!this.connected) reject(err);
        });
        sp.on('close', () => {
          this.connected = false; this.serial = null;
          this._stopStatusPolling();
          this._emit('cnc-status', { connected: false, type: 'serial' });
        });
        parser.on('data', (line) => this._onData(line + '\n'));

        sp.open((err) => {
          if (err) return reject(err);
          this.serial     = sp;
          this.connType   = 'serial';
          this.connected  = true;
          this.serialPort = portPath;
          this.baudRate   = baudRate;
          this._emit('cnc-status', { connected: true, type: 'serial', port: portPath, baudRate });
          resolve({ connected: true, type: 'serial', port: portPath, baudRate });
          this._startStatusPolling();
        });
      } catch (err) { reject(err); }
    });
  }

  // ── List available serial ports ─────────────────────────────────────────────
  static async listPorts() {
    if (!SerialPort) return [];
    try {
      const ports = await SerialPort.list();
      return ports.map(p => ({
        path: p.path,
        manufacturer: p.manufacturer || '',
        serialNumber: p.serialNumber || '',
        pnpId: p.pnpId || '',
        description: `${p.path}${p.manufacturer ? ' — ' + p.manufacturer : ''}`,
      }));
    } catch (_) { return []; }
  }

  // ── Unified connect (backward-compatible) ──────────────────────────────────
  connect(host, port, timeout = 5000) {
    return this.connectTCP(host, port, timeout);
  }

  // ── Disconnect ──────────────────────────────────────────────────────────────
  _destroyConnection() {
    this._stopStatusPolling();
    if (this.socket) { try { this.socket.destroy(); } catch (_) {} this.socket = null; }
    if (this.serial) { try { this.serial.close(); }   catch (_) {} this.serial = null; }
    this.connected = false; this.connType = null;
    this.stream = null; this.waitingAck = false;
    if (this._fallbackTimer) { clearTimeout(this._fallbackTimer); this._fallbackTimer = null; }
  }

  disconnect() {
    this._destroyConnection();
    this.machineState = 'Disconnected';
    this._emit('cnc-status', { connected: false });
  }

  // ── Data handler ────────────────────────────────────────────────────────────
  _onData(data) {
    this.buffer += data;
    const parts = this.buffer.split(/\r?\n/);
    this.buffer = parts.pop();
    parts.forEach(raw => {
      const l = raw.trim();
      if (!l) return;
      this._log(l);
      this._emit('cnc-response', { line: l });

      // Parse GRBL status: <Idle|MPos:0.000,0.000,0.000|WPos:0.000,0.000,0.000>
      if (l.startsWith('<') && l.endsWith('>')) {
        this._parseGrblStatus(l);
        return;
      }

      // ACK handling
      if (/^ok$/i.test(l) || /^ok\b/i.test(l)) {
        this.waitingAck = false;
        if (this._fallbackTimer) { clearTimeout(this._fallbackTimer); this._fallbackTimer = null; }
        setImmediate(() => this._sendNextFromStream());
      }

      // GRBL alarm
      if (/^ALARM:/i.test(l)) {
        this._emit('cnc-alarm', { message: l });
      }
    });
  }

  _parseGrblStatus(line) {
    try {
      const state = line.match(/<([^|>]+)/)?.[1] || 'Unknown';
      const mpos  = line.match(/MPos:([-\d.]+),([-\d.]+),([-\d.]+)/);
      const wpos  = line.match(/WPos:([-\d.]+),([-\d.]+),([-\d.]+)/);
      if (mpos) this.machinePos = { x: +mpos[1], y: +mpos[2], z: +mpos[3] };
      if (wpos) this.workPos    = { x: +wpos[1], y: +wpos[2], z: +wpos[3] };
      this.machineState = state;
      this._emit('cnc-position', { state, mpos: this.machinePos, wpos: this.workPos });
    } catch (_) {}
  }

  // ── GRBL status polling ─────────────────────────────────────────────────────
  _startStatusPolling() {
    this._stopStatusPolling();
    this._statusTimer = setInterval(() => {
      if (this.connected) this._write('?');
    }, 100);
  }

  _stopStatusPolling() {
    if (this._statusTimer) { clearInterval(this._statusTimer); this._statusTimer = null; }
  }

  // ── Write to connection ─────────────────────────────────────────────────────
  _write(data, cb) {
    const payload = data.endsWith('\n') ? data : data + '\n';
    if (this.connType === 'serial' && this.serial) {
      this.serial.write(payload, 'utf8', cb);
    } else if (this.connType === 'tcp' && this.socket) {
      this.socket.write(payload, 'utf8', cb);
    }
  }

  // ── Send single line ────────────────────────────────────────────────────────
  sendLine(line) {
    if (!this.connected) return Promise.reject(new Error('غير متصل'));
    return new Promise((resolve, reject) => {
      try {
        this._write(line, () => {
          this._log('> ' + line);
          this._emit('cnc-sent', { line });
          resolve();
        });
      } catch (err) { reject(err); }
    });
  }

  // ── Emergency Stop ──────────────────────────────────────────────────────────
  emergencyStop() {
    this.stopStream();
    if (!this.connected) return;
    // GRBL soft-reset = 0x18 (Ctrl+X); also send M5 as fallback
    const payload = '\x18';
    if (this.connType === 'serial' && this.serial) {
      this.serial.write(Buffer.from([0x18]));
    } else if (this.connType === 'tcp' && this.socket) {
      this.socket.write(payload);
    }
    this._write('M05');
    this._write('M09');
    this._emit('cnc-estop', { timestamp: Date.now() });
    this._log('!! E-STOP !!');
  }

  // ── Jog ─────────────────────────────────────────────────────────────────────
  jog(axis, distance, feedRate = 1000) {
    if (!this.connected) return Promise.reject(new Error('غير متصل'));
    // GRBL jog: $J=G91 X10 F1000
    const cmd = `$J=G91 ${axis}${distance > 0 ? '+' : ''}${distance} F${feedRate}`;
    return this.sendLine(cmd);
  }

  // ── Home ─────────────────────────────────────────────────────────────────────
  home() { return this.sendLine('$H'); }

  // ── Zero work coordinates ───────────────────────────────────────────────────
  zeroWork(axes = ['X', 'Y', 'Z']) {
    const cmd = 'G10 L20 P1 ' + axes.map(a => `${a}0`).join(' ');
    return this.sendLine(cmd);
  }

  // ── Stream G-Code ───────────────────────────────────────────────────────────
  streamGCode(gcode) {
    if (!this.connected) return Promise.reject(new Error('غير متصل'));
    if (this.stream) return Promise.reject(new Error('البث جارٍ بالفعل'));
    const lines = gcode.split(/\r?\n/).map(l => l.replace(/\r/, '').trim()).filter(Boolean);
    this.stream     = { lines, index: 0, total: lines.length };
    this._stopStream = false;
    this._emit('cnc-stream-start', { total: lines.length });
    setImmediate(() => this._sendNextFromStream());
    return Promise.resolve({ started: true, total: lines.length });
  }

  stopStream() {
    this._stopStream = true;
    this.stream      = null;
    this.waitingAck  = false;
    if (this._fallbackTimer) { clearTimeout(this._fallbackTimer); this._fallbackTimer = null; }
    this._emit('cnc-stream-stopped', {});
  }

  _sendNextFromStream() {
    if (!this.stream || !this.connected || this._stopStream) return;
    if (this.waitingAck) return;
    if (this.stream.index >= this.stream.total) {
      const total = this.stream.total;
      this.stream = null;
      this._emit('cnc-stream-end', { total });
      return;
    }
    const line = this.stream.lines[this.stream.index++];
    try {
      this.waitingAck = true;
      this._write(line, () => {
        this._log('> ' + line);
        this._emit('cnc-sent-line', {
          index: this.stream?.index ?? null,
          total: this.stream?.total ?? null,
          line,
          progress: this.stream ? Math.round(this.stream.index / this.stream.total * 100) : 100,
        });
        if (this._fallbackTimer) { clearTimeout(this._fallbackTimer); this._fallbackTimer = null; }
        this._fallbackTimer = setTimeout(() => {
          this.waitingAck = false; this._fallbackTimer = null;
          setImmediate(() => this._sendNextFromStream());
        }, this.fallbackMs);
      });
    } catch (err) {
      this._emit('cnc-error', { error: err.message });
      this.waitingAck = false;
    }
  }

  // ── Status & logs ───────────────────────────────────────────────────────────
  getStatus() {
    return {
      connected:    this.connected,
      type:         this.connType,
      host:         this.host,
      port:         this.port,
      serialPort:   this.serialPort,
      baudRate:     this.baudRate,
      streaming:    !!this.stream,
      machineState: this.machineState,
      mpos:         this.machinePos,
      wpos:         this.workPos,
      progress:     this.stream ? { index: this.stream.index, total: this.stream.total } : null,
    };
  }

  _log(line) {
    this.logs.push(line);
    if (this.logs.length > 2000) this.logs.shift();
  }

  tailLogs(count = 200) { return this.logs.slice(-count); }
}

module.exports = CNCConnector;
