import type { ReactNode } from "react";
import type { SignalLetter } from "./signal-flag-alphabet";

// International signal-flag alphabet A–H, used as section identifiers only.
// Reference: Naval History and Heritage Command, "Phonetic Alphabet and Signal
// Flags"; NETC NJROTC Cadet Reference Manual, 4th edition (2024), Navy Signal Flags.
// Keep the flags' conventional colors across every theme. These are not reports
// of a vessel's signaling state, and raw source text is never decorated/rewritten.
const white = "#ffffff";
const blue = "#003399";
const red = "#c8102e";
const yellow = "#ffdf00";
const swallowtail = "0,0 30,0 23,12 30,24 0,24";

const names: Record<SignalLetter, string> = {
  A: "Alfa",
  B: "Bravo",
  C: "Charlie",
  D: "Delta",
  E: "Echo",
  F: "Foxtrot",
  G: "Golf",
  H: "Hotel",
};

function horizontalStripes(colors: string[]) {
  return colors.map((color, index) => (
    <rect
      key={index}
      x="0"
      y={(24 * index) / colors.length}
      width="30"
      height={24 / colors.length}
      fill={color}
    />
  ));
}

const flags: Record<SignalLetter, ReactNode> = {
  A: (
    <>
      <polygon points={swallowtail} fill={blue} />
      <rect x="0" y="0" width="15" height="24" fill={white} />
    </>
  ),
  B: <polygon points={swallowtail} fill={red} />,
  C: horizontalStripes([blue, white, red, white, blue]),
  D: (
    <>
      <rect width="30" height="24" fill={yellow} />
      <rect y="6" width="30" height="12" fill={blue} />
    </>
  ),
  E: horizontalStripes([blue, red]),
  F: (
    <>
      <rect width="30" height="24" fill={white} />
      <polygon points="15,1 29,12 15,23 1,12" fill={red} />
    </>
  ),
  G: [yellow, blue, yellow, blue, yellow, blue].map((color, index) => (
    <rect key={index} x={index * 5} y="0" width="5" height="24" fill={color} />
  )),
  H: (
    <>
      <rect width="30" height="24" fill={red} />
      <rect width="15" height="24" fill={white} />
    </>
  ),
};

export function SignalFlag({
  letter,
  decorative = false,
}: {
  letter: SignalLetter;
  decorative?: boolean;
}) {
  return (
    <svg
      className="signal-flag"
      viewBox="0 0 30 24"
      width="30"
      height="24"
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : `${letter} — ${names[letter]} signal flag`}
      aria-hidden={decorative ? "true" : undefined}
      focusable="false"
      data-letter={letter}
    >
      {flags[letter]}
    </svg>
  );
}

/** Pair an alphabet flag with an existing readable heading, without renumbering source. */
export function SignalHeading({ letter, children }: { letter: SignalLetter; children: ReactNode }) {
  return (
    <h3 className="signal-paragraph-heading">
      <SignalFlag letter={letter} decorative />
      <span>{children}</span>
    </h3>
  );
}
