import { BaseEdge, type Edge, type EdgeProps } from '@xyflow/react';

export type FamilyEdgeData = {
  path: string;
  childId?: string;
};

export function FamilyEdge({ id, data, style }: EdgeProps<Edge<FamilyEdgeData>>) {
  if (!data) return null;
  if (!data.childId)
    return <path d={data.path} style={style} fill="none" pointerEvents="none" aria-hidden="true" />;
  return <BaseEdge id={id} path={data.path} style={style} interactionWidth={20} />;
}
