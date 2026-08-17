const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { zstdDecompressSync, zstdCompressSync, constants } = require("node:zlib");

const SESSIONS =
  "D:\\work\\opc-deepseek-harness\\dist\\runtime\\dsh-home\\sessions";
const MAGIC = 4247762216;
const FALLBACK_SOURCE = {
  kind: "model",
  provider: "deepseek-official",
  model: "deepseek-v4-pro",
};

function decodeFrames(raw) {
  const magics = [];
  for (let i = 0; i + 4 <= raw.length; i++) {
    if (raw.readUInt32LE(i) === MAGIC) magics.push(i);
  }
  const frames = [];
  for (let m = 0; m < magics.length; m++) {
    const start = magics[m];
    const end = m + 1 < magics.length ? magics[m + 1] : raw.length;
    try {
      frames.push(zstdDecompressSync(raw.subarray(start, end)).toString("utf8"));
    } catch {
      /* torn final frame is dropped */
    }
  }
  return frames;
}

function compress(text) {
  const options = {};
  try {
    if (constants && constants.ZSTD_c_checksumFlag !== undefined) {
      options.params = { [constants.ZSTD_c_checksumFlag]: 1 };
    }
  } catch {
    /* checksum param optional */
  }
  return zstdCompressSync(Buffer.from(text, "utf8"), options);
}

function encodeFile(headerLine, restLines) {
  // frame 0 must be exactly one header line; remaining events in later frames
  return Buffer.concat([
    compress(headerLine + "\n"),
    compress(restLines.join("\n") + "\n"),
  ]);
}

function headerFrameOk(frames) {
  if (!frames.length) return false;
  const first = frames[0];
  if (first.length === 0 || first.indexOf("\n") !== first.length - 1) return false;
  const line = first.slice(0, -1);
  try {
    const parsed = JSON.parse(line);
    return parsed && parsed.type === "session";
  } catch {
    return false;
  }
}

function uuidFrom(sessionId, seq) {
  const h = crypto.createHash("sha256").update(sessionId + ":" + seq).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const hex = h.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function validateMessageEvent(ev) {
  const type = ev.type;
  if (type !== "user/message" && type !== "assistant/message" && type !== "tool/result") return null;
  const data = ev.data;
  const record = data && typeof data === "object" && !Array.isArray(data) ? data : undefined;
  const message = type === "user/message" ? record : record && record.message;
  const problems = [];
  if (!message || typeof message !== "object" || typeof message.id !== "string" || message.id === "") {
    problems.push("no message id");
  } else {
    const expectedRole = type === "assistant/message" ? "assistant" : "user";
    if (message.role !== expectedRole) problems.push(`role=${JSON.stringify(message.role)}`);
    const source = message.source;
    if (!source || typeof source !== "object" || typeof source.kind !== "string" || source.kind === "") {
      problems.push("no source");
    } else if (type === "assistant/message") {
      if (source.kind !== "model" || !(typeof source.provider === "string" && source.provider && typeof source.model === "string" && source.model)) {
        problems.push("not a model source");
      }
    } else if (type === "tool/result") {
      if (source.kind !== "tool" || typeof source.callId !== "string" || source.callId === "") problems.push("not a tool source");
    }
    if (!Array.isArray(message.content)) problems.push("content not array");
  }
  return problems;
}

function headerSourceOf(events) {
  for (const ev of events) {
    if (ev.type === "request/header" && ev.data && ev.data.header && ev.data.header.config) {
      const c = ev.data.header.config;
      if (typeof c.provider === "string" && c.provider && typeof c.model === "string" && c.model) {
        return { kind: "model", provider: c.provider, model: c.model };
      }
    }
  }
  return null;
}

let rewritten = 0;
let patchedTotal = 0;

for (const ws of fs.readdirSync(SESSIONS, { withFileTypes: true })) {
  if (!ws.isDirectory()) continue;
  const wsDir = path.join(SESSIONS, ws.name);
  for (const sess of fs.readdirSync(wsDir, { withFileTypes: true })) {
    if (!sess.isDirectory()) continue;
    const dir = path.join(wsDir, sess.name);
    const file = path.join(dir, "session.jsonl.zstd");
    if (!fs.existsSync(file)) continue;

    const bak = file + ".bak";
    if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);

    const frames = decodeFrames(fs.readFileSync(file));
    const text = frames.join("");
    const lines = text.split("\n");
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    if (!lines.length) {
      console.log(`SKIP ${ws.name}/${sess.name}: empty`);
      continue;
    }

    const events = [];
    const lineOf = new Map();
    for (let i = 0; i < lines.length; i++) {
      try {
        const ev = JSON.parse(lines[i]);
        events.push(ev);
        lineOf.set(ev, i);
      } catch {
        /* keep raw */
      }
    }

    const source = headerSourceOf(events) || FALLBACK_SOURCE;
    const sessionId = events.find((e) => e.type === "session")?.id || sess.name;
    const changedLines = new Set();

    for (const ev of events) {
      if (ev.type !== "assistant/message" && ev.type !== "user/message" && ev.type !== "tool/result") continue;
      const data = ev.data;
      const record = data && typeof data === "object" && !Array.isArray(data) ? data : undefined;
      const message = ev.type === "user/message" ? record : record && record.message;
      if (!message || typeof message !== "object") continue;
      const problems = validateMessageEvent(ev) || [];
      if (!problems.length) continue;
      let modified = false;
      if (typeof message.id !== "string" || message.id === "") {
        message.id = uuidFrom(sessionId, ev.seq);
        modified = true;
      }
      if (typeof message.source !== "object" || message.source === null || typeof message.source.kind !== "string" || message.source.kind === "") {
        message.source = ev.type === "assistant/message" ? { ...source } : { kind: "user" };
        modified = true;
      }
      if (modified) {
        const idx = lineOf.get(ev);
        lines[idx] = JSON.stringify(ev);
        changedLines.add(idx);
        patchedTotal++;
      }
    }

    const remaining = [];
    for (const ev of events) {
      const p = validateMessageEvent(ev);
      if (p && p.length) remaining.push(`seq ${ev.seq}: ${p.join("; ")}`);
    }
    if (remaining.length) {
      console.log(`SKIP ${ws.name}/${sess.name}: still invalid -> ${remaining[0]}`);
      continue;
    }
    const seqs = events.filter((e) => typeof e.seq === "number").map((e) => e.seq);
    let contiguous = true;
    for (let i = 0; i < seqs.length; i++) {
      if (seqs[i] !== i) {
        contiguous = false;
        break;
      }
    }
    if (!contiguous) {
      console.log(`SKIP ${ws.name}/${sess.name}: seqs not contiguous`);
      continue;
    }

    const headerOk = headerFrameOk(frames);
    if (changedLines.size === 0 && headerOk) continue;

    let headerIdx = 0;
    try {
      const p = JSON.parse(lines[0]);
      if (p.type !== "session") headerIdx = events.findIndex((e) => e.type === "session");
    } catch {
      headerIdx = events.findIndex((e) => e.type === "session");
    }
    if (headerIdx === -1) {
      console.log(`SKIP ${ws.name}/${sess.name}: no session header line`);
      continue;
    }
    const headerLine = lines[headerIdx];
    const restLines = lines.filter((_, i) => i !== headerIdx);

    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, encodeFile(headerLine, restLines));
    fs.renameSync(tmp, file);
    rewritten++;
    console.log(`REWRITTEN ${ws.name}/${sess.name}: patched=${changedLines.size} headerOk=${headerOk}`);
  }
}

console.log(`\nfiles rewritten: ${rewritten}, events patched: ${patchedTotal}`);
