const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { zstdDecompressSync } = require("node:zlib");

const HOME =
  process.env.DSH_HOME || "D:\\work\\opc-deepseek-harness\\dist\\runtime\\dsh-home";
const SESSIONS = path.join(HOME, "sessions");
const WORKSPACE_FILE = path.join(HOME, "storages", "workspace.json");
const MAGIC = 4247762216;

function firstFrame(file) {
  const raw = fs.readFileSync(file);
  const ms = [];
  for (let i = 0; i + 4 <= raw.length; i++) {
    if (raw.readUInt32LE(i) === MAGIC) ms.push(i);
  }
  if (!ms.length) return null;
  return zstdDecompressSync(raw.subarray(ms[0], ms[1] || raw.length)).toString("utf8");
}

function headerOf(sessionDir) {
  const file = path.join(sessionDir, "session.jsonl.zstd");
  if (!fs.existsSync(file)) return null;
  const line = firstFrame(file)?.trim();
  if (!line) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

// group every persisted session by its header cwd
const groupsByCwd = new Map();
for (const ws of fs.readdirSync(SESSIONS, { withFileTypes: true })) {
  if (!ws.isDirectory()) continue;
  const wsDir = path.join(SESSIONS, ws.name);
  for (const s of fs.readdirSync(wsDir, { withFileTypes: true })) {
    if (!s.isDirectory()) continue;
    const header = headerOf(path.join(wsDir, s.name));
    const cwd = header && typeof header.cwd === "string" ? header.cwd : ws.name;
    if (!groupsByCwd.has(cwd)) groupsByCwd.set(cwd, []);
    groupsByCwd.get(cwd).push({
      id: s.name,
      createdAt: header && header.createdAt ? header.createdAt : 0,
    });
  }
}

const groups = [];
for (const [cwd, sessions] of groupsByCwd) {
  sessions.sort((a, b) => b.createdAt - a.createdAt);
  groups.push({ cwd, sessions });
}

const state = JSON.parse(fs.readFileSync(WORKSPACE_FILE, "utf8"));
const records = new Map(Object.entries(state.tables.workspaces));

for (const group of groups) {
  const key = group.cwd.toLowerCase();
  let match = null;
  for (const [id, rec] of records) {
    if (rec.path.toLowerCase() === key) {
      match = { id, rec };
      break;
    }
  }
  const ids = group.sessions.map((s) => s.id);
  if (match) {
    const rec = match.rec;
    const current = rec.sessionIds || [];
    const missing = ids.filter((id) => !current.includes(id));
    if (missing.length) {
      rec.sessionIds = [...current, ...missing];
      rec.updatedAt = new Date().toISOString();
      console.log(`ATTACH "${group.cwd}": +${missing.length} sessions`);
    } else {
      console.log(`OK "${group.cwd}": already accounted (${current.length})`);
    }
  } else {
    const id = crypto.randomUUID();
    const stamp = new Date(group.sessions[0].createdAt).toISOString();
    records.set(id, {
      path: group.cwd,
      title: path.basename(group.cwd),
      sessionIds: ids,
      createdAt: stamp,
      updatedAt: stamp,
    });
    console.log(`CREATE "${group.cwd}": ${ids.length} sessions`);
  }
}

// display order: newest workspace first (mirrors bootstrap)
const rank = new Map();
for (const [id, rec] of records) {
  let newest = Date.parse(rec.createdAt) || 0;
  for (const sid of rec.sessionIds || []) {
    for (const g of groups) {
      const hit = g.sessions.find((s) => s.id === sid);
      if (hit && hit.createdAt > newest) newest = hit.createdAt;
    }
  }
  rank.set(id, newest);
}
state.global.workspaceIds = [...records.keys()].sort((a, b) => rank.get(b) - rank.get(a));
state.tables.workspaces = Object.fromEntries(records);

fs.writeFileSync(WORKSPACE_FILE, JSON.stringify(state, null, 2) + "\n");
console.log("\nworkspaceIds:", state.global.workspaceIds.length);
for (const id of state.global.workspaceIds) {
  const rec = records.get(id);
  console.log(`  ${rec.path} (${rec.sessionIds.length} sessions)`);
}
