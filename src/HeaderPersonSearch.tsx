import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Search, X } from 'lucide-react';
import { dateLabel, type Person } from './model';
import { matchedNotePreview, searchPeople } from './personSearch';

export function HeaderPersonSearch({
  people,
  onJump,
}: {
  people: Person[];
  onJump: (id: string) => void;
}) {
  const searchRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const skipFocusOpen = useRef(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(50);
  const results = useMemo(() => searchPeople(people, query), [people, query]);
  const showResults = open && !!query.trim();

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    setQuery('');
    setLimit(50);
    if (!restoreFocus) return;
    if (window.matchMedia('(max-width: 700px)').matches) {
      triggerRef.current?.focus();
    } else if (document.activeElement !== inputRef.current) {
      // Returning focus must not immediately reopen the results.
      skipFocusOpen.current = true;
      inputRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    if (open && window.matchMedia('(max-width: 700px)').matches) inputRef.current?.focus();
  }, [open]);

  useLayoutEffect(() => {
    if (!showResults) return;
    const positionPanel = () => {
      const panel = panelRef.current;
      const search = searchRef.current;
      if (!panel || !search) return;
      if (window.matchMedia('(max-width: 700px)').matches) {
        panel.style.removeProperty('left');
        panel.style.removeProperty('max-height');
        return;
      }
      const bounds = search.getBoundingClientRect();
      const left = Math.max(16, Math.min(bounds.left, window.innerWidth - panel.offsetWidth - 16));
      panel.style.left = `${left - bounds.left}px`;
      panel.style.maxHeight = `${Math.max(0, window.innerHeight - bounds.bottom - 24)}px`;
    };
    positionPanel();
    window.addEventListener('resize', positionPanel);
    return () => window.removeEventListener('resize', positionPanel);
  }, [showResults]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !searchRef.current?.contains(event.target)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open, close]);

  const status = !people.length
    ? 'No people in this tree yet. Add a person to start searching.'
    : !results.length
      ? 'No people found. Try another name, date, or word from their notes.'
      : `${results.length} ${results.length === 1 ? 'person' : 'people'} found · Showing ${Math.min(limit, results.length)}`;

  return (
    <div ref={searchRef} className={`person-search ${open ? 'is-open' : ''}`}>
      <button
        ref={triggerRef}
        className="icon-button person-search-toggle"
        type="button"
        aria-label="Find person"
        title="Find person"
        aria-expanded={open}
        aria-controls="person-search-content"
        onClick={() => (open ? close(true) : setOpen(true))}
      >
        <Search size={18} aria-hidden="true" />
      </button>
      <div id="person-search-content" className="person-search-content">
        <div className="person-search-field">
          <Search size={18} aria-hidden="true" />
          <input
            id="person-search-input"
            ref={inputRef}
            type="search"
            value={query}
            placeholder="Find"
            aria-label="Search this tree"
            aria-controls={showResults ? 'person-search-results-panel' : undefined}
            aria-describedby={showResults ? 'person-search-status' : undefined}
            onFocus={() => {
              if (skipFocusOpen.current) skipFocusOpen.current = false;
              else setOpen(true);
            }}
            onClick={() => setOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(50);
              setOpen(true);
            }}
          />
          {open && (
            <button
              className="icon-button"
              type="button"
              aria-label="Close person search"
              onClick={() => close(true)}
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>
        {showResults && (
          <section
            ref={panelRef}
            id="person-search-results-panel"
            className="person-search-panel"
            aria-label="Search results"
          >
            <p
              id="person-search-status"
              className={results.length ? 'sr-only' : 'muted'}
              role="status"
            >
              {status}
            </p>
            <ul className="person-search-results" aria-label="Matching people">
              {results.slice(0, limit).map((person) => {
                const born = dateLabel(person.born);
                const died = dateLabel(person.died);
                const note = matchedNotePreview(person.notes, query);
                return (
                  <li key={person.id}>
                    <button
                      type="button"
                      onClick={() => {
                        close(true);
                        onJump(person.id);
                      }}
                    >
                      <span className="person-search-result-text">
                        <strong>{person.name || 'Unnamed person'}</strong>
                        {person.nickname && <small>“{person.nickname}”</small>}
                        {(born || died) && (
                          <small>
                            {[born && `Born ${born}`, died && `Died ${died}`]
                              .filter(Boolean)
                              .join(' · ')}
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
          </section>
        )}
      </div>
    </div>
  );
}
