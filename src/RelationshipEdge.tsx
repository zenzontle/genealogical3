import {
  BaseEdge,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import type { Relation } from "./model";
import { relationshipIcons } from "./relationshipIcons";

type RelationshipEdgeType = Edge<{ relationshipType: Relation["type"] }>;

export function RelationshipEdge(props: EdgeProps<RelationshipEdgeType>) {
  const [path, labelX, labelY] = getSmoothStepPath(props);
  const type = props.data?.relationshipType;
  const icon =
    type === "parent" || type === "partner" ? relationshipIcons[type] : null;

  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        style={props.style}
        markerStart={props.markerStart}
        markerEnd={props.markerEnd}
        interactionWidth={props.interactionWidth}
        label={icon ? undefined : props.label}
        labelX={labelX}
        labelY={labelY}
        labelStyle={props.labelStyle}
        labelBgStyle={props.labelBgStyle}
      />
      {icon && (
        <g transform={`translate(${labelX - 12}, ${labelY - 12})`}>
          <title>{type === "parent" ? "Parent / Child" : "Partner"}</title>
          <rect
            x="-4"
            y="-4"
            width="32"
            height="32"
            rx="8"
            fill="var(--bg)"
            fillOpacity="0.96"
          />
          <g
            fill={icon.fill}
            stroke={icon.color}
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {icon.paths.map((d) => (
              <path key={d} d={d} />
            ))}
          </g>
        </g>
      )}
    </>
  );
}
