import { useRef } from 'react';
import { ChevronDown, ImagePlus, Trash2, X } from 'lucide-react';
import { DateInput } from './DateInput';
import { HomePersonDetails } from './HomePersonDetails';
import { RelationshipFields } from './RelationshipFields';
import { SexIcon } from './SexIcon';
import { partnerKinshipLabel, type KinshipResult } from './kinship';
import { portraitData } from './media';
import {
  lifeDatesError,
  personLifeStatus,
  relationLabel,
  type LifeDates,
  type Person,
  type Relation,
} from './model';
import { setPersonName } from './personNames';

export type ConnectMode = 'parent' | 'child' | 'partner' | null;

export function PersonEditor({
  person,
  home,
  kinship,
  onSetHome,
  dates,
  onDatesChange,
  relations,
  people,
  onChange,
  onDelete,
  onAddRelative,
  connectMode,
  setConnectMode,
  onConnectTo,
  onRemoveRelation,
  onUpdateRelation,
  onClose,
}: {
  person: Person;
  home: Person | null;
  kinship?: KinshipResult;
  onSetHome: (id: string | null) => void;
  dates: LifeDates;
  onDatesChange: (changes: Partial<LifeDates>) => void;
  relations: Relation[];
  people: Person[];
  onChange: (p: Person) => void;
  onDelete: () => void;
  onAddRelative: (type: Exclude<ConnectMode, null>) => void;
  connectMode: ConnectMode;
  setConnectMode: (mode: ConnectMode) => void;
  onConnectTo: (targetId: string) => void;
  onRemoveRelation: (id: string) => void;
  onUpdateRelation: (relation: Relation) => void;
  onClose: () => void;
}) {
  const portraitInput = useRef<HTMLInputElement>(null);
  const dateError = lifeDatesError(dates);
  const dateErrorId = `date-error-${person.id}`;
  const attached = relations.filter((r) =>
    r.type === 'parent'
      ? r.parentId === person.id || r.childId === person.id
      : r.personA === person.id || r.personB === person.id,
  );
  const otherPerson = (r: Relation) =>
    people.find(
      (p) =>
        p.id ===
        (r.type === 'parent'
          ? r.parentId === person.id
            ? r.childId
            : r.parentId
          : r.personA === person.id
            ? r.personB
            : r.personA),
    );
  const other = (r: Relation) => otherPerson(r)?.name || 'Unnamed person';
  return (
    <div className="editor-content">
      <div className="panel-title">
        <div>
          <p className="eyebrow">PERSON DETAILS</p>
          <h2>{person.name || 'Unnamed person'}</h2>
        </div>
        <button className="icon-button" aria-label="Close details" onClick={onClose}>
          <X size={19} />
        </button>
      </div>
      <HomePersonDetails
        person={person}
        home={home}
        people={people}
        kinship={kinship}
        onSetHome={onSetHome}
      />
      <div className="portrait-upload">
        <button
          type="button"
          className="portrait-preview"
          aria-label={person.portrait ? 'Change photo' : 'Add photo'}
          title={person.portrait ? 'Change photo' : 'Add photo'}
          onClick={() => portraitInput.current?.click()}
        >
          {person.portrait ? (
            <img src={person.portrait} alt="Portrait" />
          ) : (
            <span>{(person.name[0] || '?').toUpperCase()}</span>
          )}
          <span className="portrait-upload-icon">
            <ImagePlus size={16} />
          </span>
        </button>
        <div>
          <input
            ref={portraitInput}
            className="sr-only"
            tabIndex={-1}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              e.currentTarget.value = '';
              try {
                onChange({ ...person, portrait: await portraitData(f) });
              } catch (error) {
                alert((error as Error).message);
              }
            }}
          />
          <p className="tiny">JPEG, PNG or WebP · processed locally</p>
          {person.portrait && (
            <button className="text-button" onClick={() => onChange({ ...person, portrait: null })}>
              Remove photo
            </button>
          )}
        </div>
      </div>
      <div className="field-grid">
        <label>
          First name
          <input
            autoComplete="given-name"
            value={person.firstName}
            onChange={(e) => onChange(setPersonName(person, 'firstName', e.target.value))}
            placeholder="First name"
          />
        </label>
        <label>
          Last name
          <input
            autoComplete="family-name"
            value={person.lastName}
            onChange={(e) => onChange(setPersonName(person, 'lastName', e.target.value))}
            placeholder="Last name"
          />
        </label>
      </div>
      <label>
        Nickname
        <input
          value={person.nickname}
          onChange={(e) => onChange({ ...person, nickname: e.target.value })}
          placeholder="Nickname"
        />
      </label>
      <label>
        Status
        <select
          value={personLifeStatus(dates)}
          onChange={(event) => {
            const lifeStatus =
              event.target.value === 'living'
                ? 'living'
                : event.target.value === 'deceased'
                  ? 'deceased'
                  : undefined;
            onDatesChange({
              lifeStatus,
              ...(lifeStatus !== 'deceased' ? { died: { precision: 'unknown' as const } } : {}),
            });
          }}
        >
          <option value="">Unknown</option>
          <option value="living">Living</option>
          <option value="deceased">Deceased</option>
        </select>
      </label>
      <div className="field-grid">
        <DateInput
          key={`${person.id}-born`}
          label="Born"
          value={dates.born}
          onChange={(born) => onDatesChange({ born })}
          invalid={!!dateError}
          errorId={dateErrorId}
        />
        {personLifeStatus(dates) === 'deceased' && (
          <DateInput
            key={`${person.id}-died`}
            label="Died"
            value={dates.died}
            onChange={(died) => onDatesChange({ died })}
            invalid={!!dateError}
            errorId={dateErrorId}
          />
        )}
      </div>
      {dateError && (
        <p className="date-error" id={dateErrorId} role="alert">
          {dateError} These date changes haven’t been saved. Adjust either field to continue.
        </p>
      )}
      <fieldset className="sex-field">
        <legend>Sex</legend>
        <div className="sex-options">
          {(['male', 'female'] as const).map((sex) => (
            <button
              key={sex}
              className={`sex-${sex}`}
              type="button"
              aria-pressed={person.sex === sex}
              onClick={() => onChange({ ...person, sex: person.sex === sex ? '' : sex })}
            >
              <SexIcon sex={sex} />
              {sex === 'male' ? 'Male' : 'Female'}
            </button>
          ))}
        </div>
        {person.sex === 'other' && (
          <p className="tiny">Other recorded. Choose an option to change it.</p>
        )}
      </fieldset>
      <label>
        Notes
        <textarea
          rows={4}
          value={person.notes}
          onChange={(e) => onChange({ ...person, notes: e.target.value })}
          placeholder="Stories, places, memories…"
        />
      </label>
      <details className="panel-section" key={person.id}>
        <summary className="section-heading">
          <h3>Relationships</h3>
          <span>{attached.length}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        {attached.length ? (
          <div className="relation-list">
            {attached.map((r) => (
              <div className="relation-item" key={r.id}>
                <div>
                  <strong>{other(r)}</strong>
                  <span>
                    {r.type === 'partner'
                      ? partnerKinshipLabel(r, otherPerson(r)?.sex || '').replace(/^./, (letter) =>
                          letter.toUpperCase(),
                        )
                      : relationLabel(r)}
                  </span>
                </div>
                <button
                  className="icon-button"
                  aria-label={`Remove relationship with ${other(r)}`}
                  title="Remove relationship"
                  onClick={() => onRemoveRelation(r.id)}
                >
                  <X size={16} />
                </button>
                <RelationshipFields
                  relation={r}
                  people={people}
                  referenceId={person.id}
                  onChange={onUpdateRelation}
                />
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">No relationships yet.</p>
        )}
        <div className="relative-actions">
          <button className="button subtle" onClick={() => onAddRelative('parent')}>
            + Parent
          </button>
          <button className="button subtle" onClick={() => onAddRelative('child')}>
            + Child
          </button>
          <button className="button subtle" onClick={() => onAddRelative('partner')}>
            + Partner
          </button>
        </div>
        <div className="connect-box">
          <p>Connect to someone already in this tree</p>
          <div className="field-grid">
            <select
              aria-label="Connection role"
              value={connectMode === 'partner' ? 'partner' : connectMode ? 'parent-child' : ''}
              onChange={(e) =>
                setConnectMode(
                  e.target.value === 'parent-child'
                    ? 'child'
                    : e.target.value === 'partner'
                      ? 'partner'
                      : null,
                )
              }
            >
              <option value="">Choose relationship</option>
              <option value="parent-child">Parent / Child</option>
              <option value="partner">Partner</option>
            </select>
            {(connectMode === 'parent' || connectMode === 'child') && (
              <label>
                Parent in this connection
                <select
                  aria-label="Parent in new connection"
                  value={connectMode}
                  onChange={(e) => setConnectMode(e.target.value as ConnectMode)}
                >
                  <option value="child">{person.name || 'This person'}</option>
                  <option value="parent">Person being connected</option>
                </select>
              </label>
            )}
            <select
              aria-label="Person to connect"
              disabled={!connectMode}
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) onConnectTo(e.target.value);
                e.target.value = '';
              }}
            >
              <option value="">Choose person…</option>
              {people
                .filter((p) => p.id !== person.id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </div>
        </div>
      </details>
      <button className="button danger" onClick={onDelete}>
        <Trash2 size={16} /> Delete person
      </button>
    </div>
  );
}
