import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.jsonl')) out.push(p);
  }
}
const files = [];
walk('C:/Users/ghost/.codex/sessions', files);
files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
const f = files[0];

const lines = readFileSync(f, 'utf8').split('\n').filter(Boolean);
const evTypes = {}, riTypes = {}, roles = {};
for (const ln of lines) {
  let o; try { o = JSON.parse(ln); } catch { continue; }
  const p = o.payload || {};
  if (o.type === 'event_msg') evTypes[p.type] = (evTypes[p.type] || 0) + 1;
  if (o.type === 'response_item') { riTypes[p.type] = (riTypes[p.type] || 0) + 1; if (p.role) roles[p.role] = (roles[p.role] || 0) + 1; }
}
console.log('event_msg types:', JSON.stringify(evTypes, null, 2));
console.log('response_item types:', JSON.stringify(riTypes, null, 2));
console.log('response_item roles:', JSON.stringify(roles, null, 2));

// Show one sample of each event_msg type
const seen = new Set();
for (const ln of lines) {
  let o; try { o = JSON.parse(ln); } catch { continue; }
  const p = o.payload || {};
  if (o.type === 'event_msg' && !seen.has(p.type)) {
    seen.add(p.type);
    console.log(`\n--- event_msg[${p.type}] ---`);
    console.log(JSON.stringify(o).slice(0, 500));
  }
}
