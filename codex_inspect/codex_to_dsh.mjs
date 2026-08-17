// Codex -> DSH session importer
// Reads Codex CLI sessions (state_5.sqlite threads + rollout-*.jsonl) and writes
// valid DeepSeek Harness session artifacts under ~/.dsh/sessions.
// Target home is $DSH_HOME (default: the portable runtime home).
//
// Usage:
//   node codex_to_dsh.mjs list                 # list Codex sessions
//   node codex_to_dsh.mjs import <id|substr>   # import matching session(s)
//   node codex_to_dsh.mjs import recent:20     # import 20 most recent
//   node codex_to_dsh.mjs import all           # import all
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { zstdCompressSync, constants as zstdConstants } from 'node:zlib';
import { execFileSync } from 'node:child_process';

const CODEX_HOME = process.env.CODEX_HOME || 'C:/Users/ghost/.codex';
const DSH_HOME = process.env.DSH_HOME || 'D:/work/opc-deepseek-harness/dist/runtime/dsh-home';
const DSH_SESSIONS = join(DSH_HOME, 'sessions');
const SESSION_FORMAT_VERSION = 0;
const FALLBACK_CWD = 'D:/work/opc-deepseek-harness';

// ---- DSH format helpers (mirror of dsh-session-persistence-jsonl/format) ----
function encodeSegment(raw) {
  if (raw.length === 0) throw new Error('cannot encode an empty path segment');
  if (raw === '.') return '~002E';
  if (raw === '..') return '~002E~002E';
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) out += ch;
    else out += '~' + code.toString(16).toUpperCase().padStart(4, '0');
  }
  return out;
}
function projectKey(cwd) {
  let readable = '';
  let separatorRun = false;
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-';
      separatorRun = true;
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch;
      separatorRun = false;
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0');
      separatorRun = false;
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`;
}
function sessionDir(cwd, id) {
  return join(DSH_SESSIONS, projectKey(cwd), encodeSegment(id));
}
function zstdFrame(text) {
  return zstdCompressSync(Buffer.from(text, 'utf8'), {
    params: { [zstdConstants.ZSTD_c_checksumFlag]: 1 },
  });
}
function uuidFrom(sessionId, seq) {
  const h = createHash('sha256').update(sessionId + ':' + seq).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const hex = h.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// ---- Codex reading ----
function loadCodexThreads() {
  const db = new DatabaseSync(join(CODEX_HOME, 'state_5.sqlite'), { readOnly: true });
  const rows = db.prepare('SELECT * FROM threads ORDER BY recency_at DESC').all();
  db.close();
  return rows;
}
function resolveRollout(p) {
  return (p || '').replace(/^\\\\\?\\/, '');
}
function normalizeCwd(cwd) {
  if (!cwd) return FALLBACK_CWD;
  let c = cwd.replace(/^\\\\\?\\/, '');
  c = c.replace(/\//g, '\\');
  if (!existsSync(c)) return FALLBACK_CWD;
  return c;
}
function toMs(v) {
  if (typeof v === 'number') return v;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : Date.now();
}

// Extract ordered (ts, role, text) from a Codex rollout JSONL
function extractMessages(rolloutPath) {
  const lines = readFileSync(rolloutPath, 'utf8').split('\n').filter(Boolean);
  const out = [];
  let meta = null;
  const modelByTurn = new Map();
  for (const ln of lines) {
    let o;
    try { o = JSON.parse(ln); } catch { continue; }
    const p = o.payload || {};
    if (o.type === 'session_meta') {
      meta = {
        id: p.id || p.session_id,
        cwd: p.cwd,
        createdAt: toMs(p.timestamp),
      };
    } else if (o.type === 'turn_context') {
      if (p.turn_id && p.model) modelByTurn.set(p.turn_id, p.model);
    } else if (o.type === 'event_msg') {
      if (p.type === 'user_message') {
        const text = String(p.message || '').trim();
        if (text) out.push({ role: 'user', text, ts: toMs(o.timestamp), turnId: p.turn_id });
      } else if (p.type === 'agent_message') {
        const text = String(p.message || '').trim();
        if (text) out.push({ role: 'assistant', text, ts: toMs(o.timestamp), phase: p.phase, turnId: p.turn_id });
      }
    }
  }
  return { meta, msgs: out, modelByTurn };
}

// Group messages into turns (a user message starts a turn; assistant msgs follow)
function groupTurns(msgs) {
  const turns = [];
  let cur = null;
  for (const m of msgs) {
    if (m.role === 'user') {
      if (cur) turns.push(cur);
      cur = { user: m, assistants: [] };
    } else if (cur) {
      cur.assistants.push(m);
    } else {
      // assistant message with no preceding user — synthesize a turn
      cur = { user: null, assistants: [m] };
    }
  }
  if (cur) turns.push(cur);
  return turns;
}

// ---- DSH event construction ----
function buildSession(thread, meta, turns, modelByTurn) {
  const id = `session-import-${meta.id || thread.id}`;
  const cwd = normalizeCwd(thread.cwd || meta.cwd);
  const createdAt = meta.createdAt || thread.created_at_ms || thread.created_at * 1000 || Date.now();

  // Build turn events first (no seqs yet).
  const turnEvents = [];
  let turnNo = 0;
  for (const turn of turns) {
    turnNo += 1;
    const user = turn.user;
    const assistants = turn.assistants;
    const baseTs = user ? user.ts : (assistants[0]?.ts || createdAt);

    turnEvents.push({ type: 'turn/start', time: baseTs, data: { turn: turnNo } });
    turnEvents.push({ type: 'step/start', time: baseTs + 1, data: { turn: turnNo, step: 1 } });

    if (user) {
      turnEvents.push({
        type: 'user/message',
        time: user.ts,
        data: {
          content: [{ type: 'text', text: user.text }],
          source: { kind: 'user', rpcId: randomUUID(), clientTimeZone: 'Asia/Shanghai' },
          role: 'user',
        },
        surfaceOp: 'append',
      });
    }

    for (const a of assistants) {
      turnEvents.push({
        type: 'assistant/message',
        time: a.ts,
        data: {
          turn: turnNo,
          step: 1,
          message: { role: 'assistant', content: [{ type: 'text', text: a.text }] },
          _importModel: modelByTurn.get(a.turnId) || 'unknown',
        },
        surfaceOp: 'append',
      });
    }

    const endTs = (assistants[assistants.length - 1]?.ts || baseTs) + 1;
    turnEvents.push({ type: 'step/end', time: endTs, data: { turn: turnNo, step: 1 } });
    turnEvents.push({ type: 'turn/end', time: endTs + 1, data: { turn: turnNo, reason: { kind: 'completed' } } });
  }

  const title = (thread.title || thread.first_user_message || 'Codex 导入').replace(/\s+/g, ' ').trim().slice(0, 80);

  // Title is placed after the 3 policy events (indices 0..2), before turn events,
  // so a user/message at turnEvents index i lands at final seq 3 + 1 + i.
  const titleSeqTargets = [];
  turnEvents.forEach((e, i) => { if (e.type === 'user/message') titleSeqTargets.push(3 + 1 + i); });
  const titleEv = {
    type: 'session/title',
    time: createdAt + 2,
    data: { title, messageSeqs: titleSeqTargets.slice(0, 1), source: { kind: 'fallback' } },
  };

  const all = [
    { type: 'permission/preset', time: createdAt, data: { preset: 'workspace-write' } },
    { type: 'sandbox/mode', time: createdAt, data: { mode: 'workspace-write' } },
    { type: 'approval/policy', time: createdAt, data: { policy: 'ask' } },
    titleEv,
    ...turnEvents,
  ];
  all.forEach((e, i) => {
    e.seq = i;
    if (e.type === 'user/message' || e.type === 'assistant/message') {
      const m = e.type === 'user/message' ? e.data : e.data.message;
      m.id = uuidFrom(id, i);
      if (e.type === 'assistant/message') {
        m.source = { kind: 'model', provider: 'codex', model: e.data._importModel };
        delete e.data._importModel;
      }
    }
  });

  // session/end-seed marks the imported history as seed
  const endSeed = {
    type: 'session/end-seed',
    seq: all.length,
    time: (all[all.length - 1]?.time || createdAt) + 1,
    data: {},
  };
  all.push(endSeed);

  const header = {
    type: 'session',
    version: SESSION_FORMAT_VERSION,
    id,
    createdAt,
    cwd,
    delegationDepth: 0,
    agentPreset: 'standard',
  };

  return { id, cwd, header, events: all, title };
}

function serialize(header, events) {
  const headerLine = JSON.stringify(header) + '\n';
  const body = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
  return Buffer.concat([zstdFrame(headerLine), zstdFrame(body)]);
}

function importThread(thread) {
  const rolloutPath = resolveRollout(thread.rollout_path);
  if (!existsSync(rolloutPath)) {
    console.log(`SKIP ${thread.id}: rollout missing ${rolloutPath}`);
    return null;
  }
  const { meta, msgs, modelByTurn } = extractMessages(rolloutPath);
  if (!msgs.length) {
    console.log(`SKIP ${thread.id}: no messages`);
    return null;
  }
  const turns = groupTurns(msgs);
  const s = buildSession(thread, meta || {}, turns, modelByTurn);
  const dir = sessionDir(s.cwd, s.id);
  const file = join(dir, 'session.jsonl.zstd');
  if (existsSync(file)) {
    console.log(`SKIP ${s.id}: already exists`);
    return null;
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, serialize(s.header, s.events));
  const userN = msgs.filter((m) => m.role === 'user').length;
  const asstN = msgs.filter((m) => m.role === 'assistant').length;
  console.log(`OK  ${s.id}  turns=${turns.length} user=${userN} asst=${asstN}  ->  ${s.title}`);
  return { id: s.id, cwd: s.cwd, title: s.title, turns: turns.length };
}

// ---- CLI ----
const args = process.argv.slice(2);
const cmd = args[0];
const target = args[1];

const threads = loadCodexThreads();

if (cmd === 'list') {
  console.log(`共 ${threads.length} 个 Codex 会话：\n`);
  for (const t of threads) {
    const p = resolveRollout(t.rollout_path);
    console.log(`  ${(t.title || t.first_user_message || '').slice(0, 46).padEnd(46)}  ${existsSync(p) ? 'ok ' : 'MISS'}  ${t.id}`);
  }
} else if (cmd === 'import') {
  let selected = [];
  if (!target || target === 'all') selected = threads;
  else if (target.startsWith('recent:')) {
    const n = parseInt(target.slice(7), 10) || 20;
    selected = threads.slice(0, n);
  } else {
    const q = target.toLowerCase();
    selected = threads.filter((t) =>
      t.id === target ||
      (t.id || '').toLowerCase().includes(q) ||
      (t.title || '').toLowerCase().includes(q) ||
      (t.first_user_message || '').toLowerCase().includes(q));
  }
  if (!selected.length) {
    console.log(`没有匹配 "${target}" 的会话。`);
    process.exit(1);
  }
  console.log(`准备导入 ${selected.length} 个会话：`);
  let ok = 0;
  for (const t of selected) {
    const r = importThread(t);
    if (r) ok++;
  }
  console.log(`\n完成：成功导入 ${ok} 个，写入 ${DSH_SESSIONS}`);
  if (ok > 0) {
    console.log('注册工作区归属...');
    try {
      execFileSync(process.execPath, [join(import.meta.dirname, '..', 'fix-scripts', 'fix-workspaces.cjs')], {
        env: { ...process.env, DSH_HOME },
        stdio: 'inherit',
      });
    } catch (e) {
      console.log(`工作区注册失败：${e.message}（可稍后手动运行 node fix-scripts/fix-workspaces.cjs）`);
    }
  }
  console.log('提示：重启 DSH（或在 web 里刷新工作区）后，它们会出现在左侧列表。');
} else {
  console.log('用法: node codex_to_dsh.mjs [list|import <id|substr|recent:N|all>]');
}
