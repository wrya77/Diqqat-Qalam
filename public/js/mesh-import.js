/**
 * mesh-import.js — قارئ صيغ المجسّمات (كل ما يُصدّره بلندر تقريباً)
 *
 *   كان الاستيراد ثلاثيّ الأبعاد يقبل صيغتين فقط: STL وOBJ. وبلندر يُصدّر
 *   افتراضياً glTF/GLB، ويستعمل الناس معه FBX وPLY وCOLLADA — فكانت الملفّات
 *   «لا يتعرّف عليها التطبيق». هذه الوحدة تقرأ:
 *
 *     STL (ثنائيّ ونصّيّ) · OBJ · PLY (نصّيّ وثنائيّ LE/BE) · glTF 2.0 · GLB
 *     COLLADA ‏(.dae) · X3D · 3MF · FBX (ثنائيّ ٦٫x و٧٫x، ونصّيّ)
 *
 *   وثلاث مسائل تُفسد الاستيراد صامتةً وتُعالَج هنا صراحةً:
 *
 *   ١) **المحور الأعلى**: عالم هذا التطبيق Z إلى الأعلى، وglTF وFBX وCOLLADA
 *      وX3D تُصدَّر Y إلى الأعلى. بلا تدوير يستلقي المجسّم على جنبه.
 *   ٢) **الوحدات**: glTF بالأمتار، وFBX بالسنتيمترات عادةً، وCOLLADA تُعلن
 *      وحدتها في ترويستها. التطبيق بالمليمتر — فمكعّب ٢م يصير ٢مم بلا تحويل.
 *   ٣) **تحويلات العُقَد**: المجسّم قد يكون مُزاحاً ومُحجَّماً في شجرة المشهد لا
 *      في رؤوسه؛ تجاهلُها يضع القطعة في غير مكانها.
 *
 *   القارئات كلّها بلا اعتماد على THREE (تُعيد مصفوفة أعداد) كي تُختبَر وحدها،
 *   وبلا مكتبات خارجية: فكّ الضغط عبر DecompressionStream وXML عبر DOMParser.
 */
