import { ViewportPortal } from '@xyflow/react';
import type { AlignmentGuide } from '../lib/cardAlignment';

export function AlignmentGuides({ guides }: { guides: AlignmentGuide[] }) {
  if (!guides.length) return null;
  return (
    <ViewportPortal>
      <svg className="alignment-guides" width="1" height="1" aria-hidden="true">
        {guides.map((guide) => (
          <line
            key={guide.axis}
            x1={guide.axis === 'x' ? guide.position : guide.start}
            y1={guide.axis === 'y' ? guide.position : guide.start}
            x2={guide.axis === 'x' ? guide.position : guide.end}
            y2={guide.axis === 'y' ? guide.position : guide.end}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
    </ViewportPortal>
  );
}
