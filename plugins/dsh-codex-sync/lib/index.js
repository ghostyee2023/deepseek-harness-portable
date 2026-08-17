// dsh-codex-sync
// Syncs local Codex conversations into DeepSeek Harness.
//
// - Auto-detects the Codex home (config.codexHome, $CODEX_HOME, ~/.codex) and
//   reads threads from state_5.sqlite plus rollout-*.jsonl files.
// - Writes harness session artifacts (header frame + event frame, validated
//   message ids/sources) and registers workspaces through the registry
//   service, so imported sessions appear under the right directory right away.
// - Command: /codex-sync [status|detect|list|sync [all|recent:N|<id>]]

import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { zstdCompressSync, constants as zstdConstants } from 'node:zlib';
import { homedir } from 'node:os';

export const name = 'codex-sync';
export const inject = ['commands', 'workspaceRegistry'];

const SESSION_FORMAT_VERSION = 0;
const SCRATCH_RE = /[\\/]Documents[\\/]Codex/i;

// ---------------------------------------------------------------------------
// Codex home detection
// ---------------------------------------------------------------------------

function codexHomeCandidates(configCodexHome) {
  const out = [];
  if (configCodexHome) out.push(configCodexHome);
  if (process.env.CODEX_HOME) out.push(process.env.CODEX_HOME);
  out.push(join(homedir(), '.codex'));
  return out;
}

function detectCodex(configCodexHome) {
  for (const home of codexHomeCandidates(configCodexHome)) {
    const db = join(home, 'state_5.sqlite');
    if (existsSync(db)) return { home, hasDb: true };
  }
  for (const home of codexHomeCandidates(configCodexHome)) {
    if (existsSync(join(home, 'sessions'))) return { home, hasDb: false };
  }
  return null;
}

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh');
}

// ---------------------------------------------------------------------------
// Harness artifact encoding (mirrors dsh-session-persistence-jsonl)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Codex reading
// ---------------------------------------------------------------------------

async function loadThreads(dbPath) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare('SELECT * FROM threads ORDER BY recency_at DESC').all();
  } finally {
    db.close();
  }
}

function resolveRollout(p) {
  return (p || '').replace(/^\\\\\?\\/, '');
}

function normalizeCwd(cwd) {
  let c = cwd.replace(/^\\\\\?\\/, '');
  c = c.replace(/\//g, '\\');
  if (!cwd || !existsSync(c) || SCRATCH_RE.test(c)) {
    // Codex scratch chats (or vanished directories) go to one tidy workspace
    const dir = join(dshHome(), 'codex-imports');
    mkdirSync(dir, { recursive: true });
    return dir;
  }
  return c;
}

function toMs(v) {
  if (typeof v === 'number') return v;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : Date.now();
}

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
      meta = { id: p.id || p.session_id, cwd: p.cwd, createdAt: toMs(p.timestamp) };
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
      cur = { user: null, assistants: [m] };
    }
  }
  if (cur) turns.push(cur);
  return turns;
}

