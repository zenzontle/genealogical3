import {
  changeRelationRole,
  relationEndpoints,
  setRelationParent,
  type ParentKind,
  type PartnerStatus,
  type Person,
  type Relation,
  type RelationshipRole,
  type UnionKind,
} from "./model";

export function RelationshipFields({
  relation,
  people,
  referenceId,
  onChange,
}: {
  relation: Relation;
  people: Person[];
  referenceId?: string;
  onChange: (relation: Relation) => void;
}) {
  const [a, b] = relationEndpoints(relation);
  const subjectId =
    referenceId ||
    (relation.type === "parent" && relation.displayRole === "parent" ? b : a);
  const otherId = subjectId === a ? b : a;
  const name = (id: string) =>
    people.find((p) => p.id === id)?.name || "Unnamed person";
  const role = relation.type === "parent" ? "parent-child" : relation.type;
  return (
    <div className="relationship-fields">
      <label>
        Relationship between {name(subjectId)} and {name(otherId)}
        <select
          aria-label={`Relationship of ${name(otherId)} to ${name(subjectId)}`}
          value={role}
          onChange={(e) =>
            onChange(
              changeRelationRole(
                relation,
                subjectId,
                e.target.value as RelationshipRole,
              ),
            )
          }
        >
          <option value="unassigned">Not set</option>
          <option value="parent-child">Parent / Child</option>
          <option value="partner">Partner</option>
        </select>
      </label>
      {relation.type === "parent" && (
        <label>
          Parent
          <select
            aria-label={`Parent in relationship between ${name(a)} and ${name(b)}`}
            value={relation.parentId}
            onChange={(e) =>
              onChange(setRelationParent(relation, e.target.value))
            }
          >
            <option value={subjectId}>{name(subjectId)}</option>
            <option value={otherId}>{name(otherId)}</option>
          </select>
        </label>
      )}
      {relation.type === "parent" && (
        <label>
          Parent type
          <select
            value={relation.kind}
            aria-label={`Parent type with ${name(otherId)}`}
            onChange={(e) =>
              onChange({ ...relation, kind: e.target.value as ParentKind })
            }
          >
            <option value="unspecified">Unspecified</option>
            <option value="biological">Biological</option>
            <option value="adoptive">Adoptive</option>
            <option value="step">Step</option>
            <option value="guardian">Guardian</option>
          </select>
        </label>
      )}
      {relation.type === "partner" && (
        <div className="relation-selects">
          <label>
            Status
            <select
              value={relation.status}
              aria-label={`Partner status with ${name(otherId)}`}
              onChange={(e) =>
                onChange({
                  ...relation,
                  status: e.target.value as PartnerStatus,
                })
              }
            >
              <option value="unspecified">Unspecified</option>
              <option value="current">Current</option>
              <option value="former">Former</option>
            </select>
          </label>
          <label>
            Union type
            <select
              value={relation.union}
              aria-label={`Union type with ${name(otherId)}`}
              onChange={(e) =>
                onChange({ ...relation, union: e.target.value as UnionKind })
              }
            >
              <option value="unspecified">Unspecified</option>
              <option value="married">Married</option>
              <option value="unmarried">Unmarried</option>
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
