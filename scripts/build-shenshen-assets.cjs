'use strict';

// Package AI-drawn sprite cells as APNG without repainting their pixels.
// Build dependency: pngjs 7.x. Node.js >= 24 supplies CRC32.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { crc32 } = require('node:zlib');
const { PNG } = require('pngjs');

const root = path.resolve(__dirname, '..');
const sourceDir = path.join(root, 'docs', 'shenshen', 'sources');
const canvasSize = 608, baseline = 544;
const states = {
  idle: { label: '待机眨眼', duration: [500, 180, 100, 140, 100, 400], headX: [287, 249, 226, 285, 252, 223],
    motionRects: [{ kind: 'eyes', x: 229, y: 238, width: 156, height: 52 }] },
  working: { label: '敲键盘', duration: [150, 150, 150, 150, 150, 150], headX: [298, 257, 224, 296, 256, 224],
    motionRects: [{ kind: 'eyes', x: 211, y: 278, width: 164, height: 54 },
      { kind: 'hands', x: 274, y: 410, width: 21, height: 32 },
      { kind: 'hands', x: 295, y: 438, width: 55, height: 33 }] },
  thinking: { label: '思考', duration: [280, 220, 260, 180, 280, 240], headX: [285, 255, 229, 297, 271, 236] },
  celebrate: { label: '完成庆祝', duration: [170, 170, 170, 170, 170, 220], headX: [283, 255, 226, 287, 255, 231] },
  failed: { label: '排错恢复', duration: [250, 250, 250, 250, 250, 300], headX: [290, 265, 243, 288, 259, 242] },
  wave: { label: '挥手回应', duration: [170, 170, 170, 170, 170, 220], headX: [284, 260, 239, 287, 259, 237] },
  jump: { label: '落下小跳', duration: [150, 140, 180, 160, 170, 250], headX: [276, 258, 251, 280, 265, 253] },
};

function chunks(bytes) {
  const result = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    result.push({ type: bytes.toString('ascii', offset + 4, offset + 8), data: bytes.subarray(offset + 8, offset + 8 + length) });
    offset += length + 12;
  }
  return result;
}

function chunk(type, data) {
  const name = Buffer.from(type), output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length); name.copy(output, 4); data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), output.length - 4);
  return output;
}

function apng(frames, durations) {
  const encoded = frames.map(frame => chunks(PNG.sync.write(frame)));
  const animation = Buffer.alloc(8);
  animation.writeUInt32BE(frames.length); animation.writeUInt32BE(0, 4);
  const output = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', encoded[0].find(item => item.type === 'IHDR').data), chunk('acTL', animation)];
  let sequence = 0;
  encoded.forEach((items, index) => {
    const control = Buffer.alloc(26);
    control.writeUInt32BE(sequence++); control.writeUInt32BE(canvasSize, 4); control.writeUInt32BE(canvasSize, 8);
    control.writeUInt16BE(durations[index], 20); control.writeUInt16BE(1000, 22);
    // Full-frame SOURCE replaces the previous frame, including transparent pixels.
    output.push(chunk('fcTL', control));
    for (const item of items.filter(item => item.type === 'IDAT')) {
      if (index === 0) output.push(chunk('IDAT', item.data));
      else { const number = Buffer.alloc(4); number.writeUInt32BE(sequence++); output.push(chunk('fdAT', Buffer.concat([number, item.data]))); }
    }
  });
  output.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(output);
}

function cellBottom(sheet, left, top, width, height) {
  let bottom = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (sheet.data[((top + y) * sheet.width + left + x) * 4 + 3] > 10) bottom = y + 1;
  }
  if (!bottom) throw new Error('Sprite cell is empty');
  return bottom;
}

const manifest = { name: '深深', design: 'early-orange-shirt-black-tie-long-trousers', format: 'APNG', width: canvasSize, height: canvasSize, footBaseline: baseline, states: {} };
for (const [state, spec] of Object.entries(states)) {
  const sheet = PNG.sync.read(fs.readFileSync(path.join(sourceDir, state + '.png')));
  if (sheet.width !== 1536 || sheet.height !== 1024) throw new Error(state + ': expected a 1536x1024, 3x2 sheet');
  const width = sheet.width / 3, height = sheet.height / 2;
  const bottoms = Array.from({ length: 6 }, (_, i) => cellBottom(sheet, i % 3 * width, Math.floor(i / 3) * height, width, height));
  // Measured head centres avoid drift between grid columns. Whole-body centres
  // would move the head when an arm waves or the laptop extends to one side.
  const offsets = bottoms.map((bottom, i) => ({
    x: canvasSize / 2 - spec.headX[i],
    y: baseline - (state === 'jump' && [2, 3].includes(i) ? Math.max(...bottoms) : bottom),
  }));
  const drawnFrames = bottoms.map((_, index) => {
    const frame = new PNG({ width: canvasSize, height: canvasSize });
    frame.data.fill(0);
    const left = index % 3 * width, top = Math.floor(index / 3) * height;
    // Airborne jump frames keep their vertical offset; landing returns to ground.
    const { x: dx, y: dy } = offsets[index];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const source = ((top + y) * sheet.width + left + x) * 4;
      if (!sheet.data[source + 3]) continue;
      if (x + dx < 0 || x + dx >= canvasSize || y + dy < 0 || y + dy >= canvasSize) {
        throw new Error(state + ': anchor would clip a visible pixel in frame ' + index);
      }
      sheet.data.copy(frame.data, ((y + dy) * canvasSize + x + dx) * 4, source, source + 4);
    }
    return frame;
  });
  // Idle/typing share one fixed rig. Only AI-drawn eye/finger patches advance;
  // regenerating an entire body per frame would reintroduce lateral drift.
  const frames = spec.motionRects ? drawnFrames.map(drawn => {
    const frame = new PNG({ width: canvasSize, height: canvasSize });
    drawnFrames[0].data.copy(frame.data);
    for (const rect of spec.motionRects) for (let y = rect.y; y < rect.y + rect.height; y++) {
      const start = (y * canvasSize + rect.x) * 4;
      drawn.data.copy(frame.data, start, start, start + rect.width * 4);
    }
    return frame;
  }) : drawnFrames;
  const uniqueFrames = new Set(frames.map(frame => createHash('sha256').update(frame.data).digest('hex'))).size;
  if (uniqueFrames !== 6) throw new Error(state + ': expected six distinct drawn frames');
  const file = 'shenshen-' + state + '.png', bytes = apng(frames, spec.duration);
  fs.writeFileSync(path.join(root, 'assets', file), bytes);
  manifest.states[state] = { label: spec.label, file, frameCount: frames.length, uniqueFrames, durationMs: spec.duration, frameOffsets: offsets,
    fixedRig: spec.motionRects ? { baseFrame: 0, motionRects: spec.motionRects } : undefined,
    bytes: bytes.length, source: 'docs/shenshen/sources/' + state + '.png' };
}
fs.writeFileSync(path.join(root, 'assets', 'shenshen-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('Packed 7 transparent APNG actions / 42 unique frames.');
