---
name: improve-mcp
description: 'Improve the EasyEDA MCP service through autonomous live end-to-end validation. Use when fixing bridge or server reliability, testing MCP tool behavior in the EasyEDA editor, creating a disposable project/schematic/PCB from scratch, reconnecting the EasyEDA bridge, or iterating until PCB creation is as complete as possible and Gerber export is reachable with minimal user interaction.'
argument-hint: 'Describe the MCP behavior to improve or validate'
user-invocable: true
---

# Improve EasyEDA MCP

## When to Use

- Fixing EasyEDA MCP bridge or server bugs.
- Validating that MCP tools work in a live EasyEDA Pro session.
- Investigating mismatches between advertised tool behavior and runtime behavior.
- Exercising the full project-to-schematic-to-PCB workflow through MCP.
- Restarting the local MCP server and reconnecting the bridge after changes.

## Required Tools

Use these tools together:

- EasyEDA MCP for bridge status, project inspection, document edits, placement flows, PCB creation progress, and source management.
- Chrome DevTools MCP for opening `https://pro.easyeda.com/editor`, confirming page state, checking login and editor readiness, inspecting progress toward a complete PCB, reading console errors, inspecting network activity, taking snapshots or screenshots, and interacting with the EasyEDA UI when necessary, such as reconnecting the MCP bridge.
- The local EasyEDA tutorial PDF at `src/context/EasyEDA-Tutorial_v6.4.32.pdf` for extra product guidance on schematic, PCB, and PCB creation workflows when the repo or live runtime leaves behavior ambiguous.
- The local bundled EasyEDA Pro example projects under `src/context/easyeda-pro-example-projects/` for host-generated reference designs, import baselines, and `.eprj` structure inspection when the repo or live runtime leaves behavior ambiguous.
- The public EasyEDA documentation at `https://docs.easyeda.com/en/` for extra product and workflow context when the live runtime or repo code leaves behavior ambiguous.
- A persistent iteration report at `.github/skills/improve-mcp/ITERATION-REPORT.md` for recording each validation loop, code change, restart, reconnection, observed failure, and resulting progress.

## Safety Boundary

- Do not ask for permission to proceed when the required access stays scoped to this repository and the EasyEDA editor page in Chrome DevTools MCP.
- Default to autonomous execution. Only ask the user for help when blocked by an external requirement the agent cannot legally or technically satisfy alone, such as login credentials, MFA, CAPTCHA, account approval, missing local software outside the repo, or a decision that would affect a non-disposable user design.
- Access to the repository-local tutorial file `src/context/EasyEDA-Tutorial_v6.4.32.pdf` is pre-approved for extra context gathering and does not require additional user confirmation.
- Access to the repository-local example projects under `src/context/easyeda-pro-example-projects/` is pre-approved for extra context gathering and structural comparison and does not require additional user confirmation.
- Access to the public EasyEDA documentation at `https://docs.easyeda.com/en/` is pre-approved for extra context gathering and does not require additional user confirmation.
- When the workflow requires creating, editing, renaming, or deleting EasyEDA design data autonomously, operate on a disposable validation project, board, schematic, and PCB created for the test run, not on unrelated user designs.
- Use a deterministic validation-project naming pattern such as `MCP_VALIDATION_<date-or-run-id>`.
- Before any destructive or stateful design action, verify with `get_current_context` that the active EasyEDA project or document belongs to the disposable validation flow.
- Prefer reusing, renaming, or cleaning up prior disposable validation artifacts created by the agent rather than accumulating ambiguous test projects.

## Autonomy Goal

- Treat this skill as a self-improvement loop, not a request for a manual checklist.
- Continue working through validation, diagnosis, code changes, restart, reconnection, and revalidation without pausing for user confirmation when the work remains inside the approved scope.
- Prefer tool use, repo inspection, live validation, and deterministic recovery steps over asking the user what to do next.
- When a step fails, exhaust the defined fallback order before concluding that user intervention is required.
- If user input is unavoidable, ask for the single smallest blocking action and then resume the autonomous loop immediately after it is resolved.

## Workflow

Follow this loop by default when improving the MCP service:

