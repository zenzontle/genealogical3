import { personCardSize, type Tree } from './model';

/** Persist a whole drag gesture together; unchanged gestures don't add history. */
export function movePeopleToPositions(
  tree: Tree,
  movedNodes: { id: string; position: { x: number; y: number } }[],
): Tree {
  const positions = new Map(movedNodes.map((node) => [node.id, node.position]));
  let changed = false;
  const people = tree.people.map((person) => {
    const position = positions.get(person.id);
    if (!position || (person.x === position.x && person.y === position.y)) return person;
    changed = true;
    return { ...person, x: position.x, y: position.y };
  });
  return changed ? { ...tree, people } : tree;
}

export function personPositionAtViewCenter(
  viewport: Tree['viewport'],
  size: { width: number; height: number },
) {
  return {
    x: (size.width / 2 - viewport.x) / viewport.zoom - personCardSize.width / 2,
    y: (size.height / 2 - viewport.y) / viewport.zoom - personCardSize.height / 2,
  };
}
