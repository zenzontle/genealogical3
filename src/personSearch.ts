import { dateLabel, type Person } from './model';

const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
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
  const start = Math.max(0, Math.min(...matches) - 40);
  const end = Math.min(text.length, start + 160);
  return `${start ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}
