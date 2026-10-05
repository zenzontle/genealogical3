import { getSmoothStepPath, Position } from "@xyflow/react";
import type { Person, Relation } from "./model";

export type Point = { x: number; y: number };
export type CardSize = { width: number; height: number };
type ParentRelation = Extract<Relation, { type: "parent" }>;
type PartnerRelation = Extract<Relation, { type: "partner" }>;
export type FamilyConnector = {
  partner: PartnerRelation;
  relationIds: string[];
  stem: Point[];
  bar: Point[];
  branches: { childId: string; points: Point[] }[];
};

const pairKey = (ids: string[]) => JSON.stringify([...ids].sort());

// Match the side handles and midpoint used by the canvas partner edge.
export function partnerGeometry(a: Person, b: Person, size: CardSize) {
  const [path, x, y] = getSmoothStepPath({
    sourceX: a.x + size.width,
    sourceY: a.y + size.height / 2,
    sourcePosition: Position.Right,
    targetX: b.x,
    targetY: b.y + size.height / 2,
    targetPosition: Position.Left,
  });
  return { path, midpoint: { x, y } };
}

export function familyConnectors(
  people: Person[],
  relations: Relation[],
  size: CardSize,
): FamilyConnector[] {
  const byId = new Map(people.map((p) => [p.id, p]));
  const parents = new Map<string, ParentRelation[]>();
  const partners = new Map<string, PartnerRelation>();
  for (const relation of relations) {
    if (relation.type === "partner")
      partners.set(pairKey([relation.personA, relation.personB]), relation);
    if (relation.type === "parent") {
      const links = parents.get(relation.childId) || [];
      links.push(relation);
      parents.set(relation.childId, links);
    }
  }
  const groups = new Map<
    string,
    { child: Person; links: ParentRelation[] }[]
  >();
  for (const [childId, links] of parents) {
    const child = byId.get(childId);
    if (
      !child ||
      links.length !== 2 ||
      links[0].parentId === links[1].parentId ||
      links.some((r) => r.kind === "step" || r.kind === "guardian")
    )
      continue;
    const key = pairKey(links.map((r) => r.parentId));
    if (!partners.has(key)) continue;
    const children = groups.get(key) || [];
    children.push({ child, links });
    groups.set(key, children);
  }
  const result: FamilyConnector[] = [];
  for (const [key, children] of groups) {
    if (children.length < 2) continue;
    const partner = partners.get(key)!;
    const a = byId.get(partner.personA),
      b = byId.get(partner.personB);
    if (!a || !b) continue;
    const { midpoint } = partnerGeometry(a, b, size);
    const parentBottom = Math.max(a.y, b.y) + size.height;
    const childTop = Math.min(...children.map(({ child }) => child.y));
    // Keep the bar above every child's top handle, including freely dragged cards.
    const barY =
      childTop - parentBottom >= 64
        ? (parentBottom + childTop) / 2
        : childTop - 32;
    const branches = children.map(({ child }) => ({
      childId: child.id,
      points: [
        { x: child.x + size.width / 2, y: barY },
        { x: child.x + size.width / 2, y: child.y },
      ],
    }));
    const xs = [midpoint.x, ...branches.map((branch) => branch.points[0].x)];
    result.push({
      partner,
      relationIds: children.flatMap(({ links }) => links.map((r) => r.id)),
      stem: [midpoint, { x: midpoint.x, y: barY }],
      bar: [
        { x: Math.min(...xs), y: barY },
        { x: Math.max(...xs), y: barY },
      ],
      branches,
    });
  }
  return result;
}

export const connectorPath = (points: Point[]) =>
  points
    .map((point, i) => `${i === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");

export const connectorPoints = (families: FamilyConnector[]) =>
  families.flatMap((family) => [
    ...family.stem,
    ...family.bar,
    ...family.branches.flatMap((branch) => branch.points),
  ]);
