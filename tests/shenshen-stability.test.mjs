import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import pngjs from 'pngjs';

const { PNG } = pngjs;
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const manifest = JSON.parse(fs.readFileSync(new URL('../assets/shenshen-manifest.json', import.meta.url), 'utf8'));

function pngChunk(type, data) {
  const name = Buffer.from(type), bytes = Buffer.alloc(data.length + 12);
  bytes.writeUInt32BE(data.length); name.copy(bytes, 4); data.copy(bytes, 8);
  bytes.writeUInt32BE(crc32(Buffer.concat([name, data])), bytes.length - 4);
  return bytes;
}

// Decode the delivered animation independently of the production packer.
// Its full-frame SOURCE payloads can each form a standalone RGBA PNG.
function decodeFrames(file) {
  const bytes = fs.readFileSync(new URL('../assets/' + file, import.meta.url));
  assert.ok(bytes.subarray(0, 8).equals(signature), 'PNG signature');
  const frames = []; let header, frame = null, sequence = 0, frameCount = 0;
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
    assert.ok(offset + length + 12 <= bytes.length, 'complete ' + type + ' chunk');
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    assert.equal(bytes.readUInt32BE(offset + 8 + length), crc32(bytes.subarray(offset + 4, offset + 8 + length)), type + ' CRC');
    if (type === 'IHDR') header = data;
    if (type === 'acTL') frameCount = data.readUInt32BE(0);
    if (type === 'fcTL') {
      assert.equal(data.readUInt32BE(0), sequence++, 'frame sequence');
      assert.equal(data.readUInt32BE(4), manifest.width); assert.equal(data.readUInt32BE(8), manifest.height);
      assert.equal(data.readUInt32BE(12), 0); assert.equal(data.readUInt32BE(16), 0);
      assert.equal(data[24], 0, 'dispose NONE'); assert.equal(data[25], 0, 'blend SOURCE');
      frame = []; frames.push(frame);
    }
    if (type === 'IDAT') { assert.ok(frame); frame.push(data); }
    if (type === 'fdAT') {
      assert.equal(data.readUInt32BE(0), sequence++, 'data sequence');
      assert.ok(frame); frame.push(data.subarray(4));
    }
    offset += length + 12;
  }
  assert.equal(frameCount, 6); assert.equal(frames.length, 6);
  return frames.map(payload => PNG.sync.read(Buffer.concat([
    signature, pngChunk('IHDR', header), ...payload.map(data => pngChunk('IDAT', data)), pngChunk('IEND', Buffer.alloc(0)),
  ])));
}

// Anatomical regions measured on the visually approved 608px artwork.
// Keep this contract independent of the packer's spec and delivered manifest:
// widening a declared mask must not exempt moving face/body pixels from checks.
const reviewedMotionRegions = {
  idle: [{ kind: 'eyes', x: 229, y: 238, width: 156, height: 52 }],
  working: [
    { kind: 'eyes', x: 211, y: 278, width: 164, height: 54 },
    { kind: 'hands', x: 274, y: 410, width: 21, height: 32 },
    { kind: 'hands', x: 295, y: 438, width: 55, height: 33 },
  ],
};

function rigFor(action, rig = manifest.states[action].fixedRig) {
  assert.ok(rig, action + ' must declare a fixed sprite rig');
  assert.equal(rig.baseFrame, 0);
  assert.ok(Array.isArray(rig.motionRects) && rig.motionRects.length > 0);
  const mask = new Uint8Array(manifest.width * manifest.height);
  const reviewed = reviewedMotionRegions[action], matched = new Set();
  for (const rect of rig.motionRects) {
    assert.ok(['eyes', 'hands'].includes(rect.kind), 'only eyes and hands may animate');
    assert.ok(action !== 'idle' || rect.kind === 'eyes', 'idle only animates eyes');
    for (const key of ['x', 'y', 'width', 'height']) assert.ok(Number.isInteger(rect[key]), key + ' must be integral');
    assert.ok(rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0);
    assert.ok(rect.x + rect.width <= manifest.width && rect.y + rect.height <= manifest.height);
    // Two pixels of tolerance permit minor edge adjustments, not a new region.
    const region = reviewed.findIndex(bounds => rect.kind === bounds.kind &&
      rect.x >= bounds.x - 2 && rect.y >= bounds.y - 2 &&
      rect.x + rect.width <= bounds.x + bounds.width + 2 && rect.y + rect.height <= bounds.y + bounds.height + 2);
    assert.ok(region >= 0, action + ' ' + rect.kind + ' must stay inside its independently reviewed anatomical bounds');
    assert.ok(rect.width >= reviewed[region].width - 4 && rect.height >= reviewed[region].height - 4,
      action + ' ' + rect.kind + ' dimensions are too small to cover the reviewed motion region');
    assert.ok(!matched.has(region), 'each reviewed eye or hand region appears once'); matched.add(region);
    for (let y = rect.y; y < rect.y + rect.height; y++) mask.fill(1, y * manifest.width + rect.x, y * manifest.width + rect.x + rect.width);
  }
  assert.equal(matched.size, reviewed.length, 'all reviewed eye and hand regions are present');
  assert.ok(rig.motionRects.some(rect => rect.kind === 'eyes'), 'eyes have an explicit motion region');
  if (action === 'working') assert.ok(rig.motionRects.some(rect => rect.kind === 'hands'), 'typing has an explicit hand region');
  assert.ok(mask.reduce((sum, value) => sum + value, 0) < mask.length / 10, 'motion regions must cover less than ten percent of the canvas');
  const hatEnd = Math.floor(manifest.height / 3), feetStart = manifest.footBaseline - 48;
  assert.ok(mask.subarray(0, hatEnd * manifest.width).every(value => value === 0), 'the hat is outside all motion regions');
  assert.ok(mask.subarray(feetStart * manifest.width).every(value => value === 0), 'the feet are outside all motion regions');
  return { rig, mask };
}

