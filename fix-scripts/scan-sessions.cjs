const fs = require("fs");
const path = require("path");
const { zstdDecompressSync } = require("node:zlib");

const SESSIONS =
  "D:\\work\\opc-deepseek-harness\\dist\\runtime\\dsh-home\\sessions";
const MAGIC = 4247762216;

function decodeFile(file) {
  const raw = fs.readFileSync(file);
  const magics = [];
  for (let i = 0; i + 4 <= raw.length; i++) {
    if (raw.readUInt32LE(i) === MAGIC) magics.push(i);
  }
  const chunks = [];
  for (let m = 0; m < magics.length; m++) {
    const start = magics[m];
    const end = m + 1 < magics.length ? magics[m + 1] : raw.length;
    try {
      chunks.push(zstdDecompressSync(raw.subarray(start, end)));
    } catch {
      /* torn final frame */
    }
  }
  return Buffer.concat(chunks).toString("utf8");
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
  return problems.length ? problems.join("; ") : null;
}

const bad = [];
for (const ws of fs.readdirSync(SESSIONS, { withFileTypes: true })) {
  if (!ws.isDirectory()) continue;
  const wsDir = path.join(SESSIONS, ws.name);
  for (const sess of fs.readdirSync(wsDir, { withFileTypes: true })) {
    if (!sess.isDirectory()) continue;
    const file = path.join(wsDir, sess.name, "session.jsonl.zstd");
    if (!fs.existsSync(file)) continue;
    const text = decodeFile(file);
    const events = text.split("\n").filter((l) => l.trim());
    const failures = [];
    for (const line of events) {
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      const problem = validateMessageEvent(ev);
      if (problem) failures.push(`seq ${ev.seq} ${ev.type}: ${problem}`);
    }
    if (failures.length) {
      bad.push({ ws: ws.name, session: sess.name, count: failures.length, sample: failures.slice(0, 3) });
    }
  }
}

console.log("sessions with validation failures:", bad.length);
for (const b of bad) {
  console.log(`\n${b.ws}/${b.session} (${b.count} failing events)`);
  for (const s of b.sample) console.log("  - " + s);
}
