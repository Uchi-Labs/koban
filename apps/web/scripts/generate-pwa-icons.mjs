import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";

const outDir = path.resolve("public/icons");
const background = [7, 9, 11, 255];
const mint = [81, 225, 179, 255];
const mintDim = [81, 225, 179, 64];
const inkHighlight = [255, 255, 255, 22];

const icons = [
  { file: "icon-192.png", size: 192, padding: 24 },
  { file: "icon-512.png", size: 512, padding: 64 },
  { file: "maskable-icon-192.png", size: 192, padding: 42 },
  { file: "maskable-icon-512.png", size: 512, padding: 112 },
  { file: "apple-touch-icon.png", size: 180, padding: 22 }
];

await mkdir(outDir, { recursive: true });

for (const icon of icons) {
  const png = createIconPng(icon.size, icon.padding);
  await writeFile(path.join(outDir, icon.file), png);
}

function createIconPng(size, padding) {
  const pixels = new Uint8Array(size * size * 4);
  fillRoundedRect(pixels, size, 0, 0, size, size, size * 0.22, background);

  const walletX = padding;
  const walletY = Math.round(size * 0.36);
  const walletW = size - padding * 2;
  const walletH = Math.round(size * 0.34);
  const radius = Math.round(size * 0.07);
  const flapH = Math.round(size * 0.16);

  fillRoundedRect(pixels, size, walletX, walletY, walletW, walletH, radius, mintDim);
  fillRoundedRect(pixels, size, walletX, walletY + Math.round(size * 0.04), walletW, walletH, radius, mint);
  fillRoundedRect(
    pixels,
    size,
    walletX + Math.round(size * 0.08),
    walletY - Math.round(size * 0.08),
    Math.round(walletW * 0.72),
    flapH,
    Math.round(size * 0.04),
    mint
  );
  fillRoundedRect(
    pixels,
    size,
    walletX + Math.round(walletW * 0.68),
    walletY + Math.round(walletH * 0.34),
    Math.round(walletW * 0.22),
    Math.round(walletH * 0.32),
    Math.round(size * 0.04),
    background
  );
  fillCircle(
    pixels,
    size,
    walletX + Math.round(walletW * 0.78),
    walletY + Math.round(walletH * 0.5),
    Math.round(size * 0.025),
    mint
  );
  fillRoundedRect(
    pixels,
    size,
    Math.round(size * 0.18),
    Math.round(size * 0.19),
    Math.round(size * 0.64),
    Math.round(size * 0.1),
    Math.round(size * 0.05),
    inkHighlight
  );

  return encodePng(size, size, pixels);
}

function fillRoundedRect(pixels, size, x, y, width, height, radius, color) {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(size, x + width);
  const y1 = Math.min(size, y + height);
  const r = Math.max(0, radius);

  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      const dx = Math.max(x + r - px, 0, px - (x + width - r - 1));
      const dy = Math.max(y + r - py, 0, py - (y + height - r - 1));

      if (dx * dx + dy * dy <= r * r) {
        blendPixel(pixels, size, px, py, color);
      }
    }
  }
}

function fillCircle(pixels, size, cx, cy, radius, color) {
  const r2 = radius * radius;

  for (let py = Math.max(0, cy - radius); py < Math.min(size, cy + radius); py += 1) {
    for (let px = Math.max(0, cx - radius); px < Math.min(size, cx + radius); px += 1) {
      const dx = px - cx;
      const dy = py - cy;

      if (dx * dx + dy * dy <= r2) {
        blendPixel(pixels, size, px, py, color);
      }
    }
  }
}

function blendPixel(pixels, size, x, y, color) {
  const index = (y * size + x) * 4;
  const alpha = color[3] / 255;
  const inverse = 1 - alpha;

  pixels[index] = Math.round(color[0] * alpha + pixels[index] * inverse);
  pixels[index + 1] = Math.round(color[1] * alpha + pixels[index + 1] * inverse);
  pixels[index + 2] = Math.round(color[2] * alpha + pixels[index + 2] * inverse);
  pixels[index + 3] = 255;
}

function encodePng(width, height, pixels) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * stride;
    raw[rowStart] = 0;
    Buffer.from(pixels.buffer, y * width * 4, width * 4).copy(raw, rowStart + 1);
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr(width, height)),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function ihdr(width, height) {
  const buffer = Buffer.alloc(13);
  buffer.writeUInt32BE(width, 0);
  buffer.writeUInt32BE(height, 4);
  buffer[8] = 8;
  buffer[9] = 6;
  buffer[10] = 0;
  buffer[11] = 0;
  buffer[12] = 0;
  return buffer;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  const crc = Buffer.alloc(4);

  length.writeUInt32BE(data.length, 0);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);

  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
  const table = crc32.table ??= createCrcTable();
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function createCrcTable() {
  return Array.from({ length: 256 }, (_, index) => {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    return value >>> 0;
  });
}

const digest = createHash("sha256")
  .update(icons.map((icon) => icon.file).join("\n"))
  .digest("hex")
  .slice(0, 8);

console.log(`Generated ${icons.length} PWA icons (${digest}).`);
