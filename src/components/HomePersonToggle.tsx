import { Home } from 'lucide-react';
import type { Person } from '../lib/model';

export function HomePersonToggle({
  person,
  home,
  onSetHome,
}: {
  person: Person;
  home: Person | null;
  onSetHome: (id: string | null) => void;
}) {
  const isHome = home?.id === person.id;
  const label = isHome ? 'Clear home person' : 'Set as home person';
  return (
    <button
      type="button"
      className={`icon-button home-toggle${isHome ? ' is-home' : ''}`}
      aria-label={label}
      title={
        isHome
          ? 'Home person: family relationships are shown relative to this person. Click to clear.'
          : 'Set as home person to see family relationships relative to this person'
      }
      onClick={() => onSetHome(isHome ? null : person.id)}
    >
      <Home size={18} />
    </button>
  );
}
