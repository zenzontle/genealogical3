import { getSmoothStepPath, Position } from "@xyflow/react";
import type { HandleSide, Person, Relation } from "./model";

export type Point = { x: number; y: number };
export type CardSize = { width: number; height: number };
type ParentRelation = Extract<Relation, { type: "parent" }>;
type PartnerRelation = Extract<Relation, { type: "partner" }>;
export type FamilyConnector = {
  partner: PartnerRelation;
  relationIds: string[];
  stem: Point[];
  bar: Point[];
  additionalPaths: Point[][];
  branches: { childId: string; targetHandle: HandleSide; points: Point[] }[];
};

const pairKey = (ids: string[]) => JSON.stringify([...ids].sort());

// Match the side handles and midpoint used by the canvas partner edge.
export function partnerGeometry(
  a: Person,
  b: Person,
  size: CardSize,
  sizes: Map<string, CardSize> = new Map(),
) {
  const aSize = sizes.get(a.id) || size;
  const bSize = sizes.get(b.id) || size;
  const forward = a.x + aSize.width / 2 <= b.x + bSize.width / 2;
  const [path, x, y] = getSmoothStepPath({
    sourceX: a.x + (forward ? aSize.width : 0),
    sourceY: a.y + aSize.height / 2,
    sourcePosition: forward ? Position.Right : Position.Left,
    targetX: b.x + (forward ? 0 : bSize.width),
    targetY: b.y + bSize.height / 2,
    targetPosition: forward ? Position.Left : Position.Right,
  });
  return { path, midpoint: { x, y } };
}

export function familyConnectors(
  people: Person[],
  relations: Relation[],
  size: CardSize,
  sizes: Map<string, CardSize> = new Map(),
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
    const partner = partners.get(key)!;
    const a = byId.get(partner.personA),
      b = byId.get(partner.personB);
    if (!a || !b) continue;
    const cardSize = (p: Person) => sizes.get(p.id) || size;
    const { midpoint } = partnerGeometry(a, b, size, sizes);
    // Children on opposite sides of their parents get separate sibling bars.
    const paths = [false, true].flatMap((above) => {
      const sideChildren = children.filter(
        ({ child }) =>
          child.y + cardSize(child).height / 2 < midpoint.y === above,
      );
      if (!sideChildren.length) return [];
      const parentEdge = above
        ? Math.min(a.y, b.y)
        : Math.max(a.y + cardSize(a).height, b.y + cardSize(b).height);
      const childEdge = above
        ? Math.max(
            ...sideChildren.map(
              ({ child }) => child.y + cardSize(child).height,
            ),
          )
        : Math.min(...sideChildren.map(({ child }) => child.y));
      const gap = above ? parentEdge - childEdge : childEdge - parentEdge;
      const barY =
        gap >= 64
          ? (parentEdge + childEdge) / 2
          : childEdge + (above ? 32 : -32);
      const branches = sideChildren.map(({ child }) => ({
        childId: child.id,
        targetHandle: above ? ("bottom" as const) : ("top" as const),
        points: [
          { x: child.x + cardSize(child).width / 2, y: barY },
          {
            x: child.x + cardSize(child).width / 2,
            y: child.y + (above ? cardSize(child).height : 0),
          },
        ],
      }));
      const xs = [midpoint.x, ...branches.map((branch) => branch.points[0].x)];
      return [
        {
          stem: [midpoint, { x: midpoint.x, y: barY }],
          bar: [
            { x: Math.min(...xs), y: barY },
            { x: Math.max(...xs), y: barY },
          ],
          branches,
        },
      ];
    });
    result.push({
      partner,
      relationIds: children.flatMap(({ links }) => links.map((r) => r.id)),
      stem: paths[0].stem,
      bar: paths[0].bar,
      additionalPaths: paths.slice(1).flatMap((path) => [path.stem, path.bar]),
      branches: paths.flatMap((path) => path.branches),
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
    ...family.additionalPaths.flat(),
    ...family.branches.flatMap((branch) => branch.points),
  ]);
