# CASREP support

OTIS supports **CASREP as its second message family**, independently of OPTASK.
GENADMIN remains a separate, currently unsupported family. Filenames and narrative
mentions of casualties never select the CASREP parser.

## Parser and source coverage

`parse-command-casrep` declares two exact profiles: the 2003 short MSGID layout
(`usmtf-2003-casrep-v1`) and the observed MIL-STD-6040(SERIES), B.1.01.12 layout
(`observed-casrep-b10112-v1`). Unknown standard-bearing editions fail closed. The
short header requires an explicit security context and leaves issue time unknown.
EXER or OPER may precede MSGID; their original bytes remain part of message identity.

The 2003 C303 definition governs conditional sets and field positions. The genuine
INITIAL example on page 52 of the externally supplied *USMTF Message Examples*
is an acceptance case. Its conflicting 2009 issue date and 1995 repair estimate
are retained with `casualty_time_conflict`, rather than rewritten. It stays outside
Git. The shared synthetic files named `casrep` whose MSGID says GENADMIN are
negative dispatch examples, not positive CASREP fixtures.

| Report action | Mandatory conditional content |
| --- | --- |
| INITIAL | ESTIMATE, ASSIST, TECHDATA, IMPACT, OPSKED, CO COMMENTS |
| UPDATE | Two-digit update sequence, initial report DTG, ESTIMATE, OPSKED |
| CORRECT | Initial report DTG, GENTEXT/CASLTY, CORRSTAT; ESTIMATE prohibited |
| CANCEL | Initial report DTG, GENTEXT/CASLTY; ESTIMATE and CORRSTAT prohibited |

CASLTY always requires action, seven-digit casualty serial, equipment name, EIC,
category, cause and reporting UIC. Category 1 (training) and categories 2–4 are
retained as source codes. Conditional assistance, technical-data, parts and receipt
narratives are enforced per segment. Set order, duplicate singleton sets, numeric
widths, identifiers, publication pairs and required sets are checked. Unsupported
sets remain in evidence and mark the projection partial. Invalid required content
fails parsing; custody preserves the source for review.

## ICD and storage

ICD 1.2.0 adds an optional `casualty` object to canonical messages, with scoped fact
ID `q1`. Existing OPTASK wire documents omit it. It contains report identity and
action, estimate, assistance, technical publications, parts, requisitions, receipts,
correction statistics and narratives. Repeating parts and requisitions preserve
their sequence relationship and leading zeros. Every contributing set has audit
spans linked to `q1`. Original source text remains separately preserved.

| Index | Role |
| --- | --- |
| `parse-command-messages-v1` | Immutable message/revision documents; typed casualty block; nested parts, requisitions, receipts and publications |
| `parse-command-search-passages-minilm-v1` | Source text passages plus compact casualty filter metadata; existing local 384-dimensional model |
| `parse-command-intake-test-audit-v1` | Source, parser rules, spans and publication evidence; opaque payload remains unindexed |
| `parse-command-casualties-v1` | Rebuildable source-report history and latest unambiguous reported action; never operational confirmation |

Startup adds the optional mappings to existing canonical and passage indices.
It does not delete or reindex existing messages. The derived history index is
rebuilt from canonical reports when newly created or recreated; normal source
publication refreshes only the affected UIC/serial family. A failed history write
keeps source publication retryable. Model, mailbox and custody state are retained.

## Search and reader

CASLTY, ESTIMATE, ASSIST, TECHDATA, PARTS, REQNDATA, RCPTDATA and CORRSTAT join the
existing narrative sets in passage generation. Text chunks retain exact source
spans and use the existing bounded tokenizer. Equipment and logistics identifiers
are searchable even when no narrative repeats them.

Keyword search combines BM25 with an exact keyword-field match boosted for
casualty serial, UIC, EIC, CIN, stock/part number and requisition number. Exact
identifiers retain their source spelling; identifiers can be searched without the
`NSN:` or `R:` designator. Local semantic search continues to use MiniLM; hybrid
search retains RRF. No model or network service is added to the parser.

The read API accepts `casualtySerials`, `casualtyUics`, `casualtyCategories`,
`casualtyReportTypes`, `casualtyEics` and `casualtyIdentifiers` under `filters`.
Both search branches and canonical result checks apply the same filters. The
Messages filter form exposes serial, reporting UIC, category and action; ordinary
message-type, sender and issue-date filters continue to work across both families.

The reader shows the selected source report, date-only repair estimate, structured
sets, original text, audit evidence and report history. Estimates create no calendar
events. `CANCEL` means a withdrawn report, not repaired equipment.

## History rules and bounds

Correlation requires reporting UIC, casualty serial and initial-report reference.
The source header identifies an INITIAL's reference at the DTG's minute precision;
subsequent actions must explicitly name it. Security scope, command assignment and
parser revision are isolated in the derived key. Reports from different scopes are
never silently combined. Baseline records lacking an issue time remain unresolved.

Source issue time orders reports, independently of arrival order. UPDATE sequence
must advance from 01 without gaps. Missing/conflicting initials, tied issue times,
sequence conflicts, an action after CORRECT/CANCEL, unresolved time or an incomplete
history keep the roll-up unresolved. All output still requires human review. The
family read is capped at 500 reports; exceeding it is flagged, never treated as a
complete history. This is a processing bound, not a production capacity promise.
The latest action remains a report of correction/withdrawal, not a command-readiness
assertion. No automatic command assignment or latest-by-arrival overwrite occurs.

## Verification

```sh
cd backend
cargo test --workspace --locked --offline
cargo clippy --workspace --all-targets --locked --offline -- -D warnings
cargo fmt --all -- --check
cd ..
python3 backend/tools/generate_types.py --check
```

The optional authentic acceptance test uses the external body extracted from PDF
page 52; its file must not contain the PDF heading or page footer:

```sh
CASREP_PAGE_52_FIXTURE=/absolute/external/page52.txt \
  cargo test --manifest-path backend/Cargo.toml -p parse-command-casrep \
  --locked --offline authentic_page_52_acceptance -- --ignored
```

The portable Docker Rust and UI test targets provide local diagnostics. Canonical
Ark checks still require the compatible Ark CLI described in the application guide.