1. Use Chrome DevTools MCP to open `https://pro.easyeda.com/editor`, then confirm the EasyEDA editor is fully loaded.
2. Create or update `.github/skills/improve-mcp/ITERATION-REPORT.md` before changing code so the current goal, active hypothesis, validation project name, and starting state are recorded.
3. Use EasyEDA MCP to verify connectivity with `bridge_status`, then inspect context with `get_current_context` and `list_project_objects`.
4. Create a disposable validation project and drive the implementation by creating a schematic and PCB from scratch through MCP.
5. When expected host-generated project structure, import behavior, or `.eprj` contents are unclear, inspect the local example projects under `src/context/easyeda-pro-example-projects/` before guessing.
6. Exercise the relevant MCP tools by placing parts, wiring or connecting nets, saving documents, and pushing the workflow as far as possible through MCP.
7. Measure progress by how far the MCP server can drive the workflow toward a fully complete PCB, not by partial success on isolated tool calls.
8. Treat any mismatch between advertised tool behavior and observed runtime behavior as a service bug in this repository.
9. Append an iteration entry to the report capturing the failure symptoms, exact errors, browser or bridge observations, and the code area suspected.
10. Fix the root cause in the bridge or server code.
11. Append the code changes made in that iteration to the report, including touched files and the intended effect of the change.
12. When restarting, detect and terminate stale local `mcp:server` processes first, then start exactly one fresh MCP server instance.
13. Reconnect the EasyEDA bridge automatically when required by the change or by bridge instability, using Chrome DevTools MCP to operate the EasyEDA UI when necessary.
14. Verify the restarted system with `bridge_status` and context checks before continuing.
15. Before treating PCB work as successful, verify that the schematic components are mapped to the intended PCB footprints and that no footprint mismatch or invalid-footprint issue remains.
16. Before DRC or fabrication-export validation, verify that the PCB has explicit board-outline geometry on the board outline layer and that the intended board size is therefore defined.
17. Before treating routing as complete, verify that no intended connections remain as unrouted ratlines or other unresolved net connectivity in the PCB view.
18. Before treating PCB work as successful or proceeding to export-oriented PCB steps, run the relevant EasyEDA DRC flow and resolve every reported error and warning unless a warning is a verified host-side false positive that is documented explicitly in the report.
19. When fabrication output is part of the goal, verify that the Gerber export flow is reachable, and when practical also verify the generated Gerber/Drill output in a viewer or EasyEDA's Gerber view before treating the board as fabrication-ready.
20. When assembly output is part of the goal, verify that BOM and Pick and Place export paths are reachable and note any missing designators, footprint metadata, or placement-origin issues that would make assembly output incomplete.
21. Rerun the same end-to-end workflow, then append the validation outcome, remaining gap, and next hypothesis to the report.
22. Continue iterating until the PCB flow completes successfully through MCP or a genuine external blocker remains.
23. Do not stop at analysis, a proposed fix, or a partial workaround when the agent can still make code changes, restart systems, reconnect the bridge, and rerun validation autonomously.

Do not proceed from a PCB validation milestone to export, fabrication, or completion claims while DRC still reports warnings or errors, unless those warnings are proven false positives outside the MCP service's control and are documented as such.

## Completion Standard

A complete PCB means as fully complete as possible through MCP, including:

- project creation
- schematic creation
- intended footprint assignment for placed parts
- PCB creation
- transfer or import of design intent from schematic to PCB when the workflow requires it
- explicit board outline geometry defining the physical board size
- intended part placement on the PCB
- intended net connectivity or routing completed as far as the host SDK allows
- no unresolved intended ratlines or equivalent unrouted PCB connections
- saved design state
- DRC check passes with no errors or warnings
- reaching a state where Gerber export can actually be invoked from the resulting PCB workflow

When fabrication or assembly outputs are part of the task, completeness also includes successful validation of the relevant export paths such as Gerber, Drill, BOM, and Pick and Place.

Do not stop at a partial schematic, partial PCB, or partial placement result when the active task is to validate PCB creation from scratch. Likewise, do not treat the PCB stage as complete while DRC warnings remain unresolved.

## Debugging Procedure

When a tool fails:

1. Capture the exact EasyEDA MCP error text.
2. Use Chrome DevTools MCP to inspect the EasyEDA editor page for console errors, page state, modal dialogs, stale UI context, and visible PCB-design progress.
3. Check whether the bug is in capability exposure, request formatting, timeout handling, coordinate conversion, optimistic revision logic, or EasyEDA host SDK method availability.
4. Record the failure in the iteration report before changing code so the original symptom is not lost.
5. If the host SDK does not actually support a claimed operation, fix the service by tightening capability reporting, adding guards, improving error messages, or routing through a supported fallback.
6. If the bridge or server becomes stale, restart the local MCP server and re-establish the bridge connection automatically before concluding the tool is broken, using Chrome DevTools MCP to reconnect through the EasyEDA UI when needed.

