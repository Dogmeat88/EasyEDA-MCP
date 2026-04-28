---
name: "EasyEDA MCP End-to-End Workflow"
description: "Use when creating a project, schematic, or PCB on EasyEDA via the EasyEDA MCP server. Covers the full workflow from project creation through schematic capture, PCB import, layout, routing, DRC, and Gerber export. Keep EasyEDA MCP as the primary execution path; use Chrome DevTools MCP only to diagnose problems or unblock UI-only and bridge-recovery steps."
---

# EasyEDA MCP End-to-End Workflow

## Operating Mode

Run this workflow as autonomously as possible.

- Follow the shared execution defaults in [../copilot-instructions.md](../copilot-instructions.md).
- This instruction adds the PCB-specific bridge-failure policy, automation loop, workflow gates, and completion criteria for the full project-to-Gerber flow.
- Treat unexpected EasyEDA bridge failures as repository defects. If the bridge is unstable, stale, falsely reports success, or cannot reconnect reliably, diagnose and fix the bridge or MCP service instead of documenting the issue away.
- Do not stop at a partial step if the next action is a deterministic recovery through Chrome DevTools MCP.

## Bridge Failure Policy

When the workflow exposes a bridge problem, do not treat it as a normal user-side obstacle.

1. Capture the exact failure symptom from `bridge_status`, the MCP response, and the EasyEDA page state.
2. Use Chrome DevTools MCP only to inspect the editor shell, header menu state, visible dialogs, and console errors, or to trigger the minimum UI action needed to restore EasyEDA MCP.
3. Distinguish between a temporary stale session and an implementation defect:
   - If reconnecting the bridge or reloading the page restores the same workflow, continue.
   - If the bridge repeatedly drops, lies about connection state, loses context, or produces no-op success responses, treat that as a service bug.
4. For service bugs, inspect and fix the relevant bridge or server code in this repository before proceeding with the PCB flow. Do not expand Chrome DevTools MCP into a substitute execution path.
5. Restart the MCP server cleanly, reconnect through Chrome DevTools MCP, and rerun the failed PCB step.
6. Only continue with the PCB workflow after the bridge problem is actually resolved or a genuine external blocker remains.

## Automation Loop

Use this control loop throughout the flow:

1. Attempt the intended EasyEDA MCP operation.
2. Read back the resulting state with `get_current_context`, `list_project_objects`, `list_*_primitive_ids`, or `get_document_source`.
3. If the operation is blocked by editor state, reconnect, hidden UI, modal dialogs, or panel interactions, use Chrome DevTools MCP only to repair the EasyEDA session or diagnose the failure, then return immediately to EasyEDA MCP.
4. If the same bridge issue recurs or readback shows that the bridge reported false success, stop treating it as transient and fix the bridge or MCP implementation.
5. Retry the same EasyEDA MCP step after the UI, bridge state, or code path is repaired.
6. Only treat the step as complete after readback confirms the expected mutation.

---

## Workflow Stages

The full workflow has eight phases. A gate closes each phase — do not advance to the next phase until the gate passes.

| Phase | Steps | Gate condition |
|-------|-------|----------------|
| **1 · Bridge ready** | Prerequisites | `bridge_status: connected:true`; editor authenticated; MCP daemon running |
| **2 · Schematic complete** | 1–5 | Saved; non-empty `sourceHash`; all components placed; all nets wired |
| **3 · Project structure** | 6–7 | PCB in `list_project_objects` with non-empty `parentBoardName` matching the board |
| **4 · Import complete** | 8 | Component count matches schematic; all expected nets present in `list_pcb_nets` |
| **5 · Layout + outline** | 9–10 | All placements inside outline; functional zones remain intentional; all `BoardOutLine` lines have `net: ""` |
| **6 · Routing complete** | 11 | Every intended net has routing primitives via `get_pcb_net_primitives`; critical routes stay short/direct |
| **7 · DRC clean** | 12 | EasyEDA DRC: `All(0)`, `Fatal Error(0)`, `Error(0)`, `Warn(0)` |
| **8 · Export ready** | 13 | Gerber export dialog opens without board-outline warning |

---

## PCB Design Best Practices

Apply best practices throughout the entire design flow, not just at DRC time.

