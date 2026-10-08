import { describe, expect, it } from 'vitest';
import { makePerson, unknownDate } from './model';
import { matchedNotePreview, searchPeople } from './personSearch';

describe('searching people in the current tree', () => {
  const jose = {
    ...makePerson('José García'),
    nickname: 'Pepe',
    born: { precision: 'full' as const, value: '1950-06-12' },
    died: { precision: 'year' as const, year: 2005 },
    notes: 'Moved to Montréal and worked as a carpenter.',
  };
  const ana = makePerson('Ana García');
  const people = [jose, ana];

  it.each(['jose', 'JOSÉ', 'GARC', '  jose   garcia  ', 'pepe', 'MONTrEAL', 'carpent'])(
    'matches partial names, nicknames and notes: %s',
    (query) => {
      expect(searchPeople(people, query)).toContain(jose);
    },
  );

  it('requires every word, allowing them to match different fields', () => {
    expect(searchPeople(people, 'garcia pepe 1950 montreal')).toEqual([jose]);
    expect(searchPeople(people, 'jose missing')).toEqual([]);
    expect(searchPeople(people, 'ana carpenter')).toEqual([]);
  });

  it.each([
    ['Łukasz', 'lukasz'],
    ['SØREN', 'soren'],
    ['Đorđe', 'dorde'],
    ['Lukasz', 'ŁUKASZ'],
    ['Soren', 'SØREN'],
    ['Dorde', 'ĐORĐE'],
  ])('matches non-decomposing letters in %s with query %s', (name, query) => {
    const person = makePerson(name);
    expect(searchPeople([person], query)).toEqual([person]);
    expect(searchPeople([person], query.slice(0, 3))).toEqual([person]);
    expect(person.name).toBe(name);
  });

  it('folds non-decomposing letters in nicknames and notes as well as names', () => {
    const person = { ...makePerson('Anna'), nickname: 'Łucja', notes: 'Ødense, Đorđević' };
    expect(searchPeople([person], 'lucja odense dordevic')).toEqual([person]);
  });

  it.each(['1950', '1950-06-12', '2005', '1950 2005'])(
    'matches recorded birth and death dates: %s',
    (query) => {
      expect(searchPeople(people, query)).toEqual([jose]);
    },
  );

  it('does not invent dates or parse natural-language dates', () => {
    expect(searchPeople(people, 'unknown')).toEqual([]);
    expect(searchPeople(people, 'June 1950')).toEqual([]);
    expect(searchPeople([ana], '1950')).toEqual([]);
    expect(ana.born).toEqual(unknownDate());
  });

  it('searches separate names even when an imported display name differs', () => {
    const person = { ...makePerson('Preserved display'), firstName: 'Alice', lastName: 'Smith' };
    expect(searchPeople([person], 'alice smith')).toEqual([person]);
  });

  it('sorts alphabetically without losing duplicate people or changing input order', () => {
    const duplicate = { ...jose, id: 'duplicate' };
    const input = [jose, duplicate, ana];
    expect(searchPeople(input, 'garcia')).toEqual([ana, jose, duplicate]);
    expect(input).toEqual([jose, duplicate, ana]);
  });

  it('finds unnamed people through their nickname or notes', () => {
    const unnamed = { ...makePerson(''), nickname: 'Nana', notes: 'Lived in Paris' };
    expect(searchPeople([unnamed], 'nana paris')).toEqual([unnamed]);
  });

  it('returns no results for empty or unmatched queries and empty trees', () => {
    expect(searchPeople(people, '')).toEqual([]);
    expect(searchPeople(people, ' \n\t ')).toEqual([]);
    expect(searchPeople(people, 'missing')).toEqual([]);
    expect(searchPeople([], 'jose')).toEqual([]);
  });

  it('uses the supplied current data after edits and deletion', () => {
    expect(searchPeople([{ ...jose, nickname: 'Joe' }], 'pepe')).toEqual([]);
    expect(searchPeople([ana], 'jose')).toEqual([]);
  });
});

describe('matching note previews', () => {
  it('shows matching notes with normalized whitespace and accents', () => {
    expect(matchedNotePreview('Moved\n to Montréal.', 'montreal')).toBe('Moved to Montréal.');
  });

  it('omits notes when only other fields match or the query is empty', () => {
    expect(matchedNotePreview('Moved to Paris.', 'jose')).toBe('');
    expect(matchedNotePreview('Moved to Paris.', '')).toBe('');
  });

  it.each([
    ['lodz', 'Łódź'],
    ['soren', 'Søren'],
    ['dorde', 'Đorđe'],
  ])('keeps original note spelling and aligned offsets when searching %s', (query, spelling) => {
    const notes = `${'e\u0301 '.repeat(200)}Visited Łódź with Søren and Đorđe. ${'later '.repeat(100)}`;
    const preview = matchedNotePreview(notes, query);
    expect(preview).toContain(spelling);
    expect(preview.length).toBeLessThanOrEqual(162);
  });

  it('includes a match deep in a long note and bounds the excerpt', () => {
    const preview = matchedNotePreview(
      `${'Earlier information. '.repeat(100)}Carpenter ${'later '.repeat(100)}`,
      'carpenter',
    );
    expect(preview).toContain('Carpenter');
    expect(preview.startsWith('…')).toBe(true);
    expect(preview.endsWith('…')).toBe(true);
    expect(preview.length).toBeLessThanOrEqual(162);
  });

  it.each([
    ['decomposed accents', 'e\u0301 '.repeat(200)],
    ['removed combining marks', '\u0301'.repeat(200)],
    ['expanded Hangul syllables', '각 '.repeat(200)],
    ['surrogate pairs and decomposed accents', '🙂e\u0301 '.repeat(200)],
  ])('keeps the matching word visible after %s', (_description, prefix) => {
    const person = {
      ...makePerson('José'),
      notes: `${prefix}Carpenter ${'later '.repeat(100)}`,
    };
    expect(searchPeople([person], 'carpenter')).toEqual([person]);
    const preview = matchedNotePreview(person.notes, 'carpenter');
    expect(preview).toContain('Carpenter');
    expect(preview.endsWith('…')).toBe(true);
    expect(preview.length).toBeLessThanOrEqual(162);
  });
});
