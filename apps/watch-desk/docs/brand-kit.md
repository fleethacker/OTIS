# OTIS UI brand kit

OTIS is the **Operational Tasking Integration System**, with the motto
**Keeping the Watch** and a watchstanding sea otter mascot. The application uses
a shared maritime identity across its pages, readers, calendars, forms, and
dialogs. This UI guide complements the approved
[OTIS mascot and artwork guide](branding/otis/README.md), which owns the original
artwork, runtime assets, and mascot usage rules.

Use the compact mascot in navigation and sign-in, and reserve the full emblem
for larger areas such as About OTIS. Preserve the artwork's aspect ratio and
colors across all three appearances. This guide describes the application-owned
implementation; `ark/` remains a read-only framework dependency. The application
directory remains `apps/watch-desk/`.

## Appearance

The theme definitions in [`ui/src/brand.css`](../ui/src/brand.css) are the source
of truth. [`ui/src/index.css`](../ui/src/index.css) applies those tokens to the
shell, shared controls, content, and calendar. All appearances share the same
layout and content hierarchy.

| Appearance | Theme key | Surfaces | Text | Primary / trim |
| --- | --- | --- | --- | --- |
| Haze Gray | `app` | `#DFE4E6`, `#B4BFC6`, `#9CA6AD` | `#152630` | Naval blue `#193B50`; oxide trim `#803D32` |
| Maritime Dark | `app-dark` | `#0B2C3A`, `#061E2A`, `#254956` | Parchment `#F5F0DF` | Brass `#E5CC88` |
| Vice | `app-vice` | `#2B1042`, `#210A38`, `#593369` | `#FFF1FC` | Pink `#FF55C5`; cyan trim `#28E9E1` |

Haze Gray uses painted-steel gradients and dark seams. Maritime Dark uses deep
navy and sea-green surfaces with brass trim. Vice adds violet gradients, neon
accents, and a grid on the header. Decorative effects stay on the shell so
messages, forms, and operational symbols remain readable.

The top-right appearance control switches between light and dark with one
click. Double-clicking it selects the hidden Vice appearance; Shift+Enter on
the focused control provides the same keyboard action. A single click from
Vice returns to Haze Gray. The selection is saved in browser local storage
under `watch-desk.appearance` and synchronized between tabs. Until a selection
is saved, the interface follows the system light/dark preference. When storage
is unavailable, the control still works for the current page session.
The existing storage key is retained for compatibility with saved preferences
from before the OTIS rebrand.

## Typography

| Use | CSS font stack | Treatment |
| --- | --- | --- |
| Body and headings | `"Times New Roman", Times, serif` | Reading baseline: 16px with 1.5 line height; headings use size and weight for hierarchy |
| Raw message text, identifiers, and times | `"Courier New", Courier, monospace` | Preserve source spacing where required; tabular time displays |
| Ship names | `Impact, Eurostile, "Arial Black", sans-serif` | Display face reserved for ship identity |
| Supplied hull numbers | `"ITC Machine", "Machine ITC", "MachineITC", monospace` | White letters with `2px 2px 0 #11171D` shadow: a crisp offset, with no blur |

