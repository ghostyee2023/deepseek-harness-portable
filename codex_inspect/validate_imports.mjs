import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';

const ZSTD_MAGIC = 4247762216;
const KNOWN = new Set([
  'agent-preset/selected','agent/inbox/spliced','approval/asked','approval/decided','approval/policy',
  'assistant/chunk','assistant/message','command/done','command/run','compaction/end','compaction/prune',
  'compaction/start','compaction/summary','feedback/record','goal/change','hook/invoked','hook/result',
  'llm/retry','llm/retry-started','permission/preset','plan/mode','request/context','request/header',
  'sandbox/mode','schedule/change','session/end-seed','session/title','session/title-llm-request',
  'step/end','step/start','subagent/descriptor','todo/write','tool-workflow/agent-end',
  'tool-workflow/agent-start','tool-workflow/run-end','tool-workflow/run-start','tool/call',
  'tool/code-dispatch','tool/code-dispatch-start','tool/result','turn/end','turn/start','user/message',
  'web/deepseek-search-llm-request',
]);
const SURFACE = new Set(['user/message', 'assistant/message', 'tool/result']);

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
    offset += (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    for (;;) {
      if (buffer.length - offset < 3) break;
      const blockHeader = buffer.readUIntLE(offset, 3); offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      offset += blockType === 1 ? 1 : blockSize;
      if (lastBlock) break;
    }
    if (checksum) offset += 4;
    frames.push({ start, end: offset });
  }
  return frames;
}

const root = 'C:/Users/ghost/.dsh/sessions';
const files = [];
(function walk(dir) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) { try { walk(p); } catch {} }
    else if (ent.name.endsWith('.jsonl.zstd')) files.push(p);
  }
})(root);

const imports = files.filter((f) => f.includes('session-import-'));
console.log(`找到 ${imports.length} 个导入文件\n`);
let pass = 0, fail = 0;
for (const f of imports) {
  const problems = [];
  try {
    const buf = readFileSync(f);
    const frames = scanFrames(buf);
    const texts = frames.map((fr) => zstdDecompressSync(buf.subarray(fr.start, fr.end)).toString('utf8'));
    const lines = texts.join('').split('\n').filter(Boolean);
    const header = JSON.parse(lines[0]);
    if (header.type !== 'session' || header.version !== 0 || typeof header.id !== 'string') problems.push('bad header');
    // seq contiguity + known types
    let prevSeq = -1;
    for (let i = 1; i < lines.length; i++) {
      const e = JSON.parse(lines[i]);
      if (typeof e.seq !== 'number' || e.seq !== prevSeq + 1) problems.push(`seq gap at line ${i}: got ${e.seq}, expected ${prevSeq + 1}`);
      prevSeq = e.seq;
      if (!KNOWN.has(e.type)) problems.push(`unknown type '${e.type}' at line ${i}`);
      if (SURFACE.has(e.type) && e.surfaceOp !== 'append') problems.push(`surface event ${e.type} missing surfaceOp=append at line ${i}`);
      if (typeof e.time !== 'number' || !Number.isSafeInteger(e.time)) problems.push(`bad time at line ${i}`);
    }
  } catch (err) {
    problems.push('EXCEPTION: ' + err.message);
  }
  const id = f.split(/[\\/]/).filter((s) => s.startsWith('session-import-')).at(-1) || f;
  if (problems.length) {
    fail++;
    console.log(`FAIL ${id}\n  ` + problems.slice(0, 4).join('\n  '));
  } else {
    pass++;
  }
}
console.log(`\n通过 ${pass} 个，失败 ${fail} 个`);