Prefer fixing discrepancies in the implementation over documenting around them.

## Fallback Order

When an edit flow fails, prefer this recovery order:

1. Retry with the intended high-level MCP tool after confirming context and inputs.
2. Query the live state with inspection tools such as `list_*`, `get_current_context`, and primitive or pin queries.
3. Use document-source tools when the higher-level edit tool is unreliable but source replacement is supported safely.
4. Restart the MCP server, reconnect the EasyEDA bridge, and use Chrome DevTools MCP to repair UI state if the bridge or page is stale.
5. Rebuild, reinstall, or relaunch the local extension/runtime components when the evidence suggests the live host is still running stale code.
6. Only conclude there is an external blocker after the above steps fail.

## Code Areas to Check First

The most relevant files for service behavior are usually:

- `src/mcp-server.ts`
- `src/mcp-tools.ts`
- `src/easyeda-mcp-bridge.ts`
- `src/bridge-session.ts`
- `src/mcp-bridge-protocol.ts`

Tests usually belong under `test/`, especially:

- `test/mcp-tools.test.ts`
- `test/bridge-session.test.ts`
- `test/mcp-bridge-protocol.test.ts`
- `test/live-mcp.integration.test.ts`

## Build and Test

Use the real repo commands:

- `npm run lint`
- `npm test`
- `npm run test:live` when a live EasyEDA bridge session is available
- `npm run mcp:server` to run the local MCP server
- `npm run build` for the packaged extension build

When fixing a bug, prefer adding or updating an automated test that covers the request and response shape or bridge-session behavior. For issues that only reproduce with a live EasyEDA instance, document the live validation path in the final response and rerun the scenario after the fix.

## Iteration Report

Maintain `.github/skills/improve-mcp/ITERATION-REPORT.md` throughout the task.

For each iteration, append a new dated section that includes:

- objective
- disposable validation project name
- starting bridge and UI state
- exact failure symptoms and errors
- files changed in that iteration
- concise summary of the code changes made
- restart and reconnection actions taken
- validation steps executed
- result and remaining gap
- next hypothesis or next step

If DRC was reachable in that iteration, record the DRC result explicitly, including the error count and warning count. If either count is non-zero, describe what must be fixed before proceeding further in the PCB flow.

If footprint validation, board-outline checks, ratline checks, or fabrication/assembly export checks were reached in that iteration, record their results explicitly as well, including what remained unresolved.

Do not overwrite prior iterations unless correcting factual mistakes. The report should show the full sequence of attempted fixes and observed results.

## Conventions

- Fix the service at the source instead of adding one-off workarounds in the client flow.
- Update this skill file as well when doing so materially improves the self-improvement process, tool sequencing, safety boundaries, or validation workflow for this repository.
- Keep protocol and tool schemas backward compatible unless the change is required to correct a broken contract.
- If a tool advertises behavior that the bridge cannot guarantee, make the contract more accurate.
- When a fix changes runtime behavior, also update tests and any relevant docs such as `MCP.md`.
- Measure success by progress toward producing a fully complete PCB through the MCP server, not by partial tool coverage alone.
- Treat missing footprint assignments, missing board outline geometry, unresolved intended ratlines, and broken fabrication-handoff exports as blocking quality failures for PCB completion.
- Treat DRC warnings as blocking quality failures for PCB completion, not as informational noise, unless they are demonstrated false positives and documented.
- A successful restart means stale MCP server processes were cleared, one fresh server instance is running, and the bridge has been revalidated with `bridge_status` before continuing.
- Restart and reconnect automatically after bridge or server changes when needed; do not wait for user approval if the scope stays within this repo and the EasyEDA editor page.
- Minimize user interaction throughout the loop. Prefer autonomous retries, inspection, rebuild, restart, reconnection, and revalidation over status-only updates or requests for direction.
- If the agent must surface a blocker, state the exact external dependency and the exact next action needed from the user instead of handing back a broad troubleshooting task.
- Do not claim a bridge fix is complete until it has been validated through a live EasyEDA workflow when that workflow is available.
- Keep the iteration report current enough that another agent could resume the self-improvement loop from it without re-discovering the last few steps.

## Style Notes

- Prefer the term "EasyEDA editor" when referring to the live browser page at `https://pro.easyeda.com/editor`.
- Prefer the term "EasyEDA UI" when referring to interactive browser controls exposed through Chrome DevTools MCP.
- Keep tool names, URLs, file paths, and validation gates explicit rather than implied.