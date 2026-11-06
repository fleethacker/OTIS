# OTIS UI brand kit

OTIS is the **Operational Tasking Integration System**, with the motto
**Keeping the Watch** and a watchstanding sea otter mascot. The application uses
a shared maritime identity across its pages, readers, calendars, forms, and
dialogs. This UI guide complements the approved
[OTIS mascot and artwork guide](branding/otis/README.md), which owns the original
artwork, runtime assets, and mascot usage rules.

Use the compact mascot in navigation and sign-in, and reserve the full emblem
for larger areas such as About OTIS. Preserve the artwork's aspect ratio and
colors across all appearances. This guide describes the application-owned
implementation; `ark/` remains a read-only framework dependency. The application
directory remains `apps/watch-desk/`.

## Appearance

The theme definitions in [`ui/src/brand.css`](../ui/src/brand.css) are the source
of truth. [`ui/src/index.css`](../ui/src/index.css) applies those tokens to the
shell, shared controls, content, and calendar. All appearances share the same
layout and content hierarchy.

| Appearance | Theme key | Surfaces | Text | Primary / trim |
| --- | --- | --- | --- | --- |
| Navy and white | `app` | `#FFFFFF`, `#F7F9FB`, `#DCE5EC` | Navy `#17364D` | Blue `#245FA6` |
| Maritime Dark | `app-dark` | `#0B2C3A`, `#061E2A`, `#254956` | Parchment `#F5F0DF` | Brass `#E5CC88` |
| Vice | `app-vice` | `#24163D`, `#180D2E`, `#654277` | `#FFF4FC` | Pink `#FF79D6`; cyan trim `#5AF7E4` |
| Windows Light | `app-windows` | `#FFFFFF`, `#F3F3F3`, `#D1D1D1` | `#202020` | Blue `#0067C0` |
| Windows Dark | `app-windows-dark` | `#2B2B2B`, `#202020`, `#454545` | `#F5F5F5` | Blue `#60CDFF` |

Navy and white uses a near-white `#F7F9FB` canvas, white panels and header,
navy text, and blue accents. Muted text uses `#4C6476`; selected rows use pale
blue `#EAF1FA`. It replaces Haze Gray while retaining the `app` theme key and
saved light-mode preferences. Maritime Dark uses deep navy and sea-green
surfaces with brass trim. Vice uses a striped peach/pink sunset, a receding cyan
grid, violet gradients, and thin neon panel edges. Its OTIS title has bold italic
lettering with crisp cyan/pink shadows; supporting text keeps its ordinary face.
Primary buttons blend pink into lavender with dark text and a separate cyan focus
outline. The scenery is static, decorative, and behind the shell; message and
calendar surfaces stay solid, and operational symbol colors retain their meanings.
The Vice-only treatments live in [`ui/src/vice.css`](../ui/src/vice.css).

Settings → Preferences offers a browser-local **Interface style** choice between
Maritime and Windows. It applies immediately, separately from the timezone Save
action, and preserves the current light/dark mode. If no mode has been explicitly
selected, changing style preserves live system light/dark behavior. Windows is a
web appearance with neutral surfaces, blue accents, subtle borders, 4px control
corners, and a `"Segoe UI Variable", "Segoe UI", system-ui, sans-serif` stack for
body text and headings. It adds no native WPF dependencies or font downloads.
Monospace text, ship names, hull numbers, and standard symbol colors retain their
existing role tokens. Windows tokens and scoped styling live in
[`ui/src/windows.css`](../ui/src/windows.css); Maritime and Vice tokens live in
[`ui/src/brand.css`](../ui/src/brand.css).

The top-right control switches between light and dark within the selected style.
Double-clicking it selects hidden Vice; Shift+Enter provides the same keyboard
action. A single click from Vice returns to the selected style's light mode.
Changing the style in Preferences while Vice is active also exits to that style's
light mode. Vice retains the selected base style across page reloads.

Appearance is saved under `watch-desk.appearance`, with the base style saved under
`watch-desk.appearance-style`. Changes synchronize across mounted controls and
browser tabs. Existing `app`, `app-dark`, and `app-vice` selections remain valid;
legacy Vice without a saved style returns to Navy and white. When storage is unavailable,
controls share the selection in memory for the current page session. These are
browser preferences, not server settings or account-wide preferences.

## Typography

| Use | CSS font stack | Treatment |
| --- | --- | --- |
| Body and headings | `system-ui, -apple-system, "Segoe UI", sans-serif` | Reading baseline: 16px with 1.5 line height; headings use size and weight for hierarchy |
| Raw message text, identifiers, times, and status labels | `"IBM Plex Mono", "Courier New", Courier, monospace` | Bundled regular/bold faces; preserve source spacing where required; tabular time displays |
| Ship names | `Impact, Eurostile, "Arial Black", sans-serif` | Display face reserved for ship identity |
| Supplied hull numbers | `"ITC Machine", "Machine ITC", "MachineITC", monospace` | White letters with `2px 2px 0 #11171D` shadow: a crisp offset, with no blur |

Body text and headings restore the application's original system sans-serif
stack in the maritime and Vice appearances. Windows retains its Segoe UI stack.
The 16px reading baseline and 1.5 line height are screen typography choices;
the interface does not claim correspondence-format compliance with SECNAV
M-5216.5. Use the shared font roles rather than page-specific font declarations.

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
| `ui/src/windows.css` | Optional Windows light/dark tokens and scoped web styling |
| `ui/src/vice.css` | Vice-only sunset, perspective grid, title lettering, and neon framing |
| `ui/src/assets/otis/` | Approved runtime mascot, emblem, and favicon assets; follow the mascot and artwork guide |
| `ui/src/index.css` | App-wide control styles, identity styles, shell, and feature layouts |
| `ui/src/theme.ts` | Preference initialization, persistence, system appearance, and tab synchronization |
| `ui/src/components/theme-control.tsx` | `ThemeControl` and its pointer/keyboard behavior |
| `ui/src/components/appearance-preferences.tsx` | Immediate, browser-local Maritime/Windows style selection |
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
define it for every appearance. Keep standard symbol colors and
calendar-series colors separate from decorative theme accents.

Use the shared field and button shapes, focus treatment, typography, and spacing.
Preserve native labels, heading levels, keyboard behavior, and source evidence.
Status remains visible text as well as color: for example, a parsed record does
not become confirmed or operationally ready through a success-colored badge.
