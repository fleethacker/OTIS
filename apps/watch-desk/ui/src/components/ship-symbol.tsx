/**
 * MIL-STD-2525D generic sea-surface symbols. These colors encode affiliation and
 * deliberately do not follow the application's theme or calendar series palette.
 * Static geometry was checked with milsymbol 2.2.0 (MIT, Måns Beckman), using
 * SIDCs 10013000000000000000 and 10033000000000000000. No runtime CDN is used.
 * The presentation API has no verified affiliation or vessel-class fields, so
 * callers must retain the unknown default until those source facts are supplied.
 */
export function ShipSymbol({
  affiliation = "unknown",
  className = "",
  context,
}: {
  affiliation?: "unknown" | "friend";
  className?: string;
  context?: string;
}) {
  const friendly = affiliation === "friend";
  const description = friendly
    ? "Sea surface vessel: friendly; type unavailable"
    : "Sea surface vessel: affiliation and type unavailable";
  return (
    <svg
      className={`ship-symbol ${className}`.trim()}
      viewBox={friendly ? "26 26 148 148" : "26.75 26.75 146.5 146.5"}
      width="20"
      height="20"
      role="img"
      aria-label={
        context !== undefined && context !== "" ? `${context}. ${description}` : description
      }
      data-sidc={friendly ? "10033000000000000000" : "10013000000000000000"}
      focusable="false"
    >
      {friendly ? (
        <circle cx="100" cy="100" r="60" strokeWidth="4" stroke="#000000" fill="#80e0ff" />
      ) : (
        <path
          d="M63,63 C63,20 137,20 137,63 C180,63 180,137 137,137 C137,180 63,180 63,137 C20,137 20,63 63,63 Z"
          strokeWidth="4"
          stroke="#000000"
          fill="#ffff80"
        />
      )}
    </svg>
  );
}
