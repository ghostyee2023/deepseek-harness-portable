import { DatabaseSync } from 'node:sqlite';

const dbs = [
  'C:/Users/ghost/.codex/state_5.sqlite',
  'C:/Users/ghost/.codex/logs_2.sqlite',
  'C:/Users/ghost/.codex/memories_1.sqlite',
  'C:/Users/ghost/.codex/goals_1.sqlite',
  'C:/Users/ghost/.codex/queue_1.sqlite',
  'C:/Users/ghost/.codex/sqlite/codex-dev.db',
];

for (const p of dbs) {
  console.log('\n===== ' + p + ' =====');
  let db;
  try {
    db = new DatabaseSync(p, { readOnly: true });
  } catch (e) {
    console.log('OPEN ERROR: ' + e.message);
    continue;
  }
  try {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all();
    for (const t of tables) {
      let cnt = '';
      try {
        cnt = String(db.prepare(`SELECT COUNT(*) c FROM "${t.name}"`).get().c);
      } catch (e) {
        cnt = '?';
      }
      console.log(`TABLE ${t.name} (rows=${cnt})`);
    }
  } catch (e) {
    console.log('SCHEMA ERROR: ' + e.message);
  }
  db.close();
}
