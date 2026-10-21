import { describe, expect, it } from 'vitest';
import {
  dateLabel,
  dateYearLabel,
  duplicateTree,
  lifeDatesError,
  makePerson,
  makeTree,
  personAgeLabel,
  personLifeLabel,
  treeDocumentVersion,
  updatePerson,
  validateTree,
  type DateValue,
} from './model';
import { saveTree } from './storage';
import { searchPeople } from './personSearch';

const unknown = { precision: 'unknown' } as const;
const about = (year: number): DateValue => ({ precision: 'about', year });

describe('approximate life years', () => {
  it('labels and searches estimates without losing About', () => {
    const person = { ...makePerson('Researcher'), born: about(1920), died: about(1980) };
    expect(dateLabel(person.born)).toBe('About 1920');
    expect(dateYearLabel(person.born)).toBe('About 1920');
    expect(personLifeLabel(person)).toBe('About 1920 — About 1980');
    expect(searchPeople([person], 'About 1920 1980')).toEqual([person]);
    expect(personLifeLabel({ ...person, born: unknown })).toBe('Died About 1980');
  });
  it.each([1, 1920, 9999])(
    'preserves approximate year %s for birth and death in version 3 backups',
    (year) => {
      const person = { ...makePerson(), born: about(year), died: about(year) };
      const tree = { ...makeTree(), people: [person] };
      expect(validateTree(JSON.parse(JSON.stringify(tree)))).toEqual({ ...tree, version: 3 });
      expect(treeDocumentVersion(tree)).toBe(3);
      expect(duplicateTree(tree).people).toEqual(tree.people);
      expect(duplicateTree(tree).version).toBe(3);
    },
  );
  it.each([NaN, Infinity, 0, -1, 1920.5, 10000])(
    'blocks invalid approximate year %s before saving',
    (year) => {
      for (const field of ['born', 'died'] as const) {
        const person = { ...makePerson(), [field]: about(year) };
        const tree = { ...makeTree(), people: [person] };
        expect(lifeDatesError(person)).toMatch(/valid (birth|death) year from 1 to 9999/);
        expect(() => saveTree(tree)).toThrow(/Correct the dates/);
        expect(() => validateTree(tree)).toThrow(/invalid person/);
      }
    },
  );
  it.each([
    { precision: 'about' },
    { precision: 'about', year: '1920' },
    { precision: 'about', value: '1920-01-01' },
    { precision: 'about', date: { precision: 'year', year: 1920 } },
    { precision: 'before', year: 1900 },
    { precision: 'after', year: 1850 },
    { precision: 'range', start: 1910, end: 1915 },
  ])('rejects unsupported approximate values %j', (born) => {
    expect(() => validateTree({ ...makeTree(), people: [{ ...makePerson(), born }] })).toThrow(
      /invalid person/,
    );
  });
  it('does not invent a tolerance or exact age for estimates', () => {
    const exactBirth = { precision: 'full', value: '1920-01-01' } as const;
    const exactDeath = { precision: 'year', year: 1910 } as const;
    expect(lifeDatesError({ born: exactBirth, died: exactDeath })).toMatch(/before birth/);
    expect(lifeDatesError({ born: about(1920), died: exactDeath })).toBe('');
    expect(lifeDatesError({ born: exactBirth, died: about(1910) })).toBe('');
    const today = new Date(2026, 8, 30);
    expect(personAgeLabel({ born: about(1920), died: unknown, lifeStatus: 'living' }, today)).toBe(
      '',
    );
    expect(personAgeLabel({ born: exactBirth, died: about(1980) }, today)).toBe('');
    expect(personAgeLabel({ born: about(1920), died: about(1980) }, today)).toBe('');
    expect(lifeDatesError({ born: unknown, died: about(1980), lifeStatus: 'living' })).toMatch(
      /Living people cannot/,
    );
  });
  it('keeps legacy dates unchanged and distinguishes estimates from exact years when editing', () => {
    const person = {
      ...makePerson(),
      born: { precision: 'year' as const, year: 1920 },
      died: { precision: 'full' as const, value: '1980-01-02' },
    };
    const tree = { ...makeTree(), people: [person, makePerson()] };
    for (const version of [1, 2])
      expect(validateTree({ ...tree, version }).people).toEqual(tree.people);
    const edited = updatePerson(tree, { ...person, born: about(1920) });
    expect(edited).not.toBe(tree);
    expect(updatePerson(edited, structuredClone(edited.people[0]))).toBe(edited);
    expect(updatePerson(edited, { ...edited.people[0], born: about(1921) })).not.toBe(edited);
    expect(treeDocumentVersion(updatePerson(edited, person))).toBe(2);
  });
});
