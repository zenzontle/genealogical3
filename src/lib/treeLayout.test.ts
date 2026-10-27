import { describe, expect, it } from 'vitest';
import { arrangeTree } from './treeLayout';
import { makePerson, makeTree, personCardSize, uid, type Person, type Relation } from './model';

const parent = (parentId: string, childId: string): Relation => ({
  id: uid(),
  type: 'parent',
  parentId,
  childId,
  kind: 'biological',
});
const partner = (personA: string, personB: string): Relation => ({
  id: uid(),
  type: 'partner',
  personA,
  personB,
  status: 'current',
  union: 'married',
});
const treeOf = (people: Person[], relations: Relation[], homePersonId: string | null = null) => ({
  ...makeTree(),
  people,
  relations,
  homePersonId,
});
const at = (tree: ReturnType<typeof treeOf>, person: Person) =>
  tree.people.find((p) => p.id === person.id)!;
const centerX = (p: Person) => p.x + personCardSize.width / 2;

// Scattered positions so the layout can't rely on the input already being tidy.
function family() {
  const mom = makePerson('Mom', 900, 40);
  const dad = makePerson('Dad', -300, 700);
  const kid1 = makePerson('Kid 1', 50, -400);
  const kid2 = makePerson('Kid 2', 400, 1200);
  const spouse = makePerson('Spouse', 1500, 500);
  const inLawMom = makePerson('In-law mom', 1600, -800);
  const grandkid = makePerson('Grandkid', -900, 0);
  const people = [mom, dad, kid1, kid2, spouse, inLawMom, grandkid];
  const relations = [
    partner(mom.id, dad.id),
    parent(mom.id, kid1.id),
    parent(dad.id, kid1.id),
    parent(mom.id, kid2.id),
    parent(dad.id, kid2.id),
    partner(kid2.id, spouse.id),
    parent(inLawMom.id, spouse.id),
    parent(kid2.id, grandkid.id),
    parent(spouse.id, grandkid.id),
  ];
  return { people, relations, mom, dad, kid1, kid2, spouse, inLawMom, grandkid };
}

describe('arranging a tree', () => {
  it('places generations in rows with partners side by side', () => {
    const f = family();
    const tree = arrangeTree(treeOf(f.people, f.relations));
    const y = (p: Person) => at(tree, p).y;
    expect(y(f.mom)).toBe(y(f.dad));
    expect(y(f.kid1)).toBe(y(f.kid2));
    expect(y(f.kid2)).toBe(y(f.spouse));
    // The in-law's parent sits one row above the in-law, beside the main ancestors.
    expect(y(f.inLawMom)).toBe(y(f.mom));
    expect(y(f.kid1)).toBeGreaterThan(y(f.mom) + personCardSize.height);
    expect(y(f.grandkid)).toBeGreaterThan(y(f.kid2) + personCardSize.height);
    const gap = Math.abs(at(tree, f.mom).x - at(tree, f.dad).x) - personCardSize.width;
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThanOrEqual(200);
  });

  it('centers children under their parents', () => {
    const f = family();
    const tree = arrangeTree(treeOf(f.people, f.relations));
    const couple = (centerX(at(tree, f.kid2)) + centerX(at(tree, f.spouse))) / 2;
    expect(centerX(at(tree, f.grandkid))).toBeCloseTo(couple, 0);
    const parents = (centerX(at(tree, f.mom)) + centerX(at(tree, f.dad))) / 2;
    const kids = [f.kid1, f.kid2].map((k) => centerX(at(tree, k)));
    expect(Math.min(...kids)).toBeLessThan(parents);
    expect(Math.max(...kids)).toBeGreaterThan(parents);
  });

  it('never overlaps cards, including across unconnected groups', () => {
    const f = family();
    const loner = makePerson('Loner', 0, 0);
    const pairA = makePerson('A', 10, 10);
    const pairB = makePerson('B', 20, 20);
    const tree = arrangeTree(
      treeOf([...f.people, loner, pairA, pairB], [...f.relations, partner(pairA.id, pairB.id)]),
    );
    for (const a of tree.people)
      for (const b of tree.people) {
        if (a === b) continue;
        const overlaps =
          Math.abs(a.x - b.x) < personCardSize.width && Math.abs(a.y - b.y) < personCardSize.height;
        expect(overlaps, `${a.name} overlaps ${b.name}`).toBe(false);
      }
  });

  it('keeps the home person in place', () => {
    const f = family();
    const tree = arrangeTree(treeOf(f.people, f.relations, f.kid2.id));
    expect(at(tree, f.kid2)).toMatchObject({ x: f.kid2.x, y: f.kid2.y });
  });

  it('keeps the top-left corner in place without a home person', () => {
    const f = family();
    const tree = arrangeTree(treeOf(f.people, f.relations));
    expect(Math.min(...tree.people.map((p) => p.x))).toBe(Math.min(...f.people.map((p) => p.x)));
    expect(Math.min(...tree.people.map((p) => p.y))).toBe(Math.min(...f.people.map((p) => p.y)));
  });

  it('returns the same tree when it is already arranged', () => {
    const f = family();
    const arranged = arrangeTree(treeOf(f.people, f.relations, f.mom.id));
    expect(arrangeTree(arranged)).toBe(arranged);
  });

  it('finishes on a parent cycle in invalid data', () => {
    const a = makePerson('A', 0, 0);
    const b = makePerson('B', 0, 300);
    const c = makePerson('C', 0, 600);
    const tree = arrangeTree(
      treeOf([a, b, c], [parent(a.id, b.id), parent(b.id, c.id), parent(c.id, a.id)]),
    );
    expect(at(tree, a).y).toBeLessThan(at(tree, b).y);
    expect(at(tree, b).y).toBeLessThan(at(tree, c).y);
  });

  it('leaves a tree with one person unchanged', () => {
    const tree = treeOf([makePerson('Solo', 40, 50)], []);
    expect(arrangeTree(tree)).toBe(tree);
  });
});
