/**
 * 天地图私有矢量瓦片 Protobuf 解码器 (CommonJS 版本)
 */

const { gunzipSync } = require('zlib');
const { validateXYZ } = require('./geometry.js');

const DECODER_VERSION = 'tdt-vts-batch-1.0.0';
const FLIPS = [1, 2, 3, 4, 99];
const TYPE = { 0: 0, 1: 2, 2: 3, 4: 1 };
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

function jsonInt(n) {
  return n >= -MAX_SAFE && n <= MAX_SAFE ? Number(n) : n.toString();
}

function xyz2pk(x, y, z) {
  validateXYZ({ x, y, z });
  const digits = [];
  for (let bit = 0; bit <= z; bit++) {
    digits.push((Math.floor(x / 2 ** bit) % 2) + 2 * (Math.floor(y / 2 ** bit) % 2)
      + (bit >= 6 && bit <= 9 ? 1 : 0));
  }
  let result = '';
  for (let i = 0; i < digits.length;) {
    let j = i + 1;
    while (j < digits.length && digits[j] === digits[i]) j++;
    result += String.fromCharCode(97 + 3 * digits[i]);
    if (j > i + 1) result += String(j - i - 1);
    i = j;
  }
  return result;
}

function pk2xyz(pk) {
  if (typeof pk !== 'string' || !pk.length || pk.length > 128) throw new Error('Invalid pk length.');
  const digits = [];
  let offset = 0;
  for (const m of pk.matchAll(/([adgjm])(\d{0,2})/g)) {
    if (m.index !== offset) throw new Error('Invalid pk syntax.');
    offset += m[0].length;
    const count = 1 + Number(m[2] || 0);
    if (digits.length + count > 31) throw new Error('pk expands beyond supported z <= 30.');
    for (let i = 0; i < count; i++) digits.push((m[1].charCodeAt(0) - 97) / 3);
  }
  if (offset !== pk.length) throw new Error('Invalid pk syntax.');
  let x = 0, y = 0;
  digits.forEach((d, bit) => {
    d -= bit >= 6 && bit <= 9 ? 1 : 0;
    if (d < 0 || d > 3) throw new Error('Invalid pk digit after deobfuscation.');
    x += (d % 2) * 2 ** bit;
    y += Math.floor(d / 2) * 2 ** bit;
  });
  return validateXYZ({ x, y, z: digits.length - 1 });
}

class Reader {
  constructor(bytes) {
    this.b = bytes;
    this.pos = 0;
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  need(n) {
    if (!Number.isSafeInteger(n) || n < 0 || this.pos + n > this.b.length) throw new Error('Truncated protobuf field.');
  }
  get done() {
    return this.pos === this.b.length;
  }
  uint64() {
    let n = 0n;
    for (let i = 0; i < 10; i++) {
      this.need(1);
      const b = this.b[this.pos++];
      if (i === 9 && b > 1) throw new Error('Protobuf varint exceeds uint64.');
      n |= BigInt(b & 127) << BigInt(7 * i);
      if (!(b & 128)) return n;
    }
    throw new Error('Unterminated varint.');
  }
  uint() {
    const n = this.uint64();
    if (n > MAX_SAFE) throw new Error('Unsafe protobuf length/index.');
    return Number(n);
  }
  bytes() {
    const n = this.uint();
    this.need(n);
    const b = this.b.subarray(this.pos, this.pos + n);
    this.pos += n;
    return b;
  }
  string() {
    return new TextDecoder('utf-8', { fatal: true }).decode(this.bytes());
  }
  tag() {
    const t = this.uint();
    const f = Math.floor(t / 8), w = t % 8;
    if (!f || f > 0x1fffffff) throw new Error('Invalid protobuf field number.');
    return [f, w];
  }
  wire(w, expected) {
    if (w !== expected) throw new Error('Unexpected protobuf wire type.');
  }
  skip(w) {
    if (w === 0) this.uint64();
    else if (w === 2) this.bytes();
    else if (w === 1 || w === 5) {
      const n = w === 1 ? 8 : 4;
      this.need(n);
      this.pos += n;
    } else throw new Error('Unsupported protobuf wire type.');
  }
  float(width) {
    this.need(width);
    const n = width === 4 ? this.dv.getFloat32(this.pos, true) : this.dv.getFloat64(this.pos, true);
    this.pos += width;
    if (!Number.isFinite(n)) throw new Error('Non-finite numeric property.');
    return n;
  }
}

function decodeValue(b) {
  const r = new Reader(b);
  let value = null;
  while (!r.done) {
    const [f, w] = r.tag();
    if (f === 1) {
      r.wire(w, 2);
      value = r.string();
    } else if (f === 2 || f === 3) {
      r.wire(w, f === 2 ? 1 : 5);
      value = r.float(f === 2 ? 8 : 4);
    } else if (f >= 4 && f <= 7) {
      r.wire(w, 0);
      const n = r.uint64();
      value = f === 7 ? n !== 0n : jsonInt(f === 4 ? BigInt.asIntN(64, n) : f === 6 ? (n >> 1n) ^ -(n & 1n) : n);
    } else r.skip(w);
  }
  return value;
}

function decodeGeometry(b, type) {
  const r = new Reader(b), rings = [];
  let ring, x = 0, y = 0, vertices = 0;
  while (!r.done) {
    const command = r.uint(), cmd = command % 8, count = Math.floor(command / 8);
    if (cmd === 7) {
      if (!ring?.length || type !== 3 || count > 1) throw new Error('Invalid ClosePath.');
      ring.push({ ...ring[0] });
      continue;
    }
    if ((cmd !== 2 && cmd !== 3) || !count || count > (r.b.length - r.pos) / 2) throw new Error('Invalid geometry command/count.');
    if (type !== 1 && cmd === 2 && count !== 1) throw new Error('Invalid non-point MoveTo count.');
    for (let i = 0; i < count; i++) {
      const dx = r.uint(), dy = r.uint();
      if (dx > 0xffffffff || dy > 0xffffffff) throw new Error('Geometry delta exceeds uint32.');
      x += dx % 2 ? -(dx + 1) / 2 : dx / 2;
      y += dy % 2 ? -(dy + 1) / 2 : dy / 2;
      if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) throw new Error('Unsafe geometry coordinate.');
      if (cmd === 2) { ring = []; rings.push(ring); }
      if (!ring) throw new Error('LineTo without MoveTo.');
      ring.push({ x, y });
      if (++vertices > 2000000) throw new Error('Feature vertex safety limit exceeded.');
    }
  }
  return rings;
}

