import { describe, expect, it } from 'vitest';
import {
  addRelation,
  changeRelationRole,
  dateYearLabel,
  lifeDatesError,
  makePerson,
  makeTree,
  personAgeLabel,
  personLifeLabel,
  personLifeStatus,
  relationFromConnection,
  relationLabel,
  setRelationParent,
  updateRelation,
  uid,
  validateTree,
  type Relation,
} from './model';
import { saveTree } from './storage';

describe('birth and death validation', () => {
  it('rejects earlier death dates and years and allows equal or overlapping precision', () => {
    expect(
      lifeDatesError({
        born: { precision: 'full', value: '1987-10-09' },
        died: { precision: 'full', value: '1987-09-09' },
      }),
    ).toMatch(/before birth/);
    expect(
      lifeDatesError({
        born: { precision: 'year', year: 1987 },
        died: { precision: 'year', year: 1986 },
      }),
    ).toMatch(/before birth/);
    expect(
      lifeDatesError({
        born: { precision: 'full', value: '1987-10-09' },
        died: { precision: 'year', year: 1987 },
      }),
    ).toBe('');
    expect(
      lifeDatesError({
        born: { precision: 'year', year: 1987 },
        died: { precision: 'full', value: '1987-01-01' },
      }),
    ).toBe('');
    expect(
      lifeDatesError({
        born: { precision: 'full', value: '1987-10-09' },
        died: { precision: 'full', value: '1987-10-09' },
      }),
    ).toBe('');
  });
  it('blocks incomplete/invalid years and dates before local persistence', () => {
    for (const born of [
      { precision: 'year', year: 0 },
      { precision: 'year', year: NaN },
      { precision: 'year', year: 10000 },
      { precision: 'full', value: '' },
      { precision: 'full', value: '2025-02-30' },
    ] as const) {
      const person = { ...makePerson('Draft'), born };
      expect(lifeDatesError(person)).not.toBe('');
      expect(() => saveTree({ ...makeTree(), people: [person] })).toThrow(/Correct the dates/);
    }
    const person = {
      ...makePerson('Draft'),
      born: { precision: 'year' as const, year: 1987 },
      died: { precision: 'year' as const, year: 1980 },
    };
    expect(() => saveTree({ ...makeTree(), people: [person] })).toThrow(/before birth/);
    expect(() => validateTree({ ...makeTree(), people: [person] })).toThrow(/before birth/);
  });
  it('shows only years while preserving full dates in the document', () => {
    const born = { precision: 'full' as const, value: '1987-10-09' };
    expect(dateYearLabel(born)).toBe('1987');
    expect(born.value).toBe('1987-10-09');
  });
});

