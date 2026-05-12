// Generates minimal solid-color PNG icons for PWA
// Run: node scripts/gen-icons.js
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

function makePNG(size, r, g, b) {
  const rowBytes = 1 + size * 4;
  const raw = Buffer.alloc(size * rowBytes, 0);
  for (let y = 0; y < size; y++) {
    raw[y * rowBytes] = 0; // None filter
    for (let x = 0; x < size; x++) {
      const o = y * rowBytes + 1 + x * 4;
      raw[o] = r; raw[o+1] = g; raw[o+2] = b; raw[o+3] = 255;
    }
  }
  const idat = zlib.deflateSync(raw);
  const tab  = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    tab[i] = c;
  }
  function crc(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = tab[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function chunk(name, data) {
    const n = Buffer.from(name, 'ascii');
    const l = Buffer.alloc(4); l.writeUInt32BE(data.length, 0);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([n, data])), 0);
    return Buffer.concat([l, n, data, c]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const pub = path.join(__dirname, '..', 'public');
// FreewayChina primary blue: #2E86DE = 46,134,222
[72, 192, 512].forEach(sz => {
  fs.writeFileSync(path.join(pub, `icon-${sz}.png`), makePNG(sz, 46, 134, 222));
  console.log(`✓ icon-${sz}.png`);
});