function decodeFeature(b, layer) {
  const r = new Reader(b);
  let id, type = 0, geometryBytes;
  const tags = [];
  while (!r.done) {
    const [f, w] = r.tag();
    if (f === 4) { r.wire(w, 0); id = jsonInt(r.uint64()); }
    else if (f === 2) { r.wire(w, 0); type = TYPE[r.uint()] ?? 0; }
    else if (f === 3) {
      r.wire(w, 2);
      const p = new Reader(r.bytes());
      while (!p.done) tags.push(p.uint());
    } else if (f === 1) { r.wire(w, 2); geometryBytes = r.bytes(); }
    else r.skip(w);
  }
  if (tags.length % 2) throw new Error('Odd property tag count.');
  const properties = Object.create(null);
  for (let i = 0; i < tags.length; i += 2) {
    if (tags[i] >= layer.keys.length || tags[i + 1] >= layer.values.length) throw new Error('Property dictionary index out of bounds.');
    properties[layer.keys[tags[i]]] = layer.values[tags[i + 1]];
  }
  if (type && !geometryBytes) throw new Error('Feature has no geometry.');
  return { ...(id !== undefined ? { id } : {}), type, properties, geometry: type ? decodeGeometry(geometryBytes, type) : [] };
}

function decodeLayer(b) {
  const r = new Reader(b), featureBytes = [];
  const layer = { name: null, version: 1, extent: 4096, keys: [], values: [], features: [] };
  while (!r.done) {
    const [f, w] = r.tag();
    if (f === 15 || f === 5) { r.wire(w, 0); layer[f === 15 ? 'version' : 'extent'] = r.uint(); }
    else if (f === 2) { r.wire(w, 2); layer.name = r.string(); }
    else if (f === 4) { r.wire(w, 2); layer.keys.push(r.string()); }
    else if (f === 3) { r.wire(w, 2); layer.values.push(decodeValue(r.bytes())); }
    else if (f === 1) { r.wire(w, 2); featureBytes.push(r.bytes()); }
    else r.skip(w);
  }
  if (!layer.extent || layer.extent > 0x7fffffff) throw new Error('Invalid layer extent.');
  layer.features = featureBytes.map(b => decodeFeature(b, layer));
  return layer;
}

function normalizeBytes(raw, maxBytes = 16 * 1024 * 1024) {
  if (!raw.length || raw.length > maxBytes) throw new Error('Empty or oversized tile response.');
  let b = Buffer.from(raw);
  if (b[0] === 0x1f && b[1] === 0x8b) b = gunzipSync(b, { maxOutputLength: maxBytes });
  if (!b.length || b.length > maxBytes) throw new Error('Empty or oversized uncompressed tile.');
  if (/^[<{\[]/.test(b.subarray(0, 160).toString('utf8').trimStart())) throw new Error('Response is HTML/XML/JSON, not /vts binary. Check authorization and endpoint.');
  return b;
}

function parse_vts_tile(raw, maxBytes) {
  const b = new Uint8Array(normalizeBytes(raw, maxBytes));
  for (const i of FLIPS) if (i < b.length) b[i] ^= 255;
  const r = new Reader(b), layers = [];
  while (!r.done) {
    const [f, w] = r.tag();
    if (f === 3) { r.wire(w, 2); layers.push(decodeLayer(r.bytes())); }
    else r.skip(w);
  }
  if (!layers.length) throw new Error('No /vts layers decoded. Other tile formats are unsupported.');
  return { layers, consumed: b.length };
}

function summarizeLayers(layers) {
  return layers.map(layer => {
    const counts = { point: 0, line: 0, polygon: 0, unknown: 0 };
    for (const f of layer.features) counts[({ 1: 'point', 2: 'line', 3: 'polygon' })[f.type] ?? 'unknown']++;
    return {
      name: layer.name,
      extent: layer.extent,
      features: layer.features.length,
      ...counts,
      keys: layer.keys,
      samples: [...layer.features.filter(f => f.type === 3).slice(0, 3), ...layer.features.filter(f => f.type !== 3).slice(0, 2)].map(f => ({ id: f.id, type: f.type, properties: f.properties })),
    };
  });
}

module.exports = {
  DECODER_VERSION,
  xyz2pk,
  pk2xyz,
  normalizeBytes,
  parse_vts_tile,
  summarizeLayers,
};
