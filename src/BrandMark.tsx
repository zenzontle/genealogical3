export function BrandMark({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand-mark${small ? ' small' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 40 40" focusable="false">
        <rect width="40" height="40" rx="8" fill="currentColor" />
        <path
          d="M13 31V14m0 9c-4.2 0-6.8-2.8-7-6.5M13 19c4.1 0 6.6-2.7 7-6.4"
          fill="none"
          stroke="#fff9ec"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.2"
        />
        <circle cx="6.5" cy="13.5" r="2.2" fill="#d7b19c" />
        <circle cx="20.5" cy="9.5" r="2.2" fill="#d7b19c" />
        <circle cx="11.5" cy="10" r="2" fill="#fff9ec" />
        <text
          x="21.5"
          y="30.5"
          fill="#fff9ec"
          fontFamily="Georgia, serif"
          fontSize="22"
          fontWeight="bold"
        >
          3
        </text>
      </svg>
    </span>
  );
}
