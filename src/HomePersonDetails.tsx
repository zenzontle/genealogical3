import { Home } from 'lucide-react';
import { describeKinshipPath, type KinshipResult } from './kinship';
import type { Person } from './model';

export function HomePersonDetails({
  person,
  home,
  people,
  kinship,
  onSetHome,
}: {
  person: Person;
  home: Person | null;
  people: Person[];
  kinship?: KinshipResult;
  onSetHome: (id: string | null) => void;
}) {
  const isHome = home?.id === person.id;
  return (
    <section className="home-person-details">
      {isHome ? (
        <>
          <strong className="home-person-heading">
            <Home size={16} /> Home person
          </strong>
          <p className="muted">
            Family relationships in this tree are shown relative to this person.
          </p>
          <button type="button" className="button subtle" onClick={() => onSetHome(null)}>
            Clear home person
          </button>
        </>
      ) : (
        <>
          <button type="button" className="button subtle" onClick={() => onSetHome(person.id)}>
            <Home size={16} /> Set as home person
          </button>
          {!home && (
            <p className="muted">
              Set a home person to see family relationships throughout this tree.
            </p>
          )}
        </>
      )}
      {home && !isHome && kinship && (
        <div className="kinship-details">
          <h3>Relationship to {home.name || 'Unnamed person'}</h3>
          <strong>{kinship.primary.label}</strong>
          {kinship.paths.length ? (
            <>
              {kinship.alternatives.length > 0 && (
                <p>Also: {kinship.alternatives.map((match) => match.label).join(' · ')}</p>
              )}
              <details>
                <summary>Recorded paths ({kinship.paths.length})</summary>
                <ul>
                  {kinship.paths.map((match, index) => (
                    <li key={index}>{describeKinshipPath(home, match, people)}</li>
                  ))}
                </ul>
              </details>
              {kinship.truncated && (
                <p className="tiny">
                  Additional shortest paths are not shown. Up to five examples are displayed.
                </p>
              )}
              <p className="tiny">
                Based on the closest recorded links. Parent types and partner status are shown in
                each path.
              </p>
            </>
          ) : (
            <p className="muted">
              No family path to {home.name || 'the home person'} has been recorded. Unassigned
              connections do not establish kinship.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
