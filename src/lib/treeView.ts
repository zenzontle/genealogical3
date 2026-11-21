import { relationEndpoints, type Tree } from './model';

export type FocusMode = 'ancestors' | 'descendants';
export type TreeFocus = { personId: string; mode: FocusMode };
/** Canvas-only filters. They are never saved, so exports and backups keep everyone. */
export type TreeView = {
  focus: TreeFocus | null;
  collapsed: readonly string[];
  /** People who existed when the view was chosen; anyone added later stays visible. */
  baseline: ReadonlySet<string>;
};
export type ResolvedTreeView = {
  visible: ReadonlySet<string>;
  hiddenCount: number;
  /** People hidden by each collapsed branch, keyed by the collapsed person. */
  collapsedCounts: ReadonlyMap<string, number>;
  focus: TreeFocus | null;
};
type Graph = Pick<Tree, 'people' | 'relations'>;

function walk(start: string, next: Map<string, string[]>): Set<string> {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    for (const id of next.get(queue.pop()!) || [])
      if (!seen.has(id)) {
        seen.add(id);
        queue.push(id);
      }
  }
  return seen;
}

function links(tree: Graph) {
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  const partners = new Map<string, string[]>();
  const neighbours = new Map<string, string[]>();
  const push = (map: Map<string, string[]>, key: string, value: string) =>
    map.set(key, [...(map.get(key) || []), value]);
  for (const relation of tree.relations) {
    const [a, b] = relationEndpoints(relation);
    push(neighbours, a, b);
    push(neighbours, b, a);
    if (relation.type === 'parent') {
      push(parents, relation.childId, relation.parentId);
      push(children, relation.parentId, relation.childId);
    } else if (relation.type === 'partner') {
      push(partners, a, b);
      push(partners, b, a);
    }
  }
  return { parents, children, partners, neighbours };
}

/** The person and everyone above them through any kind of parent link. */
export function ancestorIds(tree: Graph, personId: string): Set<string> {
  return walk(personId, links(tree).parents);
}

/** The person, everyone below them, and the partners of all of those people. */
export function descendantIds(tree: Graph, personId: string): Set<string> {
  const { children, partners } = links(tree);
  const line = walk(personId, children);
  return new Set([...line, ...[...line].flatMap((id) => partners.get(id) || [])]);
}

/**
 * Everyone a collapsed person's branch hides: their descendants, plus anyone whose
 * only recorded connections lead into that branch, such as a grandchild's partner.
 */
export function collapsedBranchIds(tree: Graph, personId: string): Set<string> {
  const { children, neighbours } = links(tree);
  const hidden = walk(personId, children);
  hidden.delete(personId);
  for (let changed = hidden.size > 0; changed;) {
    changed = false;
    for (const { id } of tree.people) {
      if (id === personId || hidden.has(id)) continue;
      const others = neighbours.get(id) || [];
      if (others.length && others.every((other) => hidden.has(other))) {
        hidden.add(id);
        changed = true;
      }
    }
  }
  return hidden;
}

/** Returns null when the view hides nobody and has no focus, so the canvas shows everyone. */
export function resolveTreeView(tree: Graph, view: TreeView): ResolvedTreeView | null {
  const ids = new Set(tree.people.map((p) => p.id));
  const focus = view.focus && ids.has(view.focus.personId) ? view.focus : null;
  const focused = focus
    ? focus.mode === 'ancestors'
      ? ancestorIds(tree, focus.personId)
      : descendantIds(tree, focus.personId)
    : ids;
  const hidden = new Set<string>();
  const collapsedCounts = new Map<string, number>();
  for (const id of view.collapsed) {
    if (!focused.has(id)) continue;
    // People added after the view was chosen stay visible, so they are not counted.
    const branch = [...collapsedBranchIds(tree, id)].filter(
      (other) => focused.has(other) && view.baseline.has(other),
    );
    branch.forEach((other) => hidden.add(other));
    collapsedCounts.set(id, branch.length);
  }
  const visible = new Set(
    tree.people
      .map((p) => p.id)
      .filter((id) => !view.baseline.has(id) || (focused.has(id) && !hidden.has(id))),
  );
  const hiddenCount = ids.size - visible.size;
  if (!focus && !hiddenCount) return null;
  return { visible, hiddenCount, collapsedCounts, focus };
}

/** The part of a tree a view shows; relations need both people to be visible. */
export function visibleTree<T extends Graph>(tree: T, visible: ReadonlySet<string>): T {
  return {
    ...tree,
    people: tree.people.filter((p) => visible.has(p.id)),
    relations: tree.relations.filter((r) => relationEndpoints(r).every((id) => visible.has(id))),
  };
}