- Use correct symbols and footprints from the start. Prefer verified library parts, and confirm package, pinout, orientation, and pad style before layout begins.
- Keep schematic intent clear. Use meaningful net names for power, ground, clocks, resets, and high-value signals so the PCB stage remains inspectable and less error-prone.
- Place parts by function. Keep related components physically grouped, keep connector orientation intentional, and keep critical support parts close to the ICs they serve.
- Keep decoupling capacitors close to the power pins they support, with short return paths to ground.
- Keep loop-critical support parts local. Regulator input/output caps, bootstrap parts, feedback dividers, crystals, shunts, and sense networks should sit next to the pins they serve instead of being spread out for visual symmetry.
- Define the board outline early and keep component placement inside the manufacturable edge clearance.
- For two-layer boards, assign a dominant routing direction to each layer and protect continuous return paths instead of treating both layers as interchangeable free space.
- Keep noisy switching and high-current paths compact and close to their source side of the board so they do not bisect quiet analog, sensing, or timing sections.
- Treat placement as routing preparation. If critical nets only fit by crossing zones, meandering, or repeatedly swapping layers, fix placement before adding more copper.
- Route critical nets first. Prioritize power, ground returns, clocks, high-current traces, and any sensitive analog or fast digital signals before low-risk nets.
- Keep traces as short and direct as practical. Avoid unnecessary jogs, acute angles, and excessive vias.
- Use trace widths and clearances appropriate for current, voltage, and manufacturing limits. Do not rely on default widths for power paths.
- Maintain solid grounding strategy. Prefer continuous return paths and avoid routing choices that force noisy or fragmented current loops.
- Separate noisy, high-current, switching, analog, RF, and sensitive measurement sections when the design requires it.
- Leave room for assembly and debugging. Keep reference designators readable, maintain connector access, and preserve probe access to critical signals where practical.
- Treat DRC as the final verification gate, not as the only design-quality gate. Good placement, routing, outline definition, and manufacturability checks must already be in place before export.

## Prerequisites

Before starting any PCB creation flow, establish a working bridge and confirm the editor is ready.

1. Open `https://pro.easyeda.com/editor` with Chrome DevTools MCP only as needed to confirm the EasyEDA editor is visibly loaded and authenticated.
2. Call `bridge_status` — confirm `connected: true` and a non-empty `bridgeSessionId`. If not connected, use Chrome DevTools MCP to open the `EasyEDA MCP Bridge` header menu, trigger `Reconnect`, and retry.
3. Call `get_current_context` — confirm the active document is inside a real project (not `tab_page1` or the Start Page). If the context shows only a Start Page pseudo-document, use Chrome DevTools MCP to reload the page, restore the project tab, and reconnect the bridge before continuing.
4. Verify the MCP server process is running (`npm run mcp:server:daemon`). Do not run `npm run mcp:server` during an active bridge session — it kills the daemon and severs the WebSocket.

If the bridge menu is not visible in the accessibility tree, use Chrome DevTools MCP DOM interaction or page script evaluation to invoke the reconnect flow instead of treating the session as blocked.

If reconnect repeatedly fails, the header menu disappears after reload, or the bridge claims `connected: true` while MCP calls still behave like a dead session, treat that as a bridge defect to fix in the repository before proceeding.

Once the bridge is healthy, return to EasyEDA MCP for the actual PCB workflow.

> **Gate — Phase 1 (Bridge ready):** Do not start the workflow until all pass:
> - [ ] `bridge_status` → `connected: true` with a non-empty `bridgeSessionId`
> - [ ] `get_current_context` → active document is a real project (not `tab_page1` or Start Page)
> - [ ] MCP daemon is running and `http://127.0.0.1:19733/mcp` responds

---

## Step 1 — Create a Project

Use a deterministic naming pattern such as `PCB_PROJECT_<date>` for new designs so artifacts are identifiable.

```
create_project: { name: "PCB_PROJECT_20260411" }
```

After creation, call `list_project_objects` and confirm the new project appears. Note the returned `projectUuid`.

If project creation times out or the UI appears stale, use Chrome DevTools MCP only to confirm the project list in the editor before retrying. Do not replay the create call until readback confirms the project is absent.

---

## Step 2 — Create a Schematic

```
create_schematic: { projectUuid: "<projectUuid>", name: "Sheet1" }
```

Call `list_project_objects` again and confirm a schematic document exists with its own UUID. Note the `schematicUuid`.

Open the schematic document:

```
open_document: { documentUuid: "<schematicUuid>" }
```

Confirm with `get_current_context` that the active document is the new schematic before placing anything.

If `open_document` is blocked by stale UI state, use Chrome DevTools MCP only to bring the correct tab to the foreground, dismiss blocking dialogs, and retry.

