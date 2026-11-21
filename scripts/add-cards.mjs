// Adds or updates cards from a batch file, then keeps questions.json ordered.
// Batch format: { "<id>": { "meta": { cat, topic, level, tags, q, also? }, "answer": { ...answer schema } } }
// Usage: node scripts/add-cards.mjs path/to/batch.json
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const qPath = join(root, "questions.json");
const data = JSON.parse(readFileSync(qPath, "utf8"));
const batch = JSON.parse(readFileSync(process.argv[2], "utf8"));
const cats = new Map(data.categories.map((c) => [c.id, c]));
const byId = new Map(data.questions.map((q) => [q.id, q]));

let added = 0, updated = 0;
for (const [id, { meta, answer }] of Object.entries(batch)) {
  if (!meta || !answer) throw new Error(`${id}: needs meta and answer`);
  const c = cats.get(meta.cat);
  if (!c) throw new Error(`${id}: unknown category ${meta.cat}`);
  if (!c.topics.includes(meta.topic)) c.topics.push(meta.topic);
  for (const t of meta.tags) if (!data.tags.includes(t)) throw new Error(`${id}: unknown tag ${t}`);
  const q = {
    id, cat: meta.cat, topic: meta.topic, level: meta.level, source: "mine",
    q: meta.q, also: meta.also || [], a: [answer.thesis], tags: meta.tags, legacy: [],
  };
  if (byId.has(id)) { Object.assign(byId.get(id), q); updated++; }
  else { data.questions.push(q); byId.set(id, q); added++; }
  writeFileSync(join(root, "answers", id + ".json"), JSON.stringify(answer, null, 2) + "\n");
}

// stable sort: category order, then topic order, then existing position
const catPos = new Map(data.categories.map((c, i) => [c.id, i]));
const pos = new Map(data.questions.map((q, i) => [q.id, i]));
data.questions.sort((x, y) =>
  catPos.get(x.cat) - catPos.get(y.cat) ||
  cats.get(x.cat).topics.indexOf(x.topic) - cats.get(y.cat).topics.indexOf(y.topic) ||
  pos.get(x.id) - pos.get(y.id));

writeFileSync(qPath, JSON.stringify(data, null, 2) + "\n");
console.log(`added ${added}, updated ${updated}, total ${data.questions.length}`);
