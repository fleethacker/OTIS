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

These two collections are intentionally tracked on `Thomas-Branch` for team
sharing, as explicitly requested by the project owner. They are not locally
ignored. Check out this branch to obtain the files at the paths above.

The draft PR makes the collection layout and provenance reviewable. Merging it
into `main` would reintroduce the message payloads there; keeping the data solely
on this branch retains `main`'s current separation. This exception covers these
125 restored files, not other operational traffic or the external OPTASK corpus.

## Source and preservation

The initial 125 files were restored from `Thomas-Branch` revision
`b278802715a239f750c2c7454912fe026e37582e`, preserved locally as
`codex/thomas-branch-before-rebase`. They were previously merged in PR #4 and
removed from `main` in commit `7409177575d8a6a326b7f7d51a02d1fadb2b40d1`.

Original `naval_messages/` maps to `messages/naval_messages/`; original
`Naval_messages2/` maps to `messages/naval_messages2/`. Filenames, source bytes,
whitespace and line endings are unchanged. Only the parent directory and the
second collection's directory capitalization changed.

Dataset authorship, synthetic/operational status and expected parser results have
not been established by this restoration. Directory placement is not evidence
of validated USMTF syntax, supported message profiles or operational acceptance.

## Use

Keep these shared inputs separate from application source, private runtime
databases and generated expected results. Tests must select them explicitly;
application startup and Compose do not automatically load or send them.

The local mail helper can send deliberately selected files using its documented
`send` command. Those messages must meet its input requirements, including a body
that starts with `MSGID`. Consult [`demo/README.md`](../demo/README.md) before
sending; restoring the collections does not imply that every file is compatible
with the current OPTASK parser.

The separately maintained OPTASK acceptance corpus and its parsed expectations
remain at `../OPTASK_Messages` outside this repository.
