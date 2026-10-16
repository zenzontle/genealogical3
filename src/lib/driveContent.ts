import { normalizeHomePerson, type Tree } from './model';
import { normalizePersonNames } from './personNames';
import { photoDigest, portraitBytes, type PortraitReference } from './driveDocument';

// Canonical meaningful content, independent of local identity, navigation and timestamps.
export async function driveContent(tree: Tree, references?: PortraitReference[]): Promise<string> {
  const normalized = normalizePersonNames(normalizeHomePerson(tree));
  const people = await Promise.all(
    normalized.people.map(async (person) => ({
      ...person,
      portrait: references
        ? references.find((ref) => ref.personId === person.id)?.digest || null
        : person.portrait
          ? await photoDigest(portraitBytes(person.portrait))
          : null,
    })),
  );
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, canonical(item)]),
      );
    return value;
  };
  return JSON.stringify(
    canonical({
      name: normalized.name,
      homePersonId: normalized.homePersonId,
      people: people.sort((a, b) => a.id.localeCompare(b.id)),
      relations: [...normalized.relations].sort((a, b) => a.id.localeCompare(b.id)),
    }),
  );
}