describe('connector inference and reassignment', () => {
  const a = makePerson('A'),
    b = makePerson('B'),
    c = makePerson('C');
  const tree = { ...makeTree(), people: [a, b, c] };
  it('keeps ancestry roles for both dragging directions and uses general labels', () => {
    const child = relationFromConnection(a.id, b.id, 'bottom', 'top');
    expect(child).toMatchObject({
      type: 'parent',
      parentId: a.id,
      childId: b.id,
    });
    expect(relationLabel(child)).toBe('Parent / Child');
    const parent = relationFromConnection(b.id, a.id, 'top', 'bottom');
    expect(parent).toMatchObject({
      type: 'parent',
      parentId: a.id,
      childId: b.id,
    });
    expect(relationLabel(parent)).toBe('Parent / Child');
    if (parent.type === 'parent')
      expect(relationLabel({ ...parent, kind: 'biological' })).toBe('Parent / Child');
    const partner = relationFromConnection(a.id, b.id, 'left', 'right');
    expect(partner.type).toBe('partner');
    if (partner.type === 'partner')
      expect(relationLabel({ ...partner, status: 'current', union: 'married' })).toBe('Partner');
  });
  it('round-trips unassigned handles and lets the user assign a relationship', () => {
    const pending = relationFromConnection(a.id, b.id, 'left', 'top');
    expect(pending).toMatchObject({
      type: 'unassigned',
      sourceHandle: 'left',
      targetHandle: 'top',
    });
    const connected = addRelation(tree, pending);
    expect(validateTree(JSON.parse(JSON.stringify(connected)))).toEqual(connected);
    const parent = changeRelationRole(pending, a.id, 'parent-child');
    expect(parent).toMatchObject({
      id: pending.id,
      type: 'parent',
      parentId: a.id,
      childId: b.id,
    });
    expect(updateRelation(connected, parent).relations).toEqual([parent]);
    expect(() => addRelation(connected, relationFromConnection(b.id, a.id, 'top', 'left'))).toThrow(
      /already exists/,
    );
  });
  it('checks ancestry cycles when assigning an unclassified link', () => {
    const ab = relationFromConnection(a.id, b.id, 'bottom', 'top');
    const bc = relationFromConnection(b.id, c.id, 'bottom', 'top');
    const ca = relationFromConnection(c.id, a.id, 'top', 'left');
    const connected = addRelation(addRelation(addRelation(tree, ab), bc), ca);
    expect(() => updateRelation(connected, changeRelationRole(ca, c.id, 'parent-child'))).toThrow(
      /cycle/,
    );
    expect(() => addRelation(tree, relationFromConnection(a.id, a.id, 'left', 'top'))).toThrow(
      /themselves/,
    );
  });
  it('preserves ancestry when choosing the merged kind and checks changing the parent', () => {
    const original: Relation = {
      id: uid(),
      type: 'parent',
      parentId: a.id,
      childId: c.id,
      kind: 'adoptive',
      displayRole: 'child',
    };
    const same = changeRelationRole(original, c.id, 'parent-child');
    expect(same).toMatchObject({
      parentId: a.id,
      childId: c.id,
      kind: 'adoptive',
    });
    const reversed = setRelationParent(original, c.id);
    expect(reversed).toMatchObject({
      id: original.id,
      parentId: c.id,
      childId: a.id,
      kind: 'adoptive',
    });
    const connected = addRelation(
      addRelation(
        addRelation(tree, relationFromConnection(a.id, b.id, 'bottom', 'top')),
        relationFromConnection(b.id, c.id, 'bottom', 'top'),
      ),
      original,
    );
    expect(() => updateRelation(connected, reversed)).toThrow(/cycle/);
    expect(() => setRelationParent(original, 'missing')).toThrow(/linked people/);
  });
  it('opens legacy version 1 documents and rejects unsupported formats', () => {
    expect(validateTree({ ...tree, version: 1 })).toEqual({
      ...tree,
      version: 2,
    });
    expect(() => validateTree({ ...tree, version: '2' })).toThrow(/version/);
    const badLink = relationFromConnection(a.id, 'missing', 'left', 'top');
    expect(() => validateTree({ ...tree, relations: [badLink] })).toThrow(/missing person/);
  });
});

describe('person ages', () => {
  const today = new Date(2026, 8, 30);
  it('uses completed birthdays and stops at the death date', () => {
    const person = makePerson();
    person.lifeStatus = 'living';
    person.born = { precision: 'full', value: '1987-10-09' };
    expect(personAgeLabel(person, today)).toBe('Age 38');
    expect(personAgeLabel(person, new Date(2026, 9, 9))).toBe('Age 39');
    person.died = { precision: 'full', value: '2020-10-08' };
    person.lifeStatus = 'deceased';
    expect(personAgeLabel(person, today)).toBe('Died at 32');
  });
  it('preserves uncertainty for year-only dates', () => {
    const person = makePerson();
    person.lifeStatus = 'living';
    person.born = { precision: 'year', year: 1987 };
    expect(personAgeLabel(person, today)).toBe('Age 38–39');
    person.died = { precision: 'year', year: 2020 };
    person.lifeStatus = 'deceased';
    expect(personAgeLabel(person, today)).toBe('Died at 32–33');
  });
  it('omits age for unknown births or dates before birth', () => {
    const person = makePerson();
    expect(personAgeLabel(person, today)).toBe('');
    person.born = { precision: 'full', value: '2027-01-01' };
    expect(personAgeLabel(person, today)).toBe('');
    person.born = { precision: 'full', value: '1987-10-09' };
    person.died = { precision: 'full', value: '1980-01-01' };
    expect(personAgeLabel(person, today)).toBe('');
  });
});

