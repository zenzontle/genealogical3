import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Home, Trash2 } from "lucide-react";
import { SexIcon } from "./SexIcon";
import { personAgeLabel, dateYearLabel, type Person } from "./model";
import type { KinshipResult } from "./kinship";
export type PersonNode = Node<
  {
    person: Person;
    selected: boolean;
    homeName: string | null;
    isHome: boolean;
    kinship?: KinshipResult;
    onSelect: (id: string) => void;
    onDelete: (id: string) => void;
  },
  "person"
>;
export function PersonCard({ data }: NodeProps<PersonNode>) {
  const p = data.person;
  const age = personAgeLabel(p);
  return (
    <>
      {data.selected && (
        <button
          className="person-delete nodrag nopan"
          type="button"
          aria-label={`Delete ${p.name || "this person"}`}
          title="Delete person"
          onClick={(event) => {
            event.stopPropagation();
            data.onDelete(p.id);
          }}
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
      )}
      <div
        className={`person-card ${data.selected ? "selected" : ""} ${data.homeName !== null ? "has-home" : ""} ${data.isHome ? "is-home" : ""}`}
        onClick={() => data.onSelect(p.id)}
        role="button"
        tabIndex={0}
        aria-label={`Edit ${p.name || "unnamed person"}${data.kinship ? `, ${data.isHome ? "Home person" : `${data.kinship.primary.label} of ${data.homeName}`}` : ""}`}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            data.onSelect(p.id);
          }
        }}
      >
        <Handle
          id="top"
          type="source"
          position={Position.Top}
          className="family-handle"
          title="Parent or child connection"
        />
        <Handle
          id="bottom"
          type="source"
          position={Position.Bottom}
          className="family-handle"
          title="Parent or child connection"
        />
        <Handle
          id="left"
          type="source"
          position={Position.Left}
          className="family-handle partner-handle"
          title="Partner connection"
        />
        <Handle
          id="right"
          type="source"
          position={Position.Right}
          className="family-handle partner-handle"
          title="Partner connection"
        />
        <div className="person-avatar">
          {p.portrait ? (
            <img src={p.portrait} alt="" />
          ) : (
            <span>{(p.name[0] || "?").toUpperCase()}</span>
          )}
        </div>
        <div className="person-info">
          <strong>{p.name || "Unnamed"}</strong>
          {p.nickname && <small>“{p.nickname}”</small>}
          {(p.born.precision !== "unknown" ||
            p.died.precision !== "unknown") && (
            <span>
              {dateYearLabel(p.born)}
              {p.died.precision !== "unknown"
                ? `${p.born.precision === "unknown" ? "Died " : " — "}${dateYearLabel(p.died)}`
                : ""}
            </span>
          )}
          {age && <span className="person-age">{age}</span>}
          {data.kinship && (
            <span
              className="person-kinship"
              title={
                data.isHome
                  ? "Home person"
                  : `${data.kinship.primary.label} of ${data.homeName}`
              }
            >
              {data.isHome && <Home size={12} aria-hidden="true" />}
              <span className="kinship-label">
                {data.kinship.primary.label}
              </span>
            </span>
          )}
        </div>
        {(p.sex === "male" || p.sex === "female") && (
          <span
            className={`person-sex sex-${p.sex}`}
            role="img"
            aria-label={p.sex === "male" ? "Male" : "Female"}
            title={p.sex === "male" ? "Male" : "Female"}
          >
            <SexIcon sex={p.sex} size={16} />
          </span>
        )}
      </div>
    </>
  );
}