---

## Step 3 — Add Schematic Components

> For schematic work, the [create-schematic skill](./../skills/create-schematic/SKILL.md) provides detailed tool signatures, wiring patterns, and failure modes. Steps 3–5 here are a concise reference.

Search the library before placing each component:

```
search_library_devices: { query: "<part-name>" }
# or by exact LCSC part number:
search_library_devices: { lcscIds: ["C12345"] }
```

From each result's `devices` array, record `libraryUuid` and `uuid` (passed as `deviceUuid` for placement).

Place each component — tools operate on the active document, no `documentUuid` param:

```
add_schematic_component: {
  libraryUuid: "<libraryUuid from search>",
  deviceUuid: "<uuid from search result>",
  x: 100,
  y: 100
}
```

After each placement, call `list_schematic_primitive_ids` and verify the component count increased. Do not assume placement succeeded from the return value alone.

Before moving on, confirm that each placed part uses the intended footprint and electrical symbol. Fix mismatches at the schematic stage instead of deferring them to PCB import.

If placement is slow or a larger symbol times out, read back the schematic source or primitive inventory before retrying. Use Chrome DevTools MCP only to inspect visible editor state if the host appears busy or partially updated.

---

## Step 4 — Connect Schematic Pins (Wiring)

Prefer `connect_schematic_pins_to_nets` over raw wire placement. It handles both the native net-label path and the wire-stub fallback. All wiring tools operate on the active document — no `documentUuid` param.

Retrieve `pinNumber` strings first:
```
list_schematic_component_pins: { componentPrimitiveId: "<primitiveId>" }
```

Then wire by `pinNumber` (a string like `"1"`, `"GND"`, `"DQ"`):
```
connect_schematic_pins_to_nets: {
  componentPrimitiveId: "<primitiveId>",
  connections: [
    { pinNumber: "1", net: "VCC" },
    { pinNumber: "2", net: "GND" }
  ]
}
```

For a single pin: `connect_schematic_pin_to_net: { componentPrimitiveId, pinNumber, net }`

For prefix-based bulk wiring: `connect_schematic_pins_with_prefix: { componentPrimitiveId, pinNumbers: ["0","1"], netPrefix: "GPIO", separator: "_" }`

After wiring, call `get_document_source` and confirm the wire/net primitives appear in the source. Timeouts do not guarantee the host ignored the request — always read back state.

If the native net-label flow is unavailable or the editor exposes a recoverable UI issue, use Chrome DevTools MCP only to inspect console errors, reconnect the bridge, and retry the same MCP call instead of switching to a non-MCP workaround.

---

## Step 5 — Save the Schematic

```
save_active_document: {}
```

Confirm no error is returned. Unsaved schematic changes will not be visible to the PCB import flow.

If saving is blocked by a modal or confirmation popup, use Chrome DevTools MCP only to dismiss or complete the dialog, then rerun the save and read back the source hash.

> **Gate — Phase 2 (Schematic complete):** Do not create a board until all pass:
> - [ ] `save_active_document` returned without error
> - [ ] `get_document_source` → source is non-empty and `sourceHash` changed from the pre-save value
> - [ ] `list_schematic_primitive_ids { family: "component" }` count matches the planned component count
> - [ ] Every intended net appears in the document source

---

## Step 6 — Create a Board

```
create_board: { projectUuid: "<projectUuid>", name: "Board1" }
```

Call `list_project_objects` and note the exact board name returned (e.g., `Board1_3`). **Use this exact name in Step 7** — an arbitrary name creates orphan PCBs that cannot participate in schematic-backed import.

Create the board only after the intended physical form factor is understood. Board naming and board-to-PCB linkage should stay stable through the rest of the workflow.

---

## Step 7 — Create a PCB Linked to the Board

```
create_pcb: {
  projectUuid: "<projectUuid>",
  boardName: "<exact-board-name-from-list_project_objects>",
  name: "PCB1"
}
```

Call `list_project_objects` again and confirm:
- A PCB document exists with a non-empty `pcbUuid`.
- Its `parentBoardName` matches the board name from Step 6.

If `create_pcb` returns no UUID or the inventory shows an empty `parentBoardName`, the board slot was already occupied or the name was wrong. Delete the orphan PCB and retry with the correct board name.

If EasyEDA reports success but the project tree does not update, use Chrome DevTools MCP only to inspect the visible project tree before deciding whether to retry or clean up the orphan item.

