import { describe, expect, it } from 'vitest';
import { makePerson, makeTree, type Tree } from './model';
import {
  ancestorIds,
  collapsedBranchIds,
  descendantIds,
  resolveTreeView,
  visibleTree,
  type TreeView,
} from './treeView';

/**
 * Grandma + Grandpa → Mum (+ Dad) → Kid (+ KidPartner)
 * Grandma → Uncle. Dad's mother is DadMum. Loner has no relations.
 */
function family(): Tree {
  const tree = makeTree();
  for (const id of [
    'Grandma',
    'Grandpa',
    'Mum',
    'Dad',
    'DadMum',
    'Uncle',
    'Kid',
    'KidPartner',
    'Loner',
  ])
    tree.people.push({ ...makePerson(id), id });
  const parent = (parentId: string, childId: string) =>
    tree.relations.push({
      id: `${parentId}>${childId}`,
      type: 'parent',
      parentId,
      childId,
      kind: 'biological',
    });
  const partner = (personA: string, personB: string) =>
    tree.relations.push({
      id: `${personA}+${personB}`,
      type: 'partner',
      personA,
      personB,
      status: 'current',
      union: 'married',
    });
  parent('Grandma', 'Mum');
  parent('Grandpa', 'Mum');
  parent('Grandma', 'Uncle');
  parent('DadMum', 'Dad');
  partner('Grandma', 'Grandpa');
  partner('Mum', 'Dad');
  parent('Mum', 'Kid');
  parent('Dad', 'Kid');
  partner('Kid', 'KidPartner');
  return tree;
}
const sorted = (ids: Iterable<string>) => [...ids].sort();
const view = (tree: Tree, changes: Partial<TreeView>): TreeView => ({
  focus: null,
  collapsed: [],
  baseline: new Set(tree.people.map((p) => p.id)),
  ...changes,
});

describe('tree view filters', () => {
  it('finds ancestors through every parent link, without siblings or partners', () => {
    expect(sorted(ancestorIds(family(), 'Kid'))).toEqual(
      sorted(['Kid', 'Mum', 'Dad', 'Grandma', 'Grandpa', 'DadMum']),
    );
  });

  it('finds descendants with their partners', () => {
    expect(sorted(descendantIds(family(), 'Mum'))).toEqual(
      sorted(['Mum', 'Dad', 'Kid', 'KidPartner']),
    );
  });

  it('collapses descendants and people who are only connected to them', () => {
    const tree = family();
    // KidPartner's only link is to Kid, so it would float alone.
    expect(sorted(collapsedBranchIds(tree, 'Mum'))).toEqual(['Kid', 'KidPartner']);
    // Dad keeps his own mother, so he stays even though his child is hidden.
    expect(collapsedBranchIds(tree, 'Mum').has('Dad')).toBe(false);
    expect(sorted(collapsedBranchIds(tree, 'Grandma'))).toEqual(
      sorted(['Mum', 'Uncle', 'Kid', 'KidPartner']),
    );
  });

  it('returns null when nothing is filtered', () => {
    const tree = family();
    expect(resolveTreeView(tree, view(tree, {}))).toBeNull();
    // Kid has no children, so collapsing hides nobody.
    expect(resolveTreeView(tree, view(tree, { collapsed: ['Kid'] }))).toBeNull();
    expect(
      resolveTreeView(tree, view(tree, { focus: { personId: 'Gone', mode: 'ancestors' } })),
    ).toBeNull();
  });

  it('combines a focus with collapsed branches and counts what each hides', () => {
    const tree = family();
    const resolved = resolveTreeView(
      tree,
      view(tree, { focus: { personId: 'Grandma', mode: 'descendants' }, collapsed: ['Mum'] }),
    )!;
    expect(sorted(resolved.visible)).toEqual(sorted(['Grandma', 'Grandpa', 'Mum', 'Dad', 'Uncle']));
    expect(resolved.collapsedCounts.get('Mum')).toBe(2);
    expect(resolved.hiddenCount).toBe(4);
  });

  it('keeps people added after the view was chosen visible', () => {
    const tree = family();
    const chosen = view(tree, { focus: { personId: 'Kid', mode: 'ancestors' } });
    tree.people.push({ ...makePerson('Newcomer'), id: 'Newcomer' });
    expect(resolveTreeView(tree, chosen)!.visible.has('Newcomer')).toBe(true);
    expect(resolveTreeView(tree, chosen)!.visible.has('Loner')).toBe(false);
  });

  it('does not count people added to a collapsed branch as hidden', () => {
    const tree = family();
    const chosen = view(tree, { collapsed: ['Mum'] });
    tree.people.push({ ...makePerson('Baby'), id: 'Baby' });
    tree.relations.push({
      id: 'Mum>Baby',
      type: 'parent',
      parentId: 'Mum',
      childId: 'Baby',
      kind: 'biological',
    });
    const resolved = resolveTreeView(tree, chosen)!;
    expect(resolved.visible.has('Baby')).toBe(true);
    expect(resolved.collapsedCounts.get('Mum')).toBe(2);
    expect(resolved.hiddenCount).toBe(2);
  });

  it('drops relations that lead to hidden people', () => {
    const tree = family();
    const shown = visibleTree(tree, new Set(['Mum', 'Dad', 'Kid']));
    expect(shown.people.map((p) => p.id)).toEqual(['Mum', 'Dad', 'Kid']);
    expect(sorted(shown.relations.map((r) => r.id))).toEqual(['Dad>Kid', 'Mum+Dad', 'Mum>Kid']);
  });
});
