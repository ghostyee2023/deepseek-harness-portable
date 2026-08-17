import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';

const ZSTD_MAGIC = 4247762216; // 0xFD2FB528

function scanFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) break;
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) break;
    offset += 4;
    const descriptor = buffer.readUInt8(offset); offset += 1;
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : (1 << contentSizeFlag);
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    offset += remainingHeaderBytes;
    for (;;) {
      if (buffer.length - offset < 3) break;
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) offset += 4;
    frames.push({ start, end: offset });
  }
  return frames;
}

// find the smallest session file
const root = 'C:/Users/ghost/.dsh/sessions';
const files = [];
(function walk(dir) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) { try { walk(p); } catch {} }
    else if (ent.name.endsWith('.jsonl.zstd')) files.push(p);
  }
})(root);
files.sort((a, b) => readFileSync(a).length - readFileSync(b).length);

const target = process.argv[2] || files[0];
const buf = readFileSync(target);
const frames = scanFrames(buf);
console.log('file:', target, 'size:', buf.length, 'frames:', frames.length);

const texts = frames.map((f) => zstdDecompressSync(buf.subarray(f.start, f.end)).toString('utf8'));
const header = JSON.parse(texts[0].split('\n')[0]);
console.log('\n=== header ===');
console.log(JSON.stringify(header, null, 2));

const lines = texts.join('').split('\n').filter(Boolean);
console.log('\n=== total lines (incl header):', lines.length, '===');
const limit = Number(process.argv[3] || 30);
for (let i = 1; i < Math.min(lines.length, limit + 1); i++) {
  const o = JSON.parse(lines[i]);
  console.log(`\n[${i}] type=${o.type} seq=${o.seq} time=${o.time}`);
  console.log(JSON.stringify(o).slice(0, 900));
}
