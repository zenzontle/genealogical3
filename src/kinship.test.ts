import { describe, expect, it } from "vitest";
import { calculateKinships, describeKinshipPath } from "./kinship";
import {
  makePerson,
  makeTree,
  setHomePerson,
  type ParentKind,
  type Person,
  type Relation,
} from "./model";

function family() {
  const tree = makeTree();
  const person = (name: string, sex: Person["sex"] = "") => {
    const p = { ...makePerson(name), id: name, sex };
    tree.people.push(p);
    return p;
  };
  const parent = (a: Person, b: Person, kind: ParentKind = "biological") =>
    tree.relations.push({
      id: `${a.id}-${b.id}`,
      type: "parent",
      parentId: a.id,
      childId: b.id,
      kind,
    });
  const partner = (
    a: Person,
    b: Person,
    status: "current" | "former" | "unspecified" = "current",
    union: "married" | "unmarried" | "unspecified" = "married",
  ) =>
    tree.relations.push({
      id: `${a.id}-${b.id}`,
      type: "partner",
      personA: a.id,
      personB: b.id,
      status,
      union,
    });
  const home = person("Home");
  tree.homePersonId = home.id;
  const results = () => calculateKinships(tree);
  const label = (p: Person) => results().get(p.id)!.primary.label;
  return { tree, home, person, parent, partner, results, label };
}