test('idle rejects an expanded eye mask that could conceal face or head drift', () => {
  const rig = structuredClone(manifest.states.idle.fixedRig);
  Object.assign(rig.motionRects[0], { x: 120, y: 220, width: 300, height: 100 });
  assert.throws(() => rigFor('idle', rig), /reviewed|anatomical|eye/i);
});

test('working rejects an eye mask widened to include the face contour', () => {
  const rig = structuredClone(manifest.states.working.fixedRig);
  Object.assign(rig.motionRects.find(rect => rect.kind === 'eyes'), { x: 190, y: 255, width: 220, height: 90 });
  assert.throws(() => rigFor('working', rig), /reviewed|anatomical|eye/i);
});

test('idle rejects a hand region even when it is tiny and below the area limit', () => {
  const rig = structuredClone(manifest.states.idle.fixedRig);
  rig.motionRects.push({ kind: 'hands', x: 295, y: 438, width: 1, height: 1 });
  assert.throws(() => rigFor('idle', rig), /idle|eyes/i);
});

test('working rejects a chest pixel falsely declared as a typing hand', () => {
  const rig = structuredClone(manifest.states.working.fixedRig);
  Object.assign(rig.motionRects.find(rect => rect.kind === 'hands'), { x: 280, y: 350, width: 1, height: 1 });
  assert.throws(() => rigFor('working', rig), /reviewed|anatomical|hand/i);
});

test('working rejects a one-pixel mask within the real hand position', () => {
  const rig = structuredClone(manifest.states.working.fixedRig);
  Object.assign(rig.motionRects.find(rect => rect.kind === 'hands'), { width: 1, height: 1 });
  assert.throws(() => rigFor('working', rig), /small|hand|dimensions/i);
});

for (const action of ['idle', 'working']) {
  test(action + ': every RGBA pixel outside the eye/hand regions stays fixed across all six frames', () => {
    const { mask } = rigFor(action), frames = decodeFrames(manifest.states[action].file), base = frames[0].data;
    for (let i = 1; i < frames.length; i++) {
      const current = frames[i].data;
      let changes = 0, first = null;
      for (let pixel = 0; pixel < mask.length; pixel++) {
        if (mask[pixel]) continue;
        const offset = pixel * 4;
        if (current[offset] !== base[offset] || current[offset + 1] !== base[offset + 1] ||
            current[offset + 2] !== base[offset + 2] || current[offset + 3] !== base[offset + 3]) {
          changes++; first ??= { x: pixel % manifest.width, y: Math.floor(pixel / manifest.width) };
        }
      }
      assert.equal(changes, 0, action + ' frame ' + i + ' changed fixed pixels; first=' + JSON.stringify(first));
      const hatEnd = Math.floor(manifest.height / 3) * manifest.width * 4;
      const feetStart = (manifest.footBaseline - 48) * manifest.width * 4;
      assert.ok(current.subarray(0, hatEnd).equals(base.subarray(0, hatEnd)), 'the hat top is strictly identical');
      assert.ok(current.subarray(feetStart).equals(base.subarray(feetStart)), 'the foot region is strictly identical');
    }
  });

  test(action + ': eye motion is visible, typing hands move, and all six frames are distinct', () => {
    const { rig } = rigFor(action), frames = decodeFrames(manifest.states[action].file), base = frames[0].data;
    assert.equal(new Set(frames.map(frame => createHash('sha256').update(frame.data).digest('hex'))).size, 6);
    for (const kind of action === 'working' ? ['eyes', 'hands'] : ['eyes']) {
      const rects = rig.motionRects.filter(rect => rect.kind === kind);
      const visibleChanges = frames.slice(1).map(frame => {
        let changed = 0;
        for (const rect of rects) for (let y = rect.y; y < rect.y + rect.height; y++) for (let x = rect.x; x < rect.x + rect.width; x++) {
          const offset = (y * manifest.width + x) * 4;
          if (Math.max(base[offset + 3], frame.data[offset + 3]) <= 10) continue;
          if ([0, 1, 2, 3].some(channel => Math.abs(base[offset + channel] - frame.data[offset + channel]) > 4)) changed++;
        }
        return changed;
      });
      assert.ok(Math.max(...visibleChanges) > 20, action + ' ' + kind + ' must change visible artwork, not just metadata or transparent RGB');
    }
  });

  test(action + ': fixed rig preserves transparent background and partially transparent edges', () => {
    const frames = decodeFrames(manifest.states[action].file);
    for (const [index, frame] of frames.entries()) {
      let transparent = 0, partial = 0, visible = 0;
      for (let offset = 3; offset < frame.data.length; offset += 4) {
        const alpha = frame.data[offset];
        if (alpha === 0) transparent++;
        else if (alpha >= 240) visible++;
        else partial++;
      }
      assert.ok(transparent > frame.width * frame.height / 3, action + ' frame ' + index + ' needs a transparent canvas');
      assert.ok(partial > 0, 'antialiased alpha is retained'); assert.ok(visible > 0, 'visible body is retained without requiring source alpha to equal 255');
      for (const pixel of [0, frame.width - 1, (frame.height - 1) * frame.width, frame.width * frame.height - 1]) assert.equal(frame.data[pixel * 4 + 3], 0);
    }
  });
}
