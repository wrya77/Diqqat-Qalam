/**
 * smoke.js — اختبار دخانٍ لخادم MCP عبر stdio حقيقيّ.
 * يتظاهر بأنّه العميل (Claude Desktop): يُهيّئ، يسرد الأدوات، ثمّ ينادي make_letters.
 */
'use strict';
const { spawn } = require('child_process');
const path = require('path');

const srv = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
  stdio: ['pipe', 'pipe', 'inherit'],
});

let buf = '';
const pending = new Map();
srv.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id != null && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  }
});

let idSeq = 1;
function rpc(method, params) {
  const id = idSeq++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
function notify(method, params) {
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

(async () => {
  const init = await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke', version: '1.0.0' },
  });
  console.log('1) initialize   →', init.result ? 'OK (' + init.result.serverInfo.name + ')' : JSON.stringify(init.error));
  notify('notifications/initialized', {});

  const tools = await rpc('tools/list', {});
  console.log('2) tools/list   →', tools.result.tools.map(t => t.name).join(', '));

  const fonts = await rpc('tools/call', { name: 'list_fonts', arguments: {} });
  console.log('3) list_fonts   →', fonts.result.content[0].text.split('\n').length - 1, 'خطوط');

  const mk = await rpc('tools/call', {
    name: 'make_letters',
    arguments: { text: 'دقة قلم', font: 'ruqaa', heightMM: 250, material: 5 },
  });
  console.log('4) make_letters →', mk.result.isError ? 'ERROR' : 'OK');
  console.log(mk.result.content[0].text.split('\n').map(l => '     ' + l).join('\n'));

  // خطأ متعمّد: نصٌّ فارغ
  const bad = await rpc('tools/call', { name: 'make_letters', arguments: { text: '' } });
  console.log('5) نصّ فارغ      →', bad.result.isError ? 'رُفض كما يجب: ' + bad.result.content[0].text : 'لم يُرفَض!');

  srv.kill();
  process.exit(0);
})().catch((e) => { console.error('smoke فشل:', e); srv.kill(); process.exit(1); });
