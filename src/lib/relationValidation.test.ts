import { describe, expect, it } from 'vitest';
import { addRelation, makePerson, makeTree, validateTree, type Relation, type Tree } from './model';

const treeOf = (count: number): Tree => ({
  ...makeTree(),
  people: Array.from({ length: count }, (_, i) => ({ ...makePerson(`P${i}`), id: `p${i}` })),
});
const parent = (id: string, parentId: string, childId: string): Relation => ({
  id,
  type: 'parent',
  parentId,
  childId,
  kind: 'biological',
});
const partner = (id: string, personA: string, personB: string): Relation => ({
  id,
  type: 'partner',
  personA,
  personB,
  status: 'current',
  union: 'married',
});
const unassigned = (id: string, personA: string, personB: string): Relation => ({
  id,
  type: 'unassigned',
  personA,
  personB,
  sourceHandle: 'right',
  targetHandle: 'left',
});
/** Parent links added from the bottom of the chain upward, the slowest order to check one by one. */
const chain = (count: number) =>
  Array.from({ length: count - 1 }, (_, i) => {
    const child = count - 1 - i;
    return parent(`r${i}`, `p${child - 1}`, `p${child}`);
  });
const validateWith = (relations: unknown[], people = 4) =>
  validateTree({ ...treeOf(people), relations });
const outcome = (run: () => Tree) => {
  try {
    return { relations: run().relations };
  } catch (error) {
    return { error: (error as Error).message };
  }
};

describe('validateTree relationships', () => {
  it('validates a worst-case 2000-person chain quickly', () => {
    const relations = chain(2000);
    const started = performance.now();
    expect(validateWith(relations, 2000).relations).toEqual(relations);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('validates the maximum number of relationships quickly', () => {
    const relations = Array.from({ length: 20_000 }, (_, i) => {
      const parentIndex = i % 1000;
      return parent(`r${i}`, `p${parentIndex}`, `p${parentIndex + 1 + Math.floor(i / 1000)}`);
    });
    const started = performance.now();
    expect(validateWith(relations, 2000).relations).toHaveLength(20_000);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('rejects more relationships than the cap', () => {
    expect(() =>
      validateWith(Array.from({ length: 20_001 }, (_, i) => partner(`r${i}`, 'p0', 'p1'))),
    ).toThrow('This file contains too many relationships.');
  });

  it('rejects a cycle that closes a long chain', () => {
    expect(() => validateWith([...chain(2000), parent('last', 'p1999', 'p0')], 2000)).toThrow(
      'That connection would create an ancestry cycle.',
    );
  });

  it.each([
    ['self links', [parent('a', 'p0', 'p0')], 'A person cannot be linked to themselves.'],
    [
      'duplicate parents',
      [parent('a', 'p0', 'p1'), parent('b', 'p0', 'p1')],
      'That parent connection already exists.',
    ],
    [
      'duplicate partners in either order',
      [partner('a', 'p0', 'p1'), partner('b', 'p1', 'p0')],
      'That partner connection already exists.',
    ],
    [
      'an unassigned link beside another link',
      [partner('a', 'p0', 'p1'), unassigned('b', 'p1', 'p0')],
      'A connection between these people already exists.',
    ],
    [
      'a two-person cycle',
      [parent('a', 'p0', 'p1'), parent('b', 'p1', 'p0')],
      'That connection would create an ancestry cycle.',
    ],
    [
      'a repeated relationship ID',
      [partner('a', 'p0', 'p1'), partner('a', 'p2', 'p3')],
      'This file contains an invalid relationship.',
    ],
    [
      'a link to a missing person',
      [parent('a', 'p0', 'nobody')],
      'A parent relationship refers to a missing person or has an invalid type.',
    ],
  ])('rejects %s with the existing message', (_, relations, message) => {
    expect(() => validateWith(relations)).toThrow(message);
  });

  it('reports an earlier cycle before a later invalid record', () => {
    expect(() =>
      validateWith([parent('a', 'p0', 'p1'), parent('b', 'p1', 'p0'), { id: 'c', type: 'nope' }]),
    ).toThrow('That connection would create an ancestry cycle.');
  });

  it('reports an earlier invalid record before a later cycle', () => {
    expect(() =>
      validateWith([parent('a', 'p0', 'p1'), { id: 'b', type: 'nope' }, parent('c', 'p1', 'p0')]),
    ).toThrow('This file contains an unknown relationship type.');
  });

  it('keeps older files that pair partner and parent links on two people', () => {
    const relations = [partner('a', 'p0', 'p1'), parent('b', 'p0', 'p1')];
    expect(validateWith(relations).relations).toEqual(relations);
  });

  it('does not confuse person IDs that join into the same text', () => {
    const tree = treeOf(3);
    tree.people[0].id = 'a';
    tree.people[1].id = 'a","b';
    tree.people[2].id = 'b';
    const relations = [unassigned('r1', 'a', 'a","b'), unassigned('r2', 'a","b', 'b')];
    expect(validateTree({ ...tree, relations }).relations).toEqual(relations);
  });

  it('matches adding each relationship one by one', () => {
    let seed = 42;
    const next = (limit: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % limit;
    };
    const people = 6;
    for (let round = 0; round < 500; round++) {
      const relations = Array.from({ length: next(10) }, (_, i) => {
        const [a, b] = [`p${next(people)}`, `p${next(people)}`];
        const kind = next(3);
        return kind === 0
          ? parent(`r${i}`, a, b)
          : kind === 1
            ? partner(`r${i}`, a, b)
            : unassigned(`r${i}`, a, b);
      });
      const tree = treeOf(people);
      const oneByOne = () =>
        relations.reduce(
          (current, relation) => addRelation(current, relation, { allowPartnerParent: true }),
          tree,
        );
      expect(outcome(() => validateTree({ ...tree, relations }))).toEqual(outcome(oneByOne));
    }
  });
});
