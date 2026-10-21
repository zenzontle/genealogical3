import { describe, expect, it, vi } from 'vitest';
import { addChildToPartners, addRelation, makePerson, makeTree, type Relation } from './model';
import { partnerConnectors, partnerNodeId } from './partnerConnectors';
import { familyConnectors, partnerGeometry } from './familyConnectors';
import { personCardSize } from './model';

function fixture() {
  const a = makePerson('Alex', 0, 0);
  const b = makePerson('Taylor', 350, 0);
  const child = makePerson('Child', 150, 300);
  const partner: Relation = {
    id: 'couple',
    type: 'partner',
    personA: a.id,
    personB: b.id,
    status: 'unspecified',
    union: 'unspecified',
  };
  const tree = { ...makeTree(), people: [a, b, child], relations: [partner] };
  return { a, b, child, partner, tree };
}

describe('connecting children from partner hearts', () => {
  it('creates ordinary parent links that use the existing family branch', () => {
    const { tree, partner, child, a, b } = fixture();
    const next = addChildToPartners(tree, partner.id, child.id);
    expect(next.relations.slice(1)).toEqual(
      [a, b].map((p) => ({
        id: expect.any(String),
        type: 'parent',
        parentId: p.id,
        childId: child.id,
        kind: 'unspecified',
      })),
    );
    expect(
      familyConnectors(next.people, next.relations, personCardSize)[0].branches[0].childId,
    ).toBe(child.id);
    expect(tree.relations).toEqual([partner]);
    expect(() => addChildToPartners(next, partner.id, child.id)).toThrow('already exists');
  });

  it('preserves an existing parent link and its details while adding the missing parent', () => {
    const { tree, partner, child, a, b } = fixture();
    const existing: Relation = {
      id: 'existing',
      type: 'parent',
      parentId: b.id,
      childId: child.id,
      kind: 'adoptive',
    };
    const next = addChildToPartners(addRelation(tree, existing), partner.id, child.id);
    expect(next.relations).toHaveLength(3);
    expect(next.relations).toContainEqual(existing);
    expect(next.relations[2]).toMatchObject({ parentId: a.id, childId: child.id });
  });

  it('rejects a cycle through the second parent without leaving a partial first link', () => {
    const { tree, partner, child, b } = fixture();
    const current = addRelation(tree, {
      id: 'ancestor',
      type: 'parent',
      parentId: child.id,
      childId: b.id,
      kind: 'unspecified',
    });
    const saved = structuredClone(current);
    expect(() => addChildToPartners(current, partner.id, child.id)).toThrow('ancestry cycle');
    expect(current).toEqual(saved);
  });

  it('rejects linking either partner as their own child and invalid endpoints', () => {
    const { tree, partner, a, b, child } = fixture();
    for (const id of [a.id, b.id]) expect(() => addChildToPartners(tree, partner.id, id)).toThrow();
    expect(() => addChildToPartners(tree, 'missing', child.id)).toThrow();
    expect(() => addChildToPartners(tree, partner.id, 'missing')).toThrow();
    expect(tree.relations).toHaveLength(1);
  });

  it('places a non-draggable heart target at the live midpoint, including measured card sizes', () => {
    const { tree, a, b, partner } = fixture();
    const positions = new Map([[a.id, { x: 700, y: 200 }]]);
    const sizes = new Map([[a.id, { width: 220, height: 180 }]]);
    const [node] = partnerConnectors(tree, positions, vi.fn(), sizes);
    expect(node).toMatchObject({
      id: partnerNodeId(partner.id),
      type: 'partnerConnector',
      draggable: false,
      selectable: false,
      deletable: false,
      position: partnerGeometry({ ...a, ...positions.get(a.id) }, b, personCardSize, sizes)
        .midpoint,
    });
    expect(partnerConnectors({ ...tree, relations: [] }, positions, vi.fn(), sizes)).toEqual([]);
  });
});
