'use strict';
/**
 * generate-worker.js — خيط عامل يشغّل مراحل التوليد الثقيلة بعيداً عن
 * الخيط الرئيسي، فلا تتجمّد بقية الطلبات أثناء معالجة تصميم كبير.
 */
const { parentPort } = require('worker_threads');
const pipeline = require('../generators/pipeline');

parentPort.on('message', (msg) => {
  const { id, op } = msg;
  try {
    let result;
    if (op === 'optimize') {
      result = { shapes: pipeline.optimizePaths(msg.shapes, msg.config) };
    } else if (op === 'finalize') {
      result = pipeline.finalize(msg.shapes, msg.config, msg.machineProfile);
    } else {
      throw new Error('عملية غير معروفة: ' + op);
    }
    parentPort.postMessage({ id, ok: true, result });
  } catch (e) {
    parentPort.postMessage({ id, ok: false, error: (e && e.message) ? e.message : String(e) });
  }
});
