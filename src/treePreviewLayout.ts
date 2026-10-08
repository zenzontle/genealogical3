import { getSmoothStepPath, Position } from '@xyflow/react';
import { connectionHandles } from './connectionHandles';
import { connectorPath, familyConnectors, partnerGeometry, type Point } from './familyConnectors';
import { personCardSize, type HandleSide, type Person, type Relation, type Tree } from './model';

type PreviewPath = { id: string; type: Relation['type']; d: string; midpoint?: Point };
const positions = {
  top: Position.Top,
  bottom: Position.Bottom,
  left: Position.Left,
  right: Position.Right,
};

function anchor(person: Person, side: HandleSide): Point {
  const { width, height } = personCardSize;
  return {
    x: person.x + (side === 'left' ? 0 : side === 'right' ? width : width / 2),
    y: person.y + (side === 'top' ? 0 : side === 'bottom' ? height : height / 2),
  };
}

/** React Flow's smooth-step paths use M, L and Q, each with coordinate pairs. */
function pathPoints(path: string): Point[] {
  const values = (path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi) || []).map(Number);
  return Array.from({ length: values.length / 2 }, (_, i) => ({
    x: values[i * 2],
    y: values[i * 2 + 1],
  }));
}

export function treePreview(tree: Tree) {
  if (!tree.people.length) return null;
  const families = familyConnectors(tree.people, tree.relations, personCardSize);
  const grouped = new Set(families.flatMap((family) => family.relationIds));
  const paths: PreviewPath[] = families.map((family) => ({
    id: `family:${family.partner.id}`,
    type: 'parent',
    d: [family.stem, family.bar, ...family.additionalPaths, ...family.branches.map((b) => b.points)]
      .map(connectorPath)
      .join(' '),
  }));
  const byId = new Map(tree.people.map((person) => [person.id, person]));
  for (const relation of tree.relations) {
    if (grouped.has(relation.id)) continue;
    const a = byId.get(relation.type === 'parent' ? relation.parentId : relation.personA);
    const b = byId.get(relation.type === 'parent' ? relation.childId : relation.personB);
    if (!a || !b) continue;
    if (relation.type === 'partner') {
      const geometry = partnerGeometry(a, b, personCardSize);
      paths.push({
        id: relation.id,
        type: relation.type,
        d: geometry.path,
        midpoint: geometry.midpoint,
      });
      continue;
    }
    const center = (p: Person) => ({
      x: p.x + personCardSize.width / 2,
      y: p.y + personCardSize.height / 2,
    });
    const handles = connectionHandles(relation, center(a), center(b));
    const source = anchor(a, handles.sourceHandle),
      target = anchor(b, handles.targetHandle);
    const [d] = getSmoothStepPath({
      sourceX: source.x,
      sourceY: source.y,
      sourcePosition: positions[handles.sourceHandle],
      targetX: target.x,
      targetY: target.y,
      targetPosition: positions[handles.targetHandle],
    });
    paths.push({ id: relation.id, type: relation.type, d });
  }
  const points = tree.people.flatMap((person) => [
    { x: person.x, y: person.y },
    { x: person.x + personCardSize.width, y: person.y + personCardSize.height },
  ]);
  for (const path of paths) for (const point of pathPoints(path.d)) points.push(point);
  // Include the partner icon as well as the routed connector extents.
  for (const path of paths) {
    if (path.midpoint)
      points.push(
        { x: path.midpoint.x - 16, y: path.midpoint.y - 16 },
        { x: path.midpoint.x + 16, y: path.midpoint.y + 16 },
      );
  }
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const padding = 24;
  return {
    paths,
    bounds: {
      x: minX - padding,
      y: minY - padding,
      width: maxX - minX + padding * 2,
      height: maxY - minY + padding * 2,
    },
  };
}
