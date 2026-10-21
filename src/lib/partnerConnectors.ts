import type { PartnerNode } from '../components/PartnerConnector';
import { partnerGeometry, type CardSize, type Point } from './familyConnectors';
import { personCardSize, type Tree } from './model';

export const partnerNodeId = (relationId: string) => `partner:${relationId}`;

export function partnerConnectors(
  tree: Tree,
  positions: Map<string, Point>,
  onSelect: (id: string) => void,
  sizes: Map<string, CardSize> = new Map(),
): PartnerNode[] {
  const people = new Map(tree.people.map((p) => [p.id, { ...p, ...positions.get(p.id) }]));
  return tree.relations.flatMap((relation) => {
    if (relation.type !== 'partner') return [];
    const a = people.get(relation.personA),
      b = people.get(relation.personB);
    if (!a || !b) return [];
    return [
      {
        id: partnerNodeId(relation.id),
        type: 'partnerConnector',
        position: partnerGeometry(a, b, personCardSize, sizes).midpoint,
        origin: [0.5, 0.5],
        width: 32,
        height: 32,
        // Keep React Flow's measured handle bounds when this derived node moves.
        measured: { width: 32, height: 32 },
        draggable: false,
        selectable: false,
        deletable: false,
        focusable: false,
        zIndex: 1001,
        data: {
          partnerId: relation.id,
          label: `Edit partner connection between ${a.name || 'unnamed person'} and ${b.name || 'unnamed person'}`,
          onSelect,
        },
      },
    ];
  });
}
