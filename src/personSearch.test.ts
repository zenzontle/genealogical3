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
});
