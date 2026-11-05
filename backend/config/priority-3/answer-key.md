# PB4T scenario answer key

All event times are **November 10, 2026 UTC**. Inputs are fictional. Source message bodies are parsed through the existing intake/parser; personnel assignments, qualifications, availability and movement policy are authored local scenario data.

| Case | Expected result |
| --- | --- |
| Original 09:00–09:45, local training 10:45–11:15 | No collision in the complete declared scenario |
| Amended communications 10:30–11:15; P-01 assigned to both | Collision 10:45–11:15 |
| Later 15-minute grid; training 30 minutes; window/availability 09:00–12:00 | Check 10:45, 11:00, 11:15; first feasible 11:15–11:45 |
| Adjacent intervals, no explicit buffer | Compatible |
| Explicit setup/rest buffers | Check extended occupied intervals and availability |
| Known unqualified or unavailable person | Exhaust permitted starts; no feasible slot if all fail |
| Unknown qualifications/availability/person assignment/time/version | Incomplete assessment |
| Truncated schedule, insufficient coverage, stale roster, interrupted search | Incomplete assessment; never assert no conflict/no solution |
| Known future change effective inside planning horizon | Incomplete until effective-version recalculation |
| Matching role/name, different assigned people | No person collision |
| Exact duplicate events/proposal replay | One logical event/proposal |
| Conflicting duplicate versions | Incomplete assessment |
| Reject | Original local plan preserved; authenticated decision recorded |
| Accept | Local training moves only; source-directed communications and original message bytes unchanged |
| Intervening roster/lineage/plan/clock write | Old aggregate or input version rejected; recalculate |
| Cancellation after acceptance | Communications removed; local training remains 11:15–11:45; history retained |

No staffing-performance improvement is claimed. A timed human baseline or independent watchstander acceptance study has not been run. Automated test durations measure software execution only.
