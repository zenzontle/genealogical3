import { movePeopleToPositions } from './canvasPosition';
import type { CardSize } from './familyConnectors';
import { personCardSize, type Person, type Tree } from './model';

const PARTNER_GAP = 120;
const UNIT_GAP = 60;
// Keeps sibling bars centered between rows (familyConnectors needs at least 64px).
const ROW_GAP = 84;
const COMPONENT_GAP = 240;
const ORDER_SWEEPS = 4;
const POSITION_PASSES = 8;

/** Partners laid out side by side; a unit occupies one slot in its generation row. */
type Unit = {
  members: Person[];
  centers: Map<string, number>;
  width: number;
  height: number;
  gen: number;
  x: number;
  originX: number;
  originY: number;
  parents: Set<Unit>;
  children: Set<Unit>;
  neighbors: Set<Unit>;
};

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

/** Place each item as close to its desired x as possible without overlaps, keeping order. */
function packRow(row: Unit[], desired: number[]) {
  const offsets: number[] = [];
  let offset = 0;
  for (const unit of row) {
    offsets.push(offset);
    offset += unit.width + UNIT_GAP;
  }
  // Pool-adjacent-violators: blocks of touching units sit at their mean desired position.
  const blocks: { start: number; sum: number; count: number }[] = [];
  row.forEach((_, i) => {
    let block = { start: i, sum: desired[i] - offsets[i], count: 1 };
    while (blocks.length && blocks.at(-1)!.sum / blocks.at(-1)!.count > block.sum / block.count) {
      const previous = blocks.pop()!;
      block = {
        start: previous.start,
        sum: previous.sum + block.sum,
        count: previous.count + block.count,
      };
    }
    blocks.push(block);
  });
  for (const block of blocks)
    for (let i = block.start; i < block.start + block.count; i++)
      row[i].x = block.sum / block.count + offsets[i];
}

/**
 * Lay the tree out by generation: parents above children, partners side by side,
 * children centered under their parents. Unconnected groups sit next to each other.
 */