> **Gate — Phase 3 (Project structure):** Do not import until all pass:
> - [ ] `list_project_objects` shows a PCB entry with a non-empty `pcbUuid`
> - [ ] That PCB entry's `parentBoardName` equals the exact board name string returned in Step 6
> - [ ] No orphan PCB with an empty `parentBoardName` exists under this project

---

## Step 8 — Import the Schematic into the PCB

> For the complete PCB flow from import through Gerber export, use the [layout-pcb skill](./../skills/layout-pcb/SKILL.md) for zoning, placement, and outline work, then the [create-pcb-from-schematic skill](./../skills/create-pcb-from-schematic/SKILL.md) for routing, DRC, and export. Steps 8–13 here are a concise reference.

```
import_schematic_to_pcb: { pcbUuid: "<pcbUuid>" }
```

This tool throws if EasyEDA claims success but leaves an empty PCB. After it returns:

1. Call `list_pcb_primitive_ids` on the PCB and confirm component primitives are present.
2. Call `get_document_source` on the PCB and confirm the source is non-empty.

Do not trust the boolean result from `importChanges` alone.

Before planning placement, spot-check imported connectors, power parts, modules, and any unusual packages with `get_pcb_primitive` to confirm the expected footprint/package survived schematic-to-PCB handoff. If the import count is correct but a critical package or pin arrangement is wrong, fix the schematic symbol/footprint choice before placement.

If import is blocked by a host-side panel, confirmation flow, or stale board tab, use Chrome DevTools MCP only to focus the target PCB tab and clear the UI state, then rerun the import check.

> **Gate — Phase 4 (Import complete):** Do not place footprints until all pass:
> - [ ] `list_pcb_primitive_ids { family: "component" }` count matches the schematic component count
> - [ ] `list_pcb_nets` contains every expected net name (power, ground, all signal nets)
> - [ ] `get_document_source` on the PCB is non-empty
> - [ ] A spot-check with `get_pcb_primitive` confirms imported connectors, power parts, modules, and unusual packages use the intended footprints
> - [ ] Critical nets and connector roles are still identifiable enough to drive zoning and routing priorities without guesswork

---

## Step 9 — Open the PCB Document and Complete Layout

```
open_document: { documentUuid: "<pcbUuid>" }
```

Confirm with `get_current_context` that the active document is the PCB.

List imported components — tools operate on the active PCB document, no `documentUuid` param:

```
list_pcb_primitive_ids: { family: "component" }
```

Move and orient each component using `modify_pcb_component`:

```
modify_pcb_component: {
  primitiveId: "<compId>",
  x: 10, y: 10, rotation: 0
}
```

Verify component positions by calling `get_pcb_primitive` after each move.

During placement, apply these quality checks:

- Group parts by function and signal flow.
- Keep connectors, switches, indicators, and mounting features aligned with the board edge and the intended user access direction.
- Keep decoupling capacitors and other support components close to their target IC pins.
- Keep power-entry, regulator, switch-node, and other high-current parts near each other so their current loops stay compact and away from quiet circuitry.
- Keep crystals, feedback dividers, shunts, and analog reference parts adjacent to the pins they support.
- Orient polarized parts and pin-1 markers consistently where practical so assembly and inspection stay unambiguous.
- Reserve routing channels for dense or critical nets before locking in less important placements.

Before moving to routing, do a routing-readiness review: power should reach loads directly, ground returns should have an obvious continuous path, and critical nets should have at least one clean route that does not cut through the wrong functional zone. If that review fails, iterate placement before routing. For the full placement and outline checklist, use the [layout-pcb skill](./../skills/layout-pcb/SKILL.md).

If the PCB canvas or inspector is visually out of sync with MCP state, use Chrome DevTools MCP only to confirm the active tab and component selection rather than continuing blind.

---

## Step 10 — Add Board Outline

This step remains part of the same layout phase. For the full outline and layout-commit gates, use the [layout-pcb skill](./../skills/layout-pcb/SKILL.md).

The board outline must exist on the `BoardOutLine` layer. Critically, the outline line net **must be an empty string** — a non-empty net (e.g., `"OUTLINE"`) causes EasyEDA's Gerber exporter to reject the outline even when DRC passes.

```
add_pcb_line: {
  layer: "BoardOutLine",
  startX: 0, startY: 0,
  endX: 50, endY: 0,
  net: ""
}
```

Add four lines to close the rectangle. After placing all four, call `get_document_source` and confirm `BoardOutLine` primitives appear with `net: ""`.

