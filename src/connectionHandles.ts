import type { HandleSide, Relation } from './model';

type Point = { x: number; y: number };

// Typed relationships follow geometry; unassigned links retain the user's handles.
export function connectionHandles(
  relation: Relation,
  source: Point,
  target: Point,
): { sourceHandle: HandleSide; targetHandle: HandleSide } {
  if (relation.type === 'unassigned')
    return {
      sourceHandle: relation.sourceHandle,
      targetHandle: relation.targetHandle,
    };
  if (relation.type === 'partner')
    return source.x <= target.x
      ? { sourceHandle: 'right', targetHandle: 'left' }
      : { sourceHandle: 'left', targetHandle: 'right' };
  return source.y <= target.y
    ? { sourceHandle: 'bottom', targetHandle: 'top' }
    : { sourceHandle: 'top', targetHandle: 'bottom' };
}
