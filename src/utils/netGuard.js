'use strict';
/**
 * netGuard.js — حماية من SSRF: يمنع الاتصال بعناوين داخلية/خاصة.
 *
 * يُستخدم في أي مسار يفتح اتصالاً لمضيف يحدّده المستخدم (مثل /api/cnc/connect)
 * لمنع مسح الشبكة الداخلية أو الوصول لخدمة الميتاداتا (169.254.169.254).
 */

const dns = require('dns');
const net = require('net');

// هل العنوان ضمن نطاقات خاصة/داخلية؟
function isPrivateAddr(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (net.isIPv4(h)) {
    const p = h.split('.').map(Number);
    if (p.some(n => Number.isNaN(n) || n < 0 || n > 255)) return true; // صيغة شاذة → ارفض
    if (p[0] === 10) return true;                              // 10.0.0.0/8
    if (p[0] === 127) return true;                             // loopback
    if (p[0] === 0) return true;                               // 0.0.0.0/8
    if (p[0] === 169 && p[1] === 254) return true;             // link-local + metadata
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true; // 172.16.0.0/12
    if (p[0] === 192 && p[1] === 168) return true;             // 192.168.0.0/16
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;// CGNAT 100.64.0.0/10
    return false;
  }
  if (net.isIPv6(h)) {
    if (h === '::1' || h === '::') return true;                // loopback / unspecified
    if (h.startsWith('fc') || h.startsWith('fd')) return true;// ULA fc00::/7
    if (h.startsWith('fe80')) return true;                    // link-local
    if (h.startsWith('::ffff:')) return isPrivateAddr(h.slice(7)); // IPv4-mapped
    return false;
  }
  return false; // اسم نطاق — يُتحقَّق بعد حلّه في assertPublicHost
}

// يرفع خطأً إن كان المضيف داخلياً أو يُحَلّ (DNS) إلى عنوان داخلي.
// يجب استدعاؤه (await) قبل أي socket.connect على مضيف من المستخدم.
async function assertPublicHost(host) {
  const h = String(host || '').trim().replace(/^\[|\]$/g, '');
  if (!h) throw new Error('مضيف غير صالح');
  if (isPrivateAddr(h)) throw new Error('وجهة داخلية غير مسموحة');
  if (net.isIP(h)) return h; // عنوان عام صريح

  const addrs = await new Promise((resolve, reject) => {
    dns.lookup(h, { all: true }, (err, a) => (err ? reject(new Error('تعذّر حلّ اسم المضيف')) : resolve(a)));
  });
  if (!addrs.length || addrs.some(a => isPrivateAddr(a.address))) {
    throw new Error('وجهة داخلية غير مسموحة');
  }
  return h;
}

module.exports = { isPrivateAddr, assertPublicHost };
