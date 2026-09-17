'use strict';
/* The starter set must be internally consistent: every practice and goal
   names an area that exists, every cadence parses, every name is a legal
   filename, orders are a clean 1..n, and the whole thing survives a
   frontmatter round trip. */
const assert = require('node:assert');
const { SEED_AREAS, SEED_PRACTICES, SEED_GOALS, SEED_EVENTS } = require('../src/seed');
const { parseCadence } = require('../src/model');
const { buildNote, parseFrontmatter, safeName } = require('../src/markdown');
const { WHEN } = require('../src/constants');

const areaNames = new Set(SEED_AREAS.map(a => a.name));
assert.deepStrictEqual(SEED_AREAS.map(a => a.order), SEED_AREAS.map((_, i) => i + 1), 'orders 1..n');

for (const p of SEED_PRACTICES) {
  assert.ok(areaNames.has(p.area), `${p.name}: area ${p.area} exists`);
  assert.ok(parseCadence(p.cadence), `${p.name}: cadence ${p.cadence} parses`);
  assert.ok(!p.when || WHEN.includes(p.when), `${p.name}: when ${p.when}`);
  assert.strictEqual(safeName(p.name), p.name, `${p.name}: legal filename`);
  const text = buildNote({ rhythm: 'practice', area: p.area, cadence: p.cadence, when: p.when, minutes: p.minutes }, p.body);
  const { fm } = parseFrontmatter(text);
  assert.strictEqual(fm.cadence, p.cadence);
  assert.strictEqual(String(fm.minutes), String(p.minutes));
}
for (const g of SEED_GOALS) {
  assert.ok(areaNames.has(g.area), `${g.name}: area`);
  assert.ok(/^\d{4}-\d{2}(-\d{2})?$/.test(g.horizon), `${g.name}: horizon`);
  assert.ok(g.next, `${g.name}: has a next step`);
  const { fm } = parseFrontmatter(buildNote({ rhythm: 'goal', area: g.area, horizon: g.horizon, status: g.status, next: g.next }, g.body));
  assert.strictEqual(fm.horizon, g.horizon, 'horizon survives bare');
  assert.strictEqual(fm.next, g.next);
}
for (const e of SEED_EVENTS) assert.ok(areaNames.has(e.area));

const names = SEED_PRACTICES.map(p => p.name.toLowerCase());
assert.strictEqual(new Set(names).size, names.length, 'no case-folded duplicate practice names');
console.log(`seed OK (${SEED_AREAS.length} areas, ${SEED_PRACTICES.length} practices, ${SEED_GOALS.length} goals)`);
