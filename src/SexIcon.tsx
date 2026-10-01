export function SexIcon({
  sex,
  size = 18,
}: {
  sex: "male" | "female";
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {sex === "male" ? (
        <>
          <circle cx="8.5" cy="15.5" r="5.5" />
          <path d="m12.5 11.5 7-7M14 4h6v6" />
        </>
      ) : (
        <>
          <circle cx="12" cy="8" r="5.5" />
          <path d="M12 13.5V22m-4-4h8" />
        </>
      )}
    </svg>
  );
}
