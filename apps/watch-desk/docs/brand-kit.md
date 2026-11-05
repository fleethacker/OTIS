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
| Raw message text, identifiers, times, and status labels | `"IBM Plex Mono", "Courier New", Courier, monospace` | Bundled regular/bold faces; preserve source spacing where required; tabular time displays |
| Ship names | `Impact, Eurostile, "Arial Black", sans-serif` | Display face reserved for ship identity |
| Supplied hull numbers | `"ITC Machine", "Machine ITC", "MachineITC", monospace` | White letters with `2px 2px 0 #11171D` shadow: a crisp offset, with no blur |

The 16px reading baseline takes inspiration from the preferred 12-point Times
New Roman guidance in the
[SECNAV M-5216.5 correspondence manual](https://www.secnav.navy.mil/doni/SECNAV%20Manuals1/5216.5%20%20CH-1.pdf).
This is a screen interface, not a claim that its layouts or generated content
comply with the manual's correspondence-format requirements.

IBM Plex Mono 2.5.0 is bundled locally under the SIL Open Font License, with
regular and bold WOFF2 files. No external font service is required. The About
page links to the shipped license; see the [font provenance](licenses/ibm-plex-mono.md).
Other stacks use fonts installed on the reader's device and otherwise fall back
in order. Naming ITC Machine in CSS does not make the font available; its exact
letterforms require a licensed local installation or an appropriately licensed
webfont added to the application. The monospace fallback is not an ITC Machine
substitute. The same availability constraint applies to the ship display faces.

## Ship identity

`ShipMarker` combines the existing calendar-series color dot, `ShipSymbol`, and
`ShipName`. The dot distinguishes calendar series; it does not encode operational
affiliation. Blank units retain the readable unavailable label without a vessel
symbol.

`ShipSymbol` uses MIL-STD-2525D symbol sets 00 (unknown), 30 (sea surface), and
35 (sea subsurface), with an unspecified entity. Static frames match the pinned
[milsymbol 2.2.0 geometry](https://github.com/spatialillusions/milsymbol/blob/v2.2.0/src/ms/symbolgeometries.js);
see its [MIT attribution](licenses/milsymbol.md). The unknown-domain symbol
includes the standard question mark. Subsurface frames remain open at the top.

| Domain | Unknown affiliation SIDC | Explicitly supplied friendly SIDC |
| --- | --- | --- |
| Unknown | `10010000000000000000` | `10030000000000000000` |
| Sea surface | `10013000000000000000` | `10033000000000000000` |
| Sea subsurface | `10013500000000000000` | `10033500000000000000` |

An unspecified frame is not a class-identifying vessel icon. The current
presentation contract has no verified vessel domain, class, or affiliation;
unit names therefore use the unknown-domain/unknown-affiliation symbol. Callers
can supply verified domain and affiliation to `ShipMarker`; they must not infer
these facts from a name. Standard affiliation colors remain fixed across themes
and independent of calendar colors. This bounded implementation loads no runtime
CDN code.

`OptaskIcon` uses the surface symbol for ASUW and the subsurface symbol for ASW.
These indicate message-category domains, not a claim that the issuing unit is
a surface combatant or submarine. Other categories keep their non-vessel icons.

References: [MIL-STD-2525D](https://www.jcs.mil/portals/36/documents/doctrine/other_pubs/ms_2525d.pdf),
Table I (unknown dimension) and Appendix A Table A-III (symbol sets), and
[Esri's 2525D surface definitions](https://github.com/Esri/joint-military-symbology-xml/blob/master/instance/jmsml_D_Sea_Surface.xml)
(`UNSPECIFIED` entity, no internal icon). Do not substitute the standard's
training-only hierarchy nodes for operational class information.

`HullNumber` accepts only an explicitly supplied hull identifier. The current
presentation contract has no separate hull-number field, so existing ship names
are not split or supplemented with invented hull numbers or vessel classes.

The parsed-message reader preserves the ordered USMTF source-set cards from the
parser, including repeated sets, narrative titles, unmapped source values, and
columnar rows. The source set ID, full name when known, and supplied title remain
the readable identifiers in native headings. Missing parsed sets retain the
existing unavailable message; the interface does not rebuild the former
metadata-group cards from internal payload fields. Original message paragraph
identifiers, source content, and the raw-message view remain unchanged.

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
| `ui/src/components/structured-message.tsx` | Source-set cards with readable headings and preserved source order |

New UI should reuse these components and the existing daisyUI/Ark primitives.
Use semantic tokens such as `--color-base-content`, `--color-primary`,
`--color-warning`, and `--brand-focus` instead of adding per-page color literals.
Extend the common token definitions when a new reusable role is needed, and
define it for all three appearances. Keep standard symbol colors and
calendar-series colors separate from decorative theme accents.

Use the shared field and button shapes, focus treatment, typography, and spacing.
Preserve native labels, heading levels, keyboard behavior, and source evidence.
Status remains visible text as well as color: for example, a parsed record does
not become confirmed or operationally ready through a success-colored badge.
