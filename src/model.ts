export type DateValue =
  | { precision: "unknown" }
  | { precision: "year"; year: number }
  | { precision: "full"; value: string };
export type Person = {
  id: string;
  name: string;
  nickname: string;
  born: DateValue;
  died: DateValue;
  sex: "" | "female" | "male" | "other";
  notes: string;
  portrait: string | null;
  x: number;
  y: number;
};
export type ParentKind =
  "biological" | "adoptive" | "step" | "guardian" | "unspecified";
export type PartnerStatus = "current" | "former" | "unspecified";
export type UnionKind = "married" | "unmarried" | "unspecified";
export type HandleSide = "top" | "bottom" | "left" | "right";
export type RelationshipRole = "parent-child" | "partner" | "unassigned";
export type Relation =
  | {
      id: string;
      type: "parent";
      parentId: string;
      childId: string;
      kind: ParentKind;
      displayRole?: "parent" | "child";
    }
  | {
      id: string;
      type: "partner";
      personA: string;
      personB: string;
      status: PartnerStatus;
      union: UnionKind;
    }
  | {
      id: string;
      type: "unassigned";
      personA: string;
      personB: string;
      sourceHandle: HandleSide;
      targetHandle: HandleSide;
    };
export type Tree = {
  version: 1 | 2;
  id: string;
  name: string;
  people: Person[];
  relations: Relation[];
  viewport: { x: number; y: number; zoom: number };
  updatedAt: number;
};
export const uid = () => crypto.randomUUID();
export const unknownDate = (): DateValue => ({ precision: "unknown" });
export const makePerson = (name = "New person", x = 0, y = 0): Person => ({
  id: uid(),
  name,
  nickname: "",
  born: unknownDate(),
  died: unknownDate(),
  sex: "",
  notes: "",
  portrait: null,
  x,
  y,
});
export const makeTree = (name = "Untitled tree"): Tree => ({
  version: 2,
  id: uid(),
  name,
  people: [],
  relations: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  updatedAt: Date.now(),
});
export const dateLabel = (date: DateValue) =>
  date.precision === "unknown"
    ? ""
    : date.precision === "year"
      ? String(date.year)
      : date.value;
export const dateYearLabel = (date: DateValue) => dateLabel(date).slice(0, 4);
export type LifeDates = Pick<Person, "born" | "died">;
export function lifeDatesError({ born, died }: LifeDates): string {
  for (const [label, date] of [
    ["birth", born],
    ["death", died],
  ] as const) {
    const precision = date.precision;
    if (!isDate(date))
      return precision === "year"
        ? `Enter a valid ${label} year from 1 to 9999.`
        : `Enter a complete, valid ${label} date.`;
  }
  if (born.precision === "unknown" || died.precision === "unknown") return "";
  const earliestBirth =
    born.precision === "year"
      ? `${String(born.year).padStart(4, "0")}-01-01`
      : born.value;
  const latestDeath =
    died.precision === "year"
      ? `${String(died.year).padStart(4, "0")}-12-31`
      : died.value;
  return latestDeath < earliestBirth ? "Death cannot be before birth." : "";
}
export function assertValidLifeDates(tree: Tree) {
  for (const p of tree.people) {
    const error = lifeDatesError(p);
    if (error)
      throw Error(
        `${p.name || "Unnamed person"}: ${error} Correct the dates before saving.`,
      );
  }
}
export function personAgeLabel(
  person: Pick<Person, "born" | "died">,
  today = new Date(),
): string {
  if (person.born.precision === "unknown") return "";
  type CalendarDate = [number, number, number];
  const bounds = (
    date: Exclude<DateValue, { precision: "unknown" }>,
  ): [CalendarDate, CalendarDate] => {
    if (date.precision === "year")
      return [
        [date.year, 1, 1],
        [date.year, 12, 31],
      ];
    const parts = date.value.split("-").map(Number) as CalendarDate;
    return [parts, parts];
  };
  const yearsBetween = (birth: CalendarDate, end: CalendarDate) =>
    end[0] -
    birth[0] -
    Number(end[1] < birth[1] || (end[1] === birth[1] && end[2] < birth[2]));
  const [earliestBirth, latestBirth] = bounds(person.born);
  const current: CalendarDate = [
    today.getFullYear(),
    today.getMonth() + 1,
    today.getDate(),
  ];
  const [earliestEnd, latestEnd] =
    person.died.precision === "unknown"
      ? [current, current]
      : bounds(person.died);
  const oldest = yearsBetween(earliestBirth, latestEnd);
  if (oldest < 0) return "";
  const youngest = Math.max(0, yearsBetween(latestBirth, earliestEnd));
  const age = youngest === oldest ? String(oldest) : `${youngest}–${oldest}`;
  return `${person.died.precision === "unknown" ? "Age" : "Died at"} ${age}`;
}
export const relationLabel = (r: Relation) =>
  r.type === "parent"
    ? "Parent / Child"
    : r.type === "partner"
      ? "Partner"
      : "Not set";
