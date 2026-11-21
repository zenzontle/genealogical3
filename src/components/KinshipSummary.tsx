import { ChevronDown, Home } from 'lucide-react';
import { describeKinshipPath, type KinshipResult } from '../lib/kinship';
import type { Person } from '../lib/model';
import { displayName } from '../lib/personNames';

export function KinshipSummary({
  person,
  home,
  people,
  kinship,
  highlighted = false,
}: {
  person: Person;
  home: Person | null;
  people: Person[];
  kinship?: KinshipResult;
  /** Whether the first path is highlighted on the canvas. */
  highlighted?: boolean;
}) {
  if (!home) return null;
  if (home.id === person.id) {
    return (
      <p className="kinship-summary">
        <Home size={13} aria-hidden="true" /> Home person
      </p>
    );
  }
  if (!kinship) return null;
  const homeName = displayName(home);
  if (!kinship.paths.length) {
    return (
      <p className="kinship-summary is-empty">
        No recorded family path to {homeName}. Unassigned connections don&apos;t count.
      </p>
    );
  }
  return (
    <details className="kinship-summary">
      <summary>
        <Home size={13} aria-hidden="true" />
        <span>
          <strong>{kinship.primary.label}</strong> of {homeName}
          {kinship.alternatives.length > 0 &&
            ` · also ${kinship.alternatives.map((match) => match.label).join(', ')}`}
        </span>
        <ChevronDown size={13} aria-hidden="true" />
      </summary>
      <div className="kinship-paths">
        <p className="tiny">
          Closest recorded {kinship.paths.length === 1 ? 'path' : 'paths'}. Parent types and partner
          status are shown in each path.{highlighted && ' The first is highlighted on the canvas.'}
        </p>
        <ul>
          {kinship.paths.map((match, index) => (
            <li key={index}>{describeKinshipPath(home, match, people)}</li>
          ))}
        </ul>
        {kinship.truncated && (
          <p className="tiny">
            Additional shortest paths are not shown. Up to five examples are displayed.
          </p>
        )}
      </div>
    </details>
  );
}