describe('living and deceased status', () => {
  it('infers only recorded deaths in legacy records and prompts for new people', () => {
    const person = makePerson();
    expect(personLifeStatus(person)).toBe('');
    const tree = { ...makeTree(), people: [person] };
    expect(validateTree(JSON.parse(JSON.stringify(tree)))).toEqual(tree);
    person.died = { precision: 'year', year: 2011 };
    expect(personLifeStatus(validateTree(tree).people[0])).toBe('deceased');
    expect(personLifeLabel(person)).toBe('Died 2011');
  });

  it("doesn't estimate a current age for deceased or unclassified people", () => {
    const person = makePerson();
    person.born = { precision: 'year', year: 1930 };
    const today = new Date(2026, 9, 5);
    expect(personAgeLabel(person, today)).toBe('');
    person.lifeStatus = 'deceased';
    expect(personAgeLabel(person, today)).toBe('');
    expect(personLifeLabel(person)).toBe('1930 — Deceased');
    person.lifeStatus = 'living';
    expect(personAgeLabel(person, today)).toBe('Age 95–96');
    expect(personLifeLabel(person)).toBe('1930');
  });

  it('round-trips both statuses and rejects invalid or contradictory records', async () => {
    const person = makePerson();
    const tree = { ...makeTree(), people: [person] };
    for (const status of ['living', 'deceased'] as const) {
      person.lifeStatus = status;
      expect(validateTree(JSON.parse(JSON.stringify(tree)))).toEqual(tree);
      expect(personLifeLabel(person)).toBe(status === 'living' ? 'Living' : 'Deceased');
    }
    for (const status of [null, 'unknown', 1, { value: 'living' }])
      expect(() => validateTree({ ...tree, people: [{ ...person, lifeStatus: status }] })).toThrow(
        /invalid person/,
      );
    person.lifeStatus = 'living';
    person.died = { precision: 'year', year: 2011 };
    expect(() => validateTree(tree)).toThrow(/Living people cannot/);
    expect(() => saveTree(tree)).toThrow(/Living people cannot/);
  });
});

describe('tree document and relationship rules', () => {
  const setup = () => {
    const people = [makePerson('A'), makePerson('B'), makePerson('C')];
    return { ...makeTree('Family'), people };
  };
  it('keeps valid portable data including year and full dates, notes, and portraits', () => {
    const tree = setup();
    tree.people[0].born = { precision: 'year', year: 1924 };
    tree.people[0].died = { precision: 'full', value: '2008-11-05' };
    tree.people[0].notes = 'A family story';
    tree.people[0].portrait = 'data:image/jpeg;base64,AAAA';
    expect(validateTree(JSON.parse(JSON.stringify(tree)))).toEqual(tree);
  });
  it('prevents duplicate and cyclic parent links while allowing shared parents', () => {
    const tree = setup();
    const [a, b, c] = tree.people;
    const ab: Relation = {
      id: uid(),
      type: 'parent',
      parentId: a.id,
      childId: b.id,
      kind: 'biological',
    };
    const bc: Relation = {
      id: uid(),
      type: 'parent',
      parentId: b.id,
      childId: c.id,
      kind: 'adoptive',
    };
    const first = addRelation(addRelation(tree, ab), bc);
    expect(() => addRelation(first, { ...ab, id: uid() })).toThrow(/already exists/);
    expect(() =>
      addRelation(first, {
        id: uid(),
        type: 'parent',
        parentId: c.id,
        childId: a.id,
        kind: 'step',
      }),
    ).toThrow(/cycle/);
    expect(
      addRelation(first, {
        id: uid(),
        type: 'parent',
        parentId: a.id,
        childId: c.id,
        kind: 'guardian',
      }).relations,
    ).toHaveLength(3);
  });
  it('treats partner links as symmetric and rejects broken imports', () => {
    const tree = setup();
    const [a, b] = tree.people;
    const paired = addRelation(tree, {
      id: uid(),
      type: 'partner',
      personA: a.id,
      personB: b.id,
      status: 'former',
      union: 'married',
    });
    expect(() =>
      addRelation(paired, {
        id: uid(),
        type: 'partner',
        personA: b.id,
        personB: a.id,
        status: 'current',
        union: 'unmarried',
      }),
    ).toThrow(/already exists/);
    expect(() =>
      validateTree({
        ...paired,
        relations: [
          {
            id: uid(),
            type: 'parent',
            parentId: a.id,
            childId: 'missing',
            kind: 'step',
          },
        ],
      }),
    ).toThrow(/missing person/);
    expect(() => validateTree({ ...tree, version: 99 })).toThrow(/version/);
  });
});