export const relationEndpoints = (r: Relation): [string, string] =>
  r.type === "parent" ? [r.parentId, r.childId] : [r.personA, r.personB];
export function relationFromConnection(
  source: string,
  target: string,
  sourceHandle: HandleSide,
  targetHandle: HandleSide,
): Relation {
  const id = uid();
  if (sourceHandle === "bottom" && targetHandle === "top")
    return {
      id,
      type: "parent",
      parentId: source,
      childId: target,
      kind: "unspecified",
    };
  if (sourceHandle === "top" && targetHandle === "bottom")
    return {
      id,
      type: "parent",
      parentId: target,
      childId: source,
      kind: "unspecified",
    };
  if (
    ["left", "right"].includes(sourceHandle) &&
    ["left", "right"].includes(targetHandle)
  )
    return {
      id,
      type: "partner",
      personA: source,
      personB: target,
      status: "unspecified",
      union: "unspecified",
    };
  return {
    id,
    type: "unassigned",
    personA: source,
    personB: target,
    sourceHandle,
    targetHandle,
  };
}
export function changeRelationRole(
  relation: Relation,
  referenceId: string,
  role: RelationshipRole,
): Relation {
  const endpoints = relationEndpoints(relation);
  const otherId = endpoints.find((id) => id !== referenceId)!;
  if (role === "parent-child")
    return {
      id: relation.id,
      type: "parent",
      parentId: relation.type === "parent" ? relation.parentId : referenceId,
      childId: relation.type === "parent" ? relation.childId : otherId,
      kind: relation.type === "parent" ? relation.kind : "unspecified",
    };
  if (role === "partner")
    return {
      id: relation.id,
      type: "partner",
      personA: referenceId,
      personB: otherId,
      status: relation.type === "partner" ? relation.status : "unspecified",
      union: relation.type === "partner" ? relation.union : "unspecified",
    };
  return {
    id: relation.id,
    type: "unassigned",
    personA: referenceId,
    personB: otherId,
    sourceHandle: "right",
    targetHandle: "left",
  };
}
export function setRelationParent(
  relation: Extract<Relation, { type: "parent" }>,
  parentId: string,
): Relation {
  const [a, b] = relationEndpoints(relation);
  if (parentId !== a && parentId !== b)
    throw Error("Choose one of the linked people as the parent.");
  return {
    id: relation.id,
    type: "parent",
    parentId,
    childId: parentId === a ? b : a,
    kind: relation.kind,
  };
}
export function updateRelation(tree: Tree, relation: Relation): Tree {
  return addRelation(
    { ...tree, relations: tree.relations.filter((r) => r.id !== relation.id) },
    relation,
  );
}
export const hasAncestorPath = (
  relations: Relation[],
  startId: string,
  targetId: string,
): boolean => {
  const visited = new Set<string>();
  const walk = (id: string): boolean => {
    if (id === targetId) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    return relations.some(
      (r) => r.type === "parent" && r.parentId === id && walk(r.childId),
    );
  };
  return walk(startId);
};
export function addRelation(tree: Tree, relation: Relation): Tree {
  const [a, b] = relationEndpoints(relation);
  if (a === b) throw Error("A person cannot be linked to themselves.");
  if (
    tree.relations.some(
      (r) =>
        (r.type === "unassigned" || relation.type === "unassigned") &&
        relationEndpoints(r).includes(a) &&
        relationEndpoints(r).includes(b),
    )
  )
    throw Error("A connection between these people already exists.");
  if (relation.type === "parent") {
    if (relation.parentId === relation.childId)
      throw Error("A person cannot be their own parent.");
    if (
      tree.relations.some(
        (r) =>
          r.type === "parent" &&
          r.parentId === relation.parentId &&
          r.childId === relation.childId,
      )
    )
      throw Error("That parent connection already exists.");
    if (hasAncestorPath(tree.relations, relation.childId, relation.parentId))
      throw Error("That connection would create an ancestry cycle.");
  } else if (relation.type === "partner") {
    if (relation.personA === relation.personB)
      throw Error("A person cannot be their own partner.");
    if (
      tree.relations.some(
        (r) =>
          r.type === "partner" &&
          [r.personA, r.personB].includes(relation.personA) &&
          [r.personA, r.personB].includes(relation.personB),
      )
    )
      throw Error("That partner connection already exists.");
  }
  return { ...tree, relations: [...tree.relations, relation] };
}
const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const isDate = (v: unknown): v is DateValue =>
  isObj(v) &&
  (v.precision === "unknown" ||
    (v.precision === "year" &&
      Number.isInteger(v.year) &&
      Number(v.year) >= 1 &&
      Number(v.year) <= 9999) ||
    (v.precision === "full" &&
      typeof v.value === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(v.value) &&
      Number(v.value.slice(0, 4)) >= 1 &&
      !Number.isNaN(Date.parse(v.value)) &&
      new Date(`${v.value}T00:00:00Z`).toISOString().slice(0, 10) === v.value));
