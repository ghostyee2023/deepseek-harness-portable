import { DatabaseSync } from 'node:sqlite';

const p = 'C:/Users/ghost/.codex/state_5.sqlite';
const db = new DatabaseSync(p, { readOnly: true });

// threads schema
const cols = db.prepare("PRAGMA table_info('threads')").all();
console.log('=== threads columns ===');
for (const c of cols) console.log(`${c.cid} ${c.name} ${c.type} notnull=${c.notnull}`);

// sample row (latest)
console.log('\n=== latest 3 threads ===');
const rows = db.prepare("SELECT * FROM threads ORDER BY updated_at DESC LIMIT 3").all();
for (const r of rows) {
  console.log(JSON.stringify(r).slice(0, 1200));
  console.log('---');
}

db.close();
