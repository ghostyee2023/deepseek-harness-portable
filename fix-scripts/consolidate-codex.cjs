// Consolidate Codex scratch-chat sessions (cwd under .../Documents/Codex or
// missing directories) into one "codex-imports" workspace, relocating each
// session directory so header cwd and storage path agree, then rebuild the
// workspace registry, pruning records left without sessions.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { zstdDecompressSync, zstdCompressSync, constants } = require("node:zlib");

const HOME =
  process.env.DSH_HOME || "D:\\work\\opc-deepseek-harness\\dist\\runtime\\dsh-home";
const SESSIONS = path.join(HOME, "sessions");
const WORKSPACE_FILE = path.join(HOME, "storages", "workspace.json");
const TARGET = path.join(HOME, "codex-imports");
const BACKUP_DIR = path.join(HOME, "codex-consolidation-backup");
const MAGIC = 4247762216;
const SCRATCH_RE = /[\\/]Documents[\\/]Codex/i;

function encodeSegment(raw) {
  if (raw.length === 0) throw new Error("empty segment");
  if (raw === ".") return "~002E";
  if (raw === "..") return "~002E~002E";
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) out += ch;
    else out += "~" + code.toString(16).toUpperCase().padStart(4, "0");
  }
  return out;
}

function projectKey(cwd) {
  let readable = "";
  let separatorRun = false;
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch === "/" || ch === "\\" || ch === ":") {
      if (!separatorRun) readable += "-";
      separatorRun = true;
    } else if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch;
      separatorRun = false;
    } else {
      readable += "~" + code.toString(16).toUpperCase().padStart(4, "0");
      separatorRun = false;
    }
  }
  return `--${(readable.replace(/^-+/, "") || "root").slice(0, 251)}--`;
}

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
      /* torn final frame */
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
  } catch {}
  return zstdCompressSync(Buffer.from(text, "utf8"), options);
}

function encodeFile(headerLine, restLines) {
  return Buffer.concat([
    compress(headerLine + "\n"),
    compress(restLines.join("\n") + "\n"),
  ]);
}

function readHeader(file) {
  const frames = decodeFrames(fs.readFileSync(file));
  if (!frames.length) return null;
  const line = frames.join("").split("\n")[0];
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

fs.mkdirSync(TARGET, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const manifest = { target: TARGET, relocated: [] };
let rewritten = 0;
let relocated = 0;

for (const ws of fs.readdirSync(SESSIONS, { withFileTypes: true })) {
  if (!ws.isDirectory()) continue;
  const wsDir = path.join(SESSIONS, ws.name);
  for (const s of fs.readdirSync(wsDir, { withFileTypes: true })) {
    if (!s.isDirectory()) continue;
    const dir = path.join(wsDir, s.name);
    const file = path.join(dir, "session.jsonl.zstd");
    if (!fs.existsSync(file)) continue;

    let header = readHeader(file);
    if (!header) continue;
    const sessionId = s.name;
    const cwd = header.cwd || "";
    const isScratch = SCRATCH_RE.test(cwd) || (cwd && !fs.existsSync(cwd));
    if (isScratch) {
      const bakFile = path.join(BACKUP_DIR, sessionId + ".jsonl.zstd");
      if (!fs.existsSync(bakFile)) fs.copyFileSync(file, bakFile);
      header.cwd = TARGET;
      const frames = decodeFrames(fs.readFileSync(file));
      const lines = frames.join("").split("\n");
      while (lines.length && lines[lines.length - 1] === "") lines.pop();
      lines[0] = JSON.stringify(header);
      const tmp = file + ".tmp";
      fs.writeFileSync(tmp, encodeFile(lines[0], lines.slice(1)));
      fs.renameSync(tmp, file);
      rewritten++;
      manifest.relocated.push({ id: sessionId, from: cwd, to: TARGET });
    }

    // ensure storage path matches header cwd
    header = readHeader(file);
    const expectedDir = path.join(SESSIONS, projectKey(header.cwd), encodeSegment(sessionId));
    if (path.resolve(dir) !== path.resolve(expectedDir)) {
      fs.mkdirSync(path.dirname(expectedDir), { recursive: true });
      if (!fs.existsSync(expectedDir)) fs.renameSync(dir, expectedDir);
      relocated++;
    }
  }
}

// remove empty workspace slug dirs left behind
for (const ws of fs.readdirSync(SESSIONS, { withFileTypes: true })) {
  if (!ws.isDirectory()) continue;
  const wsDir = path.join(SESSIONS, ws.name);
  try {
    if (fs.readdirSync(wsDir).length === 0) fs.rmdirSync(wsDir);
  } catch {}
}

fs.writeFileSync(path.join(BACKUP_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`rewritten ${rewritten} headers, relocated ${relocated} session dirs -> ${TARGET}`);

// ---- rebuild workspace registry ----
const state = JSON.parse(fs.readFileSync(WORKSPACE_FILE, "utf8"));
const records = new Map(Object.entries(state.tables.workspaces));

const groupsByCwd = new Map();
for (const ws of fs.readdirSync(SESSIONS, { withFileTypes: true })) {
  if (!ws.isDirectory()) continue;
  const wsDir = path.join(SESSIONS, ws.name);
  for (const s of fs.readdirSync(wsDir, { withFileTypes: true })) {
    if (!s.isDirectory()) continue;
    const file = path.join(wsDir, s.name, "session.jsonl.zstd");
    if (!fs.existsSync(file)) continue;
    const header = readHeader(file);
    if (!header) continue;
    const cwd = typeof header.cwd === "string" ? header.cwd : ws.name;
    if (!groupsByCwd.has(cwd)) groupsByCwd.set(cwd, []);
    groupsByCwd.get(cwd).push({ id: s.name, createdAt: header.createdAt || 0 });
  }
}
for (const sessions of groupsByCwd.values()) sessions.sort((a, b) => b.createdAt - a.createdAt);

const kept = new Map();
for (const [cwd, sessions] of groupsByCwd) {
  const key = cwd.toLowerCase();
  let match = null;
  for (const [id, rec] of records) {
    if (rec.path.toLowerCase() === key) {
      match = { id, rec };
      break;
    }
  }
  const ids = sessions.map((s) => s.id);
  if (match) {
    kept.set(match.id, { ...match.rec, sessionIds: ids, updatedAt: new Date().toISOString() });
  } else {
    const id = crypto.randomUUID();
    const stamp = new Date(sessions[0].createdAt).toISOString();
    kept.set(id, {
      path: cwd,
      title: path.basename(cwd),
      sessionIds: ids,
      createdAt: stamp,
      updatedAt: stamp,
    });
  }
}

const rank = new Map();
for (const [id, rec] of kept) {
  let newest = Date.parse(rec.createdAt) || 0;
  for (const sid of rec.sessionIds) {
    for (const sessions of groupsByCwd.values()) {
      const hit = sessions.find((s) => s.id === sid);
      if (hit && hit.createdAt > newest) newest = hit.createdAt;
    }
  }
  rank.set(id, newest);
}
state.global.workspaceIds = [...kept.keys()].sort((a, b) => rank.get(b) - rank.get(a));
state.tables.workspaces = Object.fromEntries(kept);
fs.writeFileSync(WORKSPACE_FILE, JSON.stringify(state, null, 2) + "\n");

console.log("\nworkspaces after consolidation:", kept.size);
for (const id of state.global.workspaceIds) {
  const rec = kept.get(id);
  console.log(`  ${String(rec.sessionIds.length).padStart(4)}  ${rec.path}`);
}
