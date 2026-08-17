import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const sessionsRoot = 'C:/Users/ghost/.codex/sessions';
// gather all rollout jsonl files
const out = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (name.endsWith('.jsonl')) out.push(p);
  }
}
walk(sessionsRoot);
out.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);

// pick the most recent file
const f = out[0];
console.log('file:', f, 'size:', statSync(f).size);

const lines = readFileSync(f, 'utf8').split('\n').filter(Boolean);
const typeCounts = {};
for (const ln of lines) {
  let o;
  try { o = JSON.parse(ln); } catch { continue; }
  const t = o.type || '(none)';
  typeCounts[t] = (typeCounts[t] || 0) + 1;
}
console.log('\n=== line types ===');
console.log(JSON.stringify(typeCounts, null, 2));

// show structure of each distinct type (one sample, truncated)
const seen = new Set();
console.log('\n=== sample per type ===');
for (const ln of lines) {
  let o;
  try { o = JSON.parse(ln); } catch { continue; }
  const t = o.type || '(none)';
  if (seen.has(t)) continue;
  seen.add(t);
  // summarize payload keys
  const payloadKeys = o.payload && typeof o.payload === 'object' ? Object.keys(o.payload) : null;
  console.log(`\n[${t}] keys=${JSON.stringify(Object.keys(o))} payloadKeys=${JSON.stringify(payloadKeys)}`);
  console.log(JSON.stringify(o).slice(0, 700));
}
