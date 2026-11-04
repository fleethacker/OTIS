# Fleethacker 2026 (Norfolk): Challenge Catalog

Pulled 2026-10-28 from the public event API `https://cdao.hackathon.maximus.com/api/events/norfolk/combined/` (the same data the event portal renders). 29 use cases. Text below is verbatim from the API; only formatting was changed. This project targets UC12 and UC24.

**Dates:** 2026-11-04T15:00:00Z to 2026-11-06T21:00:00Z (UTC) · **Location:** Norfolk, VA · **Sponsors:** OpenAI, Google, xAI

## Event overview

Fleethacker brings Sailors, Marines, engineers, and technologists together to rapidly prototype Super Intelligence solutions for real challenges sourced directly from the Surface Force. From reducing cognitive burden and modernizing shipboard workflows to advancing edge AI in disconnected environments, teams will turn frontline insight into practical capabilities that strengthen Fleet readiness.

Sponsored by CDAO and the Department of the Navy.

## Judging criteria

| Criterion | Weight | Question |
|---|---:|---|
| Warfighting & Deckplate Impact | 30 | How significantly does this offload watchstander cognitive burden or reclaim deckplate hours? |
| Speed to Fleet | 20 | How quickly can this be fielded to operate at the edge under disconnected afloat (DDIL) conditions? |
| Fleet Scalability | 20 | How widely can this solution scale across multiple ship classes, ratings, or operational domains? |
| Barrier Removal | 15 | How effectively does this eliminate systemic bottlenecks, manual data entry, and legacy friction? |
| Judges' Discretion | 15 | How compelling are the technical execution, Sailor user experience (UX), and overall innovation? |

## Index

