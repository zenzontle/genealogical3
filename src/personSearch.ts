import { dateLabel, type Person } from './model';

// NFD leaves these common Latin letters intact even after combining marks are removed.
const letterFolds: Record<string, string> = { ł: 'l', ø: 'o', đ: 'd' };
const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[łøđ]/g, (letter) => letterFolds[letter]);
const queryWords = (query: string) => normalize(query).trim().split(/\s+/).filter(Boolean);

/** Search committed person data; each word may match a different field. */
export function searchPeople(people: Person[], query: string): Person[] {
  const words = queryWords(query);
  if (!words.length) return [];
  return people
    .filter((person) => {
      const fields = [
        person.name,
        person.firstName,
        person.lastName,
        person.nickname,
        dateLabel(person.born),
        dateLabel(person.died),
        person.notes,
      ].map(normalize);
      return words.every((word) => fields.some((field) => field.includes(word)));
    })
    .sort((a, b) => normalize(a.name).localeCompare(normalize(b.name)));
}

/** Keep the matching part of a long note visible without rendering the whole note. */
export function matchedNotePreview(notes: string, query: string): string {
  const text = notes.replace(/\s+/g, ' ').trim();
  const normalized = normalize(text);
  const matches = queryWords(query)
    .map((word) => normalized.indexOf(word))
    .filter((index) => index >= 0);
  if (!matches.length) return '';
  const firstMatch = Math.min(...matches);
  let originalOffset = 0;
  let normalizedOffset = 0;
  // Translate the normalized match back to UTF-16 offsets in the displayed text.
  for (const character of text) {
    const normalizedLength = normalize(character).length;
    if (normalizedOffset + normalizedLength > firstMatch) break;
    normalizedOffset += normalizedLength;
    originalOffset += character.length;
  }
  const start = Math.max(0, originalOffset - 40);
  const end = Math.min(text.length, start + 160);
  return `${start ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}
