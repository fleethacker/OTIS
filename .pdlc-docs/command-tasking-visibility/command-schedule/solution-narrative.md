# Parse Command — Solution Narrative

Status: Initial working draft · 2026-11-04

## Reference

Addresses the [command tasking visibility problem](../problem-statement.md).

## The User's Story

A watchstander provides raw formatted USMTF message text and specifies the command or commands of interest. Parse Command extracts the relevant tasking, events, and correspondence, including frequency plans, crypto change-over windows, and flight quarters event times. Timed items appear on a synchronized, consolidated 24-hour visual schedule.

The watchstander or shipboard leader can identify the appropriate coordinating point of contact within Command C2, such as CO, XO, OPS, or CHENG, for the relevant item.

## Who This Serves

- **Watchstanders:** Determine their command's tasking and scheduled events from operational messages.
- **Shipboard leaders and coordinating officers:** Understand relevant obligations, timing, and coordination responsibilities.

## Goals and Scope

### Required capability

- Accept raw formatted USMTF text.
- Extract tasking, events, and correspondence for specified command(s).
- Extract frequency plans, crypto change-over windows, and flight quarters event times.
- Present timed information on a synchronized 24-hour visual schedule.
- Identify the appropriate coordinating POC within Command C2.

### Desired additional capability

- Generate a properly formatted draft response for POC review.
- Use the command's existing schedule to identify conflicts early.

These are supplied nice-to-have requirements. Their inclusion in the two-day proof of concept has not been decided.

### Boundaries still to define

[TBD — not yet discussed: supported message types and variations, handling of untimed correspondence, definition of the 24-hour window, and the boundary between the first proof of concept and subsequent operational development.]

## Proof-of-Concept Milestone

Within two hackathon days, demonstrate the core message-to-schedule workflow using mock USMTF raw text. The proof of concept is an initial milestone toward an operational capability.

Representative messages and watchstanders or subject-matter experts are available to validate the interpretations. The team has not yet agreed the validation cases, acceptance thresholds, or operational release criteria.

## Success Criteria

The supplied deliverable is a tool that converts mock USMTF raw text into a synchronized 24-hour visual schedule for watchstanders and shipboard leaders, together with the required command filtering and coordinating-POC identification.

[TBD — not yet discussed: measurable extraction accuracy, acceptable missed or incorrectly included tasking, correct time interpretation, POC correctness, processing time, and SME acceptance criteria.]

## Options Considered

[TBD — not yet discussed. No implementation approach has been selected in this design conversation.]

## Open Questions

- Which end-to-end watchstander scenario should anchor the initial proof of concept?
- Which representative messages will define the initial validation set?
- What information establishes command aliases, applicable tasking, and coordinating POCs?
- How should uncertain, incomplete, or contradictory interpretations be presented and resolved?
- How should times, date boundaries, updates, and cancellations affect the schedule?
- Which desired additional capabilities fit the two-day milestone?

These are design questions awaiting discussion, not agreed product behavior.
