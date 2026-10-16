import type { Edge } from '@xyflow/react';
import { connectorPath, familyConnectors, type Point, type CardSize } from './familyConnectors';
import { connectionHandles } from './connectionHandles';
import { personCardSize, relationLabel, type Tree } from './model';

export function relationshipEdges(
  tree: Tree,
  positions: Map<string, Point>,
  selectedRelationId: string | null,
  onSelectChild: (id: string) => void,
  sizes: Map<string, CardSize> = new Map(),
): Edge[] {
  const people = tree.people.map((p) => ({
    ...p,
    ...(positions.get(p.id) || {}),
  }));
  const byId = new Map(
    people.map((p) => {
      const size = sizes.get(p.id) || personCardSize;
      return [p.id, { x: p.x + size.width / 2, y: p.y + size.height / 2 }];
    }),
  );
  const families = familyConnectors(people, tree.relations, personCardSize, sizes);
  const groupedIds = new Set(families.flatMap((family) => family.relationIds));
  const names = new Map(tree.people.map((p) => [p.id, p.name]));
  const regularEdges: Edge[] = tree.relations
    .filter((r) => !groupedIds.has(r.id))
    .map((r) => ({
      id: r.id,
      source: r.type === 'parent' ? r.parentId : r.personA,
      target: r.type === 'parent' ? r.childId : r.personB,
      ...connectionHandles(
        r,
        byId.get(r.type === 'parent' ? r.parentId : r.personA)!,
        byId.get(r.type === 'parent' ? r.childId : r.personB)!,
      ),
      type: 'relationship',
      data: { relationshipType: r.type },
      ariaLabel: relationLabel(r),
      label: relationLabel(r),
      style: {
        stroke:
          r.type === 'parent'
            ? 'var(--copper)'
            : r.type === 'partner'
              ? 'var(--partner)'
              : 'var(--text-muted)',
        strokeWidth: selectedRelationId === r.id ? 3 : 2,
      },
      labelStyle: { fill: 'var(--text-muted)', fontSize: 11, fontWeight: 600 },
      labelBgStyle: { fill: 'var(--bg)', fillOpacity: 0.96 },
      selectable: true,
    }));
  const familyEdges: Edge[] = families.flatMap((family) => {
    const handles = connectionHandles(
      family.partner,
      byId.get(family.partner.personA)!,
      byId.get(family.partner.personB)!,
    );
    const base = {
      source: family.partner.personA,
      sourceHandle: handles.sourceHandle,
      type: 'family',
      selectable: false,
      focusable: false,
      deletable: false,
      reconnectable: false,
      style: { stroke: 'var(--copper)', strokeWidth: 2 },
    };
    const branches: Edge[] = family.branches.map((branch) => ({
      ...base,
      id: `family:${family.partner.id}:${branch.childId}`,
      target: branch.childId,
      targetHandle: branch.targetHandle,
      focusable: true,
      className: 'family-branch',
      ariaRole: 'button',
      ariaLabel: `Edit parents of ${names.get(branch.childId) || 'unnamed person'}`,
      domAttributes: {
        'aria-describedby': undefined,
        onKeyDown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
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
        targetHandle: handles.targetHandle,
        data: {
          path: [family.stem, family.bar, ...family.additionalPaths].map(connectorPath).join(' '),
        },
        style: { ...base.style, pointerEvents: 'none' },
        domAttributes: { 'aria-hidden': true },
      },
      ...branches,
    ];
  });
  // Paint shared stems behind partner icons so the heart remains unobstructed.
  return [...familyEdges, ...regularEdges];
}
