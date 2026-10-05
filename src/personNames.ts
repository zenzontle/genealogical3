import type { Person, Tree } from "./model";

export function splitPersonName(name: string) {
  const [firstName = "", ...rest] = name.trim().split(/\s+/);
  return { firstName, lastName: rest.join(" ") };
}

export function setPersonName(
  person: Person,
  field: "firstName" | "lastName",
  value: string,
): Person {
  const next = { ...person, [field]: value };
  return {
    ...next,
    name: [next.firstName.trim(), next.lastName.trim()]
      .filter(Boolean)
      .join(" "),
  };
}

/** Older trees only have a full name. Preserve it until the user edits it. */
export function normalizePersonNames(tree: Tree): Tree {
  return {
    ...tree,
    people: tree.people.map((person) =>
      typeof person.firstName === "string" &&
      typeof person.lastName === "string"
        ? person
        : { ...person, ...splitPersonName(person.name) },
    ),
  };
}
