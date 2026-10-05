import { describe, expect, it } from "vitest";
import { makePerson, makeTree, validateTree } from "./model";
import {
  normalizePersonNames,
  setPersonName,
  splitPersonName,
} from "./personNames";

describe("first and last names", () => {
  it.each([
    ["Ada Lovelace", "Ada", "Lovelace"],
    ["María de la Cruz", "María", "de la Cruz"],
    ["Cher", "Cher", ""],
    ["", "", ""],
  ])(
    "splits legacy name %j without losing words",
    (name, firstName, lastName) => {
      expect(splitPersonName(name)).toEqual({ firstName, lastName });
    },
  );

  it("keeps compound first and last names independently editable", () => {
    let person = setPersonName(makePerson(""), "firstName", "Mary Jane");
    person = setPersonName(person, "lastName", "de la Cruz");
    const tree = { ...makeTree(), people: [person] };
    expect(validateTree(JSON.parse(JSON.stringify(tree))).people[0]).toEqual(
      person,
    );
    expect(person.name).toBe("Mary Jane de la Cruz");
    person = setPersonName(person, "firstName", "");
    expect(person.name).toBe("de la Cruz");
    expect(person.lastName).toBe("de la Cruz");
    expect(setPersonName(person, "lastName", "").name).toBe("");
  });

  it("normalizes older local records and imports without rewriting their display names", () => {
    const {
      firstName: _first,
      lastName: _last,
      ...legacy
    } = makePerson("Ada  Lovelace");
    const tree = { ...makeTree(), people: [legacy] };
    const imported = validateTree(tree);
    expect(imported.people[0]).toMatchObject({
      name: "Ada  Lovelace",
      firstName: "Ada",
      lastName: "Lovelace",
    });
    expect(normalizePersonNames(imported)).toEqual(imported);
    expect(tree.people[0]).not.toHaveProperty("firstName");
  });

  it("rejects malformed or incomplete name fields in backups", () => {
    const person = makePerson("Ada Lovelace");
    for (const fields of [
      { firstName: 12 },
      { lastName: null },
      { firstName: undefined },
    ]) {
      expect(() =>
        validateTree({ ...makeTree(), people: [{ ...person, ...fields }] }),
      ).toThrow(/invalid person/);
    }
  });
});
