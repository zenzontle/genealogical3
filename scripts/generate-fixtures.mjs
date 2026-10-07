import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const output = new URL('../.perf/', import.meta.url);
mkdirSync(output, { recursive: true });
const portrait =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9kAAAAASUVORK5CYII=';
writeFileSync(new URL('portrait.png', output), Buffer.from(portrait.split(',')[1], 'base64'));
for (const count of [100, 300]) {
  const people = Array.from({ length: count }, (_, i) => ({
    id: randomUUID(),
    name: `Person ${i + 1}`,
    nickname: '',
    born: { precision: 'year', year: 1800 + i },
    died: { precision: 'unknown' },
    sex: '',
    notes: '',
    portrait,
    x: (i % 20) * 300,
    y: Math.floor(i / 20) * 220,
  }));
  const relations = people.slice(20).map((person, i) => ({
    id: randomUUID(),
    type: 'parent',
    parentId: people[i].id,
    childId: person.id,
    kind: 'unspecified',
  }));
  const tree = {
    version: 1,
    id: randomUUID(),
    name: `Performance ${count}`,
    people,
    relations,
    viewport: { x: 0, y: 0, zoom: 1 },
    updatedAt: Date.now(),
  };
  writeFileSync(new URL(`tree-${count}.json`, output), JSON.stringify(tree));
}
