const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const size = 256;
const pixels = Buffer.alloc(size * size * 4);

function setPixel(x, y, color) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const offset = (y * size + x) * 4;
  pixels[offset] = color[0]; pixels[offset + 1] = color[1]; pixels[offset + 2] = color[2]; pixels[offset + 3] = color[3] ?? 255;
}
function blendPixel(x, y, color, alpha = 1) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const offset = (y * size + x) * 4, inverse = 1 - alpha;
  pixels[offset] = Math.round(pixels[offset] * inverse + color[0] * alpha);
  pixels[offset + 1] = Math.round(pixels[offset + 1] * inverse + color[1] * alpha);
  pixels[offset + 2] = Math.round(pixels[offset + 2] * inverse + color[2] * alpha);
  pixels[offset + 3] = 255;
}
function roundedBox(x0, y0, x1, y1, radius, color) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const cx = Math.max(x0 + radius, Math.min(x1 - radius, x));
    const cy = Math.max(y0 + radius, Math.min(y1 - radius, y));
    if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) setPixel(x, y, color);
  }
}
function polygon(points, color) {
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i], [xj, yj] = points[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) setPixel(x, y, color);
  }
}
function line(x0, y0, x1, y1, width, color) {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
  for (let step = 0; step <= steps; step++) {
    const x = x0 + (x1 - x0) * step / steps, y = y0 + (y1 - y0) * step / steps;
    for (let dy = -width; dy <= width; dy++) for (let dx = -width; dx <= width; dx++) if (dx * dx + dy * dy <= width * width) blendPixel(Math.round(x + dx), Math.round(y + dy), color, .95);
  }
}

for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const radial = Math.max(0, 1 - Math.hypot(x - 128, y - 112) / 190);
  setPixel(x, y, [5 + radial * 7, 15 + radial * 18, 30 + radial * 31, 255]);
}
roundedBox(12, 12, 243, 243, 47, [7, 22, 42, 255]);
polygon([[128, 32], [211, 65], [201, 157], [128, 224], [55, 157], [45, 65]], [13, 45, 70, 255]);
polygon([[128, 42], [199, 70], [190, 151], [128, 210], [66, 151], [57, 70]], [5, 22, 39, 255]);
line(72, 162, 103, 128, 6, [43, 211, 209, 255]);
line(103, 128, 129, 146, 6, [43, 211, 209, 255]);
line(129, 146, 181, 91, 6, [94, 234, 165, 255]);
line(161, 91, 181, 91, 6, [94, 234, 165, 255]);
line(181, 91, 181, 112, 6, [94, 234, 165, 255]);
for (const [x, y, color] of [[72, 162, [43, 211, 209, 255]], [103, 128, [43, 211, 209, 255]], [129, 146, [43, 211, 209, 255]], [181, 91, [94, 234, 165, 255]]]) {
  for (let dy = -9; dy <= 9; dy++) for (let dx = -9; dx <= 9; dx++) if (dx * dx + dy * dy <= 81) blendPixel(x + dx, y + dy, color, 1);
}

const crcTable = Array.from({ length: 256 }, (_, number) => {
  let value = number;
  for (let bit = 0; bit < 8; bit++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(buffer) { let crc = 0xffffffff; for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const name = Buffer.from(type), output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0); name.copy(output, 4); data.copy(output, 8); output.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return output;
}
const scanlines = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y++) { scanlines[y * (size * 4 + 1)] = 0; pixels.copy(scanlines, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(scanlines, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
const icoHeader = Buffer.alloc(22); icoHeader.writeUInt16LE(0, 0); icoHeader.writeUInt16LE(1, 2); icoHeader.writeUInt16LE(1, 4); icoHeader[6] = 0; icoHeader[7] = 0; icoHeader[8] = 0; icoHeader[9] = 0; icoHeader.writeUInt16LE(1, 10); icoHeader.writeUInt16LE(32, 12); icoHeader.writeUInt32LE(png.length, 14); icoHeader.writeUInt32LE(22, 18);
const destination = path.resolve(__dirname, '..', 'build'); fs.mkdirSync(destination, { recursive: true });
fs.writeFileSync(path.join(destination, 'icon.png'), png); fs.writeFileSync(path.join(destination, 'icon.ico'), Buffer.concat([icoHeader, png]));
console.log(`Generated ${path.join(destination, 'icon.ico')}`);
