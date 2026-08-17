// Codex session extractor
// Usage:
//   node extract.mjs                 -> list recent sessions
//   node extract.mjs <id|title|path> -> dump matching session(s) to markdown
//   node extract.mjs list --all      -> list all sessions
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const HOME = 'C:/Users/ghost/.codex';
const OUT_DIR = 'D:/work/opc-deepseek-harness/codex_inspect/exports';
const args = process.argv.slice(2);

function toLocal(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleString('zh-CN', { hour12: false });
}

// Load thread metadata from sqlite
function loadThreads() {
  const db = new DatabaseSync(join(HOME, 'state_5.sqlite'), { readOnly: true });
  const rows = db.prepare('SELECT * FROM threads ORDER BY recency_at DESC').all();
  db.close();
  return rows;
}

function resolveRolloutPath(p) {
  return p.replace(/^\\\\\?\\/, '');
}

function normDate(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function listSessions(all) {
  const threads = loadThreads();
  const rows = all ? threads : threads.slice(0, 40);
  console.log(`\n共 ${threads.length} 个会话${all ? '' : '，显示最近 40 个'}：\n`);
  for (const t of rows) {
    const path = resolveRolloutPath(t.rollout_path || '');
    const exists = existsSync(path);
    const size = exists ? `${(statSync(path).size / 1024).toFixed(0)}KB` : 'missing';
    console.log(
      `${normDate(t.updated_at_ms || t.updated_at * 1000)}  ${(t.title || t.first_user_message || '').slice(0, 46).padEnd(46)}  ${size.padStart(8)}  ${exists ? '✓' : '✗'}  ${t.id}`
    );
  }
}

// Extract a transcript from a rollout file
function extractTranscript(path) {
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  const msgs = [];
  let meta = null;
  for (const ln of lines) {
    let o; try { o = JSON.parse(ln); } catch { continue; }
    const p = o.payload || {};
    if (o.type === 'session_meta') {
      meta = {
        session_id: p.id || p.session_id,
        cwd: p.cwd,
        model_provider: p.model_provider,
        cli_version: p.cli_version,
        created: p.timestamp,
      };
    } else if (o.type === 'event_msg') {
      if (p.type === 'user_message') {
        msgs.push({ role: 'user', text: p.message || '', ts: o.timestamp });
      } else if (p.type === 'agent_message') {
        msgs.push({ role: 'assistant', text: p.message || '', phase: p.phase, ts: o.timestamp });
      }
    }
  }
  return { meta, msgs };
}

function dumpSession(thread) {
  const path = resolveRolloutPath(thread.rollout_path);
  if (!existsSync(path)) {
    console.log(`!! 文件不存在：${path}`);
    return null;
  }
  const { meta, msgs } = extractTranscript(path);
  const title = (thread.title || thread.first_user_message || meta?.session_id || 'untitled')
    .replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
  const id = thread.id;
  const outPath = join(OUT_DIR, `${normDate(thread.updated_at_ms || thread.updated_at * 1000).replace(/[: ]/g, '-')}_${title}.md`);

  mkdirSync(OUT_DIR, { recursive: true });
  const md = [];
  md.push(`# ${thread.title || thread.first_user_message || 'Codex Session'}`);
  md.push('');
  md.push(`- **session id**: \`${id}\``);
  md.push(`- **cwd**: \`${thread.cwd || meta?.cwd || ''}\``);
  md.push(`- **model**: \`${thread.model || '?'}\` (provider: ${thread.model_provider || meta?.model_provider || '?'})`);
  md.push(`- **created**: ${meta?.created ? toLocal(meta.created) : ''}`);
  md.push(`- **updated**: ${toLocal(thread.updated_at_ms || thread.updated_at * 1000)}`);
  md.push(`- **messages**: ${msgs.filter((m) => m.role === 'user').length} user / ${msgs.filter((m) => m.role === 'assistant').length} assistant`);
  md.push('');
  md.push('---');
  md.push('');

  for (const m of msgs) {
    if (m.role === 'user') {
      md.push(`## 👤 User`);
    } else {
      md.push(`## 🤖 Assistant${m.phase === 'commentary' ? ' (commentary)' : ''}`);
    }
    md.push('');
    md.push(String(m.text || '(empty)').trim());
    md.push('');
  }

  writeFileSync(outPath, md.join('\n'), 'utf8');
  return { outPath, meta, msgs };
}

function findThreads(query) {
  const threads = loadThreads();
  const q = query.toLowerCase();
  // exact id match first
  let hits = threads.filter((t) => t.id === query);
  if (!hits.length) hits = threads.filter((t) => (t.id || '').toLowerCase().includes(q));
  if (!hits.length) hits = threads.filter((t) =>
    (t.title || '').toLowerCase().includes(q) || (t.first_user_message || '').toLowerCase().includes(q));
  return hits;
}

// main
if (!args.length || args[0] === 'list') {
  listSessions(args.includes('--all'));
} else {
  const q = args.join(' ');
  const hits = findThreads(q);
  if (!hits.length) {
    console.log(`没有找到匹配 "${q}" 的会话。用 \`node extract.mjs\` 查看列表。`);
    process.exit(1);
  }
  console.log(`匹配到 ${hits.length} 个会话：`);
  for (const h of hits) console.log(`  ${normDate(h.updated_at_ms || h.updated_at * 1000)}  ${h.title || h.first_user_message}  ${h.id}`);
  console.log('');
  for (const h of hits.slice(0, 10)) {
    const r = dumpSession(h);
    if (r) {
      console.log(`已导出：${r.outPath}`);
      console.log(`  user=${r.msgs.filter((m) => m.role === 'user').length} assistant=${r.msgs.filter((m) => m.role === 'assistant').length}`);
    }
  }
}
