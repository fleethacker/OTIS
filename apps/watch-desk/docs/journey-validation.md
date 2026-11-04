# Journey validation diagnostics

## Recorded investigation: bb2e0ea6

The validation failure reported 26 passed tests and one flaky test:
`view-message-record-lifecycle.spec.ts`. A retry passing is not a clean run:
the protected pipeline retains `failOnFlakyTests`.

Reproduction in the assigned builder clone on 2026-11-04:

- `ark run job journey`: exit 0, 27 passed, no flaky tests (57.0 seconds).
- `ark run job journey --spec ui/tests/journey/view-message-record-lifecycle.spec.ts`:
  nine isolated runs passed, including eight consecutive repeats.
- Screenshot uploads warned that `/data/.ark/assignments` was absent. These
  warnings occurred in passing runs and did not cause their exit status.

No failed assertion was reproduced. These results do not establish the original
flake's cause or prove that it is repaired. Application behavior and journey
assertions remain unchanged; a fresh main run is the acceptance check.

## Investigating a recurrence

1. Retain the failing run's `test-results/journey-report.json`, failure trace,
   and assertion output before another run overwrites local results.
2. Identify the first failed assertion and its retry outcome. Do not infer an
   application failure from screenshot-upload warnings alone.
3. Run the affected spec with `ark run job journey --spec <spec-path>` to
   isolate the behavior, then run the full `ark run job journey` suite.
4. Keep keyboard focus, tab semantics, draft persistence, privacy, and mobile
   accessibility assertions intact unless evidence identifies an incorrect test
   assumption. Use observable readiness rather than sleeps for a proven race.
5. Preserve deliverable screenshots and the protected pipeline configuration.
   Report artifact-publication failures to Ark separately; do not patch the
   protected helper or fabricate assignment files.

Local runs are diagnostic only. A passing isolated spec does not replace the
fresh-main journey validation required by the validation story.
