import type { Edge } from "@xyflow/react";
import {
  connectorPath,
  familyConnectors,
  type Point,
} from "./familyConnectors";
import { personCardHeight, relationLabel, type Tree } from "./model";

export function relationshipEdges(
  tree: Tree,
  positions: Map<string, Point>,
  selectedRelationId: string | null,
  onSelectChild: (id: string) => void,
): Edge[] {
  const families = familyConnectors(
    tree.people.map((p) => ({ ...p, ...(positions.get(p.id) || {}) })),
    tree.relations,
    { width: 220, height: personCardHeight(tree.homePersonId !== null) },
  );
  const groupedIds = new Set(families.flatMap((family) => family.relationIds));
  const names = new Map(tree.people.map((p) => [p.id, p.name]));
  const regularEdges: Edge[] = tree.relations
    .filter((r) => !groupedIds.has(r.id))
    .map((r) => ({
      id: r.id,
      source: r.type === "parent" ? r.parentId : r.personA,
      target: r.type === "parent" ? r.childId : r.personB,
      sourceHandle:
        r.type === "parent"
          ? "bottom"
          : r.type === "unassigned"
            ? r.sourceHandle
            : "right",
      targetHandle:
        r.type === "parent"
          ? "top"
          : r.type === "unassigned"
            ? r.targetHandle
            : "left",
      type: "relationship",
      data: { relationshipType: r.type },
      ariaLabel: relationLabel(r),
      label: relationLabel(r),
      style: {
        stroke:
          r.type === "parent"
            ? "var(--copper)"
            : r.type === "partner"
              ? "var(--partner)"
              : "var(--text-muted)",
        strokeWidth: selectedRelationId === r.id ? 3 : 2,
      },
      labelStyle: { fill: "var(--text-muted)", fontSize: 11, fontWeight: 600 },
      labelBgStyle: { fill: "var(--bg)", fillOpacity: 0.96 },
      selectable: true,
    }));
  const familyEdges: Edge[] = families.flatMap((family) => {
    const base = {
      source: family.partner.personA,
      sourceHandle: "right",
      type: "family",
      selectable: false,
      focusable: false,
      deletable: false,
      reconnectable: false,
      style: { stroke: "var(--copper)", strokeWidth: 2 },
    };
    const branches: Edge[] = family.branches.map((branch) => ({
      ...base,
      id: `family:${family.partner.id}:${branch.childId}`,
      target: branch.childId,
      targetHandle: "top",
      focusable: true,
      className: "family-branch",
      ariaRole: "button",
      ariaLabel: `Edit parents of ${names.get(branch.childId) || "unnamed person"}`,
      domAttributes: {
        "aria-describedby": undefined,
        onKeyDown: (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            onSelectChild(branch.childId);
          }
        },
      },
      data: { path: connectorPath(branch.points), childId: branch.childId },
    }));
    return [
      {
        ...base,
        id: `family:${family.partner.id}`,
        target: family.partner.personB,
        targetHandle: "left",
        data: {
          path: `${connectorPath(family.stem)} ${connectorPath(family.bar)}`,
        },
        style: { ...base.style, pointerEvents: "none" },
        domAttributes: { "aria-hidden": true },
      },
      ...branches,
    ];
  });
  // Paint shared stems behind partner icons so the heart remains unobstructed.
  return [...familyEdges, ...regularEdges];
}