(function meshImport() {
  'use strict';

  /* ══════════════ مصفوفات ٤×٤ (صفّيّة، column-major كـglTF) ══════════════ */

  const M_ID = () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];

  /** a·b بترتيب column-major */
  function mMul(a, b) {
    const o = new Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
                       a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return o;
  }

  function mApply(m, x, y, z) {
    return [
      m[0] * x + m[4] * y + m[8]  * z + m[12],
      m[1] * x + m[5] * y + m[9]  * z + m[13],
      m[2] * x + m[6] * y + m[10] * z + m[14],
    ];
  }

  /** تركيب من إزاحة ودوران (رباعيّ) وتحجيم */
  function mCompose(t, q, s) {
    const [x, y, z, w] = q;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    const [sx, sy, sz] = s;
    return [
      (1 - (yy + zz)) * sx, (xy + wz) * sx,       (xz - wy) * sx,       0,
      (xy - wz) * sy,       (1 - (xx + zz)) * sy, (yz + wx) * sy,       0,
      (xz + wy) * sz,       (yz - wx) * sz,       (1 - (xx + yy)) * sz, 0,
      t[0], t[1], t[2], 1,
    ];
  }

  const DEG = Math.PI / 180;
  /** دوران أويلر بترتيب XYZ (اصطلاح FBX وCOLLADA الشائع) بالدرجات */
  function mEulerXYZ(rx, ry, rz) {
    const cx = Math.cos(rx * DEG), sx = Math.sin(rx * DEG);
    const cy = Math.cos(ry * DEG), sy = Math.sin(ry * DEG);
    const cz = Math.cos(rz * DEG), sz = Math.sin(rz * DEG);
    // R = Rz·Ry·Rx
    return [
      cz * cy,                  sz * cy,                  -sy,      0,
      cz * sy * sx - sz * cx,   sz * sy * sx + cz * cx,   cy * sx,  0,
      cz * sy * cx + sz * sx,   sz * sy * cx - cz * sx,   cy * cx,  0,
      0, 0, 0, 1,
    ];
  }

  /* ══════════════ أدوات ══════════════ */

  /** نصّ من ArrayBuffer أو Uint8Array؛ len بالبايت لا بالحروف */
  const dec = (buf, from, len) => new TextDecoder('utf-8', { fatal: false })
    .decode(buf instanceof ArrayBuffer ? new Uint8Array(buf, from || 0, len) : buf);

  const b64 = s => {
    const bin = atob(s);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  };

  /** فكّ ضغط zlib أو deflate الخام عبر المتصفّح — بلا مكتبة */
  async function inflate(u8, raw) {
    if (typeof DecompressionStream !== 'function') throw new Error('فكّ الضغط غير مدعوم في هذا المتصفّح');
    const ds = new DecompressionStream(raw ? 'deflate-raw' : 'deflate');
    const stream = new Blob([u8]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /* ══════════════ ١ · STL ══════════════ */

  function parseSTL(buf) {
    const dv = new DataView(buf);
    const n = buf.byteLength >= 84 ? dv.getUint32(80, true) : 0;
    // الفحص الحاسم هو تطابق الطول المُعلن مع حجم الملف؛ ترويسة "solid" تظهر
    // في ملفّات ثنائية أيضاً فلا يصحّ الاعتماد عليها
    const isBin = n > 0 && 84 + n * 50 === buf.byteLength;
    const pos = [];
    if (isBin) {
      let o = 84;
      for (let i = 0; i < n; i++) {
        o += 12;                                     // الناظم يُعاد حسابه لاحقاً
        for (let k = 0; k < 9; k++) { pos.push(dv.getFloat32(o, true)); o += 4; }
        o += 2;
      }
    } else {
      const re = /vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/g;
      const txt = dec(buf);
      let m;
      while ((m = re.exec(txt))) pos.push(+m[1], +m[2], +m[3]);
    }
    return { pos, up: 'z', unitToMM: 1 };
  }

  /* ══════════════ ٢ · OBJ ══════════════ */

  function parseOBJ(buf) {
    const txt = dec(buf).replace(/\\\r?\n/g, ' ');   // وصل الأسطر المكسورة
    const V = [], pos = [];
    let name = null;
    for (const rawLine of txt.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line[0] === '#') continue;
      const sp = line.indexOf(' ');
      if (sp < 0) continue;
      const tag = line.slice(0, sp);
      if (tag === 'v') {
        const p = line.slice(sp + 1).trim().split(/\s+/);
        V.push([+p[0], +p[1], +p[2]]);
      } else if (tag === 'f') {
        const parts = line.slice(sp + 1).trim().split(/\s+/);
        const idx = parts.map(t => {
          const k = parseInt(t.split('/')[0], 10);
          return k < 0 ? V.length + k : k - 1;       // الفهارس السالبة نسبية للنهاية
        });
        for (let i = 2; i < idx.length; i++) {       // مروحة للمضلّعات
          for (const k of [idx[0], idx[i - 1], idx[i]]) {
            const v = V[k];
            if (v) pos.push(v[0], v[1], v[2]);
          }
        }
      } else if ((tag === 'o' || tag === 'g') && !name) {
        name = line.slice(sp + 1).trim() || null;
      }
    }
    return { pos, name, up: 'y', unitToMM: 1 };
  }

  /* ══════════════ ٣ · PLY ══════════════ */

  const PLY_SZ = { char:1, uchar:1, int8:1, uint8:1, short:2, ushort:2, int16:2, uint16:2,
                   int:4, uint:4, int32:4, uint32:4, float:4, float32:4, double:8, float64:8 };
  function plyRead(dv, off, type, le) {
    switch (type) {
      case 'char': case 'int8':    return dv.getInt8(off);
      case 'uchar': case 'uint8':  return dv.getUint8(off);
      case 'short': case 'int16':  return dv.getInt16(off, le);
      case 'ushort': case 'uint16':return dv.getUint16(off, le);
      case 'int': case 'int32':    return dv.getInt32(off, le);
      case 'uint': case 'uint32':  return dv.getUint32(off, le);
      case 'float': case 'float32':return dv.getFloat32(off, le);
      case 'double': case 'float64':return dv.getFloat64(off, le);
      default: return 0;
    }
  }

  function parsePLY(buf) {
    const head = dec(buf, 0, Math.min(buf.byteLength, 65536));
    const endTok = head.indexOf('end_header');
    if (endTok < 0) throw new Error('ترويسة PLY ناقصة');
    const nl = head.indexOf('\n', endTok);
    const headerText = head.slice(0, nl);
    // طول الترويسة بالبايت لا بالحروف: قد تحوي أسماءً غير لاتينية
    const dataStart = new TextEncoder().encode(head.slice(0, nl + 1)).length;

    let format = 'ascii', le = true;
    const elements = [];
    let cur = null;
    for (const line of headerText.split(/\r?\n/)) {
      const t = line.trim().split(/\s+/);
      if (t[0] === 'format') {
        format = t[1];
        le = format !== 'binary_big_endian';
      } else if (t[0] === 'element') {
        cur = { name: t[1], count: +t[2], props: [] };
        elements.push(cur);
      } else if (t[0] === 'property' && cur) {
        if (t[1] === 'list') cur.props.push({ list: true, countType: t[2], itemType: t[3], name: t[4] });
        else cur.props.push({ list: false, type: t[1], name: t[2] });
      }
    }

    const verts = [], faces = [];
    if (format === 'ascii') {
      const body = dec(buf).slice(nl + 1);
      const toks = body.split(/\s+/).filter(s => s.length);
      let p = 0;
      for (const el of elements) {
        for (let i = 0; i < el.count; i++) {
          const row = {};
          for (const pr of el.props) {
            if (pr.list) {
              const n = +toks[p++];
              const arr = [];
              for (let k = 0; k < n; k++) arr.push(+toks[p++]);
              row[pr.name] = arr;
            } else row[pr.name] = +toks[p++];
          }
          if (el.name === 'vertex') verts.push([row.x, row.y, row.z]);
          else if (el.name === 'face') faces.push(row.vertex_indices || row.vertex_index || []);
        }
      }
    } else {
      const dv = new DataView(buf);
      let o = dataStart;
      for (const el of elements) {
        for (let i = 0; i < el.count; i++) {
          const row = {};
          for (const pr of el.props) {
            if (pr.list) {
              const n = plyRead(dv, o, pr.countType, le); o += PLY_SZ[pr.countType] || 1;
              const arr = [];
              for (let k = 0; k < n; k++) { arr.push(plyRead(dv, o, pr.itemType, le)); o += PLY_SZ[pr.itemType] || 4; }
              row[pr.name] = arr;
            } else {
              row[pr.name] = plyRead(dv, o, pr.type, le);
              o += PLY_SZ[pr.type] || 4;
            }
          }
          if (el.name === 'vertex') verts.push([row.x, row.y, row.z]);
          else if (el.name === 'face') faces.push(row.vertex_indices || row.vertex_index || []);
        }
      }
    }

    const pos = [];
    for (const f of faces) {
      for (let i = 2; i < f.length; i++) {
        for (const k of [f[0], f[i - 1], f[i]]) {
          const v = verts[k];
          if (v) pos.push(v[0], v[1], v[2]);
        }
      }
    }
    return { pos, up: 'y', unitToMM: 1 };
  }

  /* ══════════════ ٤ · glTF 2.0 و GLB ══════════════ */

  const GLTF_COMP = { 5120:['getInt8',1], 5121:['getUint8',1], 5122:['getInt16',2],
                      5123:['getUint16',2], 5125:['getUint32',4], 5126:['getFloat32',4] };
  const GLTF_NUM = { SCALAR:1, VEC2:2, VEC3:3, VEC4:4, MAT2:4, MAT3:9, MAT4:16 };

  async function parseGLTF(buf, extras, isGLB) {
    let json, binChunk = null;
    if (isGLB) {
      const dv = new DataView(buf);
      if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('GLB: توقيع غير صالح');
      let o = 12;
      while (o + 8 <= buf.byteLength) {
        const len = dv.getUint32(o, true), type = dv.getUint32(o + 4, true);
        const start = o + 8;
        if (type === 0x4E4F534A) json = JSON.parse(dec(buf, start, len));
        else if (type === 0x004E4942) binChunk = new Uint8Array(buf, start, len);
        o = start + len;                       // الحشو للمحاذاة داخل len أصلاً
      }
      if (!json) throw new Error('GLB: لا كتلة JSON');
    } else {
      json = JSON.parse(dec(buf));
    }

    /* المخازن: كتلة GLB، أو data: مضمَّنة، أو ملفّ .bin اختاره المستخدم معه */
    const buffers = [];
    for (const b of (json.buffers || [])) {
      if (!b.uri) { buffers.push(binChunk); continue; }
      if (/^data:/i.test(b.uri)) { buffers.push(b64(b.uri.slice(b.uri.indexOf(',') + 1))); continue; }
      const fname = decodeURIComponent(b.uri.split('/').pop());
      const ex = extras && (extras[fname] || extras[b.uri]);
      if (!ex) throw new Error(`glTF يحتاج الملفّ المرافق «${fname}» — اختره مع الملفّ`);
      buffers.push(new Uint8Array(ex));
    }

    const accessor = i => {
      const a = json.accessors[i];
      const comp = GLTF_COMP[a.componentType];
      const num = GLTF_NUM[a.type] || 1;
      const out = new Array(a.count * num);
      if (a.bufferView == null) { out.fill(0); return { data: out, num }; }
      const bv = json.bufferViews[a.bufferView];
      const src = buffers[bv.buffer || 0];
      if (!src) throw new Error('glTF: مخزن مفقود');
      const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
      const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
      const stride = bv.byteStride || comp[1] * num;
      for (let e = 0; e < a.count; e++) {
        for (let k = 0; k < num; k++) out[e * num + k] = dv[comp[0]](base + e * stride + k * comp[1], true);
      }
      return { data: out, num };
    };

    const nodeMatrix = n => {
      if (n.matrix) return n.matrix.slice();
      return mCompose(n.translation || [0,0,0], n.rotation || [0,0,0,1], n.scale || [1,1,1]);
    };

    const pos = [];
    const emit = (meshIdx, world) => {
      const mesh = json.meshes[meshIdx];
      if (!mesh) return;
      for (const prim of (mesh.primitives || [])) {
        if (prim.mode != null && prim.mode !== 4) continue;   // مثلّثات فقط
        const pa = prim.attributes && prim.attributes.POSITION;
        if (pa == null) continue;
        const P = accessor(pa).data;
        let idx;
        if (prim.indices != null) idx = accessor(prim.indices).data;
        else { idx = new Array(P.length / 3); for (let i = 0; i < idx.length; i++) idx[i] = i; }
        for (let i = 0; i + 2 < idx.length; i += 3) {
          for (const k of [idx[i], idx[i + 1], idx[i + 2]]) {
            const t = mApply(world, P[k * 3], P[k * 3 + 1], P[k * 3 + 2]);
            pos.push(t[0], t[1], t[2]);
          }
        }
      }
    };

    const walk = (ni, parent) => {
      const n = json.nodes[ni];
      if (!n) return;
      const world = mMul(parent, nodeMatrix(n));
      if (n.mesh != null) emit(n.mesh, world);
      for (const c of (n.children || [])) walk(c, world);
    };

    const scene = json.scenes && json.scenes[json.scene || 0];
    if (scene && scene.nodes) scene.nodes.forEach(n => walk(n, M_ID()));
    else if (json.nodes) json.nodes.forEach((_, i) => walk(i, M_ID()));
    else (json.meshes || []).forEach((_, i) => emit(i, M_ID()));

    const name = (scene && scene.name) || (json.meshes && json.meshes[0] && json.meshes[0].name) || null;
    // glTF بالأمتار نصّاً في المواصفة
    return { pos, name, up: 'y', unitToMM: 1000 };
  }

  /* ══════════════ ٥ · COLLADA (.dae) ══════════════ */

  function parseDAE(buf) {
    const doc = new DOMParser().parseFromString(dec(buf), 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('COLLADA: XML غير صالح');
    const nums = el => (el.textContent || '').trim().split(/\s+/).map(Number);

    // وحدة الملفّ مُعلَنة في الترويسة (بالأمتار)
    const unitEl = doc.querySelector('asset > unit');
    const meter = unitEl ? parseFloat(unitEl.getAttribute('meter')) || 1 : 1;
    const upEl = doc.querySelector('asset > up_axis');
    const up = upEl && /Z_UP/i.test(upEl.textContent) ? 'z' : 'y';

    /** هندسة واحدة → مثلّثات بإحداثياتها المحلّية */
    const geomTris = g => {
      const out = [];
      const mesh = g.querySelector('mesh');
      if (!mesh) return out;
      const sources = {};
      mesh.querySelectorAll('source').forEach(s => {
        const fa = s.querySelector('float_array');
        if (fa) sources['#' + s.getAttribute('id')] = nums(fa);
      });
      // <vertices> وسيطٌ يشير إلى مصدر المواضع
      const vmap = {};
      mesh.querySelectorAll('vertices').forEach(v => {
        const inp = v.querySelector('input[semantic="POSITION"]');
        if (inp) vmap['#' + v.getAttribute('id')] = inp.getAttribute('source');
      });

      const prims = [...mesh.querySelectorAll('triangles, polylist, polygons')];
      for (const pr of prims) {
        const inputs = [...pr.querySelectorAll('input')];
        const vin = inputs.find(i => i.getAttribute('semantic') === 'VERTEX');
        if (!vin) continue;
        let srcId = vin.getAttribute('source');
        if (vmap[srcId]) srcId = vmap[srcId];
        const P = sources[srcId];
        if (!P) continue;
        const offset = +(vin.getAttribute('offset') || 0);
        const stride = Math.max(...inputs.map(i => +(i.getAttribute('offset') || 0))) + 1;
        const pEl = pr.querySelector('p');
        if (!pEl) continue;
        const p = nums(pEl);
        const vcEl = pr.querySelector('vcount');
        const counts = vcEl ? nums(vcEl) : null;

        const faceIdx = [];
        if (counts) {
          let c = 0;
          for (const n of counts) {
            const f = [];
            for (let k = 0; k < n; k++) f.push(p[(c + k) * stride + offset]);
            faceIdx.push(f); c += n;
          }
        } else {
          const total = p.length / stride;
          for (let i = 0; i + 2 < total; i += 3) {
            faceIdx.push([p[i * stride + offset], p[(i + 1) * stride + offset], p[(i + 2) * stride + offset]]);
          }
        }
        for (const f of faceIdx) {
          for (let i = 2; i < f.length; i++) {
            for (const k of [f[0], f[i - 1], f[i]]) out.push(P[k * 3], P[k * 3 + 1], P[k * 3 + 2]);
          }
        }
      }
      return out;
    };

    const geoms = {};
    doc.querySelectorAll('library_geometries > geometry').forEach(g => {
      geoms['#' + g.getAttribute('id')] = geomTris(g);
    });

    const pos = [];
    const nodeLocal = node => {
      let m = M_ID();
      for (const ch of node.children) {
        const tag = ch.tagName.toLowerCase();
        if (tag === 'matrix') {
          const v = nums(ch);                         // COLLADA صفّيّ — نُحوّله
          m = mMul(m, [v[0],v[4],v[8],v[12], v[1],v[5],v[9],v[13],
                       v[2],v[6],v[10],v[14], v[3],v[7],v[11],v[15]]);
        } else if (tag === 'translate') {
          const v = nums(ch);
          m = mMul(m, mCompose([v[0], v[1], v[2]], [0,0,0,1], [1,1,1]));
        } else if (tag === 'scale') {
          const v = nums(ch);
          m = mMul(m, mCompose([0,0,0], [0,0,0,1], [v[0], v[1], v[2]]));
        } else if (tag === 'rotate') {
          const v = nums(ch);                         // محور + زاوية بالدرجات
          const a = v[3] * DEG, s = Math.sin(a / 2);
          const len = Math.hypot(v[0], v[1], v[2]) || 1;
          m = mMul(m, mCompose([0,0,0],
            [v[0] / len * s, v[1] / len * s, v[2] / len * s, Math.cos(a / 2)], [1,1,1]));
        }
      }
      return m;
    };

    const walkNode = (node, parent) => {
      const world = mMul(parent, nodeLocal(node));
      node.querySelectorAll(':scope > instance_geometry').forEach(ig => {
        const tris = geoms[ig.getAttribute('url')];
        if (!tris) return;
        for (let i = 0; i < tris.length; i += 3) {
          const t = mApply(world, tris[i], tris[i + 1], tris[i + 2]);
          pos.push(t[0], t[1], t[2]);
        }
      });
      node.querySelectorAll(':scope > node').forEach(c => walkNode(c, world));
    };

    const scenes = [...doc.querySelectorAll('library_visual_scenes > visual_scene')];
    if (scenes.length) scenes.forEach(s => s.querySelectorAll(':scope > node').forEach(n => walkNode(n, M_ID())));
    // مشهدٌ فارغ: اعرض الهندسات كما هي بدل ألّا يُستورَد شيء
    if (!pos.length) Object.values(geoms).forEach(t => pos.push(...t));

    return { pos, up, unitToMM: meter * 1000 };
  }

  /* ══════════════ ٦ · X3D ══════════════ */

  function parseX3D(buf) {
    const doc = new DOMParser().parseFromString(dec(buf), 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('X3D: XML غير صالح');
    const nums = s => (s || '').trim().split(/[\s,]+/).filter(x => x.length).map(Number);
    const pos = [];

    const walk = (el, parent) => {
      let world = parent;
      if (el.tagName === 'Transform') {
        const t = nums(el.getAttribute('translation'));
        const s = nums(el.getAttribute('scale'));
        const r = nums(el.getAttribute('rotation'));   // محور + زاوية بالراديان
        let q = [0, 0, 0, 1];
        if (r.length === 4) {
          const sn = Math.sin(r[3] / 2), len = Math.hypot(r[0], r[1], r[2]) || 1;
          q = [r[0] / len * sn, r[1] / len * sn, r[2] / len * sn, Math.cos(r[3] / 2)];
        }
        world = mMul(parent, mCompose(
          t.length === 3 ? t : [0, 0, 0], q, s.length === 3 ? s : [1, 1, 1]));
      }
      if (el.tagName === 'IndexedFaceSet') {
        const ci = nums(el.getAttribute('coordIndex'));
        const coordEl = el.querySelector('Coordinate');
        const P = coordEl ? nums(coordEl.getAttribute('point')) : [];
        let face = [];
        for (const k of ci) {
          if (k < 0) {
            for (let i = 2; i < face.length; i++) {
              for (const v of [face[0], face[i - 1], face[i]]) {
                const t = mApply(world, P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
                pos.push(t[0], t[1], t[2]);
              }
            }
            face = [];
          } else face.push(k);
        }
      }
      for (const c of el.children) walk(c, world);
    };
    if (doc.documentElement) walk(doc.documentElement, M_ID());
    return { pos, up: 'y', unitToMM: 1 };
  }

  /* ══════════════ ٧ · 3MF (ZIP) ══════════════ */

  /** يقرأ مدخلات ZIP من دليلها المركزيّ — لا بالبحث عن تواقيع محلّية */
  async function unzip(buf) {
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);
    // نهاية الدليل المركزيّ: توقيعها في آخر ٦٥٥٥٧ بايت
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('3MF: ليس أرشيف ZIP صالحاً');
    const count = dv.getUint16(eocd + 10, true);
    let off = dv.getUint32(eocd + 16, true);
    const out = {};
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(off, true) !== 0x02014b50) break;
      const method = dv.getUint16(off + 10, true);
      const csize = dv.getUint32(off + 20, true);
      const nameLen = dv.getUint16(off + 28, true);
      const extraLen = dv.getUint16(off + 30, true);
      const cmtLen = dv.getUint16(off + 32, true);
      const lho = dv.getUint32(off + 42, true);
      const name = dec(u8.subarray(off + 46, off + 46 + nameLen));
      // الترويسة المحلّية تُعيد إعلان أطوال الاسم والحقول الإضافية
      const lNameLen = dv.getUint16(lho + 26, true);
      const lExtraLen = dv.getUint16(lho + 28, true);
      const dataStart = lho + 30 + lNameLen + lExtraLen;
      const raw = u8.subarray(dataStart, dataStart + csize);
      out[name] = method === 0 ? raw : await inflate(raw, true);
      off += 46 + nameLen + extraLen + cmtLen;
    }
    return out;
  }

  async function parse3MF(buf) {
    const files = await unzip(buf);
    const key = Object.keys(files).find(k => /3dmodel\.model$/i.test(k)) ||
                Object.keys(files).find(k => /\.model$/i.test(k));
    if (!key) throw new Error('3MF: لا يحوي 3dmodel.model');
    const doc = new DOMParser().parseFromString(dec(files[key]), 'application/xml');
    const unitAttr = (doc.documentElement.getAttribute('unit') || 'millimeter').toLowerCase();
    const U = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };

    const objects = {};
    doc.querySelectorAll('resources > object').forEach(o => {
      const verts = [], tris = [];
      o.querySelectorAll('mesh > vertices > vertex').forEach(v =>
        verts.push([+v.getAttribute('x'), +v.getAttribute('y'), +v.getAttribute('z')]));
      o.querySelectorAll('mesh > triangles > triangle').forEach(t =>
        tris.push([+t.getAttribute('v1'), +t.getAttribute('v2'), +t.getAttribute('v3')]));
      objects[o.getAttribute('id')] = { verts, tris };
    });

    const pos = [];
    const emit = (obj, m) => {
      if (!obj) return;
      for (const t of obj.tris) {
        for (const k of t) {
          const v = obj.verts[k];
          if (!v) continue;
          const p = mApply(m, v[0], v[1], v[2]);
          pos.push(p[0], p[1], p[2]);
        }
      }
    };
    const items = [...doc.querySelectorAll('build > item')];
    if (items.length) {
      for (const it of items) {
        const tr = it.getAttribute('transform');
        let m = M_ID();
        if (tr) {
          const v = tr.trim().split(/\s+/).map(Number);      // ٤×٣ صفّيّة
          if (v.length >= 12) m = [v[0],v[1],v[2],0, v[3],v[4],v[5],0,
                                   v[6],v[7],v[8],0, v[9],v[10],v[11],1];
        }
        emit(objects[it.getAttribute('objectid')], m);
      }
    } else Object.values(objects).forEach(o => emit(o, M_ID()));

    return { pos, up: 'z', unitToMM: U[unitAttr] || 1 };
  }

  /* ══════════════ ٨ · FBX ══════════════ */

  const FBX_MAGIC = 'Kaydara FBX Binary';

  async function fbxNodes(buf) {
    const dv = new DataView(buf);
    const version = dv.getUint32(23, true);
    const wide = version >= 7500;                    // ٧٫٥+ تستعمل u64 للإزاحات
    let p = 27;

    async function readProp() {
      const t = String.fromCharCode(dv.getUint8(p++));
      switch (t) {
        case 'Y': { const v = dv.getInt16(p, true); p += 2; return v; }
        case 'C': { const v = dv.getUint8(p) !== 0; p += 1; return v; }
        case 'I': { const v = dv.getInt32(p, true); p += 4; return v; }
        case 'F': { const v = dv.getFloat32(p, true); p += 4; return v; }
        case 'D': { const v = dv.getFloat64(p, true); p += 8; return v; }
        case 'L': { const v = Number(dv.getBigInt64(p, true)); p += 8; return v; }
        case 'S': case 'R': {
          const n = dv.getUint32(p, true); p += 4;
          const b = new Uint8Array(buf, p, n); p += n;
          return t === 'S' ? dec(b) : b;
        }
        case 'f': case 'd': case 'l': case 'i': case 'b': {
          const len = dv.getUint32(p, true);
          const enc = dv.getUint32(p + 4, true);
          const clen = dv.getUint32(p + 8, true);
          p += 12;
          let bytes = new Uint8Array(buf, p, clen);
          p += clen;
          if (enc === 1) bytes = await inflate(bytes, false);
          const d2 = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
          const out = new Array(len);
          for (let i = 0; i < len; i++) {
            if (t === 'f') out[i] = d2.getFloat32(i * 4, true);
            else if (t === 'd') out[i] = d2.getFloat64(i * 8, true);
            else if (t === 'l') out[i] = Number(d2.getBigInt64(i * 8, true));
            else if (t === 'i') out[i] = d2.getInt32(i * 4, true);
            else out[i] = d2.getUint8(i) !== 0;
          }
          return out;
        }
        default: throw new Error('FBX: نوع خاصّية غير معروف ' + t);
      }
    }

    async function readNode() {
      const end = wide ? Number(dv.getBigUint64(p, true)) : dv.getUint32(p, true); p += wide ? 8 : 4;
      const nProps = wide ? Number(dv.getBigUint64(p, true)) : dv.getUint32(p, true); p += wide ? 8 : 4;
      p += wide ? 8 : 4;                              // طول قائمة الخصائص
      const nameLen = dv.getUint8(p++);
      const name = dec(new Uint8Array(buf, p, nameLen)); p += nameLen;
      if (end === 0) return null;                     // سجلّ فارغ = نهاية قائمة
      const props = [];
      for (let i = 0; i < nProps; i++) props.push(await readProp());
      const children = [];
      while (p < end - (wide ? 25 : 13)) {
        const c = await readNode();
        if (c) children.push(c);
      }
      p = end;
      return { name, props, children };
    }

    const root = { name: '', props: [], children: [] };
    while (p < buf.byteLength - (wide ? 25 : 13)) {
      const n = await readNode();
      if (!n) break;
      root.children.push(n);
    }
    return root;
  }

  function fbxFind(node, name) { return node.children.find(c => c.name === name) || null; }
  function fbxAll(node, name) { return node.children.filter(c => c.name === name); }

  /** تحويل المُجسَّم من Properties70 (Lcl Translation/Rotation/Scaling) */
  function fbxModelMatrix(model) {
    const p70 = fbxFind(model, 'Properties70');
    let t = [0,0,0], r = [0,0,0], s = [1,1,1];
    if (p70) {
      for (const pr of p70.children) {
        const k = pr.props[0];
        if (k === 'Lcl Translation') t = [pr.props[4] || 0, pr.props[5] || 0, pr.props[6] || 0];
        else if (k === 'Lcl Rotation') r = [pr.props[4] || 0, pr.props[5] || 0, pr.props[6] || 0];
        else if (k === 'Lcl Scaling')  s = [pr.props[4] == null ? 1 : pr.props[4],
                                            pr.props[5] == null ? 1 : pr.props[5],
                                            pr.props[6] == null ? 1 : pr.props[6]];
      }
    }
    // T·R·S — التحجيم أوّلاً ثمّ الدوران ثمّ الإزاحة
    const R = mEulerXYZ(r[0], r[1], r[2]);
    const S = mCompose([0,0,0], [0,0,0,1], s);
    const T = mCompose(t, [0,0,0,1], [1,1,1]);
    return mMul(mMul(T, R), S);
  }

  function fbxBuild(root) {
    const objects = fbxFind(root, 'Objects');
    if (!objects) throw new Error('FBX: لا قسم Objects');

    // وحدة الملفّ: FBX بالسنتيمتر افتراضاً، والعامل مُعلَن في GlobalSettings
    let unitScale = 1;
    const gs = fbxFind(root, 'GlobalSettings');
    const gp = gs && fbxFind(gs, 'Properties70');
    if (gp) for (const pr of gp.children) {
      if (pr.props[0] === 'UnitScaleFactor') unitScale = pr.props[4] || 1;
    }

    const geoms = new Map();
    for (const g of fbxAll(objects, 'Geometry')) {
      const vs = fbxFind(g, 'Vertices'), pi = fbxFind(g, 'PolygonVertexIndex');
      if (!vs || !pi) continue;
      geoms.set(g.props[0], { v: vs.props[0] || [], i: pi.props[0] || [] });
    }
    const models = new Map();
    for (const m of fbxAll(objects, 'Model')) models.set(m.props[0], m);

    // الوصلات OO تربط الهندسة بمُجسَّمها
    const parentOf = new Map();
    const conns = fbxFind(root, 'Connections');
    if (conns) for (const c of conns.children) {
      if (c.props[0] === 'OO') parentOf.set(c.props[1], c.props[2]);
    }

    const pos = [];
    for (const [gid, g] of geoms) {
      const mid = parentOf.get(gid);
      const model = mid != null ? models.get(mid) : null;
      const M = model ? fbxModelMatrix(model) : M_ID();
      const face = [];
      for (let k = 0; k < g.i.length; k++) {
        let idx = g.i[k];
        const last = idx < 0;
        if (last) idx = ~idx;                        // آخر رأس في المضلّع مُكمَّل بتاً
        face.push(idx);
        if (!last) continue;
        for (let t = 2; t < face.length; t++) {
          for (const vi of [face[0], face[t - 1], face[t]]) {
            const p = mApply(M, g.v[vi * 3], g.v[vi * 3 + 1], g.v[vi * 3 + 2]);
            pos.push(p[0], p[1], p[2]);
          }
        }
        face.length = 0;
      }
    }
    // UnitScaleFactor يقول كم سنتيمتراً في الوحدة الواحدة؛ الافتراضيّ ١ (سنتيمتر)
    return { pos, unitToMM: (unitScale || 1) * 10, up: 'y' };
  }

  /** FBX نصّيّ: الرؤوس والفهارس في كتل a: {...} */
  function parseFBXAscii(txt) {
    const grab = key => {
      const re = new RegExp(key + '\\s*:\\s*\\*\\d+\\s*\\{\\s*a\\s*:\\s*([^}]*)\\}', 'g');
      const out = [];
      let m;
      while ((m = re.exec(txt))) out.push(m[1].split(',').map(s => parseFloat(s)).filter(v => !isNaN(v)));
      return out;
    };
    const V = grab('Vertices'), I = grab('PolygonVertexIndex');
    const pos = [];
    for (let g = 0; g < Math.min(V.length, I.length); g++) {
      const v = V[g], ind = I[g], face = [];
      for (let k = 0; k < ind.length; k++) {
        let idx = ind[k];
        const last = idx < 0;
        if (last) idx = ~idx;
        face.push(idx);
        if (!last) continue;
        for (let t = 2; t < face.length; t++) {
          for (const vi of [face[0], face[t - 1], face[t]]) pos.push(v[vi*3], v[vi*3+1], v[vi*3+2]);
        }
        face.length = 0;
      }
    }
    // نفس حساب المسار الثنائيّ: العامل عددُ السنتيمترات في الوحدة
    const um = /UnitScaleFactor[^\d-]*([\d.]+)/.exec(txt);
    return { pos, up: 'y', unitToMM: (um ? +um[1] : 1) * 10 };
  }

  async function parseFBX(buf) {
    const head = dec(buf, 0, Math.min(64, buf.byteLength));
    if (head.startsWith(FBX_MAGIC)) return fbxBuild(await fbxNodes(buf));
    return parseFBXAscii(dec(buf));
  }

  /* ══════════════ التعرّف على الصيغة ══════════════ */

  const FORMATS = [
    { id:'stl',  ext:['stl'],          name:'STL' },
    { id:'obj',  ext:['obj'],          name:'OBJ' },
    { id:'ply',  ext:['ply'],          name:'PLY' },
    { id:'glb',  ext:['glb'],          name:'GLB' },
    { id:'gltf', ext:['gltf'],         name:'glTF' },
    { id:'dae',  ext:['dae'],          name:'COLLADA' },
    { id:'x3d',  ext:['x3d','x3dv'],   name:'X3D' },
    { id:'3mf',  ext:['3mf'],          name:'3MF' },
    { id:'fbx',  ext:['fbx'],          name:'FBX' },
  ];
  /* صيغ نعرفها ولا نقرؤها — الرسالة أنفع من فشلٍ غامض */
  const UNSUPPORTED = {
    blend: 'ملفّ بلندر الأصليّ لا يُقرأ خارج بلندر. من بلندر: File → Export → glTF 2.0 ‏(.glb) ثمّ استورده هنا.',
    abc:   'Alembic صيغة تحريك لا تُقرأ هنا. صدّر glTF ‏(.glb) أو STL بدلاً منها.',
    usd:   'USD غير مدعومة. صدّر glTF ‏(.glb) أو STL.',
    usda:  'USD غير مدعومة. صدّر glTF ‏(.glb) أو STL.',
    usdc:  'USD غير مدعومة. صدّر glTF ‏(.glb) أو STL.',
    usdz:  'USD غير مدعومة. صدّر glTF ‏(.glb) أو STL.',
    wrl:   'VRML قديمة؛ صدّر X3D ‏(.x3d) أو glTF.',
  };

  const ACCEPT = FORMATS.flatMap(f => f.ext).map(e => '.' + e).join(',') + ',.bin';

  const extOf = n => (n.split('.').pop() || '').toLowerCase();

  /** يُقرّر الصيغة من البايتات أوّلاً ثمّ من الامتداد */
  function sniff(name, buf) {
    const head = buf && buf.byteLength >= 4 ? dec(buf, 0, Math.min(64, buf.byteLength)) : '';
    if (head.startsWith('glTF')) return 'glb';
    if (head.startsWith(FBX_MAGIC)) return 'fbx';
    if (head.startsWith('ply')) return 'ply';
    if (head.startsWith('PK')) return '3mf';
    const e = extOf(name);
    const f = FORMATS.find(x => x.ext.includes(e));
    return f ? f.id : null;
  }

  /* ══════════════ الواجهة ══════════════ */

  const PARSERS = {
    stl:  b => parseSTL(b),
    obj:  b => parseOBJ(b),
    ply:  b => parsePLY(b),
    glb:  (b, x) => parseGLTF(b, x, true),
    gltf: (b, x) => parseGLTF(b, x, false),
    dae:  b => parseDAE(b),
    x3d:  b => parseX3D(b),
    '3mf': b => parse3MF(b),
    fbx:  b => parseFBX(b),
  };

  /**
   * يقرأ ملفّاً واحداً ويُعيد {pos, name, format, up, unitToMM}
   * @param extras خريطة اسم→ArrayBuffer للملفّات المرافقة (‎.bin مع glTF)
   */
  async function parseBuffer(fileName, buf, extras) {
    const e = extOf(fileName);
    if (UNSUPPORTED[e]) { const err = new Error(UNSUPPORTED[e]); err.code = 'UNSUPPORTED'; throw err; }
    const fmt = sniff(fileName, buf);
    if (!fmt || !PARSERS[fmt]) {
      const err = new Error(`صيغة غير معروفة «.${e}». المدعوم: ${FORMATS.map(f => f.name).join(' · ')}`);
      err.code = 'UNKNOWN';
      throw err;
    }
    const r = await PARSERS[fmt](buf, extras);
    if (!r || !r.pos || r.pos.length < 9) {
      const err = new Error(`«${fileName}»: لم أجد أيّ مثلّث قابل للقراءة`);
      err.code = 'EMPTY';
      throw err;
    }
    return Object.assign({ name: null, up: 'z', unitToMM: 1 }, r, { format: fmt });
  }

  /**
   * يُطبّق تحويل المحور الأعلى والمقياس على مصفوفة المواضع (في مكانها).
   * @param up محور الملفّ الأعلى ('y' أو 'z') و upTo المحور المطلوب
   */
  function orient(pos, up, scale) {
    const s = scale || 1;
    if (up === 'y') {
      // Y-up ⇒ Z-up: (x, y, z) ← (x, -z, y)
      for (let i = 0; i < pos.length; i += 3) {
        const y = pos[i + 1], z = pos[i + 2];
        pos[i] *= s; pos[i + 1] = -z * s; pos[i + 2] = y * s;
      }
    } else if (s !== 1) {
      for (let i = 0; i < pos.length; i++) pos[i] *= s;
    }
    return pos;
  }

  /** مظروف المواضع — لتقدير الوحدة واقتراح المقياس */
  function bounds(pos) {
    let a = [Infinity, Infinity, Infinity], b = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (pos[i + k] < a[k]) a[k] = pos[i + k];
        if (pos[i + k] > b[k]) b[k] = pos[i + k];
      }
    }
    return { min: a, max: b, size: [b[0]-a[0], b[1]-a[1], b[2]-a[2]] };
  }

  window.MeshImport = {
    ACCEPT, FORMATS, UNSUPPORTED,
    sniff, parseBuffer, orient, bounds,
    triCount: r => (r.pos.length / 9) | 0,
    // مكشوفة للاختبار
    _internals: { mMul, mApply, mCompose, mEulerXYZ, unzip, inflate },
  };
})();
