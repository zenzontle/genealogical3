import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  changeRelationRole,
  makePerson,
  makeTree,
  setHomePerson,
  setRelationParent,
  timestampDataChange,
  updatePerson,
  updateRelation,
  validateTree,
  type Relation,
} from './model';
import { setPersonName } from './personNames';

afterEach(() => vi.restoreAllMocks());

describe('meaningful tree timestamps', () => {
  it('captures one creation timestamp and advances under identical and backward clocks', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValueOnce(100).mockReturnValueOnce(101);
    const tree = makeTree();
    expect(tree).toMatchObject({ updatedAt: 100, dataUpdatedAt: 100 });
    expect(clock).toHaveBeenCalledOnce();
    const first = timestampDataChange({ ...tree, name: 'Edited' }, tree);
    expect(first).toMatchObject({ updatedAt: 101, dataUpdatedAt: 101 });
    clock.mockReturnValue(101);
    const second = timestampDataChange({ ...first, name: 'Again' }, first);
    expect(second.dataUpdatedAt).toBe(102);
    clock.mockReturnValue(50);
    const third = timestampDataChange(tree, second);
    expect(third).toMatchObject({ updatedAt: 50, dataUpdatedAt: 103 });
    expect(tree.dataUpdatedAt).toBe(100);
  });

  it.each([undefined, null, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '123'])(
    'rejects incoming dataUpdatedAt=%s without a fallback',
    (dataUpdatedAt) => {
      expect(() => validateTree({ ...makeTree(), dataUpdatedAt })).toThrow(/required fields/);
    },
  );

  it('allows the last safe increment and rejects exhaustion without changing either tree', () => {
    vi.spyOn(Date, 'now').mockReturnValue(100);
    const current = { ...makeTree(), dataUpdatedAt: Number.MAX_SAFE_INTEGER - 1 };
    const next = { ...current, name: 'Last edit' };
    const updated = timestampDataChange(next, current);
    expect(updated.dataUpdatedAt).toBe(Number.MAX_SAFE_INTEGER);
    expect(validateTree(JSON.parse(JSON.stringify(updated)))).toEqual(updated);
    const before = structuredClone(updated);
    expect(() => timestampDataChange({ ...updated, name: 'Too far' }, updated)).toThrow(
      /timestamp has reached its limit/,
    );
    expect(updated).toEqual(before);
    expect(current.dataUpdatedAt).toBe(Number.MAX_SAFE_INTEGER - 1);
    expect(next.dataUpdatedAt).toBe(Number.MAX_SAFE_INTEGER - 1);
  });

  it.each([0, 123, Number.MAX_SAFE_INTEGER])(
    'preserves valid incoming dataUpdatedAt=%s',
    (dataUpdatedAt) => {
      const tree = { ...makeTree(), dataUpdatedAt };
      expect(validateTree(tree)).toEqual(tree);
      expect(validateTree({ ...tree, version: 1 }).dataUpdatedAt).toBe(dataUpdatedAt);
    },
  );

  it('guards identical details, portraits, home and relationship values at mutation entry', () => {
    const a = makePerson('Alex'),
      b = makePerson('Taylor');
    const relation: Relation = {
      id: 'parent',
      type: 'parent',
      parentId: a.id,
      childId: b.id,
      kind: 'biological',
      displayRole: 'child',
    };
    const tree = { ...makeTree(), people: [a, b], homePersonId: a.id, relations: [relation] };
    expect(updatePerson(tree, structuredClone(a))).toBe(tree);
    expect(setPersonName(a, 'firstName', a.firstName)).toBe(a);
    expect(setPersonName({ ...a, name: 'Alex  ' }, 'lastName', a.lastName).name).toBe('Alex  ');
    expect(updatePerson(tree, { ...a, portrait: null })).toBe(tree);
    expect(updatePerson(tree, { ...a, born: { precision: 'unknown' } })).toBe(tree);
    expect(setHomePerson(tree, a.id)).toBe(tree);
    expect(setRelationParent(relation, a.id)).toBe(relation);
    expect(changeRelationRole(relation, b.id, 'parent-child')).toBe(relation);
    expect(updateRelation(tree, { ...relation })).toBe(tree);
    expect(updatePerson(tree, { ...a, notes: 'New details' })).not.toBe(tree);
    expect(updateRelation(tree, { ...relation, kind: 'adoptive' })).not.toBe(tree);
    expect(setHomePerson(tree, b.id)).not.toBe(tree);
  });
});
