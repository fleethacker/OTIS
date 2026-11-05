/**
 * MIL-STD-2525D unknown-domain, sea-surface, and subsurface symbols. Colors encode affiliation and
 * deliberately do not follow the application's theme or calendar series palette.
 * Static geometry was checked with milsymbol 2.2.0 (MIT, Måns Beckman), using
 * symbol sets 00 (unknown), 30 (surface), and 35 (subsurface). No runtime CDN is used.
 * Source: https://github.com/spatialillusions/milsymbol/blob/v2.2.0/src/ms/symbolgeometries.js
 * Attribution and MIT license: docs/licenses/milsymbol.md.
 * The presentation API has no verified domain, affiliation, or vessel-class fields.
 * Retain unknown defaults until those source facts are explicitly supplied.
 */
export function ShipSymbol({
  domain = "unknown",
  affiliation = "unknown",
  className = "",
  context,
}: {
  domain?: "unknown" | "surface" | "subsurface";
  affiliation?: "unknown" | "friend";
  className?: string;
  context?: string;
}) {
  const friendly = affiliation === "friend";
  const subsurface = domain === "subsurface";
  const description = `${domain === "unknown" ? "Unknown-domain" : `Sea ${domain}`} symbol: ${friendly ? "friendly" : "affiliation unknown"}; entity unspecified`;
  const sidcs = {
    unknown: { unknown: "10010000000000000000", friend: "10030000000000000000" },
    surface: { unknown: "10013000000000000000", friend: "10033000000000000000" },
    subsurface: { unknown: "10013500000000000000", friend: "10033500000000000000" },
  };
  const viewBox = subsurface
    ? friendly
      ? "41 46 118 128"
      : "21 46 158 138"
    : friendly
      ? "36 36 128 128"
      : "26.75 26.75 146.5 146.5";
  const path = subsurface
    ? friendly
      ? "m 45,50 c 0,100 40,120 55,120 15,0 55,-20 55,-120"
      : "m 65,50 c -55,0 -50,90 0,90 0,50 70,50 70,0 50,0 55,-90 0,-90"
    : "M63,63 C63,20 137,20 137,63 C180,63 180,137 137,137 C137,180 63,180 63,137 C20,137 20,63 63,63 Z";
  return (
    <svg
      className={`ship-symbol ${className}`.trim()}
      viewBox={viewBox}
      width="20"
      height="20"
      role="img"
      aria-label={
        context !== undefined && context !== "" ? `${context}. ${description}` : description
      }
      data-sidc={sidcs[domain][affiliation]}
      focusable="false"
    >
      {friendly && !subsurface ? (
        <circle cx="100" cy="100" r="60" strokeWidth="4" stroke="#000000" fill="#80e0ff" />
      ) : (
        <path d={path} strokeWidth="4" stroke="#000000" fill={friendly ? "#80e0ff" : "#ffff80"} />
      )}
      {domain === "unknown" && (
        <text
          x="100"
          y="127"
          textAnchor="middle"
          fontSize="80"
          fontFamily="Arial"
          fontWeight="bold"
          fill="#000000"
          aria-hidden="true"
        >
          ?
        </text>
      )}
    </svg>
  );
}
