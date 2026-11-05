# Shared message test data

Message collections used by parser tests, UI integration work and the local mail
demo belong under `test-data/messages/`:

```text
test-data/
  README.md
  messages/
    naval_messages/       65 message files
    naval_messages2/      60 message files
```

## Branch sharing

These two collections were explicitly authorized for team sharing on
`Thomas-Branch` and merged in PR #15. This exception covers these 125 synthetic
files, not other traffic or the external OPTASK acceptance corpus.

## Source and preservation

The initial 125 files were restored from `Thomas-Branch` revision
`b278802715a239f750c2c7454912fe026e37582e`, preserved locally as
`codex/thomas-branch-before-rebase`. They were previously merged in PR #4 and
removed from `main` in commit `7409177575d8a6a326b7f7d51a02d1fadb2b40d1`.

Original `naval_messages/` maps to `messages/naval_messages/`; original
`Naval_messages2/` maps to `messages/naval_messages2/`. The project owner confirmed
that all 125 files are AI-generated synthetic test data.

On 2026-11-05 all 125 synthetic fixtures were marked **UNCLASSIFIED**, as directed
by the project owner, and corrected against the supplied definitions and example
profiles. Transport codes and narrative content remain in the files; line
endings are CRLF. All 125 pass the Rust scanner and the checked scheduled-set,
field-layout, and amplification rules. Unavailable information uses the
standard's prescribed unknown values.

| Message identifier | Files | Format basis |
| --- | ---: | --- |
| GENADMIN | 86 | Supplied 2003 definition |
| OPTASK RAS | 18 | Supplied B.1.01.12 example profile |
| SITREP | 7 | Supplied 2003 definition |
| OPTASK ASUW | 7 | Inferred from the supplied B.1.01.12 example |
| MOVEREP | 7 | Supplied 2003 definition; corrected identifier spelling |

Existing source facts populate the applicable structured fields. Missing
information is explicit; no new operational facts were invented. The later
OPTASK profiles use the supplied examples and do not claim verification against
an unavailable complete later-edition definition. Fixture conformance and enabled
parser coverage are separate checks. Detailed evidence and delivery records stay
outside Git.

## Use

Keep these shared inputs separate from application source, private runtime
databases and generated expected results. Tests must select them explicitly;
application startup and Compose do not automatically load or send them.

These files retain naval transport preambles and trailers. Extract their USMTF
body, from `MSGID` through the last set terminator, before using the local mail
helper's `send` command. Carry the source subject into the email's `SUBJ:` header.
Do not send these full files directly to the helper, which requires a body that
starts with `MSGID`. See [`demo/README.md`](../demo/README.md).

The separately maintained OPTASK acceptance corpus and its parsed expectations
remain at `../OPTASK_Messages` outside this repository.
