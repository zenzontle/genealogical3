import { Trash2, X } from 'lucide-react';
import { RelationshipFields } from './RelationshipFields';
import { relationLabel, type Person, type Relation } from './model';

export function RelationshipEditor({
  relation,
  people,
  onChange,
  onDelete,
  onClose,
}: {
  relation: Relation;
  people: Person[];
  onChange: (relation: Relation) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <div className="editor-content">
      <div className="panel-title">
        <div>
          <p className="eyebrow">RELATIONSHIP</p>
          <h2>{relationLabel(relation)}</h2>
        </div>
        <button className="icon-button" aria-label="Close details" onClick={onClose}>
          <X size={19} />
        </button>
      </div>
      <RelationshipFields relation={relation} people={people} onChange={onChange} />
      <button className="button danger" onClick={onDelete}>
        <Trash2 size={16} /> Remove relationship
      </button>
    </div>
  );
}