export function validateTree(input: unknown): Tree {
  if (!isObj(input) || (input.version !== 1 && input.version !== 2))
    throw Error("Unsupported tree file version.");
  if (
    typeof input.id !== "string" ||
    typeof input.name !== "string" ||
    !Array.isArray(input.people) ||
    !Array.isArray(input.relations) ||
    !isObj(input.viewport) ||
    typeof input.viewport.x !== "number" ||
    typeof input.viewport.y !== "number" ||
    typeof input.viewport.zoom !== "number" ||
    !Number.isFinite(input.viewport.x) ||
    !Number.isFinite(input.viewport.y) ||
    !Number.isFinite(input.viewport.zoom) ||
    input.viewport.zoom <= 0
  )
    throw Error("This tree file is missing required fields.");
  if (input.people.length > 2000)
    throw Error("This file contains too many people.");
  const ids = new Set<string>();
  for (const p of input.people) {
    if (
      !isObj(p) ||
      typeof p.id !== "string" ||
      ids.has(p.id) ||
      typeof p.name !== "string" ||
      typeof p.nickname !== "string" ||
      !isDate(p.born) ||
      !isDate(p.died) ||
      !["", "female", "male", "other"].includes(String(p.sex)) ||
      typeof p.notes !== "string" ||
      !(
        p.portrait === null ||
        (typeof p.portrait === "string" &&
          /^data:image\/(jpeg|png|webp);base64,/.test(p.portrait))
      ) ||
      typeof p.x !== "number" ||
      typeof p.y !== "number" ||
      !Number.isFinite(p.x) ||
      !Number.isFinite(p.y)
    )
      throw Error("This file contains an invalid person record.");
    ids.add(p.id);
    const error = lifeDatesError(p as Person);
    if (error) throw Error(`${p.name || "Unnamed person"}: ${error}`);
  }
  const relIds = new Set<string>();
  let checked: Tree = { ...(input as Tree), version: 2, relations: [] };
  for (const r of input.relations) {
    if (!isObj(r) || typeof r.id !== "string" || relIds.has(r.id))
      throw Error("This file contains an invalid relationship.");
    relIds.add(r.id);
    if (
      r.type === "parent" &&
      r.displayRole !== undefined &&
      !["parent", "child"].includes(String(r.displayRole))
    )
      throw Error("A relationship has an invalid display role.");
    if (r.type === "parent") {
      if (
        typeof r.parentId !== "string" ||
        typeof r.childId !== "string" ||
        !ids.has(r.parentId) ||
        !ids.has(r.childId) ||
        !["biological", "adoptive", "step", "guardian", "unspecified"].includes(
          String(r.kind),
        )
      )
        throw Error(
          "A parent relationship refers to a missing person or has an invalid type.",
        );
    } else if (r.type === "partner") {
      if (
        typeof r.personA !== "string" ||
        typeof r.personB !== "string" ||
        !ids.has(r.personA) ||
        !ids.has(r.personB) ||
        !["current", "former", "unspecified"].includes(String(r.status)) ||
        !["married", "unmarried", "unspecified"].includes(String(r.union))
      )
        throw Error(
          "A partner relationship refers to a missing person or has an invalid type.",
        );
    } else if (r.type === "unassigned" && input.version === 2) {
      if (
        typeof r.personA !== "string" ||
        typeof r.personB !== "string" ||
        !ids.has(r.personA) ||
        !ids.has(r.personB) ||
        !["top", "bottom", "left", "right"].includes(String(r.sourceHandle)) ||
        !["top", "bottom", "left", "right"].includes(String(r.targetHandle))
      )
        throw Error(
          "An unassigned connection refers to a missing person or an invalid handle.",
        );
    } else throw Error("This file contains an unknown relationship type.");
    checked = addRelation(checked, r as Relation);
  }
  return checked;
}
