import { useId, useMemo } from 'react';
import { Home, Users } from 'lucide-react';
import { personCardSize, type Tree } from './model';
import { relationshipIcons } from './relationshipIcons';
import { treePreview } from './treePreviewLayout';

export function TreePreview({ tree }: { tree: Tree }) {
  const id = useId();
  const preview = useMemo(() => treePreview(tree), [tree]);
  if (!preview)
    return (
      <div className="tree-preview tree-preview-empty" aria-hidden="true">
        <Users size={27} />
        <span>
          {tree.people.length
            ? `${tree.people.length} people · ${tree.relations.length} connections`
            : 'No people yet'}
        </span>
      </div>
    );
  const { bounds, paths } = preview;
  const partner = relationshipIcons.partner;
  return (
    <svg
      className="tree-preview"
      viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id={`${id}-portrait`}>
          <circle cx="20" cy="20" r="20" />
        </clipPath>
        <clipPath id={`${id}-name`}>
          <rect x="8" y="65" width="164" height="60" />
        </clipPath>
      </defs>
      {paths.map((path) => (
        <g key={path.id}>
          <path d={path.d} className={`preview-link preview-link-${path.type}`} />
          {path.midpoint && (
            <g transform={`translate(${path.midpoint.x - 12}, ${path.midpoint.y - 12})`}>
              <rect x="-4" y="-4" width="32" height="32" rx="8" fill="var(--bg)" />
              <g
                fill={partner.fill}
                stroke={partner.color}
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {partner.paths.map((d) => (
                  <path key={d} d={d} />
                ))}
              </g>
            </g>
          )}
        </g>
      ))}
      {tree.people.map((person) => {
        const name = person.name || 'Unnamed person';
        return (
          <g key={person.id} transform={`translate(${person.x}, ${person.y})`}>
            <rect
              width={personCardSize.width}
              height={personCardSize.height}
              rx="8"
              className={`preview-person${person.id === tree.homePersonId ? ' preview-person-home' : ''}`}
            />
            <g transform="translate(70, 14)">
              <circle cx="20" cy="20" r="20" fill="var(--accent-surface)" />
              <text x="20" y="27" textAnchor="middle" className="preview-initial">
                {name[0].toUpperCase()}
              </text>
              {person.portrait && (
                <image
                  href={person.portrait}
                  width="40"
                  height="40"
                  preserveAspectRatio="xMidYMid slice"
                  clipPath={`url(#${id}-portrait)`}
                />
              )}
            </g>
            {person.id === tree.homePersonId && (
              <Home x="10" y="10" size={20} color="var(--copper)" />
            )}
            <text
              x="90"
              y="87"
              textAnchor="middle"
              clipPath={`url(#${id}-name)`}
              className="preview-name"
            >
              {name.length > 18 ? `${name.slice(0, 17)}…` : name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