The 16px reading baseline takes inspiration from the preferred 12-point Times
New Roman guidance in the
[SECNAV M-5216.5 correspondence manual](https://www.secnav.navy.mil/doni/SECNAV%20Manuals1/5216.5%20%20CH-1.pdf).
This is a screen interface, not a claim that its layouts or generated content
comply with the manual's correspondence-format requirements.

The repository includes no licensed font files or remote font requests. These
stacks use fonts installed on the reader's device and otherwise fall back in
order. Naming ITC Machine in CSS does not make the font available; its exact
letterforms require a licensed local installation or an appropriately licensed
webfont added to the application. The monospace fallback is not an ITC Machine
substitute. The same availability constraint applies to the ship display faces.

## Ship identity and signal flags

`ShipMarker` combines the existing calendar-series color dot, `ShipSymbol`, and
`ShipName`. The dot distinguishes calendar series; it does not encode operational
affiliation. Blank units retain the readable unavailable label without a vessel
symbol.

`ShipSymbol` uses static MIL-STD-2525D generic sea-surface frame geometry checked
against milsymbol 2.2.0. The current presentation contract has no verified vessel
class or affiliation, so markers use the unknown symbol
(`10013000000000000000`). The component also supports explicitly supplied friendly
affiliation (`10033000000000000000`); callers must not infer it from a ship name.
The standard affiliation colors are fixed across themes and are independent of
calendar colors. This is a bounded symbol implementation, not a full symbology
renderer, and it loads no runtime CDN code.

`OptaskIcon` also uses this generic unknown symbol for the ASUW and ASW message
categories. A category does not establish the class or affiliation of a vessel;
the icon's accessible label retains that distinction. Other message categories
keep their existing non-vessel icons.

`HullNumber` accepts only an explicitly supplied hull identifier. The current
presentation contract has no separate hull-number field, so existing ship names
are not split or supplemented with invented hull numbers or vessel classes.

`SignalFlag` supports the international signal flags A through H. `SignalHeading`
uses these as decorative section identifiers alongside readable native `h3`
headings. Flags do not replace headings, imply a message's operational signal,
or alter raw source text. Their conventional colors remain fixed across themes.
Standalone flags have accessible letter and phonetic-name labels; flags beside
heading text are hidden from assistive technology to avoid redundant narration.

The parsed-message reader preserves the ordered USMTF source-set cards from the
parser, including repeated sets, narrative titles, unmapped source values, and
columnar rows. Each card receives a decorative flag in the sequence A–H (Alfa,
Bravo, Charlie, Delta, Echo, Foxtrot, Golf, Hotel), repeating after H for longer
messages. The source set ID, full name when known, and supplied title remain the
readable identifiers. Flag letters are visual section markers, not a replacement
for source paragraph numbers or an assertion that a paragraph has a supplied
letter identifier. Missing parsed sets retain the existing unavailable message;
the interface does not rebuild the former metadata-group cards from internal
payload fields.

Flag identification follows the
[Naval History and Heritage Command reference](https://www.history.navy.mil/research/library/online-reading-room/title-list-alphabetically/p/phonetic-alphabet-and-signal-flags.html).
Original message paragraph identifiers and content remain source data, and the
raw-message view is unchanged by the flag treatment.

## Shared implementation

All paths below are relative to the application root.

| Location | Reusable responsibility |
| --- | --- |
| `ui/src/brand.css` | Theme, font, spacing, shape, and semantic color tokens |
| `ui/src/assets/otis/` | Approved runtime mascot, emblem, and favicon assets; follow the mascot and artwork guide |
| `ui/src/index.css` | App-wide control styles, identity styles, shell, and feature layouts |
| `ui/src/theme.ts` | Preference initialization, persistence, system appearance, and tab synchronization |
| `ui/src/components/theme-control.tsx` | `ThemeControl` and its pointer/keyboard behavior |
| `ui/src/components/ui.tsx` | `AppButton`, `TextInput`, `SelectInput`, `TextArea`, `PageHeading`, `Notice`, `RecordStatus`, and `RevisionBadge` |
| `ui/src/components/ship-name.tsx` | `ShipName` and `HullNumber` |
| `ui/src/components/ship-symbol.tsx` | `ShipSymbol` and its bounded affiliation mapping |
| `ui/src/components/ship-marker.tsx` | Shared ship label with separate calendar-series color |
| `ui/src/components/optask-icons.tsx` | Message category icons, reusing `ShipSymbol` for vessel imagery |
| `ui/src/components/signal-flag.tsx` | `SignalFlag` and `SignalHeading`; supported letters live in `signal-flag-alphabet.ts` |
| `ui/src/components/structured-message.tsx` | Source-set cards with decorative flags and preserved source order |

New UI should reuse these components and the existing daisyUI/Ark primitives.
Use semantic tokens such as `--color-base-content`, `--color-primary`,
`--color-warning`, and `--brand-focus` instead of adding per-page color literals.
Extend the common token definitions when a new reusable role is needed, and
define it for all three appearances. Keep standard symbol/flag colors and
calendar-series colors separate from decorative theme accents.

Use the shared field and button shapes, focus treatment, typography, and spacing.
Preserve native labels, heading levels, keyboard behavior, and source evidence.
Status remains visible text as well as color: for example, a parsed record does
not become confirmed or operationally ready through a success-colored badge.