describe("kinship relative to home", () => {
  it("calculates ancestors, descendants, siblings, aunts, nieces, and cousins", () => {
    const f = family();
    const mother = f.person("Mother", "female"),
      grandmother = f.person("Grandmother", "female"),
      great = f.person("Great", "male"),
      older = f.person("Older", "other");
    const brother = f.person("Brother", "male"),
      aunt = f.person("Aunt", "female"),
      cousin = f.person("Cousin"),
      removed = f.person("Removed"),
      niece = f.person("Niece", "female");
    const son = f.person("Son", "male"),
      grandchild = f.person("Grandchild"),
      greatChild = f.person("GreatChild", "female");
    f.parent(mother, f.home);
    f.parent(grandmother, mother);
    f.parent(great, grandmother);
    f.parent(older, great);
    f.parent(mother, brother);
    f.parent(grandmother, aunt);
    f.parent(aunt, cousin);
    f.parent(cousin, removed);
    f.parent(brother, niece);
    f.parent(f.home, son);
    f.parent(son, grandchild);
    f.parent(grandchild, greatChild);
    const results = f.results();
    for (const [p, expected] of [
      [mother, "Mother"],
      [grandmother, "Grandmother"],
      [great, "Great-grandfather"],
      [older, "2× great-grandparent"],
      [brother, "Brother"],
      [aunt, "Aunt"],
      [cousin, "1st cousin"],
      [removed, "1st cousin once removed"],
      [niece, "Niece"],
      [son, "Son"],
      [grandchild, "Grandchild"],
      [greatChild, "Great-granddaughter"],
    ] as const) {
      expect(results.get(p.id)!.primary.label).toBe(expected);
    }
    expect(results.get(f.home.id)!.primary.label).toBe("Home person");
    expect(f.tree).toEqual(setHomePerson(f.tree, f.home.id));
  });

  it("handles distant cousins, removals, great aunts and great nephews", () => {
    const f = family();
    const ancestor = f.person("Ancestor"),
      p = f.person("Parent"),
      gp = f.person("Grandparent"),
      aunt = f.person("GreatAunt", "female"),
      cousinParent = f.person("CousinParent"),
      cousin = f.person("SecondCousin"),
      next = f.person("Next"),
      last = f.person("Last"),
      sibling = f.person("Sibling"),
      niece = f.person("Niece"),
      nephew = f.person("GreatNephew", "male");
    f.parent(ancestor, gp);
    f.parent(gp, p);
    f.parent(p, f.home);
    f.parent(ancestor, aunt);
    f.parent(aunt, cousinParent);
    f.parent(cousinParent, cousin);
    f.parent(cousin, next);
    f.parent(next, last);
    f.parent(p, sibling);
    f.parent(sibling, niece);
    f.parent(niece, nephew);
    expect(f.label(aunt)).toBe("Great-aunt");
    expect(f.label(cousin)).toBe("2nd cousin");
    expect(f.label(last)).toBe("2nd cousin twice removed");
    expect(f.label(nephew)).toBe("Great-nephew");
  });

  it("counts adoption and unspecified parentage without claiming biological or full siblings", () => {
    const f = family();
    const parent = f.person("AdoptiveParent"),
      sibling = f.person("Sibling", "other"),
      aunt = f.person("Aunt"),
      grandparent = f.person("Grandparent");
    f.parent(parent, f.home, "adoptive");
    f.parent(parent, sibling, "unspecified");
    f.parent(grandparent, parent, "adoptive");
    f.parent(grandparent, aunt);
    expect(f.label(parent)).toBe("Parent");
    expect(f.label(sibling)).toBe("Sibling");
    expect(f.label(aunt)).toBe("Aunt/uncle");
    const path = describeKinshipPath(
      f.home,
      f.results().get(sibling.id)!.primary,
      f.tree.people,
    );
    expect(path).toContain("(adoptive)");
    expect(path).toContain("(unspecified)");
    expect(path).not.toMatch(/half|full/);
  });

  it("keeps step, guardian, partner, and mixed paths explicit", () => {
    const f = family();
    const stepfather = f.person("Stepfather", "male"),
      guardian = f.person("Guardian"),
      ward = f.person("Ward"),
      otherChild = f.person("OtherChild"),
      ex = f.person("Ex", "female"),
      companion = f.person("Companion"),
      friend = f.person("Friend");
    f.parent(stepfather, f.home, "step");
    f.parent(guardian, f.home, "guardian");
    f.parent(f.home, ward, "guardian");
    f.parent(stepfather, otherChild);
    f.partner(f.home, ex, "former");
    f.partner(f.home, companion, "former", "unmarried");
    f.partner(ex, friend, "unspecified", "unspecified");
    expect(f.label(stepfather)).toBe("Stepfather");
    expect(f.label(guardian)).toBe("Guardian");
    expect(f.label(ward)).toBe("Ward");
    expect(f.label(otherChild)).toBe("Stepfather → child");
    expect(f.label(ex)).toBe("Ex-wife");
    expect(f.label(companion)).toBe("Former partner");
    expect(f.label(friend)).toBe("Ex-wife → partner");
    const coParent = f.person("CoParent");
    f.parent(coParent, ward);
    expect(f.label(coParent)).toBe("Ward → parent");
    f.partner(companion, friend);
    expect(f.results().get(friend.id)!.paths).toHaveLength(2);
  });

  it("uses only equally shortest paths and stable order, collapsing repeated labels", () => {
    const f = family();
    const p = f.person("Parent"),
      target = f.person("Target", "female"),
      partner = f.person("Partner"),
      second = f.person("SecondParent");
    f.parent(p, f.home);
    f.parent(p, target);
    f.partner(f.home, partner);
    f.parent(partner, target);
    f.parent(second, f.home);
    f.parent(second, target);
    const before = f.results();
    const result = before.get(target.id)!;
    expect(result.primary.label).toBe("Sister");
    expect(result.alternatives.map((match) => match.label)).toEqual([
      "Spouse → daughter",
    ]);
    expect(result.paths).toHaveLength(3);
    f.tree.people.reverse();
    f.tree.relations.reverse();
    expect(f.results().get(target.id)).toEqual(result);
    f.partner(f.home, target);
    expect(f.results().get(target.id)!.primary.label).toBe("Wife");
    expect(f.results().get(target.id)!.alternatives).toHaveLength(0);
  });

  it("preserves ancestor prefixes when collateral ties exceed the path limit", () => {
    const f = family();
    const target = f.person("Target"),
      ancestor = f.person("Ancestor");
    for (let up = 1; up <= 7; up++) {
      let previous = f.home;
      for (let i = 0; i < 7; i++) {
        const next = i === 6 ? target : f.person(`route-${up}-${i}`);
        const before = f.tree.relations.length;
        if (i < up) f.parent(next, previous);
        else f.parent(previous, next);
        f.tree.relations[before].id = `${up === 7 ? "z" : "a"}-${up}-${i}`;
        previous = next;
      }
    }
    f.parent(ancestor, target);
    const results = f.results();
    expect(results.get(target.id)!.paths).toHaveLength(5);
    expect(results.get(target.id)!.truncated).toBe(true);
    expect(results.get(ancestor.id)!.primary.label).toBe(
      "6× great-grandparent",
    );
  });

  it("hides calculations without home and excludes unassigned and disconnected paths", () => {
    const f = family();
    const disconnected = f.person("Disconnected"),
      unassigned = f.person("Unassigned");
    f.tree.relations.push({
      id: "not-set",
      type: "unassigned",
      personA: f.home.id,
      personB: unassigned.id,
      sourceHandle: "top",
      targetHandle: "left",
    });
    expect(f.label(disconnected)).toBe("Relationship not established");
    expect(f.label(unassigned)).toBe("Relationship not established");
    expect(calculateKinships(setHomePerson(f.tree, null)).size).toBe(0);
  });

  it("updates for changing home, sex, names, and relationship kinds", () => {
    const f = family();
    const parent = f.person("Parent");
    f.parent(parent, f.home);
    expect(f.label(parent)).toBe("Parent");
    parent.sex = "female";
    expect(f.label(parent)).toBe("Mother");
    parent.name = "Renamed";
    expect(
      describeKinshipPath(
        f.home,
        f.results().get(parent.id)!.primary,
        f.tree.people,
      ),
    ).toContain("Renamed");
    (f.tree.relations[0] as Extract<Relation, { type: "parent" }>).kind =
      "guardian";
    expect(f.label(parent)).toBe("Guardian");
    f.tree.homePersonId = parent.id;
    expect(f.label(f.home)).toBe("Ward");
  });

  it("bounds branching and discloses omitted shortest paths in a dense 2,000-person graph", () => {
    const f = family();
    const parents = Array.from({ length: 30 }, (_, i) => f.person(`P${i}`));
    for (const p of parents) f.parent(p, f.home);
    for (let i = f.tree.people.length; i < 2000; i++) {
      const child = f.person(`C${i}`);
      for (const p of parents) f.parent(p, child);
    }
    const started = performance.now();
    const results = f.results();
    expect(results.size).toBe(2000);
    expect(results.get("C100")!.primary.label).toBe("Sibling");
    expect(results.get("C100")!.paths).toHaveLength(5);
    expect(results.get("C100")!.truncated).toBe(true);
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it.each([100, 300])(
    "handles the %i-person generation-grid fixture shape",
    (count) => {
      const f = family();
      for (let i = 1; i < count; i++) f.person(`Person${i}`);
      for (let i = 20; i < count; i++)
        f.parent(f.tree.people[i - 20], f.tree.people[i]);
      expect(f.results().size).toBe(count);
      expect(f.results().get(f.tree.people[20].id)!.primary.label).toBe(
        "Child",
      );
    },
  );
});
