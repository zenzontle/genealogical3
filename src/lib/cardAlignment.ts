import { partnerGeometry } from './familyConnectors';
import { personCardSize, type Relation } from './model';

type AlignmentNode = {
  id: string;
  type?: string;
  position: { x: number; y: number };
  measured?: { width?: number; height?: number };
};

export type AlignmentGuide = {
  axis: 'x' | 'y';
  position: number;
  start: number;
  end: number;
};

function alignmentAnchors(nodes: AlignmentNode[], relations: Relation[]) {
  const cards = nodes.filter((node) => node.type === 'person');
  const byId = new Map(cards.map((node) => [node.id, node]));
  const sizes = new Map(
    cards.map((node) => [
      node.id,
      {
        width: node.measured?.width ?? personCardSize.width,
        height: node.measured?.height ?? personCardSize.height,
      },
    ]),
  );
  return [
    ...cards.map((node) => {
      const size = sizes.get(node.id)!;
      return {
        position: {
          x: node.position.x + size.width / 2,
          y: node.position.y + size.height / 2,
        },
        start: node.position,
        end: { x: node.position.x + size.width, y: node.position.y + size.height },
      };
    }),
    ...relations.flatMap((relation) => {
      if (relation.type !== 'partner') return [];
      const a = byId.get(relation.personA),
        b = byId.get(relation.personB);
      if (!a || !b) return [];
      const { midpoint } = partnerGeometry(
        { id: a.id, ...a.position },
        { id: b.id, ...b.position },
        personCardSize,
        sizes,
      );
      return [{ position: midpoint, start: midpoint, end: midpoint }];
    }),
  ];
}

/** Snap each axis independently within eight screen pixels, preserving group spacing. */
export function cardAlignment(
  movingNodes: AlignmentNode[],
  nodes: AlignmentNode[],
  zoom: number,
  relations: Relation[] = [],
) {
  const movingIds = new Set(movingNodes.map((node) => node.id));
  // Only hearts with both partners in the same set move by a shared offset.
  const movingAnchors = alignmentAnchors(movingNodes, relations);
  const targets = alignmentAnchors(
    nodes.filter((node) => !movingIds.has(node.id)),
    relations,
  );
  const threshold = 8 / zoom;
  const offset = { x: 0, y: 0 };
  const guides: AlignmentGuide[] = [];

  for (const axis of ['x', 'y'] as const) {
    const otherAxis = axis === 'x' ? 'y' : 'x';
    let closest: { distance: number; guide: AlignmentGuide } | undefined;

    for (const moving of movingAnchors) {
      for (const target of targets) {
        const position = target.position[axis];
        const distance = position - moving.position[axis];
        if (
          Math.abs(distance) > threshold ||
          (closest && Math.abs(distance) >= Math.abs(closest.distance))
        )
          continue;
        closest = {
          distance,
          guide: {
            axis,
            position,
            start: Math.min(moving.start[otherAxis], target.start[otherAxis]),
            end: Math.max(moving.end[otherAxis], target.end[otherAxis]),
          },
        };
      }
    }
    if (closest) {
      offset[axis] = closest.distance;
      // Cover the small correction on the other axis at either end of the guide.
      guides.push({
        ...closest.guide,
        start: closest.guide.start - threshold,
        end: closest.guide.end + threshold,
      });
    }
  }
  return { offset, guides };
}
