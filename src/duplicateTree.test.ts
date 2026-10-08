import { afterEach, describe, expect, it, vi } from 'vitest';
import { duplicateTree, makePerson, makeTree, type Tree } from './model';

afterEach(() => vi.restoreAllMocks());

describe('local tree duplication', () => {
  it('preserves all content and references with a new document identity and timestamp', () => {
    const a = {
      ...makePerson('Ada', -200, 50),
      notes: 'Family notes',
      portrait: 'data:image/png;base64,portrait',
      born: { precision: 'year' as const, year: 1900 },
    };
    const b = makePerson('Bea', 250, 400);
    const tree: Tree = {
      ...makeTree('History'),
      version: 1,
      updatedAt: 1,
      people: [a, b],
      homePersonId: a.id,
      relations: [
        { id: 'parent', type: 'parent', parentId: a.id, childId: b.id, kind: 'adoptive' },
      ],
      viewport: { x: -300, y: 200, zoom: 0.5 },
    };
    const before = structuredClone(tree);
    vi.spyOn(Date, 'now').mockReturnValue(123456);
    const copy = duplicateTree(tree);
    expect(copy.id).not.toBe(tree.id);
    expect(copy).toEqual({
      ...tree,
      version: 2,
      id: copy.id,
      name: 'History (copy)',
      updatedAt: 123456,
    });
    expect(tree).toEqual(before);
    copy.people[0].notes = 'Different notes';
    copy.people[0].born = { precision: 'unknown' };
    copy.viewport.x = 999;
    copy.relations[0].id = 'different relation';
    expect(tree).toEqual(before);
    expect(duplicateTree(tree).id).not.toBe(copy.id);
  });

  it('copies empty trees without inventing a home person', () => {
    const tree = makeTree('Empty');
    const copy = duplicateTree(tree);
    expect(copy.people).toEqual([]);
    expect(copy.relations).toEqual([]);
    expect(copy.homePersonId).toBeNull();
    expect(copy.name).toBe('Empty (copy)');
  });
});
