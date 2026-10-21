import { personCardSize } from './model';

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

/** Snap each axis independently within eight screen pixels, preserving group spacing. */
export function cardAlignment(movingNodes: AlignmentNode[], nodes: AlignmentNode[], zoom: number) {
  const movingIds = new Set(movingNodes.map((node) => node.id));
  const targets = nodes.filter((node) => node.type === 'person' && !movingIds.has(node.id));
  const threshold = 8 / zoom;
  const offset = { x: 0, y: 0 };
  const guides: AlignmentGuide[] = [];

  for (const axis of ['x', 'y'] as const) {
    const size = axis === 'x' ? 'width' : 'height';
    const otherAxis = axis === 'x' ? 'y' : 'x';
    const otherSize = axis === 'x' ? 'height' : 'width';
    let closest: { distance: number; guide: AlignmentGuide } | undefined;

    for (const moving of movingNodes) {
      if (moving.type !== 'person') continue;
      for (const target of targets) {
        // Prefer center guides when equal-sized cards have several matching anchors.
        for (const anchor of [0.5, 0, 1]) {
          const position =
            target.position[axis] + (target.measured?.[size] ?? personCardSize[size]) * anchor;
          const distance =
            position -
            moving.position[axis] -
            (moving.measured?.[size] ?? personCardSize[size]) * anchor;
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
              start: Math.min(moving.position[otherAxis], target.position[otherAxis]),
              end: Math.max(
                moving.position[otherAxis] +
                  (moving.measured?.[otherSize] ?? personCardSize[otherSize]),
                target.position[otherAxis] +
                  (target.measured?.[otherSize] ?? personCardSize[otherSize]),
              ),
            },
          };
        }
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