function buildSession(thread, meta, turns, modelByTurn) {
  const id = `session-import-${meta.id || thread.id}`;
  const cwd = normalizeCwd(thread.cwd || meta.cwd);
  const createdAt = meta.createdAt || thread.created_at_ms || thread.created_at * 1000 || Date.now();

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

  all.push({
    type: 'session/end-seed',
    seq: all.length,
    time: (all[all.length - 1]?.time || createdAt) + 1,
    data: {},
  });

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

// ---------------------------------------------------------------------------
// Import + workspace registration
// ---------------------------------------------------------------------------

async function registerWorkspace(ctx, cwd, sessionId) {
  try {
    await ctx.workspaceRegistry.sessionKnown(sessionId);
    const ws = await ctx.workspaceRegistry.create(cwd, basename(cwd));
    await ws.attachSession(sessionId);
    return true;
  } catch (error) {
    ctx.logger?.warn?.(`[codex-sync] workspace attach failed for ${sessionId}: ${error?.message}`);
    return false;
  }
}

async function importThread(ctx, thread, sessionsRoot) {
  const rolloutPath = resolveRollout(thread.rollout_path);
  if (!existsSync(rolloutPath)) return { status: 'missing-rollout' };
  const { meta, msgs, modelByTurn } = extractMessages(rolloutPath);
  if (!msgs.length) return { status: 'no-messages' };
  const rawCwd = (thread.cwd || meta.cwd || '').replace(/^\\\\\?\\/, '');
  if (SCRATCH_RE.test(rawCwd)) return { status: 'scratch-skipped' };
  const turns = groupTurns(msgs);
  const s = buildSession(thread, meta || {}, turns, modelByTurn);
  const dir = join(sessionsRoot, projectKey(s.cwd), encodeSegment(s.id));
  const file = join(dir, 'session.jsonl.zstd');
  if (existsSync(file)) return { status: 'exists' };
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, serialize(s.header, s.events));
  await registerWorkspace(ctx, s.cwd, s.id);
  return { status: 'imported', id: s.id, cwd: s.cwd, title: s.title, turns: turns.length };
}

function selectThreads(threads, selection) {
  if (!selection || selection === 'all') return threads;
  if (/^recent:(\d+)$/i.test(selection)) {
    const n = parseInt(selection.slice(7), 10) || 10;
    return threads.slice(0, n);
  }
  const q = selection.toLowerCase();
  return threads.filter((t) =>
    String(t.id).toLowerCase() === q ||
    String(t.id).toLowerCase().includes(q) ||
    String(t.title || '').toLowerCase().includes(q) ||
    String(t.first_user_message || '').toLowerCase().includes(q));
}

async function runSync(ctx, cfg, selection) {
  const found = detectCodex(cfg.codexHome);
  if (!found) {
    return { kind: 'error', text: `未找到 Codex 数据目录（查找过: ${codexHomeCandidates(cfg.codexHome).join(', ')}）。可用配置 codexHome 指定路径。` };
  }
  if (!found.hasDb) {
    return { kind: 'error', text: `找到 ${found.home}，但没有 state_5.sqlite（无法读取线程索引）。` };
  }
  let threads;
  try {
    threads = await loadThreads(join(found.home, 'state_5.sqlite'));
  } catch (error) {
    return { kind: 'error', text: `读取 Codex 数据库失败：${error?.message}` };
  }
  const selected = selectThreads(threads, selection);
  if (!selected.length) return { kind: 'error', text: `没有匹配 "${selection || 'all'}" 的 Codex 会话。` };

  const sessionsRoot = join(dshHome(), 'sessions');
  const lines = [`正在导入 ${selected.length} 个 Codex 会话 -> ${sessionsRoot}`];
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  const pendingRegistration = [];
  for (const t of selected) {
    try {
      const r = await importThread(ctx, t, sessionsRoot);
      if (r.status === 'imported') {
        imported++;
        lines.push(`  导入 ${r.id} (${r.title || '无标题'}) @ ${r.cwd}`);
        pendingRegistration.push({ cwd: r.cwd, id: r.id });
      } else if (r.status === 'exists') {
        skipped++;
      } else if (r.status === 'scratch-skipped') {
        lines.push(`  跳过草稿会话 ${t.id}（Documents/Codex）`);
      } else {
        failed++;
        lines.push(`  跳过 ${t.id}：${r.status}`);
      }
    } catch (error) {
      failed++;
      lines.push(`  失败 ${t.id}: ${error?.message}`);
    }
  }
  // retry workspace registration once for any session that failed to attach
  if (pendingRegistration.length) {
    const stillPending = [];
    for (const { cwd, id } of pendingRegistration) {
      if (!(await registerWorkspace(ctx, cwd, id))) stillPending.push(id);
    }
    if (stillPending.length) {
      lines.push(`  工作区注册未完成（可稍后再跑 /codex-sync sync）：${stillPending.join(', ')}`);
    }
  }
  lines.push(`完成：导入 ${imported}，已存在 ${skipped}，失败 ${failed}。刷新左侧列表即可看到。`);
  return { kind: 'success', text: lines.join('\n') };
}