export function arrangeTree(tree: Tree, sizes: Map<string, CardSize> = new Map()): Tree {
  const { people } = tree;
  if (people.length < 2) return tree;
  const byId = new Map(people.map((p) => [p.id, p]));
  const size = (p: Person) => sizes.get(p.id) ?? personCardSize;

  const partners = new Map<string, string[]>();
  const personParents = new Map<string, string[]>();
  const personChildren = new Map<string, string[]>();
  const parentLinks: [string, string][] = [];
  const otherLinks: [string, string][] = [];
  const push = (map: Map<string, string[]>, key: string, value: string) =>
    map.set(key, [...(map.get(key) || []), value]);
  for (const relation of tree.relations) {
    const [a, b] =
      relation.type === 'parent'
        ? [relation.parentId, relation.childId]
        : [relation.personA, relation.personB];
    if (a === b || !byId.has(a) || !byId.has(b)) continue;
    if (relation.type === 'parent') {
      parentLinks.push([a, b]);
      push(personParents, b, a);
      push(personChildren, a, b);
    } else if (relation.type === 'partner') {
      push(partners, a, b);
      push(partners, b, a);
    } else otherLinks.push([a, b]);
  }

  // Partners (including chains such as remarriages) share a unit.
  const units: Unit[] = [];
  const unitOf = new Map<string, Unit>();
  const byX = (a: Person, b: Person) => a.x - b.x;
  for (const person of [...people].sort(byX)) {
    if (unitOf.has(person.id)) continue;
    const group: Person[] = [];
    const stack = [person];
    const found = new Set([person.id]);
    while (stack.length) {
      const current = stack.pop()!;
      group.push(current);
      for (const id of partners.get(current.id) || [])
        if (!found.has(id)) {
          found.add(id);
          stack.push(byId.get(id)!);
        }
    }
    group.sort(byX);
    // Walk the partner chain from an end so each couple stays adjacent.
    const members: Person[] = [];
    const visit = (p: Person) => {
      if (members.includes(p)) return;
      members.push(p);
      for (const id of [...(partners.get(p.id) || [])].sort((a, b) =>
        byX(byId.get(a)!, byId.get(b)!),
      ))
        visit(byId.get(id)!);
    };
    visit(group.find((p) => (partners.get(p.id)?.length ?? 0) <= 1) ?? group[0]);
    const unit: Unit = {
      members,
      centers: new Map(),
      width: 0,
      height: Math.max(...members.map((p) => size(p).height)),
      gen: 0,
      x: 0,
      originX: mean(members.map((p) => p.x)),
      originY: Math.min(...members.map((p) => p.y)),
      parents: new Set(),
      children: new Set(),
      neighbors: new Set(),
    };
    for (const member of members) unitOf.set(member.id, unit);
    units.push(unit);
  }
  const measureUnit = (unit: Unit) => {
    let left = 0;
    unit.members.forEach((member, i) => {
      if (i) left += PARTNER_GAP;
      unit.centers.set(member.id, left + size(member).width / 2);
      left += size(member).width;
    });
    unit.width = left;
  };
  units.forEach(measureUnit);
  for (const [parentId, childId] of parentLinks) {
    const parent = unitOf.get(parentId)!,
      child = unitOf.get(childId)!;
    if (parent === child) continue;
    parent.children.add(child);
    child.parents.add(parent);
  }
  for (const [a, b] of otherLinks) {
    const first = unitOf.get(a)!,
      second = unitOf.get(b)!;
    if (first === second) continue;
    first.neighbors.add(second);
    second.neighbors.add(first);
  }

  // Generations: longest path from the roots. A cycle in bad data is broken at its topmost card.
  const waiting = new Map(units.map((unit) => [unit, unit.parents.size]));
  const order: Unit[] = [];
  const done = new Set<Unit>();
  const ready = units.filter((unit) => !unit.parents.size);
  while (order.length < units.length) {
    const unit =
      ready.pop() ??
      units.filter((u) => !done.has(u)).reduce((top, u) => (u.originY < top.originY ? u : top));
    if (done.has(unit)) continue;
    done.add(unit);
    order.push(unit);
    for (const child of unit.children) {
      if (done.has(child)) continue;
      child.gen = Math.max(child.gen, unit.gen + 1);
      waiting.set(child, waiting.get(child)! - 1);
      if (!waiting.get(child)) ready.push(child);
    }
  }
  // Ancestors who only connect through a child (e.g. in-laws' parents) sit just above that child.
  for (const unit of [...order].reverse())
    if (!unit.parents.size && unit.children.size)
      unit.gen = Math.max(unit.gen, Math.min(...[...unit.children].map((c) => c.gen)) - 1);

  // Connected groups are arranged separately, the home person's group first.
  const components: Unit[][] = [];
  const componentOf = new Set<Unit>();
  for (const start of units) {
    if (componentOf.has(start)) continue;
    const component: Unit[] = [];
    const stack = [start];
    componentOf.add(start);
    while (stack.length) {
      const unit = stack.pop()!;
      component.push(unit);
      for (const next of [...unit.parents, ...unit.children, ...unit.neighbors])
        if (!componentOf.has(next)) {
          componentOf.add(next);
          stack.push(next);
        }
    }
    components.push(component);
  }
  const home = tree.homePersonId ? unitOf.get(tree.homePersonId) : undefined;
  components.sort(
    (a, b) =>
      Number(b.includes(home!)) - Number(a.includes(home!)) ||
      Math.min(...a.map((u) => u.originX)) - Math.min(...b.map((u) => u.originX)),
  );

  const positions = new Map<string, { x: number; y: number }>();
  let cursor = 0;
  for (const component of components) {
    const gens = [...new Set(component.map((unit) => unit.gen))].sort((a, b) => a - b);
    const rowOf = new Map(component.map((unit) => [unit, gens.indexOf(unit.gen)]));
    const rows: Unit[][] = gens.map(() => []);

    // Initial order: depth-first through relatives, nearest (by current x) first.
    const placed = new Set<Unit>();
    const byOrigin = (a: Unit, b: Unit) => a.originX - b.originX;
    for (const start of [...component].sort((a, b) => a.gen - b.gen || byOrigin(a, b))) {
      const stack = [start];
      while (stack.length) {
        const unit = stack.pop()!;
        if (placed.has(unit)) continue;
        placed.add(unit);
        rows[rowOf.get(unit)!].push(unit);
        const next = [...unit.parents, ...unit.children, ...unit.neighbors].sort(byOrigin);
        for (const relative of next.reverse()) if (!placed.has(relative)) stack.push(relative);
      }
    }

    // Barycenter sweeps reduce crossings between generations.
    const index = new Map<Unit, number>();
    const reindex = () => rows.forEach((row) => row.forEach((unit, i) => index.set(unit, i)));
    const sortRow = (row: Unit[], related: (unit: Unit) => Set<Unit>) => {
      const keys = new Map(
        row.map((unit) => {
          const indices = [...related(unit)].map((r) => index.get(r)!);
          return [unit, indices.length ? mean(indices) : index.get(unit)!];
        }),
      );
      row.sort((a, b) => keys.get(a)! - keys.get(b)!);
      row.forEach((unit, i) => index.set(unit, i));
    };
    const personIndex = (id: string) => index.get(unitOf.get(id)!)!;
    reindex();
    for (let sweep = 0; sweep < ORDER_SWEEPS; sweep++) {
      for (let r = 1; r < rows.length; r++) sortRow(rows[r], (unit) => unit.parents);
      for (let r = rows.length - 2; r >= 0; r--) sortRow(rows[r], (unit) => unit.children);
    }
    // Put each partner on the side nearer their own parents.
    for (const unit of component) {
      if (unit.members.length !== 2) continue;
      const side = unit.members.map((m) => {
        const parents = personParents.get(m.id) || [];
        return parents.length ? mean(parents.map(personIndex)) : null;
      });
      if (side[0] !== null && side[1] !== null && side[0] > side[1]) {
        unit.members.reverse();
        measureUnit(unit);
      }
    }

    // Alternate centering children under parents and parents over children.
    const center = (id: string) => unitOf.get(id)!.x + unitOf.get(id)!.centers.get(id)!;
    for (const row of rows)
      packRow(
        row,
        row.map(() => 0),
      );
    const pullDown = (row: Unit[]) =>
      packRow(
        row,
        row.map((unit) => {
          const wants = unit.members.flatMap((m) => {
            const parents = personParents.get(m.id) || [];
            return parents.length ? [mean(parents.map(center)) - unit.centers.get(m.id)!] : [];
          });
          return wants.length ? mean(wants) : unit.x;
        }),
      );
    const pullUp = (row: Unit[]) =>
      packRow(
        row,
        row.map((unit) => {
          const children = new Set(unit.members.flatMap((m) => personChildren.get(m.id) || []));
          const wants = [...children].flatMap((childId) => {
            const anchors = (personParents.get(childId) || []).filter(
              (id) => unitOf.get(id) === unit,
            );
            if (!anchors.length || unitOf.get(childId) === unit) return [];
            return [center(childId) - mean(anchors.map((id) => unit.centers.get(id)!))];
          });
          return wants.length ? mean(wants) : unit.x;
        }),
      );
    for (let pass = 0; pass < POSITION_PASSES; pass++) {
      for (let r = 1; r < rows.length; r++) pullDown(rows[r]);
      for (let r = rows.length - 2; r >= 0; r--) pullUp(rows[r]);
    }

    const left = Math.min(...component.map((unit) => unit.x));
    const right = Math.max(...component.map((unit) => unit.x + unit.width));
    let top = 0;
    for (const row of rows) {
      for (const unit of row)
        for (const member of unit.members)
          positions.set(member.id, {
            x: cursor + unit.x - left + unit.centers.get(member.id)! - size(member).width / 2,
            y: top,
          });
      top += Math.max(...row.map((unit) => unit.height)) + ROW_GAP;
    }
    cursor += right - left + COMPONENT_GAP;
  }

  // Keep the home person (or the tree's top-left corner) where it was so the canvas doesn't jump.
  const anchor = tree.homePersonId ? byId.get(tree.homePersonId) : undefined;
  const placedValues = [...positions.values()];
  const shift = anchor
    ? {
        x: anchor.x - positions.get(anchor.id)!.x,
        y: anchor.y - positions.get(anchor.id)!.y,
      }
    : {
        x: Math.min(...people.map((p) => p.x)) - Math.min(...placedValues.map((p) => p.x)),
        y: Math.min(...people.map((p) => p.y)) - Math.min(...placedValues.map((p) => p.y)),
      };
  return movePeopleToPositions(
    tree,
    [...positions].map(([id, position]) => ({
      id,
      position: { x: Math.round(position.x + shift.x), y: Math.round(position.y + shift.y) },
    })),
  );
}
