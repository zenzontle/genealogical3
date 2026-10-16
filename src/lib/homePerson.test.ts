import { describe, expect, it } from 'vitest';
import {
  makePerson,
  makeTree,
  normalizeHomePerson,
  removePerson,
  setHomePerson,
  validateTree,
} from './model';
import { saveTree } from './storage';

describe('home designation and portable documents', () => {
  const a = makePerson('A'),
    b = makePerson('B');
  const tree = { ...makeTree(), people: [a, b] };
  it('starts unset and can be assigned, replaced, and cleared without mutating snapshots', () => {
    const first = setHomePerson(tree, a.id),
      replaced = setHomePerson(first, b.id),
      cleared = setHomePerson(replaced, null);
    expect(tree.homePersonId).toBeNull();
    expect(first.homePersonId).toBe(a.id);
    expect(replaced.homePersonId).toBe(b.id);
    expect(cleared.homePersonId).toBeNull();
    expect(first.viewport).toEqual(tree.viewport);
    expect(first.people).toEqual(tree.people);
    expect(structuredClone(first).homePersonId).toBe(a.id);
    expect(validateTree(JSON.parse(JSON.stringify(first)))).toEqual(first);
  });
  it('normalizes missing home fields in version 1 and 2 documents without choosing a person', () => {
    const { homePersonId: _home, ...legacy } = tree;
    expect(normalizeHomePerson(legacy).homePersonId).toBeNull();
    expect(validateTree({ ...legacy, version: 1 }).homePersonId).toBeNull();
    expect(validateTree(legacy)).toEqual(tree);
    expect(legacy).not.toHaveProperty('homePersonId');
  });
  it('rejects missing references and malformed values at import and persistence boundaries', () => {
    for (const homePersonId of ['missing', 1, false, {}, []])
      expect(() => validateTree({ ...tree, homePersonId })).toThrow(/home person/);
    expect(() => setHomePerson(tree, 'missing')).toThrow(/home person/);
    expect(() => saveTree({ ...tree, homePersonId: 'missing' })).toThrow(/home person/);
  });
  it('clears home and attached relationships atomically on deletion, leaving other snapshots intact', () => {
    const assigned = {
      ...setHomePerson(tree, a.id),
      relations: [
        {
          id: 'link',
          type: 'parent' as const,
          parentId: a.id,
          childId: b.id,
          kind: 'biological' as const,
        },
      ],
    };
    const deleted = removePerson(assigned, a.id);
    expect(deleted.homePersonId).toBeNull();
    expect(deleted.people).toEqual([b]);
    expect(deleted.relations).toEqual([]);
    expect(assigned.homePersonId).toBe(a.id);
    expect(assigned.people).toHaveLength(2);
    expect(removePerson(assigned, b.id).homePersonId).toBe(a.id);
  });
});
