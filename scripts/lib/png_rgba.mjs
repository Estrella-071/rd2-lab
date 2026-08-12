import { deflateSync, inflateSync } from "node:zlib";

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const chunk = Buffer.allocUnsafe(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
}

function parseChunks(png, label) {
  if (!png.subarray(0, 8).equals(signature)) {
    throw new Error(`${label} is not a PNG file`);
  }

  const chunks = [];
  let offset = 8;
  while (offset < png.length) {
    if (offset + 12 > png.length) {
      throw new Error(`${label} has a truncated PNG chunk`);
    }
    const length = png.readUInt32BE(offset);
    const chunkEnd = offset + length + 12;
    if (chunkEnd > png.length) {
      throw new Error(`${label} has a truncated PNG chunk payload`);
    }
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset = chunkEnd;
  }
  return chunks;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodeFilteredByte(filter, raw, left, up, upperLeft, label) {
  switch (filter) {
    case 0:
      return raw;
    case 1:
      return raw + left;
    case 2:
      return raw + up;
    case 3:
      return raw + Math.floor((left + up) / 2);
    case 4:
      return raw + paeth(left, up, upperLeft);
    default:
      throw new Error(`${label} uses unsupported PNG row filter ${filter}`);
  }
}

function decodeRow(filtered, pixels, label, y, stride, bytesPerPixel) {
  const filter = filtered[y * (stride + 1)];
  const sourceOffset = y * (stride + 1) + 1;
  const rowOffset = y * stride;
  for (let x = 0; x < stride; x += 1) {
    const raw = filtered[sourceOffset + x];
    const left = x >= bytesPerPixel ? pixels[rowOffset + x - bytesPerPixel] : 0;
    const up = y > 0 ? pixels[rowOffset + x - stride] : 0;
    const upperLeft = y > 0 && x >= bytesPerPixel
      ? pixels[rowOffset + x - stride - bytesPerPixel]
      : 0;
    pixels[rowOffset + x] = decodeFilteredByte(filter, raw, left, up, upperLeft, label) & 0xff;
  }
}

export function decodeRgba8(png, label) {
  const chunks = parseChunks(png, label);
  const ihdr = chunks.find(({ type }) => type === "IHDR")?.data;
  if (!ihdr) throw new Error(`${label} is missing IHDR`);

  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  const interlace = ihdr[12];
  if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
    throw new Error(
      `${label} must be a non-interlaced RGBA8 PNG; received depth=${bitDepth}, type=${colorType}, interlace=${interlace}`,
    );
  }

  const compressed = Buffer.concat(
    chunks.filter(({ type }) => type === "IDAT").map(({ data }) => data),
  );
  const filtered = inflateSync(compressed);
  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  if (filtered.length !== height * (stride + 1)) {
    throw new Error(`${label} has an unexpected decompressed byte length`);
  }

  const pixels = Buffer.allocUnsafe(height * stride);
  for (let y = 0; y < height; y += 1) decodeRow(filtered, pixels, label, y, stride, bytesPerPixel);
  return { chunks, width, height, pixels };
}

export function encodeRgba8(sourceChunks, width, height, pixels) {
  const stride = width * 4;
  const filtered = Buffer.allocUnsafe(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    const targetOffset = y * (stride + 1);
    filtered[targetOffset] = 0;
    pixels.copy(filtered, targetOffset + 1, y * stride, (y + 1) * stride);
  }

  const ihdrChunk = sourceChunks.find(({ type }) => type === "IHDR");
  if (!ihdrChunk) throw new Error("Source PNG is missing IHDR");
  const ihdr = Buffer.from(ihdrChunk.data);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  const idat = makeChunk("IDAT", deflateSync(filtered, { level: 9 }));
  const outputChunks = [];
  let wroteIdat = false;
  for (const chunk of sourceChunks) {
    if (chunk.type === "IHDR") {
      outputChunks.push(makeChunk("IHDR", ihdr));
      continue;
    }
    if (chunk.type === "IDAT") {
      if (!wroteIdat) {
        outputChunks.push(idat);
        wroteIdat = true;
      }
      continue;
    }
    outputChunks.push(makeChunk(chunk.type, chunk.data));
  }
  return Buffer.concat([signature, ...outputChunks]);
}