Do not defer outline definition until the end. The outline defines usable placement area, edge clearance, connector alignment, and fabrication validity.

If Gerber later reports a missing outline, inspect the source first. Use Chrome DevTools MCP only to confirm the export warning text or visual board state; fix the actual outline through MCP or source replacement.

> **Gate — Phase 5 (Layout + outline):** Do not route until all pass:
> - [ ] `list_pcb_primitive_ids { family: "line", layer: "BoardOutLine" }` returns the expected outline lines
> - [ ] `get_document_source` → every `BoardOutLine` primitive has `net: ""`
> - [ ] All components are inside the outline and respect the edge-clearance target
> - [ ] Connectors, switches, and mounting features align with the intended board edges and access direction
> - [ ] Power/high-current/noisy sections remain separated from sensitive analog, sensing, or timing sections
> - [ ] Decouplers, crystals, feedback parts, and other loop-critical support parts sit adjacent to the pins they serve
> - [ ] Placement leaves a clean routing corridor per layer for the critical nets identified in the layout plan
> - [ ] `save_active_document` confirms placement state is committed before routing begins

---

## Step 11 — Route Traces

Route connections between pads using `route_pcb_line_between_component_pads` for point-to-point connections:

```
route_pcb_line_between_component_pads: {
  fromComponentPrimitiveId: "<compId1>",
  fromPadNumber: "<padNumber1>",
  toComponentPrimitiveId: "<compId2>",
  toPadNumber: "<padNumber2>",
  layer: "TopLayer",
  lineWidth: 20
}
```

Use `list_pcb_component_pads: { componentPrimitiveId: "<id>" }` to retrieve `padNumber` strings before routing. After routing, call `list_pcb_nets` and `get_pcb_net_primitives` to confirm no ratlines remain unresolved for expected nets.

During routing, apply these quality checks:

- Route power, ground-sensitive, clock, high-current, and otherwise critical nets first.
- Keep critical traces short and direct, and minimize via count where the return path matters.
- Keep one dominant routing direction per layer where practical; switch layers near the source or destination, not repeatedly in the middle of a run.
- Protect return paths: do not route fast or switching nets in a way that fractures the ground reference beneath quiet signals.
- Complete the tightest current loops first — input power loop, regulator/switch loop, rectifier/load loop, and any clock or feedback loop.
- Avoid routing that creates narrow neck-downs, awkward detours, or avoidable coupling between unrelated nets.
- Keep clocks, crystals, feedback traces, and quiet analog nets out of high-current or switching corridors.
- Confirm that trace widths and clearances match the board's electrical and manufacturing needs.

If routing tools stall or the canvas shows unresolved ratsnests that are not obvious from MCP responses, use Chrome DevTools MCP only to inspect the live PCB view, then resolve the underlying missing route through MCP.

> **Gate — Phase 6 (Routing complete):** Do not run DRC until all pass:
> - [ ] `get_pcb_net_primitives { net: "<net>" }` returns at least one entry for every intended net
> - [ ] Power and high-current nets use the intended widths and stay on short, direct paths with compact return loops
> - [ ] Clock, crystal, feedback, and sensitive analog nets are short/direct and do not pass through noisy or high-voltage zones
> - [ ] Routing still reflects the planned two-layer strategy: no avoidable meanders, no repeated layer swapping, and no trace crossing the board outline
> - [ ] Routing confirmation was done with `get_pcb_net_primitives`, not `list_pcb_nets.length`, because polyline routes can report `length: 0`
> - [ ] `list_pcb_primitive_ids { family: "line", layer: "BoardOutLine" }` shows the complete closed outline
> - [ ] `save_active_document` returned `saved: true` after all routing writes

---

## Step 12 — Run DRC

Do not proceed to export while DRC reports errors or warnings.

Trigger DRC through the EasyEDA UI with Chrome DevTools MCP, since this is currently a host-side validation path: `Design → Check DRC`, then press the in-panel `Check DRC` button.

Read results from the DOM if the DRC panel is not in the accessibility tree:

```javascript
document.querySelector('#panelDrcPrimaryLog').innerText
```

A clean board shows `All(0)`, `Fatal Error(0)`, `Error(0)`, `Warn(0)`. Resolve every reported item. Document any item confirmed to be a host-side false positive before continuing.

Treat Chrome DevTools MCP as a validation-side assist for this step, not as a substitute for EasyEDA MCP design control. DRC is currently a host UI workflow even when the rest of the board is created through EasyEDA MCP.

