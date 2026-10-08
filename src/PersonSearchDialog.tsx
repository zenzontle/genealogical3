import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ArrowRight, Search, X } from 'lucide-react';
import { dateLabel, type Person } from './model';
import { matchedNotePreview, searchPeople } from './personSearch';

export function PersonSearchDialog({
  people,
  triggerRef,
  onJump,
  onClose,
}: {
  people: Person[];
  triggerRef: RefObject<HTMLButtonElement | null>;
  onJump: (id: string) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(50);
  const results = useMemo(() => searchPeople(people, query), [people, query]);

  useEffect(() => {
    const dialog = dialogRef.current;
    const trigger = triggerRef.current;
    dialog?.showModal();
    inputRef.current?.focus();
    return () => {
      dialog?.close();
      trigger?.focus();
    };
  }, [triggerRef]);

  const status = !people.length
    ? 'No people in this tree yet. Add a person to start searching.'
    : !query.trim()
      ? 'Search names, nicknames, birth or death dates (year or YYYY-MM-DD), and notes.'
      : !results.length
        ? 'No people found. Try another name, date, or word from their notes.'
        : `${results.length} ${results.length === 1 ? 'person' : 'people'} found · Showing ${Math.min(limit, results.length)}`;

  return (
    <dialog
      ref={dialogRef}
      className="modal person-search-dialog"
      aria-labelledby="person-search-title"
      onKeyDown={(event) => {
        // Search inputs otherwise consume Escape to clear their value first.
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          onClose();
      }}
    >
      <div className="modal-heading">
        <h2 id="person-search-title">Find person</h2>
        <button
          className="icon-button"
          type="button"
          aria-label="Close person search"
          onClick={onClose}
        >
          <X size={19} aria-hidden="true" />
        </button>
      </div>
      <label className="person-search-label" htmlFor="person-search-input">
        Search this tree
      </label>
      <div className="person-search-field">
        <Search size={18} aria-hidden="true" />
        <input
          id="person-search-input"
          ref={inputRef}
          type="search"
          value={query}
          placeholder="Name, nickname, date, or notes"
          aria-describedby="person-search-status"
          onChange={(event) => {
            setQuery(event.target.value);
            setLimit(50);
          }}
        />
      </div>
      <p id="person-search-status" className="muted" role="status">
        {status}
      </p>
      <ul className="person-search-results" aria-label="Matching people">
        {results.slice(0, limit).map((person) => {
          const born = dateLabel(person.born);
          const died = dateLabel(person.died);
          const note = matchedNotePreview(person.notes, query);
          return (
            <li key={person.id}>
              <button type="button" onClick={() => onJump(person.id)}>
                <span className="person-search-result-text">
                  <strong>{person.name || 'Unnamed person'}</strong>
                  {person.nickname && <small>“{person.nickname}”</small>}
                  {(born || died) && (
                    <small>
                      {[born && `Born ${born}`, died && `Died ${died}`].filter(Boolean).join(' · ')}
                    </small>
                  )}
                  {note && <small className="person-search-note">Notes: {note}</small>}
                </span>
                <span className="person-search-jump">
                  Jump to person <ArrowRight size={16} aria-hidden="true" />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {limit < results.length && (
        <button
          type="button"
          className="button subtle person-search-more"
          onClick={() => setLimit((value) => value + 50)}
        >
          Show more
        </button>
      )}
    </dialog>
  );
}