| ID | Use case | Category | Difficulty |
|---:|---|---|---|
| 35 | [Autonomous Cyber Defender](#uc-35) | Cyber Resilience & Trusted Autonomy | medium |
| 26 | [Restore to Mission](#uc-26) | Fleet Readiness & Restore-to-Mission | medium |
| 32 | [Know Before It Breaks the Mission](#uc-32) | Fleet Readiness & Restore-to-Mission | medium |
| 37 | [Sailor-Built to Fleet-Fielded](#uc-37) | Path to Fleet | medium |
| 42 | [Enterprise PA-Ops Platform: Fleet-Wide Operational Planning, Media Tracking, and Decision Advantage](#uc-42) | Path to Fleet |  |
| 12 | [Electronic OPTASK (Operational Tasking) Message Parser & Timeline Visualizer](#uc-12) | Tactical Decision Advantage | medium |
| 13 | [TSS (Total Ship System) Authoritative  aggregated sensor and system information platform for real time decision making](#uc-13) | Tactical Decision Advantage |  |
| 14 | [Fleet Mission Consequence Assistant — Reducing Watchstander Cognitive Burden at the Tactical Edge](#uc-14) | Tactical Decision Advantage |  |
| 16 | [MORDECAI — "Adult Supervision" for Shipboard AI](#uc-16) | Tactical Decision Advantage |  |
| 17 | [Digital SUROB: AI-Assisted Surf Observation & Craft GO/NO-GO Agent](#uc-17) | Tactical Decision Advantage |  |
| 20 | [Cited Contact Brief — Evidence-Backed Intelligence on Contacts of Interest](#uc-20) | Tactical Decision Advantage | medium |
| 22 | [Handwritten to Digitized Fleet Documents](#uc-22) | Tactical Decision Advantage |  |
| 23 | [VIBRANIUM GATEWAY: Deterministic Multi-Agent Zero-Trust Orchestration & Tactical Casualty Triage Core](#uc-23) | Tactical Decision Advantage |  |
| 33 | [Trusted Watchstander](#uc-33) | Tactical Decision Advantage | medium |
| 34 | [Maritime Picture in Minutes](#uc-34) | Tactical Decision Advantage | medium |
| 8 | [CASREP Command: Unified Casualty Report Drafting, Routing & Release](#uc-8) | The Autonomous Shipboard Enterprise | medium |
| 11 | [PB4T (Planning Board for Training) Autonomous Deconfliction Agent](#uc-11) | The Autonomous Shipboard Enterprise | medium |
| 15 | [Collaborative AI Sandboxes for Geographically Segregated Acquisition Teams](#uc-15) | The Autonomous Shipboard Enterprise |  |
| 21 | [Trusted Watchstander Copilot for Engineering Plant Casualties](#uc-21) | The Autonomous Shipboard Enterprise | medium |
| 24 | [Automated Message Traffic Task & Event Extraction](#uc-24) | The Autonomous Shipboard Enterprise |  |
| 36 | [Paperless Underway](#uc-36) | The Autonomous Shipboard Enterprise | medium |
| 41 | [Next in Line: One-Scan AI Service Queue for Sailor Support](#uc-41) | The Autonomous Shipboard Enterprise |  |
| 9 | [AI automated systems](#uc-9) | Open Innovation | medium |
| 10 | [Physics-Informed Mooring & Tug Allocation Planning Agent](#uc-10) | Open Innovation | medium |
| 18 | [From Alert to Handoff: Cyber Watchstander Agent](#uc-18) | Open Innovation |  |
| 25 | [DoW Web Application Standard Tools](#uc-25) | Open Innovation |  |
| 19 | [Risk registry and risk assessment tool](#uc-19) | Uncategorized |  |
| 39 | [Lessons Learned Agentic Integrator](#uc-39) | Uncategorized |  |
| 40 | [ANCHOR: Authoritative Naval Communications Hub for Official Records](#uc-40) | Uncategorized |  |

## Use cases

### Category: Cyber Resilience & Trusted Autonomy

> Focuses on defending isolated, low-bandwidth naval networks and making SI agents safe to field. Projects will find misconfigurations, vulnerabilities and threats, explain the risk, and stage fixes only with human approval, audit and rollback. Trusted-agent guardrails from this category apply to AI solutions in every category. The goal is a shorter path from new vulnerability to verified fix.

<a id="uc-35"></a>

#### UC 35: Autonomous Cyber Defender

Difficulty: medium · Portal: https://cdao.hackathon.maximus.com/event/norfolk/use-cases/35

**Problem**

Challenge statement: Find, explain and fix misconfigurations and vulnerabilities in isolated, low-bandwidth networks with a human approving every change.

High-value outcome to the fleet: Isolated and afloat networks close new vulnerabilities faster, with every change approved, logged and reversible.

Operational problem: New STIGs and vulnerability bulletins arrive faster than IT and cyber staff can review them. Engineers manually correlate device configurations, logs, firewall and monitoring data to find root causes. Afloat and isolated networks cannot rely on normal patching or cloud tooling, and complex cloud identity policies hide insecure combinations that no existing tool flags.

Scenario:
An isolated, shipboard-like network enclave receives a new STIG release and a critical vulnerability bulletin over a constrained link. Discover affected assets, explain the risk, propose fixes, apply them after approval (or produce steps), verify, and report. A seeded misconfiguration or intrusion is hidden in the environment.

Transition hypothesis:
- Owner: NAVIFOR / Naval Network Warfare Command, NIWC Atlantic and program cloud operators (all appear among submitters)
- Destination: Information warfare training range, then an afloat or shore enclave
- Next steps: 30d: owner confirms target environment; 60d: test on a training range; 90d: authorization path defined; 180d: limited deployment decision

Category: Cyber Resilience & Trusted Autonomy (Status: New)
Category description: Focuses on defending isolated, low-bandwidth naval networks and making AI agents safe to field. Projects will find misconfigurations, vulnerabilities and threats, explain the risk, and stage fixes only with human approval, audit and rollback. Trusted-agent guardrails from this category apply to AI solutions in every category. The goal is a shorter path from new vulnerability to verified fix.
Why this category: Cyber produced the largest single candidate challenge and had no home; about a third of government registrants list a cyber or networking background.

**Requirements**

- Isolated and low-bandwidth
- Human approval before any change, with rollback
- Full audit trail
- Open interfaces; no live Navy networks

Fleet-Ready Definition of Done (all solutions): runs offline; keeps humans in authority; cites sources; logs auditable actions; syncs on reconnect; includes a one-page path to fleet.

**Resources**

- Isolated cyber range with deliberately misconfigured hosts and containers
- Public DISA STIGs and NVD / CVE feeds
- Sample logs and network configurations
- Low-bandwidth link emulation
- SMEs: IT and cyber warfare personnel

---

### Category: Fleet Readiness & Restore-to-Mission

> Focuses on the readiness chain from an equipment casualty to restored mission capability, and on seeing readiness risk before it reaches tasking. Projects will correlate technical procedures, maintenance history, parts, manning and schedule data to isolate faults, plan restorations and surface compounding risks, working on last-synced data when disconnected. The goal is shorter time to restore and an earlier, explainable view of mission risk, with Sailors keeping every decision.

<a id="uc-26"></a>

#### UC 26: Restore to Mission

Difficulty: medium · Portal: https://cdao.hackathon.maximus.com/event/norfolk/use-cases/26

**Problem**

###### Operational Problem

Cut the time from an equipment casualty to an executable, approved restoration plan, even while disconnected.

When equipment fails underway, Sailors must isolate the fault using technical manuals, equipment logs, and maintenance history; assess the mission impact; determine the availability of replacement parts or repair alternatives; and prepare casualty reports, parts requests, and repair approvals.

Teams will develop a solution that brings this information together and helps produce a decision-ready restoration plan without relying on continuous connectivity.

###### Desired Outcomes

- Shorter time from casualty identification to a decision-ready restoration plan
- Fewer manual searches across systems, manuals, and personnel
- More complete and accurate casualty and parts reporting
- Continued operation when network connectivity is unavailable

**Requirements**

###### Challenge Tracks

Teams may enter one track or develop a solution that addresses both.

**Track A: Fault Isolation**

A ship operating in EMCON reports low lube oil pressure on a ship's service diesel generator. The solution must help the engineering team isolate likely causes using available manuals, equipment logs, and maintenance history.

**Track B: Parts and Repair**

The fault has been isolated to a failed component. The solution must help the team:

- Determine onboard part availability
- Identify alternatives available from ships in company or ashore
- Evaluate fabrication or approved temporary-repair options
- Estimate the time required to restore the equipment
- Assess mission impact
- Produce draft reports for chain-of-command review and release

###### Technical and Operational Constraints

- Operate offline using last-synchronized data
- Queue outbound requests until connectivity returns
- Run on a laptop or existing shipboard server-class hardware
- Use read-only connections to systems of record
- Cite the source for every recommendation
- Require human approval for every action and report release
- Use only unclassified synthetic or surrogate data

**Resources**

###### Resources Provided

- Synthetic casualty dataset with example casualty reports
- Notional onboard inventory
- Notional ships-in-company list
- Surrogate unclassified equipment manuals, including commercial pump and generator manuals
- Sample maintenance history
- Sample equipment logs
- Description of the repair-approval workflow
- Access to Fleet subject matter experts representing engineering ratings and supply

###### Recommended Team Expertise

- Maintainers and engineering ratings
- Supply specialists
- Data and AI engineers
- UX designers
- A non-coding Sailor serving as the casualty scenario owner and acceptance judge

---

<a id="uc-32"></a>

#### UC 32: Know Before It Breaks the Mission

Difficulty: medium · Portal: https://cdao.hackathon.maximus.com/event/norfolk/use-cases/32

**Problem**

Challenge statement: Surface emerging readiness risk and what to do first, before it affects tasking.

High-value outcome to the fleet: Leaders see readiness risk before it reaches tasking, know why, and act on the right thing first.

Operational problem: Ship leaders reconstruct status from the 8 O'Clock and 1200 reports, maintenance schedules, casualty reports, manning, spreadsheets and meetings. Sailors re-enter the same data across many disconnected systems (one submitter lists seven). Individual indicators exist, but no one can quickly tell whether a seemingly minor change. A slipped maintenance action, a late part, two qualified watchstanders detaching will become a mission-readiness problem next week.

Scenario:
A destroyer is 21 days from a scheduled mission. During the event a stream of changes arrives: a casualty report on a radar, a parts arrival date slips, a maintenance backlog grows, two qualified personnel detach, and the schedule moves. Show which mission capabilities are at risk, why, and what to do first.

Transition hypothesis:
- Owner: Naval Surface Forces / Task Force Hopper (two related submissions came from surface force headquarters staff)
- Destination: Task Force Hopper data environment
- Next steps: 30d: owner validates the mission-dependency model; 60d: access to representative ship data; 90d: shore-based pilot on one ship's data; 180d: decision on integration with readiness reporting

Category: Fleet Readiness & Restore-to-Mission (Status: New)
Category description: Focuses on the readiness chain from an equipment casualty to restored mission capability, and on seeing readiness risk before it reaches tasking. Projects will correlate technical procedures, maintenance history, parts, manning and schedule data to isolate faults, plan restorations and surface compounding risks, working on last-synced data when disconnected. The goal is shorter time to restore and an earlier, explainable view of mission risk, with Sailors keeping every decision.
Why this category: Maintenance, casualty response, parts and readiness visibility formed the largest problem cluster in the submissions, and it is more than administrative modernization.

**Requirements**

- Read-only by design: cannot write back to any source system
- Every flagged risk explains itself and traces to source records
- Humans decide; the tool recommends
- Works on last-synced data; synthetic data only

Fleet-Ready Definition of Done (all solutions): runs offline; keeps humans in authority; cites sources; logs auditable actions; syncs on reconnect; includes a one-page path to fleet.

**Resources**

- Synthetic ship status dataset: 8 O'Clock / 1200 reports, maintenance schedule, casualty reports, manning and qualifications, ship schedule
- Mission-to-equipment dependency table
- Optional synthetic equipment condition data for a predictive variant
- SMEs with department head / executive officer perspective

---

### Category: Path to Fleet

> Focuses on the last mile between a working prototype and a fielded capability. Projects will take a working Sailor-built tool to a fieldable package (hosting, install path, security evidence, sustainment owner) and document the path for the next one. Teams in every category may also complete an optional Path to Fleet field.

<a id="uc-37"></a>

#### UC 37: Sailor-Built to Fleet-Fielded

Difficulty: medium · Portal: https://cdao.hackathon.maximus.com/event/norfolk/use-cases/37

**Problem**

Challenge statement: Take a working Sailor-built tool from laptop to fielded, and document the path so the next one goes faster.

High-value outcome to the fleet: Sailor-built tools actually reach the fleet, and the next one follows a documented path.

Operational problem: Sailors are already building working tools, and those tools stall on hosting, authorization and sustainment rather than technical merit. A Beachmaster Unit built an offline app that computes the Modified Surf Index and craft GO/NO-GO status, a safety-critical calculation still done by hand on paper on the beach, but could not field it: no approved hosting, no install path for government phones, no offline deployment route. Another command has a Sailor-built administrative validator at version 1.4.

Scenario:
Starting from the Beachmaster Unit's working app (the submitter brings it): add AI-assisted entry of spoken or typed observations with Beachmaster approval and logging; send approved results over a disconnected network; and produce the fielding package: hosting option, install path, security evidence and sustainment owner.

Transition hypothesis:
- Owner: Beachmaster Unit TWO (the submitter's command) and its chain of command, to be confirmed
- Destination: Navy-approved hosting or mobile path; next beach-party evolution as a field test
- Next steps: 30d: hosting decision; 60d: authorization package submitted; 90d: field test at a beach-party evolution; 180d: release to other beach and assault craft units

Category: Path to Fleet (Status: New)
Category description: Focuses on the last mile between a working prototype and a fielded capability. Projects will take a working Sailor-built tool to a fieldable package (hosting, install path, security evidence, sustainment owner) and document the path for the next one. Teams in every category may also complete an optional Path to Fleet field.
Why this category: Sailors are already building working tools that stall on hosting and authorization. This category targets transition directly.

**Requirements**

- Offline; government mobile devices
- Human approval of every result
- Security evidence aligned to the authorization process
- Open, maintainable code

Fleet-Ready Definition of Done (all solutions): runs offline; keeps humans in authority; cites sources; logs auditable actions; syncs on reconnect; includes a one-page path to fleet.

**Resources**

- The submitter's app and SME
- Surf observation worksheet rules
- An authorizing-official or hosting-platform representative on site (required)
- Fielding checklist

---

<a id="uc-42"></a>

#### UC 42: Enterprise PA-Ops Platform: Fleet-Wide Operational Planning, Media Tracking, and Decision Advantage

Difficulty: n/a · Portal: https://cdao.hackathon.maximus.com/event/norfolk/use-cases/42

**Problem**

Operational Context & Problem Statement

Navy Public Affairs Officers (PAOs) and Mass Communication Specialists (MCs) execute mission-critical communication daily—shaping the information environment, countering adversary disinformation, and connecting the American public to the fleet. However, the operational workflow supporting this mission remains burdened by administrative drag and fragmented tools.

Across USFF, Type Commands (TYCOMs), numbered fleets, and individual units, public affairs planning and media operations rely heavily on disconnected spreadsheets, isolated email chains, local phone logs, and unlinked SharePoint trackers. When executing high-visibility initiatives—such as the 12 annual Navy Weeks managed by the Navy Office of Community Outreach (NAVCO), regional Fleet Weeks, or dynamic fleet exercises—this fragmentation creates substantial operational friction:

Administrative Status-Chasing: Operational planning cells spend critical hours manually polling participating units, verifying itineraries, reconciling funding line items, and consolidating status updates across disparate commands rather than focusing on execution and strategic engagement.

Delayed Strategic Advising: PAOs require rapid access to previously approved Statements of Record, cross-echelon guidance, and command messaging history to advise senior decision-makers. Searching across siloed inboxes and drives delays recommendations to Flag Officers and Commanders during time-sensitive media events.

Decoupled Deckplate Production: Mass Communication Specialists produce exceptional photography, video, and print products on the deckplates, yet these outputs are frequently disconnected from the originating media inquiries (MQs), response chops (RTQs), and high-level parent operations. The Navy lacks a closed-loop system demonstrating the direct strategic return on investment (ROI) of deckplate storytelling.

Cumbersome Post-Event Analysis: After-Action Reports (AARs) and earned media sentiment analyses are assembled manually weeks after an event concludes, resulting in stale data, lost institutional lessons, and poorly defended future budget requirements.

The Hackathon Solution: Rapid Catalyst to Fleet Scale

This project delivers the Enterprise PA-Ops Platform—an unclassified, operational system that treats major operations, Navy Weeks, and outreach engagements as first-class parent records that unify sub-engagements, resource allocations, media inquiries, and downstream earned media into a single operational picture.

Rather than attempting an unmanageable broad deployment during the 3-day hackathon, this sprint focuses on a tightly scoped, high-impact Initial Operating Capability (IOC): the NAVCO Navy Week Planning Desk. By solving the end-to-end planning, resource tracking, deconfliction, and AAR close-out lifecycle for NAVCO's two-person core planning cell, the team will validate the exact relational data architecture and user interface required to support all PAOs, MCs, and operational decision-makers across the entire Navy.

**Requirements**

Core Acceptance Criteria for Hackathon IOC

Relational Data Integrity (Single Source of Truth):

The platform must establish a clean parent-child relational hierarchy on Microsoft 365 / Flank Speed SharePoint lists.

A single Parent Event record (Exercises/Events/Operations) must anchor child engagement visits, funding line items, media queries, and downstream coverage without data duplication.

Enforce required foreign-key lookup fields across all operational lists so that child metrics automatically aggregate to the parent mission.

Full Operational Lifecycle Progression:

Support an intuitive operational status workflow: Requested  Deconflicted  Confirmed  Executing  AAR Complete.

Enable real-time deconfliction visibility between operational planning cells (NAVCO/USFF), TYCOM resource leads, and participating fleet units.

Human-Gated Authority & Compliance:

All funding allocations, unit participation commitments, and public statement release authorizations must remain strictly gated behind designated human approval checkpoints.

Zero automated release of public statements or automated budget commitments.

Strict adherence to DoD IL5 / Flank Speed operational boundaries: unclassified data handling only, zero CUI/PII spillage, and zero operational ship movement data outside pre-approved public outreach schedules.

Closed-Loop Media & Impact Linkage:

Incoming press inquiries (Media Queries) must link directly to the originating parent/child event and assignable action officers.

Responses to Queries (RTQs) must capture multi-echelon chop workflows (Drafting, SME Review, Flag Review, Approved).

Downstream published news, broadcast clips, and social amplification (Earned Media) must link back to originating queries and events, capturing sentiment and message penetration for instant AAR rollups.

Front-End Architecture Evaluation (Dual-Track Trade Study):

Track A (Power Apps Canvas Baseline): Evaluate existing low-code components, gallery templates, and M365 security role bindings.

Track B (Modern Web / SPFx / HTML5 Alternative): Evaluate a lightweight web interface communicating directly via SharePoint REST API / Microsoft Graph to test for instantaneous load speeds, zero player latency, and responsive fluid styling.

Deliver a clear technical recommendation on the optimal front-end vehicle by Hackathon Day 2.

Automated Close-Out & Strategic Analysis:

Demonstrate an instantaneous After-Action Report (AAR) summary view that pulls real-time budget execution, total engagements conducted, media queries processed, and earned media sentiment reach into an executive-ready brief.

**Resources**

Existing Infrastructure & Assets

Operational Flank Speed Environment:

Host Site: USFF Public Affairs and Outreach (/sites/USFFPublicAffairsandOutreach)

Security Context: DoD Flank Speed IL5 / GCC High Cloud Environment

Normalized SharePoint List Schemas (Deployed & Active):

Exercises/Events/Operations (No SIPR): Parent event registry and schedule tracking

Public Affairs Officer: Global personnel directory synchronized via Power Automate from CHINFO PA Directory (PADirectory1)

Commands: Echelon, HQ location, and Area of Responsibility (AOR) reference data

Fleet Outreach Visits Master & Itinerary: Deckplate community visits and ship tour requests

Fleet Outreach Funding Requests & Resource Tracker: Granular travel, logistics, and supply line items

Media Outlets: Directory of print, broadcast, digital, wire, and trade publications

Reporters: Beat journalists and outlet associations

Media Queries: Incoming reporter inquiries, stated deadlines, priority scoring, and routing

Responses to Queries (RTQs): Approved statements, background guidance, release authorities, and chop routing

Earned Media: Published coverage records, sentiment scoring, tone analysis, and key message penetration

Design Standards & Brand Tokens:

Primary Palette: Navy Primary (#002060), Light Accent (#e6ecf7), Info Blue (#004578)

Functional Tokens: Urgent/Critical Red (#a80000), Warning Amber (#8a3707), Success Green (#107c41)

Reference Artifacts & Codebases:

MediaOpsDesktopLists_v2.json: Authoritative list schema definition, field types, relationships, and choice matrices

Fleethacker_NavyWeek_PlanningDesk_Proposal.docx: Baseline project concept and planning cell workflows

Existing Power Apps Canvas App: USFF PAO - Media Query & RTQ Operations Portal (scr_OperationsDesk)

---

### Category: Tactical Decision Advantage

> Focuses on reducing watchstander cognitive load at the moments that matter: casualties, high-tempo evolutions, degraded sensors and the watchfloor shift change. Projects will deliver source-cited, auditable decision support at the edge that shows what changed and what to trust, built on surrogate and public data for this unclassified event. The goal is faster correct decisions and more bandwidth for judgment and mission command.

Tactical Intent and Edge Intelligence (Watchstander Cognitive Load Reduction)

<a id="uc-12"></a>

#### UC 12: Electronic OPTASK (Operational Tasking) Message Parser & Timeline Visualizer

Difficulty: medium · Portal: https://cdao.hackathon.maximus.com/event/norfolk/use-cases/12

**Problem**

Warfare commanders disseminate operational orders via dense, formatted telecommunication messages. Watchstanders must parse hundreds of lines of text to determine when their ship is scheduled for events.

**Requirements**

A parser that takes raw formatted military text (USMTF format), extracts frequency plans, crypto change-over windows, and flight quarters event times, and plots them on a consolidated visual timeline.

---

<a id="uc-13"></a>

#### UC 13: TSS (Total Ship System) Authoritative  aggregated sensor and system information platform for real time decision making

Difficulty: n/a · Portal: https://cdao.hackathon.maximus.com/event/norfolk/use-cases/13

**Problem**

Todays Modern warship houses hundreds of systems and sensors that are not being used effectively in a manner that enables every warfighter onboard to make risk descions in real time, but rather has watch standers bookmarking every internally hosted system log on page and memorizing different sensor or system dependent codes or unique identifiers. 

For example a piece of equipment that is part of a larger system may have an NSN (that changes over time), be a part of a larger APL (Allowed Parts List), be locally serialized  by a cognizant work center , have it's own unique manufacturers serial number just to name a few. Understanding the status of this item is spread across many things such as Sked32 for PMS, OMMS-NG / AWN for equipment status as well as parts, Rsupply / one touch for parts, DRRS-N for a higher level overview status of how equipment effects a mission area, and probably many more.

 These all work independently with out any form of authoritative truth, they don't update across each other nor do they track real time changes. What is the whole ships baseline and how does one prove it is within standards or every system is online and ready without the burden of proving everything with numerous inspections and wasting time?

**Requirements**

The system or tool should host it's own data base that correlates aggregated values and attributes between systems serving as the authoritative truth for all. It should not send data back to any system or sensor and be passive in action with only receiving information or data to  update it's data base. The tool should host up a dedicated portal or internally hosted web page to allow sailors / watch standers / warfighters to access customizable dashboards and item pages to view relevant information, status, and associations. 

The tool must be access controlled via CAC / Token incorporating Active Directory integration for user accounts from the ships domain controller. The tool should incorporate Machine learning to assist in identifications of deviations from baseline or to assist in providing a warfighter with a better understanding of what is changing.

---

<a id="uc-14"></a>

#### UC 14: Fleet Mission Consequence Assistant — Reducing Watchstander Cognitive Burden at the Tactical Edge

Difficulty: n/a · Portal: https://cdao.hackathon.maximus.com/event/norfolk/use-cases/14

**Problem**

Shipboard watchstanders and support personnel may need to reconcile maintenance status, logistics timing, personnel availability, equipment constraints, and mission schedules to determine whether a seemingly minor change will create a downstream mission-readiness consequence.
The challenge is not simply access to more information. The friction is the cognitive work required to determine which dependency actually controls the outcome, how much operational margin remains, what information is missing or uncertain, and which response options require human approval.
This challenge asks an integrated FleetHacker team to build and test an unclassified, human-controlled edge decision-support prototype that can:
- reconcile multiple approved or synthetic operational inputs;
- identify the current critical constraint rather than merely important dependencies;
- distinguish upstream slack from true mission margin;
- identify missing or uncertain information;
- explain emerging readiness risk in concise, plain language;
- present bounded response options;
- preserve human authority for consequential decisions; and
- continue its core decision-support function under limited-connectivity conditions where feasible.

The goal is not to automate command decisions. The goal is to return time and cognitive capacity to the watchstander while keeping the human clearly in control.
Success by the end of the sprint is a working prototype shaped by Sailor and government-team input, tested against an approved unclassified workflow, with measurable evidence showing whether it improves time-to-understanding, critical-constraint identification, recognition of future mission risk, or manual workload compared with the current process.

**Requirements**

The prototype should:
1. Operate only on unclassified, approved, or synthetic data during FleetHacker.
2. Support a Fleet-defined watchstanding or readiness workflow rather than a pre-selected vendor workflow.
3. Clearly distinguish current operational state from future readiness risk.
4. Identify the true controlling constraint or critical dependency when supported by the available data.
5. Make uncertainty, missing information, and assumptions visible to the user.
6. Preserve human authority. The system may analyze, reconcile, explain, alert, and propose bounded options, but it must not independently issue operational orders, direct personnel, authorize maintenance, alter mission tasking, or modify authoritative records.
7. Include explicit human approval, rejection/modification, monitoring, logging, and stop/override controls.
8. Maintain an auditable trace of inputs, calculations/reasoning, recommendations, and human decisions.
9. Prefer deterministic calculation for timing, dependency, slack, and consequence logic where feasible; generative AI should assist interpretation and explanation rather than become the sole source of operational truth.
10. Be designed for shipboard edge conditions, including limited bandwidth, intermittent connectivity, graceful degradation, and local execution of the core workflow where practical.
11. Be tested against a measurable baseline during the event.
12. Document failure cases, remaining technical friction, and what would be required for a controlled follow-on experiment.

**Resources**

- Synthetic, unclassified maintenance/logistics/personnel/readiness scenarios
- Python-based deterministic dependency and critical-path logic
- JSON/CSV synthetic data
- Local browser-based prototype components
- Human-approval and STOP-agent control patterns
- Local event logging / audit-trace patterns
- Baseline and assisted-workflow measurement templates
- Failure-case and disconnected-operation test procedures
Jennings Intelligence can contribute reusable prior-work components as building blocks, but the FleetHacker team should define the actual Fleet problem, workflow, event-specific data model, prototype changes, and test evidence during the sprint.

---

<a id="uc-16"></a>

#### UC 16: MORDECAI — "Adult Supervision" for Shipboard AI

Difficulty: n/a · Portal: https://cdao.hackathon.maximus.com/event/norfolk/use-cases/16

**Problem**

**Problem:** A warship runs a dozen AI systems side by side — sensors, nav, weapons, damage control, logistics, comms. Built independently, sharing physical resources, with nobody arbitrating when they disagree. Two agents issue contradictory orders to the same actuator and nobody notices until something breaks. The hard part of multi-agent systems isn't the agents — it's the undocumented authority between them.

**Approach:** MORDECAI (Multi-agent Oversight, Resource Deconfliction, Emergent Conflict Arbitration, Intervention) is a governance layer above the agents, not another agent. Protocol, not plugins: every agent signs a manifest and honors a four-part contract — heartbeat, intent announcement, action reporting, halt hook. Intents publish to a shared bus before execution; contested resources are managed as leases; policy lives as data, not code. Trust is declare-and-verify with continuous monitoring — mismatch means quarantine, no-go. When intents collide, rank wins: human-assigned base rank, class modifiers per ship condition, live human field promotion. Anything unresolvable escalates to the operator with full context. One move pauses anything, anytime.

**Cognitive burden payoff:** Watchstanders stop being the integration layer. Instead of mentally arbitrating which system to trust when two disagree, the operator sees one governed picture — who won, why, under whose authority — with a single override that always works identically on agent 1 and agent 13.

**Demo:** (1) Live onboarding — register a 13th agent mid-demo, absorbed with zero restart. (2) Condition flip — cruising to general quarters, roster re-sorts in real time. (3) Field promotion — operator promotes the repair agent live in a simulated emergency and it wins the contested actuator.

**Track:** Tactical Intent and Edge Intelligence (Cognitive Burden Reduction); Open Innovation Track as fallback.

---

<a id="uc-17"></a>

#### UC 17: Digital SUROB: AI-Assisted Surf Observation & Craft GO/NO-GO Agent

Difficulty: n/a · Portal: https://cdao.hackathon.maximus.com/event/norfolk/use-cases/17

**Problem**

BPT still calculate the Modified Surf Index (MSI) by hand on paper during surf observations (SUROB). The MSI drives GO/NO-GO decisions for LCAC, LCU,LCM, LARC-V, INLS, and ACV. Doing hand math on the beach, under time constraints, and often with no connectivity, is slow and is prone to have errors. A single error in the calculation can put the craft and crew at risk in the surf beyond the crafts abilities.

**Requirements**

- Runs fully offline on a phone or laptop (no network dependency).
- Accepts typed or spoken raw observations and completes the SUROB worksheet (Alpha through Hotel).
- Computes MSI and craft GO/NO-GO against listed craft limits; shows the math for every step.
- Sailor Authority: the agent may draft and calculate but may NEVER issue a GO/NO-GO; Beachmaster Beach Party Team Commander (BPTC)/Senior Ramp Marshal (SRM) approval is required before release.
- Logs every input, agent action, edit, approval, rejection and with a hard stop available at any time.
- Produces a correctly formatted SUROB report.
- Transmits the approved report over a disconnected link.
- Results must match hand-calculated historical worksheets.
- Unclassified only: synthetic or sanitized data, no CUI or PII

**Resources**

-Existing SUROB/MSI calculator prototype (offline HTML)
-NTTP 3-59.3M
-MCRP 2-10.3
-BMU-HNDBK-5400.1B
-BMU2 OIC

---

<a id="uc-20"></a>

#### UC 20: Cited Contact Brief — Evidence-Backed Intelligence on Contacts of Interest

Difficulty: medium · Portal: https://cdao.hackathon.maximus.com/event/norfolk/use-cases/20

**Problem**

Problem Statement: When unidentified or merchant vessels appear in an operational area, tactical watchstanders spend hours manually scouring disconnected commercial registries, sanctions lists, and port logs to assess intent. Commercial AI models hallucinate and cannot cite verifiable evidence, making their output unusable for official briefing.

Operational Objective: Build an automated research agent that takes a vessel identifier (Name, IMO, MMSI) and returns a concise, 1-page intelligence brief where every factual claim links directly to an underlying primary source with exact timestamps, explicitly declaring "UNKNOWN" rather than guessing.

**Requirements**

Open-Source Grounding: Ingest unclassified commercial and open maritime feeds (AIS, IMO ship registries, OFAC/EU sanctions).

Zero Hallucination Tolerance: 100% of claims must link to an immutable captured source snapshot; unresolved queries must declare "Unknown".

---

<a id="uc-22"></a>

#### UC 22: Handwritten to Digitized Fleet Documents

Difficulty: n/a · Portal: https://cdao.hackathon.maximus.com/event/norfolk/use-cases/22

**Problem**

In active fleet operations, numerous Maintenance Standard Operating Procedures (SOPs) require personnel to record system checkouts by hand. Currently, these handwritten logs must be either manually scanned or redundantly typed into computer systems for official record-keeping.
This duplicate data entry is highly inefficient, introduces transcription errors, and increases cognitive fatigue. An automated software solution is needed to ingest scanned files, intelligently match them to the correct digital templates, autonomously populate the fields, and store the output as a new record. This will directly save critical operational time and drastically reduce administrative errors.

**Requirements**

- The system must accept a scanned document file (typically in PDF format) directly from a multi-function printer.
- The system must store a repository of master template files (specifically Microsoft Word and Excel). The AI must autonomously analyze the incoming scan and select the correct template to populate.
- The system must extract handwritten text and numerical data from the scan, generating a statistical confidence score for every parsed token.
- The system must visually highlight any extracted data point with a confidence score below 70% to prompt human verification before finalization.
- The system must map and transfer the extracted handwritten data into the correct fields of the chosen template, leveraging semantic understanding and contextual clues rather than simple coordinate mapping.
- The system must generate and save the newly populated template as a distinct, downloadable file.

---

<a id="uc-23"></a>

#### UC 23: VIBRANIUM GATEWAY: Deterministic Multi-Agent Zero-Trust Orchestration & Tactical Casualty Triage Core

Difficulty: n/a · Portal: https://cdao.hackathon.maximus.com/event/norfolk/use-cases/23

**Problem**

Modern warships operate under increasing cognitive and autonomous saturation. While individual agentic tools and sensor suites are introduced to assist watchstanders, uncoordinated multi-agent models introduce compounding failure modes: conflicting resource demands, opaque hallucinated advice, race conditions, and vulnerability to telemetry poisoning. In contested DDIL (Disconnected, Disrupted, Intermittent, Limited-Bandwidth) environments and EMCON conditions, fragile cloud-tethered LLMs collapse into latency bottlenecks, leaving bridge and engineering watchstanders to manually reconcile corrupted CASREPs, contradictory sensor alarms, and mission readiness impacts under fire.

**Requirements**

Key Requirements
Air-Gapped DDIL Runtime: Operates completely offline on edge/laptop hardware without external network connectivity or cloud APIs.   
Deterministic Triage & Arbitration Core: Uses local deterministic logic (Python/DuckDB/rules engine) for timing, critical-path dependencies, and Zero-Trust boundary gating; generative models are restricted to plain-language explanation and cannot serve as operational ground truth.   
Multi-Agent Boundary Governance: Implements an active registry tracking agent identities, accessible data streams/tools, and automated conflict detection when resource demands or recommendations collide.
Hardware-Enforced Human Authority: Preserves command supremacy by presenting bounded, ranked casualty options; explicitly prohibits agents from autonomously issuing orders, redirecting personnel, or modifying authoritative records.
Standardized Naval Telemetry Ingestion: Ingests unclassified synthetic data across common fleet schemas (CASREP, CSMP, and hull/propulsion sensor streams) applicable across surface and subsurface platforms.   
Acceptance Criteria
Criterion 1 (DDIL Survivability): During the live evaluation, the system continues running with zero functional degradation or latency spikes when all network adapters (Wi-Fi/Ethernet) are physically disconnected.   
Criterion 2 (Deterministic Collision Handling): When fed simultaneous, conflicting agent recommendations or corrupted sensor packets, the deconfliction daemon identifies the anomaly, logs the policy violation, and isolates the corrupted stream in under 50 milliseconds.
Criterion 3 (Watchstander Control & Safe-Stop): The bridge HUD displays a single-click "HALT / ISOLATE" control that instantly revokes an agent’s access, rolls back its proposed state, and leaves an immutable, tamper-evident audit record.
Criterion 4 (Measurable Cognitive Offload): Replaces multi-system manual paper and log reconciliation with an automated readiness-margin score, reducing simulated watchstander casualty time-to-understanding by at least 70% against the baseline workflow.   
Criterion 5 (Failure-Case Transparency): The user interface explicitly flags missing, contradictory, or stale telemetry with visible confidence markers and explicit "UNKNOWN" indicators rather than inferring or hallucinating values.

**Resources**

Naval Doctrine & Standards: NWP 1-03.1 (CASREP Format), OPNAVINST 4790.4 (3-M Manual), EOSS/EOCC casualty response guidelines, DoD Zero Trust Architecture.
Local Edge Architecture: Python, DuckDB/SQLite (embedded in-memory engines), Pydantic (schema/data contracts), Streamlit/React (tactical dark-mode HUD).
Cryptographic Audit: Local SHA-256 signature and event-logging modules for immutable state-change verification.
Synthetic Telemetry: Unclassified mock CASREP feeds, hull/propulsion sensor time series, and equipment dependency trees (JSON/CSV/Parquet).

---

<a id="uc-33"></a>

#### UC 33: Trusted Watchstander

Difficulty: medium · Portal: https://cdao.hackathon.maximus.com/event/norfolk/use-cases/33

**Problem**

Challenge statement: Give the watch team source-cited, trustworthy decision support in seconds when it matters most.

High-value outcome to the fleet: Watchstanders take the correct casualty response faster, supported by an assistant whose every action is grounded and auditable.

Operational problem: During casualties and high-tempo evolutions, engineering and tactical watchstanders cross-reference casualty procedures, alarm states, tag-outs, logs and sensor health while making time-critical calls. That information is spread across binders, displays and people. AI assistance on a fleet platform is only fieldable if every recommendation is grounded in approved procedures and every action the assistant takes is identity-bound, policy-gated and auditable.

Scenario:
- Engineering variant: a plant casualty during a high-tempo evolution. The watchstander reports a symptom by voice or text; the assistant returns ranked, source-cited response actions, shows affected equipment and active tag-outs, and logs every step.
- Navigation variant: conflicting position and timing readings during degraded navigation conditions. Show the watch team which sources to trust and why.

Transition hypothesis:
- Owner: Naval Surface Forces engineering and NAVSEA as procedure owner; NAVWAR for the navigation variant
- Destination: Evaluation on a shore-based engineering plant trainer
- Next steps: 30d: owner confirms procedure set and evaluation venue; 60d: approved procedure content loaded in a controlled environment; 90d: trainer evaluation; 180d: decision on shipboard test

Category: Tactical Decision Advantage (Status: Evolved from Tactical Intent and Edge Intelligence)
Category description: Focuses on reducing watchstander cognitive load at the moments that matter: casualties, high-tempo evolutions, degraded sensors and the watchfloor shift change. Projects will deliver source-cited, auditable decision support at the edge that shows what changed and what to trust, built on surrogate and public data for this unclassified event. The goal is faster correct decisions and more bandwidth for judgment and mission command.

**Requirements**

- Fully offline on edge hardware
- Grounded only in the procedures loaded; no ungrounded steps
- Every agent action signed, policy-checked and logged
- Human authority over every decision; no automated control of equipment
- Unclassified surrogate procedures only

Fleet-Ready Definition of Done (all solutions): runs offline; keeps humans in authority; cites sources; logs auditable actions; syncs on reconnect; includes a one-page path to fleet.

**Resources**

- Unclassified surrogate casualty procedures in casualty-control format
- Simulated plant alarm and log stream; tag-out list
- Synthetic navigation sensor readings for the navigation variant
- SMEs: engineering watch officers and navigators

---

<a id="uc-34"></a>

#### UC 34: Maritime Picture in Minutes

Difficulty: medium · Portal: https://cdao.hackathon.maximus.com/event/norfolk/use-cases/34

**Problem**

Challenge statement: Turn fragmented unclassified maritime reporting into a source-cited brief of what changed and why it matters.

High-value outcome to the fleet: Watch teams brief what changed in minutes, with every finding traceable to its source.

Status: Conditional

Operational problem: Watchfloor teams spend much of a shift manually sifting and correlating reports, tracks and open sources before they can brief what has changed. Source references and timestamps are lost along the way, which makes findings slow to verify.

Scenario:
Over 24 hours in a busy approach, publicly available vessel-tracking data, synthetic unit reports and open-source items arrive. Seeded anomalies include a vessel going dark, loitering, and an inconsistent track. Produce the shift-change brief.

Transition hypothesis:
- Owner: None identified in the submissions
- Destination: Unclassified demonstration; real transition requires a classified follow-on venue
- Next steps: Before the event: transition owner named by 28 Oct 2026; 30 to 180d: defined by the owner

Category: Tactical Decision Advantage (Status: Evolved from Tactical Intent and Edge Intelligence)
Category description: Focuses on reducing watchstander cognitive load at the moments that matter: casualties, high-tempo evolutions, degraded sensors and the watchfloor shift change. Projects will deliver source-cited, auditable decision support at the edge that shows what changed and what to trust, built on surrogate and public data for this unclassified event. The goal is faster correct decisions and more bandwidth for judgment and mission command.

**Requirements**

- Unclassified only: public vessel-tracking (AIS) data and synthetic reports
- Analyst verifies before anything is briefed
- Provenance on every claim
- Low-bandwidth and edge-capable

Fleet-Ready Definition of Done (all solutions): runs offline; keeps humans in authority; cites sources; logs auditable actions; syncs on reconnect; includes a one-page path to fleet.

**Resources**

- Historical public AIS extract (e.g., NOAA / BOEM MarineCadastre)
- Synthetic reports with seeded anomalies and an answer key
- Watchfloor brief template
- SMEs: watch officers and intelligence specialists

---

### Category: The Autonomous Shipboard Enterprise

> Focuses on the paper, re-keying, manual routing, tasking and records work that consumes deckplate and staff hours. Projects will turn these into offline-first workflows with human review that sync when connectivity returns. The goal is to return Sailor hours to maintenance, training and readiness within EMCON and offline limits.

(Administrative Workflow Modernization)

<a id="uc-8"></a>

#### UC 8: CASREP Command: Unified Casualty Report Drafting, Routing & Release

Difficulty: medium · Portal: https://cdao.hackathon.maximus.com/event/norfolk/use-cases/8

**Problem**

Today a CASREP is drafted in one tool, emailed or walked around the ship for chop in another, marked up on paper or in redlines, and finally released as a message, with no single source of truth for where it stands or who is holding it. This slows reporting of equipment casualties that directly affect readiness and parts priority, and it buries the originating sailor in rework. This use case asks teams to build one tool where a CASREP is written, routed through the chain of command, commented on, revised, and released, all in one place.

**Requirements**

The tool must support role-based access for the originator (Sailor/LPO), Division Officer, Department Head, Engineer Officer/CHENG, XO, and CO as releasing authority, with each role able to comment, return for revision, or approve and forward. Drafts must enforce NWP 1-03.1 CASREP formatting (report types such as INITIAL, UPDATE, CORRECT, and CASCOR, plus category and required fields), keep a full version history and audit trail of every comment and approval, and show at a glance where each report is in the routing chain. The prototype must use notional, unclassified data only.

**Resources**

- NWP 1-03.1, Operational Reports (CASREP format and reporting rules)
- OPNAVINST 4790.4 (3-M Manual), for linking casualties to maintenance actions and JSNs
- Sample unclassified mock CASREPs and a notional ship chain of command, provided by the use case sponsor

---

<a id="uc-11"></a>

#### UC 11: PB4T (Planning Board for Training) Autonomous Deconfliction Agent

Difficulty: medium · Portal: https://cdao.hackathon.maximus.com/event/norfolk/use-cases/11

**Problem**

Weekly PB4T meetings struggle to coordinate competing departmental training requirements (Damage Control drills, Combat Systems exercises, engineering casualty controls, flight quarters) against real crew availability and ship operations. Key personnel are frequently double-booked across simultaneous evolutions. This use case asks teams to build a constraint-satisfaction multi-agent scheduling system that automatically negotiates and deconflicts the shipboard weekly drill calendar.

**Requirements**

The tool must deploy collaborative departmental agents (Engineering Agent, Weapons Agent, Combat Systems Agent, etc.) that negotiate drill schedules against shared constraints: ship operational windows, qualified personnel rosters (e.g., Fire Party Leader, EOOW, TAO), and fatigue policies. The multi-agent solver identifies personnel collisions, proposes alternate schedule allocations, and ensures all SFTRM-mandated training periodicities are satisfied.

---

<a id="uc-15"></a>

#### UC 15: Collaborative AI Sandboxes for Geographically Segregated Acquisition Teams

Difficulty: n/a · Portal: https://cdao.hackathon.maximus.com/event/norfolk/use-cases/15

**Problem**

The Problem: Department of War (DoW) Multi-Functional Teams (MFTs) are highly fragmented and geographically separated (e.g., AMIC HQ at JBLE, Det 2 at JBSA, OLs, and OSD partners). Acquisition, surveillance, and financial data live in deep, disconnected legacy silos (CON-IT, DEAMS, WAWF, and PMO spreadsheets). Currently, enterprise AI tools (like GenAI Gemini) lack native, live DAF365 or SharePoint connectors. This forces individual users into manual "Doc Import" (drag-and-drop) workflows in isolated chat sessions, making real-time, cross-echelon collaborative AI operations impossible.
The Solution: Establish an interim, collaborative "AI Data Sandbox" utilizing Google NotebookLM (or the GenAI.mil Notebook platform) to serve as a shared semantic and data-broker layer. By standardizing structured, non-proprietary data exports (exports of contract modifications, DEAMS ledgers, risk registers, and surveillance logs) and loading them into a shared, live Notebook workspace, geographically segregated MFTs can immediately collaborate in a unified, interactive AI environment. This bypasses connection delays, breaks down local data silos, and demonstrates the "art of the possible" for federated multi-agent decision support ahead of formal system-to-system API integration.

**Requirements**

Collaboration & Access: Geographically separated users must be able to securely access, view, and query the same shared AI Notebook workspace simultaneously.
Silo Elimination: The platform must support multi-format data ingestion (PDF, TXT, CSV, and Google Docs/Slides) to synthesize disparate financial, schedule, quality, and risk data into a single, unified operating picture.
Deterministic Grounding: AI responses must be strictly bounded to the uploaded source data, featuring dynamic citations that link directly to specific pages or ledger rows (zero-hallucination guardrails).
Multi-Tiered Views: The workspace must support three operational perspectives: Enterprise-level portfolio burndown, Division-level metrics, and individual program-level tracking.
Human-in-Command (HIC) Compliance: The system must act as an analytical and drafting co-pilot, leaving 100% of final approvals and statutory decisions to the human team.

**Resources**

DDoD OV-1 Architecture: Mapped against the DAF Data on Demand Framework and Data Mesh Environment principles (treating data as domain-owned, reusable products).
HELM Specialist Schemas: Standardized 4-section financial reconciliation, PWS functional outcomes, and risk register templates.
Technical Frameworks: GSA CALC+ labor rate databases, AFH 33-337 (Tongue & Quill) templates, and AMIC OP 64-102 §13.8 AI policy guidelines.
Platform Model: Google NotebookLM / GenAI.mil Notebook environment.

---

<a id="uc-21"></a>

#### UC 21: Trusted Watchstander Copilot for Engineering Plant Casualties

Difficulty: medium · Portal: https://cdao.hackathon.maximus.com/event/norfolk/use-cases/21

**Problem**

Problem Statement: Engineering watchstanders (EOOW, EDO) experience intense cognitive saturation during casualties. In high-stress alarm situations (e.g., low lube oil pressure on a generator), watchstanders must immediately cross-reference and execute strict Engineering Operational Casualty Control (EOCC) procedures. AI in engineering plants is can be viewed as high risk due to legitimate fears of inaccurate or untrusted recommendations.

Operational Objective: Deploy a localized, edge copilot that ingests spoken or typed casualty symptoms and returns ranked, source-cited procedural responses in under 5 seconds. Crucially, the system implements an identity-bound cryptographic trust layer where every agent action is signed, policy-checked, and logged in a tamper-evident audit trail, demonstrating active guardrails that block unauthorized actions.

**Requirements**

100% Offline Edge Deployment: Runs locally on laptop/edge hardware with zero cloud connectivity.

Strict Procedural Retrieval: Grounded exclusively in authorized, unclassified EOSS/EOCC technical doctrine.

Cryptographic Identity & Audit Logging: Every recommendation and operator action must be cryptographically signed and recorded in an immutable audit trail.

Active Safety Guardrails: Policy engine that actively rejects out-of-sequence, dangerous, or unverified casualty control steps.

---

<a id="uc-24"></a>

#### UC 24: Automated Message Traffic Task & Event Extraction

Difficulty: n/a · Portal: https://cdao.hackathon.maximus.com/event/norfolk/use-cases/24

**Problem**

Reading and extracting tasks, events, and required correspondence for a single ship/command can be burdensome and often things are missed in human error leading to schedule disruption, missed communication, and last minute preparation for tasking.

**Requirements**

Must:
- Extract tasking/events/correspondence for specified command(s)
- Identify proper coordinating POC within Command C2 (CO/XO/OPS/CHENG/etc.)
Nice-To-Have:
- Generates draft response (in proper format) and has ready for review to POC
- Has access to and is aware of Command schedule identifying conflicts early

---

<a id="uc-36"></a>

#### UC 36: Paperless Underway

Difficulty: medium · Portal: https://cdao.hackathon.maximus.com/event/norfolk/use-cases/36

**Problem**

Challenge statement: Replace paper, re-keying and manual routing with workflows that run offline and sync when connectivity returns.

High-value outcome to the fleet: Sailor hours move from paperwork and re-keying back to maintenance, training and watchstanding.

Operational problem: Sailors hand-transcribe paper forms, re-key requisition documents, route correspondence by hand, consolidate tasking from email, and keep records programs that need a full-time manager no one has. Expeditionary and underway units lose connectivity and cannot route even basic forms. This family drew the strongest fleet demand of any in the submissions, and every hour spent here is an hour not spent on maintenance or training.

Scenario:
- Track A, Forms and documents: an expeditionary unit in the field must capture handwritten training logs, a supply requisition document and a routine correspondence package offline on a tablet, validate them against format rules, and sync and route them on reconnect.
- Track B, Tasking and records: a command staff must turn a week of tasking emails and documents into a verified action list and draft status updates, and file records correctly.

Transition hypothesis:
- Owner: NAVSUP Business Systems Center (submitters there build automation and low-code apps), NAVIFOR, Navy Reserve Force
- Destination: Existing low-code / automation platform; pilot with one ship or expeditionary unit
- Next steps: 30d: owner selects the forms and workflows to pilot; 60d: build on the owner's platform; 90d: unit pilot; 180d: fleet release decision

Category: The Autonomous Shipboard Enterprise (Status: Retained, refocused on Sailor productivity)
Category description: Focuses on the paper, re-keying, manual routing, tasking and records work that consumes deckplate and staff hours. Projects will turn these into offline-first workflows with human review that sync when connectivity returns. The goal is to return Sailor hours to maintenance, training and readiness within EMCON and offline limits.

**Requirements**

- Offline-first with clean sync
- Human review before anything is submitted
- Audit trail
- Runs on government devices and existing low-code platforms where possible
- Synthetic data only; no personal information

Fleet-Ready Definition of Done (all solutions): runs offline; keeps humans in authority; cites sources; logs auditable actions; syncs on reconnect; includes a one-page path to fleet.

**Resources**

- Public blank forms (e.g., DD 1348-1A and NAVPERS forms)
- Public correspondence formatting rules (SECNAV M-5216.5)
- Sample handwritten form scans
- Synthetic tasking emails and documents; records schedule excerpt
- SMEs: yeomen, logistics specialists, admin officers

---

<a id="uc-41"></a>

#### UC 41: Next in Line: One-Scan AI Service Queue for Sailor Support

Difficulty: n/a · Portal: https://cdao.hackathon.maximus.com/event/norfolk/use-cases/41

**Problem**

Sailors lose hours of limited duty and drill time waiting in person for administrative, medical, and personnel support. At Navy Reserve Center Houston, SELRES members spend a significant share of each drill weekend sitting in waiting rooms instead of training. The same friction exists afloat at PSD, disbursing, and sick call aboard large-deck ships.

NRC Houston built a Sailor-made workaround: QR codes posted for each support department let members join a virtual line and get a message when they're next. It works, but it runs on several separate commercial services, has no single entry point, captures no usable data, frequently sends members to the wrong desk or without required documents, and isn't on a Navy-authorized platform, so it can't be scaled or shared.

The challenge: Build a single, AI-assisted service queue on Navy-licensed Microsoft 365 that any Reserve Center, PSD, or shipboard admin office can tailor to its own departments and deploy without new contracts or software.

**Requirements**

Must have

1. Single QR entry point that routes to every support department.
2. Plain-language intake: Sailor describes their need, AI routes them to the correct department and lists documents to bring.
3. Virtual queue with notification to the member when it's their turn.
4. Staff view to see, call, and close out the queue in real time.
Built within Navy M365 (Flank Speed): Power Apps, Power Automate, Teams, SharePoint/Dataverse. 5. No external paid services.
6. Configurable: another command can add/rename departments without a developer.

Should have

7. Predicted wait time shown to the member.
8. Metrics dashboard (throughput, wait times, peak demand by department) for leadership staffing decisions.
9. Low-connectivity/offline-tolerant design for afloat use.

Like to have

10. Solution links for commons issues
11. Department handoff for users seeking multiple assist visits

Constraints

1. Minimal PII; no SSNs. DoD ID only if required.
2. Must work on a Sailor's personal phone (Teams mobile or browser).
3. Notification method must stay within M365 (Teams/email). SMS needs approved alternatives

**Resources**

1. Operational SME and owner of the current tool (on-site all three days)
2. Walkthrough of NRC Houston's current QR virtual-line process and its failure points
3. Department list, service types, and required-documents checklists for each support desk
4. Drill weekend workflow map and staff input gathered ahead of the event
5. Synthetic sample queue data based on real drill weekend volumes (no real member data)

---

### Category: Open Innovation

> An unconstrained edge AI track for high-impact prototypes outside the curated use cases, under minimal power and bandwidth. Entries meet the Fleet-Ready Definition of Done and are judged on the same rubric.

<a id="uc-9"></a>

#### UC 9: AI automated systems

Difficulty: medium · Portal: https://cdao.hackathon.maximus.com/event/norfolk/use-cases/9

**Problem**

Future vessels and maritime environments are likely to rely on multiple AI-enabled and autonomous systems operating at the same time. 
While each individual system may perform well on its own, the combined behavior of multiple interacting systems can become difficult to predict, monitor and control. The challenge is not to create more autonomous agents nut rather an orchestration and governance layer that makes multi-agent systems more visible, bounded and manageable.

**Requirements**

Develop a concept or prototype for a multi-agent governance and orchestration system. The solution should demonstrate how multiple onboard AI systems could share relevant information, coordinate actions, operate within defined authority limits, and remain subject to human oversight.

---

<a id="uc-10"></a>

#### UC 10: Physics-Informed Mooring & Tug Allocation Planning Agent

Difficulty: medium · Portal: https://cdao.hackathon.maximus.com/event/norfolk/use-cases/10

**Problem**

Drafting a safe mooring and pier-work plan requires navigating ship displacement, berth depth, wind and tidal current vectors, bollard load ratings, and line configurations. Bridge teams often rely on static whiteboard sketches and rough mental estimates. This use case asks teams to build an agentic mooring assistant that calculates lateral environmental forces and autonomously configures tug placement and mooring line sequences.

**Requirements**

The tool must provide a drag-and-drop 2D pier canvas for selecting ship class, pier number, and line types. A physics-informed agent ingests mock hydrographic data (wind velocity, ebb/flood current) and iteratively evaluates mooring line geometry and bollard strain against NSTM 582 limits. The agent must recommend optimal tug assist horsepower, line sequences, and issue warnings when wind gusts threaten breaking line thresholds.

**Resources**

NSTM 582 (Mooring and Towing)

---

<a id="uc-18"></a>

#### UC 18: From Alert to Handoff: Cyber Watchstander Agent

Difficulty: n/a · Portal: https://cdao.hackathon.maximus.com/event/norfolk/use-cases/18

**Problem**

From Alert to Handoff: Cyber Watchstander Agent
Navy cyber watchstanders must manually assemble evidence from fragmented tools to determine whether an alert warrants escalation. This slows triage, produces inconsistent incident handoffs, and makes junior analysts dependent on scarce senior expertise. The immediate bottleneck is turning an individual alert into an evidence-backed decision that another analyst can quickly understand and act on.
During the 72-hour sprint, we will prototype one complete workflow: triaging a suspected endpoint compromise from initial alert through analyst-approved incident handoff. Using synthetic or sanitized data, the prototype will gather related logs, consult a supplied response playbook, and produce a concise investigation summary with linked evidence, identified information gaps, recommended next investigative or response actions, and a recommended disposition. The watchstander will review, edit, and approve the handoff and any proposed actions before execution.
Success at the end of the sprint means a repeatable demonstration in which a watchstander takes a representative alert through the entire workflow and exports a completed incident handoff with traceable evidence and a recorded human decision. We will compare completion time and handoff completeness against manual triage of the same scenario to assess whether the prototype reduces effort while preserving analyst judgment.
This prototype represents an initial workflow within a broader AI-enabled Security Operations Center capability, with potential expansion into vulnerability prioritization, incident investigation, and human-approved remediation.

**Requirements**

Ability to ingest and analyze representative cybersecurity alerts, endpoint logs, and related security event data.

Access to synthetic or sanitized incident scenarios, including a suspected endpoint compromise.

A sample incident response playbook to guide investigation, escalation, and recommended actions.

Ability to correlate evidence, identify information gaps, and generate investigation summaries with traceable supporting information.

Human-in-the-loop review and approval of incident disposition, recommended actions, and handoff.

**Resources**

Legion's AI agent orchestration platform and development environment.

Synthetic or sanitized cybersecurity datasets and representative incident scenarios.

Sample SOC operating procedures, investigation checklists, and incident response playbooks.

Technical personnel familiar with AI agent development, cybersecurity workflows, and SOC operations.

Access to suitable development compute and AI models. No direct access to operational Navy networks or security tools is required.

---

<a id="uc-25"></a>

#### UC 25: DoW Web Application Standard Tools

Difficulty: n/a · Portal: https://cdao.hackathon.maximus.com/event/norfolk/use-cases/25

**Problem**

Virtually all DoW/USN web applications are currently hosted or planned to migrate to commercial cloud platforms with cybersecurity policy requiring CAC-PKI authentication for all users to access those applications. There are two major problems with the current situation, the first is that application configurations within cloud environments such as Amazon Web Services (AWS) are not consistently scanned for security vulnerabilities within the configuration of overlapping security policies. The only known compliance guidance is the Cloud Computing Security Requirements Guide (SRG), but no compliance tool exists for scanning for items listed in the “guide.” Furthermore, problems such as overlapping identity and access control policies consist of many lines of JSON code which, while human-readable, does not readily identify inconsistencies or problematic policies within the complex policies. Given access to frontier AI coding models without the severe restrictions levied by genai.mil would enable software development of a scanning agent or standalone tool for identifying departures from CIS-benchmark configurations or insecure policies and better secure every web application used by the DoW. Relatedly, development of a “standard” CAC-PKI authentication tool or library that all web application developers could use would rapidly assist DevOps projects across the board who all face the same problems with integrating a complex CAC-PKI authentication protocol with any new or existing web applications. Every web application, touched by every sailor would stand to gain improvements to security configuration or faster, standardized user authentication workflows.

**Requirements**

1. Develop a USN approved scanning tool for any mission owner to use within their AWS GovCloud environment that will validate configuration in accordance with Cloud SRG.
2. Develop a USN approved scanning tool for any mission owner to use within their AWS GovCloud environment that will validate configuration in accordance with CIS AWS Cloud Benchmarks.
3. Develop an approved, open-source PKI library for use on Windows OS that any web application can use for authentication.
4. Develop an approved, open-source PKI library for use on Linux OS that any web application can use for authentication.
5. Tool information complies with SCAP protocol equivalent standard.

**Resources**

DISA Cloud SRG: https://www.cyber.mil/dccs/dccs-documents/
CIS Benchmark for Amazon Web Services: https://www.cisecurity.org/benchmark/amazon_web_services
Existing DISA PKI Tools List: https://www.cyber.mil/pki-pke/tools-configuration-files

---

### Category: Uncategorized

<a id="uc-19"></a>

#### UC 19: Risk registry and risk assessment tool

Difficulty: n/a · Portal: https://cdao.hackathon.maximus.com/event/norfolk/use-cases/19

**Problem**

Develop a software application tool using Generative AI. This tool will utilize existing project and facility information to auto-populate a risk registry. This risk registry will be used to understand shore facility/infrastructure degradation risk to Fleet readiness.

**Requirements**

Coding language is Python. GenAI platform is Gemini Enterprise. The tool will need to take project narratives and infer the hazard, severity, and mitigation burden into the risk registry as well as assign a numeric value to assess and compare risks.

**Resources**

GenAI Gemini Enterprise, GenAI ChatGPT, Advana Jupiter, Prometheus Group Forge, Microsoft Excel

---

<a id="uc-39"></a>

#### UC 39: Lessons Learned Agentic Integrator

Difficulty: n/a · Portal: https://cdao.hackathon.maximus.com/event/norfolk/use-cases/39

**Problem**

Organizations routinely capture observations, lessons learned, corrective actions, and best practices in the Joint Lessons Learned Information System (JLLIS) and other approved knowledge repositories. However, the practical reuse of this knowledge remains limited. Users often face significant barriers when attempting to locate relevant material, determine whether it applies to their current problem, assess its credibility and recency, and translate it into usable recommendations.

These barriers affect a broad range of activities, including assessments, inspections, training, exercises, research, planning, readiness reporting, maintenance, logistics, and other mission-support functions. As a result, teams often recreate analysis, rely primarily on individual experience, or miss previously validated practices that could improve performance and readiness.

This use case proposes a human-in-the-loop capability that uses approved data interfaces—preferably an API, or alternatively a controlled export/index—to search, compare, and analyze observations or other user-provided material against JLLIS and other authorized lessons-learned sources.

A user would submit an approved document, report draft, observation, problem statement, research question, training gap, or other authorized input. The capability would identify relevant prior lessons, observations, corrective approaches, and best practices. For each result, it would provide:

The source lesson or approved knowledge record;

A concise explanation of relevance to the user’s input;

Applicability factors, such as mission, function, organization type, process, capability, operating context, and recency;

Potential best practices, considerations, or research leads;

Traceable source citations; and

An uncertainty indicator where relevance or applicability is incomplete.

The initial test case will use cyberspace assessments. Assessment reports contain detailed observations, assessor analysis, required remediations for doctrine or policy noncompliance, and optional recommendations for additional unit improvement. The pilot will evaluate whether the capability can compare report content to JLLIS records and provide assessors with relevant, source-traceable best practices more rapidly than the current manual research process.

Although cyberspace assessments provide the test environment, the intended capability is organization- and use-case-agnostic. Its reusable functions—document or observation intake, semantic retrieval, applicability analysis, source traceability, human review, feedback capture, and exportable results—are designed to support future use across any authorized organization or mission workflow.

Warfighting and Deckplate Impact
The capability improves access to validated experience across the force, helping users identify proven practices and avoid repeating previously observed problems. The cyberspace-assessment pilot provides a direct readiness benefit while the organization-agnostic design enables impact across multiple mission areas.

Speed to Fleet
A bounded cyberspace pilot can be implemented quickly using approved sample inputs and an authorized JLLIS data interface. The pilot generates practical evidence before expanding to other users and mission functions.

Fleet Scalability
The core capability is designed for reuse, not for a single assessment program. It can support any authorized organization or workflow that needs to compare current problems, observations, or research questions against prior lessons and best practices.

Barrier Removal
The proposal reduces the recurring barriers that prevent lessons-learned reuse: difficult discovery, inconsistent terminology, time-intensive research, uncertainty about applicability, limited visibility of prior experience, and lack of easily reusable output.

Judges’ Discretion
The proposal combines immediate operational utility with responsible implementation. It retains human judgment, provides source traceability, identifies uncertainty, respects approved data-access controls, and uses a measurable pilot to demonstrate value before enterprise expansion.

**Requirements**

Organization- and Use-Case-Agnostic Design

The solution must not be limited to a specific organization, Service, assessment type, or mission area.

The architecture must support use with authorized observations, reports, research questions, training gaps, exercise results, inspection findings, or other approved inputs.

The initial cyberspace-assessment pilot must use reusable components that can be applied to additional communities without redesigning the core capability.

Human-in-the-Loop Decision Support

The capability will recommend relevant lessons and best practices; it will not autonomously determine compliance, issue findings, direct remediation, or alter source documents.

Users must be able to review, accept, reject, revise, and annotate all recommendations.

Final application of a lesson or recommendation remains the responsibility of the appropriate user, assessor, researcher, trainer, or decision authority.

Approved Data Access and Traceability

The solution must use an approved interface to JLLIS or another authorized lessons-learned repository, such as an authorized API or controlled export/index.

Every recommended lesson or best practice must identify its source record and provide sufficient information for user verification.

The solution must preserve applicable access controls, handling requirements, need-to-know, records, security, and release policies.

Relevance and Applicability Analysis

The solution must evaluate relevance beyond exact keyword matching.

It must explain why a source is relevant and identify the factors supporting or limiting applicability.

It must distinguish clearly between source-supported best practices, required actions identified in authoritative guidance, and optional user considerations.

Practical Workflow Integration

The user experience should allow a user to submit or select an input, review ranked results, inspect source context, capture useful recommendations, and export approved citations or draft language.

The workflow should reduce the time and effort required to conduct lessons-learned research.

Quality Controls

The solution must identify uncertainty when sources are outdated, incomplete, contradictory, weakly matched, or only partially applicable.

It must not fabricate source material, citations, doctrine, requirements, or lessons learned.

The system should capture user feedback on result relevance and usefulness to improve retrieval and ranking over time.

Pilot Measurement
The pilot should measure:

Time required to identify applicable lessons and best practices;

Number of relevant, source-traceable results identified;

User acceptance, rejection, and revision rates;

Reduction in duplicative research;

User confidence in applicability and traceability; and

Potential for reuse across additional organizations and workflows.

**Resources**

Joint Knowledge Online (JKO), Joint Lessons Learned Program:

Prefix: J3O

Course Number: P-US1181

Course Name: Joint Lessons Learned Program

JLLIS and/or other authorized lessons-learned data sources and associated user guidance.

Approved and appropriately sanitized pilot inputs, beginning with cyberspace assessment reports, observations, and assessor analyses.

Subject-matter experts from the pilot community; lessons-learned, knowledge-management, data-owner, security, and information-assurance stakeholders.

Representative follow-on use cases from other authorized communities to validate scalability beyond the initial pilot.

---

<a id="uc-40"></a>

#### UC 40: ANCHOR: Authoritative Naval Communications Hub for Official Records

Difficulty: n/a · Portal: https://cdao.hackathon.maximus.com/event/norfolk/use-cases/40

**Problem**

Official naval message traffic is broadly distributed through email, creating duplicated storage, unnecessary traffic, manual sorting, and uncertainty about whether locally retained copies reflect the authoritative message.

ANCHOR proposes a common, CAC/PKI-enabled capability to improve access to official messages while preserving existing systems and release authority processes.

* Provide a searchable repository for official messages with integrity validation.
* Enable approved subscriptions, targeted notifications, and acknowledgement tracking.
* Clearly identify amended, corrected, cancelled, expired, and superseded messages.
* Address shipboard, submarine, intermittent-connectivity, and EMCON operating requirements.
* Develop a scalable concept for improving message access, integrity, relevance, and accountability.

**Requirements**

* Assess integration options with C2OIX and dependencies involving NC2 without disrupting existing operations.
* Define official-message preservation, integrity validation, audit logging, and version-status requirements.
* Establish CAC/PKI authentication and command-, role-, and group-based access controls.
* Define subscription approval, mandatory notification, acknowledgement, and escalation rules.
* Identify records-retention, cybersecurity, hosting, availability, and recovery requirements.
* Address disconnected and intermittent-connectivity environments, including EMCON.
* Define measurable success criteria for message retrieval, relevance, integrity, and accountability.

**Resources**

* Available C2OIX and NC2 technical documentation and interface information.
* Representative operational workflows and user requirements.
* Relevant communications, cybersecurity, identity-management, and records-management expertise.
* Hosting and infrastructure architecture guidance.
* Representative message metadata and appropriately controlled test data.
* A development or demonstration environment suitable for a proof of concept.

---

## Appendix A: Rules of engagement

**FLEETHACKER Rules of Engagement**

**Warfighting Purpose**

The Fleet needs capabilities that return time to Sailors, reduce watchstander burden, improve decisions, and perform in contested or disconnected environments. Fleethacker is a chance to focus on problems with dedicated time, tooling, and expertise.

MINDSET: Build for the Sailor standing watch at 0200, not simply for the judge watching a demonstration. Every team should leave Fleethacker with evidence, lessons, and a credible next step toward your idea's use.

**Three Challenge Categories**

1. **Naval Agentic AI**

   Build trustworthy, observable, and governable agents for Navy missions. Solutions must define what the agent may do, what it may never do, what requires human approval, how activity is logged, and how the agent can be stopped. Ushering in the next generation of agentic warfare will require visibility and trust. 

2. **Bring Your Own Idea**

   Open to operational, administrative, maintenance, logistics, personnel, readiness, and other mission problems. Ideas may come from any service or government organization, but must demonstrate relevance to the warfighter missions. 

3. **Digital Challenge**

   Demonstrate, compare, or improve existing Sailor-built and warfighter-created tools. Teams may consolidate competing solutions, package an existing capability for broader use, or prove which approach best meets Fleet requirements. We want to bring the builders together to compete and collaborate. The best solutions are driven from where the action happens. Here is your chance to show us what you got!

**Core Rules**

1. **Alignment to an ROI.** Our challenge is designed to deliver on the priorities and ROIs provided by the Office of the Secretary of War. We measure success through building, collaborating, learning, training, teaching and executing our policy's marching orders. 

2. **Solve a real problem.** Each team must identify the user, operational problem, current process, and measurable burden being reduced.

3. **Build, test, and demonstrate.** Concept slides alone are insufficient. Teams must work to produce an observable prototype, test, workflow, integration, or technical finding.

4. **Remain unclassified.** Do not introduce classified information, CUI, operationally sensitive information, PII, export-controlled data, or nonpublic government data unless specifically vetted or approved. This event is meant to be free and open and can serve as a proof of concept for expanding into high classification data sets. Wars are won on the high side, but lets keep it low for now.

5. **Use authorized resources.** Participants may use approved commercial, government, open-source, or personally provided tools. Tooling, models, datasets, and external services must be disclosed. We will help you get the tools you need to make sure you are hacking during the event. 

6. **Preserve human authority.** AI-supported solutions must clearly identify human approval points, prohibited actions, monitoring, escalation, and shutdown procedures. Automate what you can, but building trust takes iteration and a human-in-the-loop to start.

7. **Be transparent about prior work.** Existing code and products are welcome, particularly in the FleetWorks Digital Challenge, but teams must distinguish pre-event capabilities from work completed during Fleethacker.

8. **No sales pitches.** Industry participants must contribute technical capability or mission expertise. Judging is based on mission results, not vendor positioning.

9. **Design for Fleet conditions.** Teams should consider cybersecurity, portability, limited connectivity, shipboard constraints, sustainment, and disconnected operations.

10. **Document the friction.** Teams must record policy, data, authority, infrastructure, acquisition, and technical barriers encountered.

11. **Plan beyond Friday.** Every final submission must identify a mission owner, technical owner, next experiment, required resources, and a 30/60/90-day transition recommendation.

12. **Act professionally.** Collaboration, respect, safety, and responsible use of event systems are mandatory. Harassment, unauthorized access, destructive testing, and malicious activity are prohibited.

**OSW ROI Mapping**

- **Developing the Skills of a Digital Workforce:** Skills practiced, new tools learned, cross-functional collaboration, and participant confidence gained.
- **Accelerating Platform Adoption:** Solutions packaged or demonstrated on enterprise offerings or another reusable pathway contribute toward deployment and authorizations.
- **Clarifying Friction Points to Agile Delivery:** Documented barriers, responsible organizations, and recommended actions to remove them.
- **Promoting a Culture of Innovation:** New ideas surfaced, Sailor-builders connected, and mission personnel empowered to solve problems.
- **Learning and Adaptation During War:** Evidence that the capability improves operational learning, decision speed, resilience, or adaptation under contested conditions.

As Clausewitz famously surmized: "Policy drives strategy, which drive tactics. These three must be aligned to achieve one's objectives."

**Judging Model**

- Warfighting and Deckplate Impact: **30%**
- Speed to Fleet: **20%**
- Fleet Scalability: **20%**
- Barrier Removal: **15%**
- Judges’ Discretion: **15%**

**Definition of Victory**

A winning team does more than produce good software. It proves that a real Fleet problem can be attacked differently, produces evidence about what works, develops the people involved, and establishes a credible route from prototype to operational capability.

## Appendix B: FAQ

### FAQ

**Who can participate in Fleethacker?**

- Fleethacker is open to active-duty and reserve Navy and Marine Corps personnel, regardless of designator, rating, or rank. It is also open to other service members looking for an opportunity to spend time working on ideas that would benefit their service or the DoW as a whole. 

- Fleethacker is open to DoW government civilians, contractors, academia and industry. 

- Industry partners will be accepted based on submitted use cases and problem statements. This is not intended to be a product demo environment. Industry is also welcome to register and provide hacking team support on submitted problems. 

- Participants may register in one of two roles: 1) Active hackers: Hands-on problem solvers who will collaborate with teams to develop and test solutions; 2) Observers/evaluators: Participants who will observe the event, share expertise, or help evaluate proposed solutions.

- Participation is subject to command approval.


**What will I be doing at Fleethacker?**

- Ask yourself this question: "If there was one thing about your community you could change, improve, or bring into existence, what would it be?" Fleethacker is a dedicated event to work on this problem space and have dedicated support, tooling, and resources provided to turn an idea into reality. Submit your idea or pain point and see where it goes!

**Do I need coding experience to participate?**

- No. Technical or software development experience is not required.
Fleethacker needs both coders and non-coders. Operational experience from the CIC, bridge, deckplates, and other Fleet environments is essential to ensuring teams develop solutions that address authentic operational challenges.

**Is Fleethacker a classified event?**

- No. Fleethacker is an unclassified event.

**Does submitting a registration guarantee participation?**

- No. Submitting the registration form does not guarantee participation. Registrations will be reviewed, and approved participants will receive a confirmation email.

**How will I know if I’m approved to participate?**

- You will receive an email confirming whether you have been approved to participate. Please monitor the email address you used to register for updates.

**When will I receive the event location and other logistical details?**

- Confirmed participants will receive additional information about the venue, access requirements, hotel accommodations, IT requirements, and other event logistics after their participation has been approved.

**When and where will Fleethacker take place?**

- Fleethacker will take place November 4–6, 2026, in Norfolk, Virginia. Specific venue information will be shared with approved participants.

**Are travel orders and funding provided?**

- Participation is subject to command approval. Parent commands may issue TAD/TDY orders in accordance with applicable Joint Travel Regulations. Participants should coordinate travel authorization and funding directly with their command.

## Appendix D: Schedule

### Early Badge Pickup (2026-11-03T22:00:00Z – 2026-11-04T00:00:00Z)

Check-in and badge pickup on Tuesday are optional.

###### Participant Check-In & Badge Pickup

Before arrival, please ensure **the name on your identification matches the name used during event registration** in the hackathon portal.

Upon arrival, proceed to one of the two ticketing booths located outside the building, to the left of the main entrance, to check in and receive your event badge and have a valid, government-issued ID ready to present for check-in. 

After your registration and identification are verified, you will receive your event badge. Please wear your badge visibly while attending the event and retain it for all event days. Check-in is only required once; the badge will serve as your entrance into the build for all days of the hackathon.

**Important**: Badges may not be picked up on behalf of another participant. Participants who do not have the required identification or whose registration cannot be located will be unable to check-in for the event.

### Registration & Badge Pickup (2026-11-04T12:00:00Z – 2026-11-04T13:00:00Z)

All participants must check-in before entering the venue.

###### Participant Check-In & Badge Pickup

Before arrival, please ensure **the name on your identification matches the name used during event registration** in the hackathon portal.

Upon arrival, proceed to one of the two ticketing booths located outside the building, to the left of the main entrance, to check in and receive your event badge and have a valid, government-issued ID ready to present for check-in. 

After your registration and identification are verified, you will receive your event badge. Please wear your badge visibly while attending the event and retain it for all event days. Check-in is only required once; the badge will serve as your entrance into the build for all days of the hackathon.

**Important**: Badges may not be picked up on behalf of another participant. Participants who do not have the required identification or whose registration cannot be located will be unable to check-in for the event.

### Breakfast (2026-11-04T12:45:00Z – 2026-11-04T14:00:00Z)

Boxed breakfasts are available in the bar area

### Hackathon Kickoff (2026-11-04T13:00:00Z – 2026-11-04T13:45:00Z)

Mission Context, rules, agenda, and guidelines

### Structured team formation (2026-11-04T13:45:00Z – 2026-11-04T14:30:00Z)

Send one team rep over to the table to collect your table tent and the team concierge will write the team name and members on it and help find a location to work

### Development session I (2026-11-04T14:30:00Z – 2026-11-04T16:00:00Z)

Hacking

### Working Lunch (2026-11-04T16:00:00Z – 2026-11-04T17:00:00Z)

Boxed lunches available in the bar area

### Development session II (2026-11-04T17:00:00Z – 2026-11-04T20:00:00Z)

Hacking

### Development session III (2026-11-04T20:00:00Z – 2026-11-04T22:00:00Z)

Hacking

### Working Dinner (2026-11-04T22:00:00Z – 2026-11-05T00:00:00Z)

Catering / food trucks: slide on the main screen will inform when dinner has arrived and the two choices for the evening.

### Continued development / collaboration (2026-11-05T00:00:00Z – 2026-11-05T01:00:00Z)

Venue closes promptly at 8PM

### Registration & Badge Pickup (2026-11-05T12:00:00Z – 2026-11-05T13:00:00Z)

All new participants must check in before entering the venue. Participants with a badge do not need to check-in.

###### Participant Check-In & Badge Pickup

Before arrival, please ensure **the name on your identification matches the name used during event registration** in the hackathon portal.

Upon arrival, proceed to one of the two ticketing booths located outside the building, to the left of the main entrance, to check in and receive your event badge and have a valid, government-issued ID ready to present for check-in. 

After your registration and identification are verified, you will receive your event badge. Please wear your badge visibly while attending the event and retain it for all event days. Check-in is only required once; the badge will serve as your entrance into the build for all days of the hackathon.

**Important**: Badges may not be picked up on behalf of another participant. Participants who do not have the required identification or whose registration cannot be located will be unable to check-in for the event.

### Day 2 Kick off and agenda (2026-11-05T13:00:00Z – 2026-11-05T13:15:00Z)

Agenda of the day

### Working Breakfast (2026-11-05T13:15:00Z – 2026-11-05T14:00:00Z)

Boxed breakfasts are available in the bar area

### Development Session IV (2026-11-05T14:00:00Z – 2026-11-05T16:00:00Z)

Hacking

### Working Lunch (2026-11-05T16:00:00Z – 2026-11-05T17:00:00Z)

Boxed lunches available in the bar area

### Working Session V (2026-11-05T17:00:00Z – 2026-11-05T22:00:00Z)

Hacking with continued development, mentor feedback and peer review. Teams review judging expectations before the critical checkpoint.

### Project Submission for Downselect Presentation (2026-11-05T19:00:00Z – 2026-11-05T19:01:00Z)

Critical checkpoint for mentor feedback and peer review. Confirm that teams understand judging expectations and are ready to refine their work. Project Submission for Semifinals must be submitted in the portal by 2PM. Work can continue on the project for judging and presentation.

### Working Dinner (2026-11-05T22:00:00Z – 2026-11-06T00:00:00Z)

Catering / food trucks: slide on the main screen will inform when dinner has arraived and the two choices for the evening. Continue collaboration, networking and asynchronous mentor feedback.

### Continued development / collaboration (2026-11-06T00:00:00Z – 2026-11-06T01:00:00Z)

Venue closes promptly at 8PM

### Registration & Badge Pickup (2026-11-06T12:00:00Z – 2026-11-06T13:00:00Z)

All new participants must check in before entering the venue. Participants with a badge do not need to check-in.
###### Participant Check-In & Badge Pickup

Before arrival, please ensure **the name on your identification matches the name used during event registration** in the hackathon portal.

Upon arrival, proceed to one of the two ticketing booths located outside the building, to the left of the main entrance, to check in and receive your event badge and have a valid, government-issued ID ready to present for check-in. 

After your registration and identification are verified, you will receive your event badge. Please wear your badge visibly while attending the event and retain it for all event days. Check-in is only required once; the badge will serve as your entrance into the build for all days of the hackathon.

**Important**: Badges may not be picked up on behalf of another participant. Participants who do not have the required identification or whose registration cannot be located will be unable to check-in for the event.

### Working Breakfast (2026-11-06T13:15:00Z – 2026-11-06T14:00:00Z)

Boxed breakfasts are available in the bar area

### Team Presentations for Final Judging (2026-11-06T14:00:00Z – 2026-11-06T16:00:00Z)

Teams that made it through Downselect will present their final projects to the judges.

### Judges deliberation (2026-11-06T16:00:00Z – 2026-11-06T16:30:00Z)

Judges will have time for delibration and discussion before the final results are announced.

### Recognition, awards, and closing remarks (2026-11-06T16:30:00Z – 2026-11-06T17:00:00Z)

1st, 2nd, and 3rd place teams will receive recognition and awards.

### Send-off lunch + final networking (2026-11-06T17:00:00Z – 2026-11-06T18:00:00Z)

Venue closes promptly at 2PM