Before treating DRC success as sufficient, also confirm:

- Silkscreen and reference text do not collide with pads, holes, or board edges.
- Connectors and mechanical features remain accessible.
- No component is placed too close to the board edge for assembly or enclosure use.
- The layout still matches the intended functional grouping and signal-flow assumptions from the schematic.

> **Gate — Phase 7 (DRC clean):** Do not export until all pass:
> - [ ] EasyEDA DRC panel shows `All(0)`, `Fatal Error(0)`, `Error(0)`, `Warn(0)`
> - [ ] Silkscreen does not overlap pads, holes, or board edges
> - [ ] Connectors are oriented correctly and accessible
> - [ ] Any warning recorded as a confirmed false positive is explicitly documented

---

## Step 13 — Export Gerber

After DRC passes, verify the Gerber export path:

1. In the EasyEDA UI, use Chrome DevTools MCP only as needed to verify the host export flow: `Export → PCB Fabrication File(Gerber)...`
2. Confirm the dialog opens and reaches the confirmation step without the outline-missing warning.
3. If the warning `JLCPCB will not recognize the board outline` appears, check that all `BoardOutLine` primitives have `net: ""` (Step 10). Fix and re-export.

For assembly output, also validate:

```javascript
eda.pcb_ManufactureData.getBomFile(...)
eda.pcb_ManufactureData.getPickAndPlaceFile(...)
```

Both calls returning `{}` confirms the export paths are reachable.

If the export popup is hidden, clipped, or not accessible through the normal page snapshot, use Chrome DevTools MCP DOM inspection or script evaluation only to verify the dialog state instead of concluding export is unavailable.

---

## Verification Checklist

Before treating PCB creation as complete, confirm all of the following:

- [ ] `bridge_status` shows `connected: true`
- [ ] Schematic components match intended footprints (no footprint mismatch warnings)
- [ ] Functional grouping, connector orientation, and critical support-part placement remain intentional
- [ ] Power-entry, regulator, and other high-current loops are compact and do not run through quiet signal areas
- [ ] Crystals, feedback parts, shunts, and other loop-critical parts stayed adjacent to their target pins after final placement
- [ ] Board outline exists on `BoardOutLine` layer with all lines having `net: ""`
- [ ] No ratlines remain unrouted for any intended net
- [ ] Trace widths, clearances, and critical-net routing choices are appropriate for the design
- [ ] Preferred layer directions and return-path continuity are still recognizable in the finished routing
- [ ] Silkscreen, designators, and access to connectors or debug points are acceptable
- [ ] DRC shows `All(0)` with no unresolved errors or warnings
- [ ] Gerber export dialog opens and completes without an outline-missing warning
- [ ] `list_project_objects` shows the correctly linked board/PCB pair (non-empty `parentBoardName`)

---

## Completion Review

Once all eight gates pass — or to audit a board at any point in the workflow — use the [review-pcb-completion skill](./../skills/review-pcb-completion/SKILL.md). It applies the full gate checklist, uses live EasyEDA MCP inspection, and returns a structured verdict with the earliest gate to return to if the board is not finished.

---

## Common Pitfalls

| Pitfall | Fix |
|---------|-----|
| `create_pcb` returns no UUID | `boardName` did not match the exact name from `list_project_objects` |
| Import leaves empty PCB | PCB and schematic not linked to the same board (`parentBoardName` mismatch); check `list_project_objects`, delete the orphan PCB, and recreate with the correct `boardName` |
| Gerber export rejects board outline | Set `net: ""` on all `BoardOutLine` lines; non-empty nets are silently rejected |
| DRC passes but Gerber still warns | Outline recognition is a separate gate from DRC; validate both independently |
| Placement or write call appears to succeed but state is unchanged | Re-read inventory/source after every write; host can return success on no-ops |
| Bridge disconnects after `npm run mcp:server` | Use `mcp:server:daemon`; ad-hoc stdio probes kill the daemon |
| `get_current_context` returns `tab_page1` | Editor bootstrap failure; reload the page and reconnect bridge before continuing |
| EasyEDA MCP is blocked by hidden UI or bridge state | Use Chrome DevTools MCP only to reconnect, dismiss dialogs, expose DRC/export panels, or re-focus the correct tab, then rerun the MCP step |
| Bridge repeatedly fails, lies about state, or reconnect does not stick | Treat it as a repository bug, inspect bridge/server code, fix it, restart cleanly, and rerun the blocked PCB step |
