import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Home, Trash2 } from "lucide-react";
import { SexIcon } from "./SexIcon";
import { personLifeLabel, type Person } from "./model";
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
export function PersonCard({ data, selected }: NodeProps<PersonNode>) {
  const p = data.person;
  const life = personLifeLabel(p);
  const kinship =
    data.isHome || data.kinship?.paths.length ? data.kinship : undefined;
  return (
    <>
      {data.selected && selected && (
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
        className={`person-card ${selected ? "selected" : ""} ${data.isHome ? "is-home" : ""}`}
        onClick={() => data.onSelect(p.id)}
        role="button"
        tabIndex={0}
        aria-label={`Edit ${p.name || "unnamed person"}${kinship ? `, ${data.isHome ? "Home person" : `${kinship.primary.label} of ${data.homeName}`}` : ""}`}
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
        {data.isHome && (
          <span
            className="person-home"
            role="img"
            aria-label="Home person"
            title="Home person"
          >
            <Home size={16} aria-hidden="true" />
          </span>
        )}
        <div className="person-avatar">
          {p.portrait ? (
            <img src={p.portrait} alt="" />
          ) : (
            <span>{(p.name[0] || "?").toUpperCase()}</span>
          )}
        </div>
        <div className="person-info">
          <strong title={p.name || "Unnamed"}>{p.name || "Unnamed"}</strong>
          {p.nickname && <small title={p.nickname}>“{p.nickname}”</small>}
          {life && <span title={life}>{life}</span>}
          {kinship && !data.isHome && (
            <span
              className="person-kinship"
              title={`${kinship.primary.label} of ${data.homeName}`}
            >
              <span className="kinship-label">{kinship.primary.label}</span>
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