function detectReport(cfg) {
  const found = detectCodex(cfg.codexHome);
  const lines = [];
  if (found) {
    lines.push(`Codex 目录：${found.home}${found.hasDb ? '（含 state_5.sqlite）' : '（无数据库，只有 sessions）'}`);
  } else {
    lines.push(`未找到 Codex（查找过: ${codexHomeCandidates(cfg.codexHome).join(', ')}）`);
  }
  lines.push(`Harness 数据目录：${dshHome()}`);
  return { kind: 'success', text: lines.join('\n') };
}

async function listReport(cfg) {
  const found = detectCodex(cfg.codexHome);
  if (!found || !found.hasDb) return { kind: 'error', text: '未找到 Codex 数据库，无法列出会话。' };
  let threads;
  try {
    threads = await loadThreads(join(found.home, 'state_5.sqlite'));
  } catch (error) {
    return { kind: 'error', text: `读取失败：${error?.message}` };
  }
  const lines = [`共 ${threads.length} 个 Codex 会话：`];
  for (const t of threads.slice(0, 20)) {
    const p = resolveRollout(t.rollout_path);
    lines.push(`  ${(t.title || t.first_user_message || '').slice(0, 40).padEnd(40)} ${existsSync(p) ? 'ok ' : 'MISS'} ${t.id}`);
  }
  if (threads.length > 20) lines.push(`  ... 还有 ${threads.length - 20} 个`);
  return { kind: 'success', text: lines.join('\n') };
}

const HELP_TEXT = [
  '用法: /codex-sync [status|detect|list|sync [all|recent:N|<id>]]',
  '  status           显示 Codex / Harness 状态',
  '  detect           查找本机 Codex 数据目录',
  '  list             列出最近的 Codex 会话',
  '  sync             同步最近 10 个（默认）',
  '  sync all         同步全部',
  '  sync recent:N    同步最近 N 个',
  '  sync <id|关键字>  同步匹配的会话',
].join('\n');

async function handleCommand(ctx, cfg, invocation) {
  const raw = (invocation.rawInput || '').trim();
  const parts = raw.split(/\s+/).filter(Boolean);
  const sub = (parts[0] || 'status').toLowerCase();
  try {
    switch (sub) {
      case 'status':
      case 'detect':
        return detectReport(cfg);
      case 'list':
        return await listReport(cfg);
      case 'sync':
        return await runSync(ctx, cfg, parts[1] || `recent:${cfg.defaultCount}`);
      default:
        return { kind: 'error', text: HELP_TEXT };
    }
  } catch (error) {
    return { kind: 'error', text: `codex-sync 出错：${error?.message}` };
  }
}

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------

export function apply(ctx, config = {}) {
  const cfg = {
    codexHome: config.codexHome || '',
    defaultCount: config.defaultCount || 10,
    autoSyncOnStartup: config.autoSyncOnStartup === true,
  };
  ctx.commands.register({
    name: 'codex-sync',
    description: 'sync local Codex conversations into this harness',
    input: { hint: '[status|detect|list|sync [all|recent:N|<id>]]' },
    handler: (invocation) => handleCommand(ctx, cfg, invocation),
  });
  if (cfg.autoSyncOnStartup) {
    setTimeout(() => {
      runSync(ctx, cfg, `recent:${cfg.defaultCount}`)
        .then((r) => ctx.logger?.info?.(`[codex-sync] ${r.text}`))
        .catch((error) => ctx.logger?.warn?.(`[codex-sync] ${error?.message}`));
    }, 1500);
  }
}
