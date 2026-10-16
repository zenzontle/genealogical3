import { describe, expect, it } from 'vitest';
import { connectorPoints, familyConnectors } from './familyConnectors';
import { makePerson, makeTree, personCardSize, type Tree } from './model';
import { treePreview } from './treePreviewLayout';

describe('static tree preview geometry', () => {
  it('has no geometry for an empty tree', () => {
    expect(treePreview(makeTree())).toBeNull();
  });

  it('fits a single person with padding regardless of the saved viewport', () => {
    const person = makePerson('Single', -500, -250);
    const tree = { ...makeTree(), people: [person], viewport: { x: 999, y: -999, zoom: 0.05 } };
    expect(treePreview(tree)).toEqual({
      paths: [],
      bounds: { x: -524, y: -274, width: 228, height: 184 },
    });
    expect(treePreview(tree)).toEqual(treePreview({ ...tree, viewport: { x: 0, y: 0, zoom: 1 } }));
  });

  it('includes disconnected people and negative coordinates without changing the saved tree', () => {
    const tree = {
      ...makeTree(),
      people: [makePerson('West', -1000, -500), makePerson('East', 1200, 700)],
    };
    const original = structuredClone(tree);
    const bounds = treePreview(tree)!.bounds;
    for (const person of tree.people) {
      expect(person.x).toBeGreaterThan(bounds.x);
      expect(person.y).toBeGreaterThan(bounds.y);
      expect(person.x + personCardSize.width).toBeLessThan(bounds.x + bounds.width);
      expect(person.y + personCardSize.height).toBeLessThan(bounds.y + bounds.height);
    }
    expect(tree).toEqual(original);
  });

  it('uses shared sibling bars and includes connector extents outside the person cards', () => {
    const a = makePerson('A', -350, 0),
      b = makePerson('B', 350, 0);
    const children = [makePerson('C', -300, 100), makePerson('D', 300, 100)];
    const tree: Tree = {
      ...makeTree(),
      people: [a, b, ...children],
      homePersonId: a.id,
      relations: [
        {
          id: 'partners',
          type: 'partner',
          personA: a.id,
          personB: b.id,
          status: 'current',
          union: 'married',
        },
        ...children.flatMap((child) =>
          [a, b].map((parent) => ({
            id: `${parent.id}:${child.id}`,
            type: 'parent' as const,
            parentId: parent.id,
            childId: child.id,
            kind: 'biological' as const,
          })),
        ),
      ],
    };
    const original = structuredClone(tree);
    const preview = treePreview(tree)!;
    expect(preview.paths.map((path) => path.id)).toEqual(['family:partners', 'partners']);
    for (const point of connectorPoints(
      familyConnectors(tree.people, tree.relations, personCardSize),
    )) {
      expect(point.x).toBeGreaterThan(preview.bounds.x);
      expect(point.x).toBeLessThan(preview.bounds.x + preview.bounds.width);
      expect(point.y).toBeGreaterThan(preview.bounds.y);
      expect(point.y).toBeLessThan(preview.bounds.y + preview.bounds.height);
    }
    expect(preview.paths[0].d).toContain('L');
    expect(tree).toEqual(original);
  });

  it('routes parent and unassigned links from their correct handles and bounds their paths', () => {
    const a = makePerson('Above', 0, -300),
      b = makePerson('Below', 300, 300);
    const tree: Tree = {
      ...makeTree(),
      people: [a, b],
      relations: [
        { id: 'parent', type: 'parent', parentId: a.id, childId: b.id, kind: 'guardian' },
        {
          id: 'unassigned',
          type: 'unassigned',
          personA: a.id,
          personB: b.id,
          sourceHandle: 'left',
          targetHandle: 'right',
        },
      ],
    };
    const preview = treePreview(tree)!;
    expect(preview.paths).toHaveLength(2);
    expect(preview.paths[0].d).toMatch(/^M90 -164/);
    expect(preview.paths[1].d).toMatch(/^M0 -232/);
    for (const path of preview.paths) {
      const values = path.d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
      for (let i = 0; i < values.length; i += 2) {
        expect(values[i]).toBeGreaterThan(preview.bounds.x);
        expect(values[i]).toBeLessThan(preview.bounds.x + preview.bounds.width);
        expect(values[i + 1]).toBeGreaterThan(preview.bounds.y);
        expect(values[i + 1]).toBeLessThan(preview.bounds.y + preview.bounds.height);
      }
    }
  });
});
