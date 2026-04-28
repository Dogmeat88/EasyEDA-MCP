---
name: create-pcb-from-schematic
description: "Create a routed PCB from an existing EasyEDA schematic using the EasyEDA MCP server. Use when importing a schematic to a new PCB, validating the imported structure, handing off layout to the dedicated layout skill, routing traces, running DRC, and preparing for Gerber export. Assumes the schematic already exists and is saved. Covers correct tool parameter names, import verification, routing, DRC, and the full save+verify loop."
argument-hint: "Describe the board — form factor, layer count, connector requirements, or any critical constraints"
user-invocable: true
---

# Create a PCB from a Schematic via EasyEDA MCP

## When to Use

- Importing a completed EasyEDA schematic into a new PCB document.
- Verifying imported footprints, nets, and board linkage before layout/routing.
- Handing layout work to the dedicated PCB layout skill, then routing all nets.
- Running DRC and preparing for Gerber/BOM/CPL export.

---

## Operating Principles

- Follow the shared EasyEDA execution defaults in [../../copilot-instructions.md](../../copilot-instructions.md).
- This skill focuses on PCB-specific import checks, routing, DRC, and export-readiness validation.
- Use the [layout-pcb skill](../layout-pcb/SKILL.md) for functional zoning, component placement, board outline creation, and routing-readiness validation.
- None of the PCB tools take a `documentUuid` parameter. They all operate on the active PCB document. Confirm the active document is the PCB with `get_current_context` before calling them.
- Treat a write that returns success but leaves state unchanged as a no-op defect, not a transient error. Read back before retrying.
- Before starting any numbered workflow step after the first PCB mutation, run PCB DRC and resolve every current issue before proceeding. Do not keep building on top of known DRC failures.

---

## Validation Step Before Every Step

Treat this as a recurring prerequisite for the entire PCB flow below, not as a one-time milestone.

1. Run the current PCB DRC check before each numbered step after any prior PCB edit.
2. Read the current DRC results and resolve all reported issues before continuing to the next numbered step.
3. Re-run PCB DRC after each repair until the board is clean or an item is proven to be a host-side false positive and documented.
4. Only then continue with the next numbered step in this skill.

Validation rule:
- Before Step 3, Step 4, Step 5, and every later step, there must be no unresolved PCB DRC issues carried forward from earlier work.

## PCB DRC Check

Use an explicit EasyEDA DRC pass after each placement, outline, routing, or source-level PCB mutation.

Preferred order:
1. Open the PCB DRC panel in EasyEDA for the active PCB document.
2. Press `Check DRC` for a fresh run instead of trusting a stale panel summary.
3. Read the current totals from the visible panel or host-readable result nodes.

Minimum acceptance for continuing:
- `All(0)`
- `Fatal Error(0)`
- `Error(0)`
- `Warn(0)` unless a warning is a verified host-side false positive and explicitly documented

Treat these as blocking categories until repaired:
- `TracktoTrack`
- `TH PadtoTrack`
- `HoletoTrack`
- `SMD PadtoTrack`
- Connection or unrouted-net errors
- Board-outline recognition problems that would block export even if DRC appears clean

## PCB Correction Loop

When PCB DRC fails, use this repair loop before progressing to the next workflow step:

1. Capture the exact failing category, count, and affected net or primitive family.
2. Identify the smallest repair slice using `get_pcb_net_primitives`, `list_pcb_component_pads`, `get_pcb_primitives_bbox`, or `get_document_source`.
3. Repair only that slice first: reroute the local segment, move the conflicting component slightly, widen spacing, or fix the outline primitive.
4. Read back the mutated PCB state and verify the targeted primitive or net actually changed.
5. Re-run PCB DRC immediately.
6. If the same category persists, keep iterating on that same local defect instead of routing new nets elsewhere.

Escalation rules:
- If a route or outline write returns success but readback state is unchanged, treat it as a host no-op defect and recover before adding more copper.
- If the current routing has accumulated many overlapping local failures, prefer deleting or replacing that local route set and rerouting cleanly over layering more fixes onto the same bad geometry.

---

## Key Tool Signatures (Quick Reference)

```
# Project / board setup
create_board: { projectUuid, name }
create_pcb: { projectUuid, boardName, name }
import_schematic_to_pcb: { pcbUuid, saveAfter? }

# Inspect PCB contents — operates on active document, no documentUuid
list_pcb_primitive_ids: { family: "component"|"line"|"text", layer?, net? }
list_pcb_component_pads: { componentPrimitiveId }
get_pcb_primitive: { primitiveId }
get_pcb_primitives_bbox: { primitiveIds: ["<id>", ...] }
list_pcb_nets: {}
get_pcb_net: { net }
get_pcb_net_primitives: { net }    # verify routing; polylines show length=0 in list_pcb_nets but are real

# Move components
modify_pcb_component: { primitiveId, x?, y?, rotation?, layer? }

# Draw outline and traces
add_pcb_line: { layer, startX, startY, endX, endY, net?, lineWidth? }

# Route pad-to-pad
route_pcb_line_between_component_pads: {
  fromComponentPrimitiveId, fromPadNumber,
  toComponentPrimitiveId, toPadNumber,
  layer, lineWidth?, net?
}

# Route with waypoints (multi-segment orthogonal path)
route_pcb_lines_between_component_pads: {
  fromComponentPrimitiveId, fromPadNumber,
  toComponentPrimitiveId, toPadNumber,
  layer, waypoints: [{x, y}, ...], lineWidth?, net?
}

# Save
save_active_document: {}
```

---

## Workflow Stages

| Stage | Steps | Gate condition |
|-------|-------|----------------|
| **1 · Bridge + schematic** | 1–2 | `bridge_status: connected:true`; schematic saved and source non-empty |
| **2 · Structure created** | 3 | PCB with non-empty `parentBoardName` in `list_project_objects` |
| **3 · Import complete** | 4 | Component count, intended footprints, and all nets match schematic |
| **4 · Layout committed** | 5 | The dedicated layout skill finished with routing-ready placement and a valid outline |
| **5 · Routing planned** | 6 | Critical nets, widths, and layer strategy are fixed before adding traces |
| **6 · Routing complete** | 7 | Every net has routing primitives via `get_pcb_net_primitives`; critical routes stay short/direct |
| **7 · Design committed** | 8 | `saved: true`; `sourceHash` changed |
| **8 · DRC clean** | 9 | EasyEDA DRC: `All(0)` |
| **9 · Export ready** | 10 | Gerber export opens without outline warning |

Do not advance a stage until its gate passes.

---

## Step 1 — Verify Bridge and Active Context

```
bridge_status → connected: true, non-empty bridgeSessionId
get_current_context → confirm active document is the target schematic or project
```

If bridge is disconnected, use Chrome DevTools MCP to open the `EasyEDA MCP Bridge` header menu, trigger `Reconnect`, then re-run `bridge_status`.

If `get_current_context` returns `tab_page1` or a Start Page, use Chrome DevTools MCP to reload the page, restore the project tab, and reconnect before continuing.

Verify the MCP server daemon is running:
```
npm run mcp:server:daemon
```
Do **not** run `npm run mcp:server` during an active bridge session — it kills the daemon and severs the WebSocket.

> **Gate — Stage 1 (Bridge ready):**
> - [ ] `bridge_status` → `connected: true` with a non-empty `bridgeSessionId`
> - [ ] `get_current_context` → active document is in the correct project (not `tab_page1`)
> - [ ] MCP daemon is running and `http://127.0.0.1:19733/mcp` responds

---

## Step 2 — Ensure the Schematic Is Saved

Before creating a board or importing, confirm the schematic is saved and non-empty:

```
open_document: { documentUuid: "<schematicPageUuid>" }
get_document_source   → confirm source is non-empty and has expected component primitives
save_active_document  → if any unsaved changes exist
```

Unsaved schematic changes will not appear in the PCB import. Always save and read back the source hash before proceeding.

---

## Step 3 — Create a Board and Linked PCB

```
create_board: { projectUuid: "<projectUuid>", name: "Board1" }
```

Call `list_project_objects` and record the **exact** board name returned (e.g., `Board1`, `Board1_3`). EasyEDA may suffix the name if a conflict exists.

```
create_pcb: {
  projectUuid: "<projectUuid>",
  boardName: "<exact-board-name-from-list_project_objects>",
  name: "PCB1"
}
```

Call `list_project_objects` again and confirm:
- A PCB document exists with a non-empty `pcbUuid`.
- Its `parentBoardName` matches the board name exactly.

If `create_pcb` returns no UUID or `parentBoardName` is empty, the board name did not match. Delete the orphan PCB and retry with the correct exact name.

> **Gate — Stage 2 (Structure created):** Do not import until all pass:
> - [ ] `list_project_objects` shows a PCB entry with a non-empty `pcbUuid`
> - [ ] That PCB entry's `parentBoardName` matches the exact board name string returned at creation
> - [ ] No orphan PCB with an empty `parentBoardName` exists under this project

---

## Step 4 — Import the Schematic into the PCB

Open the PCB document and confirm it is active:

```
open_document: { documentUuid: "<pcbUuid>" }
get_current_context → documentType must be PCB, not schematic
```

Import:

```
import_schematic_to_pcb: { pcbUuid: "<pcbUuid>" }
```

**Verify — do not trust the boolean result alone:**

```
list_pcb_primitive_ids: { family: "component" }
```

Confirm the component count matches the schematic. Then:

```
list_pcb_nets: {}
```

Confirm the expected net names are present (power, ground, signals). If a net is missing, the schematic had an unconnected pin — return to the schematic to fix it before re-importing.

Before planning layout, spot-check imported connectors, power parts, modules, and any unusual packages with `get_pcb_primitive` to confirm the expected footprint/package survived schematic-to-PCB handoff. If the import count is correct but a critical package or pin arrangement is wrong, fix the schematic symbol/footprint choice before placement.

If import leaves an empty PCB, the schematic may not have been linked. Confirm the schematic and PCB share the same board via `list_project_objects`. If not linked, delete the PCB and recreate it with the correct `boardName`.

> **Gate — Stage 3 (Import complete):** Do not plan layout until all pass:
> - [ ] `list_pcb_primitive_ids { family: "component" }` count matches the schematic component count
> - [ ] `list_pcb_nets` contains every expected net (power, ground, all signal nets)
> - [ ] `get_document_source` on the PCB is non-empty
> - [ ] A spot-check with `get_pcb_primitive` confirms imported connectors, power parts, modules, and unusual packages use the intended footprints
> - [ ] Critical nets and connector roles are still identifiable enough to drive zoning and routing priorities without guesswork
> - [ ] Any missing net means an unconnected schematic pin — fix the schematic and re-import before continuing

---

## Step 5 — Complete Layout Readiness via the Dedicated Layout Skill

After Stage 3 passes, switch to the [layout-pcb skill](../layout-pcb/SKILL.md) and complete its full flow:

1. Verify the active PCB and imported state.
2. Plan functional zones, connector orientation, keep-outs, return paths, and routing corridors.
3. Place components into routing-ready positions.
4. Draw the board outline on `BoardOutLine` with `net: ""`.
5. Save and verify that placement and outline state are committed.

Do not return here until the layout skill has passed its Stage 5 gate.

> **Gate — Stage 4 (Layout committed):**
> - [ ] The [layout-pcb skill](../layout-pcb/SKILL.md) completed through Step 5
> - [ ] The PCB now has routing-ready placement instead of a provisional footprint spread
> - [ ] `BoardOutLine` primitives are present and every one has `net: ""`
> - [ ] The current layout leaves clear routing corridors for the critical nets

---

## Step 6 — Plan the Routing

Before routing, inspect all nets and their pad counts:

```
list_pcb_nets: {}
```

For each critical net, check which components are connected and how far apart their pads are:

```
get_pcb_net: { net: "GND" }
get_pcb_net: { net: "+3V3" }
```

**Routing priority order (industry standard):**

1. **Power planes / power fills** — GND and primary supply rails. On a two-layer board, dedicate entire copper regions to GND whenever practical.
2. **High-current traces** — motor drivers, LED drivers, relay coils. Size for current: 1 A ≈ 1 mm trace at 1 oz copper with 10 °C rise.
3. **Clocks, oscillators, differential pairs** — route short and direct, avoid parallel runs next to noisy nets.
4. **Critical analog/sensing signals** — shield from switching noise; keep return paths clean.
5. **Digital I/O and control signals** — route after all above.
6. **Low-priority signals and optional connections** — last.

**Two-layer strategy:**
- TopLayer: horizontal signal traces, power distribution.
- BottomLayer: vertical signal traces, ground returns.
- Cross-hatching layers minimizes coupling.
- Use short, straight via-less paths for power connections where possible.
- Preserve the broadest continuous ground reference you can; route signals so their return path can stay directly beneath or adjacent.
- Change layers near pad escape or destination, not repeatedly in the middle of a route.
- Route compact local loops first: regulator input/output loops, switching loops, crystal pairs, and feedback/sense loops.

**Width guidelines (1 oz copper):**
- Board outline: n/a
- Low-current signal (< 0.3 A): 8–10 mil (0.2–0.25 mm)
- General signal: 10–20 mil (0.25–0.5 mm)
- Power (1–3 A): 30–50 mil (0.75–1.25 mm)
- High-current (> 3 A): 80+ mil (2 mm+)

If the planned channels cannot support short/direct routes for the critical nets above, return to the [layout-pcb skill](../layout-pcb/SKILL.md) and rework placement before committing traces.

---

## Step 7 — Route Traces

Obtain pad numbers for each component before routing:

```
list_pcb_component_pads: { componentPrimitiveId: "<primitiveId>" }
```

Each pad has a `padNumber` string (e.g., `"1"`, `"2"`, `"GND"`) and `x`, `y` coordinates.

**Point-to-point route:**
```
route_pcb_line_between_component_pads: {
  fromComponentPrimitiveId: "<id1>",
  fromPadNumber: "1",
  toComponentPrimitiveId: "<id2>",
  toPadNumber: "2",
  layer: "TopLayer",
  lineWidth: 20
}
```

**Multi-segment route with waypoints (for avoidance or orthogonal routing):**
```
route_pcb_lines_between_component_pads: {
  fromComponentPrimitiveId: "<id1>",
  fromPadNumber: "1",
  toComponentPrimitiveId: "<id2>",
  toPadNumber: "2",
  layer: "BottomLayer",
  waypoints: [
    { x: 1500, y: -800 },
    { x: 1500, y: -1200 }
  ],
  lineWidth: 10
}
```

**Verify routing after each critical net is complete:**
```
get_pcb_net_primitives: { net: "GND" }
```

Note: `list_pcb_nets` reports `length: 0` for routed polylines — this is a known EasyEDA behavior. Use `get_pcb_net_primitives` to confirm actual routing primitives exist. A `pcbItemPrimitiveType: "Polygon"` or `"Line"` entry confirms the trace is present.

**Routing rules:**
- Avoid acute angles (< 45°). Use 45° or curved jogs only.
- Do not route directly across the edge of the board outline.
- For high-current AC traces, use 30 mil minimum and route on TopLayer only, keeping them well away from LV signals.
- Vias introduce impedance and reliability risk — prefer direct routing to minimize via count.
- If a net requires a via, place it intentionally; EasyEDA MCP does not yet have a via placement API, so via-less routing is preferred for all automated paths.
- Keep each high-di/dt loop compact and local; prioritize source-to-switch-to-load-to-return before general signals.
- Keep clocks, crystals, feedback traces, and quiet analog nets out of high-current or switching corridors.
- Prefer one dominant direction per layer; avoid meanders added only to compensate for poor placement.

> **Gate — Stage 6 (Routing complete):**
> - [ ] `get_pcb_net_primitives { net: "<net>" }` returns at least one entry for every intended net
> - [ ] No net from `list_pcb_nets` has zero routing primitives unless intentionally left unrouted and documented
> - [ ] Power and high-current nets use the intended widths and stay on short, direct paths with compact return loops
> - [ ] Clock, crystal, feedback, and sensitive analog nets are short/direct and do not pass through noisy or high-voltage zones
> - [ ] Routing still reflects the planned two-layer strategy: no avoidable meanders, no repeated layer swapping, and no trace crossing the board outline
> - [ ] Note: `list_pcb_nets` shows `length: 0` for polyline routes — always use `get_pcb_net_primitives` to confirm

---

## Step 8 — Save and Verify Completeness

```
save_active_document: {}
```

Confirm `saved: true`. Then run the pre-DRC checklist:

```
list_pcb_nets: {}
```

For every net in the schematic, confirm routing primitives exist via `get_pcb_net_primitives`. Any net with zero primitives has unrouted connections (ratlines).

```
list_pcb_primitive_ids: { family: "component" }
```

All components from the import should still be present.

```
get_document_source
```

Confirm the source is non-empty and the `sourceHash` changed from before the save, confirming the server received the writes.

If the board passes this save/readback step but still relies on long detours, fractured return paths, or placement compromises to complete routing, it is not finished. Return to placement or routing and fix the root cause before DRC.

> **Gate — Stage 7 (Design committed):**
> - [ ] `save_active_document` returned `saved: true`
> - [ ] `get_document_source` → `sourceHash` differs from the pre-save value
> - [ ] `list_pcb_primitive_ids { family: "component" }` count is unchanged (no accidental deletions)

---

## Step 9 — Run DRC

DRC is a host-side UI workflow. Use Chrome DevTools MCP to trigger it:

1. `Design → Check DRC` in the EasyEDA menu.
2. Click the `Check DRC` button in the panel.
3. Read the result from the DOM if the panel is not in the accessibility tree:

```javascript
document.querySelector('#panelDrcPrimaryLog').innerText
```

A clean board shows `All(0)`, `Fatal Error(0)`, `Error(0)`, `Warn(0)`.

**Resolve every error before export.** Common DRC errors and causes:

| DRC Error | Cause | Fix |
|---|---|---|
| Clearance violation | Two traces or pads too close | Re-route with wider clearance; increase separation |
| Unconnected net | A ratline remains | Route the missing trace |
| Short circuit | Overlapping traces or pads | Delete overlapping primitives, re-route |
| Silkscreen over pad | Reference text on top of pad | Move silkscreen text off pads |
| Missing board outline | `BoardOutLine` layer empty or `net ≠ ""` | Fix outline per Step 7 |

Also verify manually before export:
- Silkscreen and reference designators do not collide with pads, holes, or board edges.
- Connectors are accessible and oriented correctly.
- Component polarity markers (pin 1, cathode) are visible and correct.
- No component is overlapping another or placed too close to the edge.

> **Gate — Stage 8 (DRC clean):** Do not export until all pass:
> - [ ] EasyEDA DRC panel shows `All(0)`, `Fatal Error(0)`, `Error(0)`, `Warn(0)`
> - [ ] Silkscreen inspection passed (no overlap with pads, holes, or board edges)
> - [ ] Any confirmed false positive is explicitly documented
> - [ ] No unresolved error or warning remains — this gate is a hard stop

---

## Step 10 — Export Gerber

After DRC passes, verify the Gerber export path via Chrome DevTools MCP:

1. `Export → PCB Fabrication File (Gerber)...`
2. Confirm the dialog opens without the `JLCPCB will not recognize the board outline` warning.
3. If the outline warning appears, open `get_document_source`, find `BoardOutLine` primitives, and confirm all have `net: ""`. Fix via `modify_pcb_line` or source edit, then re-export.

For JLCPCB SMT assembly, also validate BOM and pick-and-place exports are reachable:

```javascript
eda.pcb_ManufactureData.getBomFile(...)
eda.pcb_ManufactureData.getPickAndPlaceFile(...)
```

Both returning non-empty results confirms the assembly export path is healthy.

---

## Verification Checklist

Before treating PCB creation as complete:

- [ ] `bridge_status` shows `connected: true`
- [ ] `list_project_objects` shows PCB with non-empty `parentBoardName` matching the board
- [ ] All schematic components are present in `list_pcb_primitive_ids { family: "component" }`
- [ ] Board outline on `BoardOutLine` layer, all four sides present, all with `net: ""`
- [ ] All components placed inside the outline with ≥ 0.3 mm edge clearance
- [ ] Connectors oriented outward toward the correct board edge
- [ ] Decoupling caps within 1–2 mm of their target IC power pins
- [ ] Power-entry, regulator, and other high-current loops are compact and do not cut through quiet signal areas
- [ ] Crystals, feedback parts, shunts, and other loop-critical parts stayed adjacent to their target pins after final placement
- [ ] Every net has routing confirmed via `get_pcb_net_primitives`
- [ ] Trace widths appropriate for current and signal type
- [ ] Preferred layer directions and return-path continuity are still recognizable in the finished routing
- [ ] DRC shows `All(0)` — no unresolved errors or warnings
- [ ] Gerber export opens without board outline warning
- [ ] `save_active_document` returned `saved: true` after final changes

---

## Common Failure Modes

| Symptom | Likely Cause | Fix |
|---|---|---|
| `create_pcb` returns no UUID | `boardName` did not match exact name from `list_project_objects` | Re-read `list_project_objects`, use the exact string including any suffix |
| Import leaves empty PCB | Schematic and PCB not linked to the same board | Check `parentBoardName` in `list_project_objects`; recreate PCB with correct `boardName` |
| `list_pcb_nets` shows fewer nets than schematic | Some schematic pins unconnected or incorrectly named | Fix wiring in schematic, save, re-import |
| `get_pcb_net_primitives` returns empty for a routed net | Routing tool timed out without placing a primitive | Retry the route; read back to confirm on each attempt |
| `list_pcb_nets` shows `length: 0` for all nets | Known EasyEDA behavior for polyline routes | Use `get_pcb_net_primitives` instead — polyline routes show as `Polygon` type with zero length |
| `modify_pcb_component` succeeds but position unchanged | Tool operated on wrong active document | Call `get_current_context` — open PCB first with `open_document`, then retry |
| Board outline missing in Gerber | `BoardOutLine` lines have non-empty `net` | Fix `net: ""` on all outline primitives; run Gerber export again |
| DRC fails with clearance error after routing | Traces too close together | Delete violating segment, re-route with wider separation or via a detour |
| Board can only be finished with long crossovers, meanders, or repeated layer swaps | Placement ignored routing channels, return paths, or functional zoning | Go back to Steps 5–6, re-place the functional groups, and reroute the critical nets from a cleaner baseline |
| Bridge disconnects after running `npm run mcp:server` | Ad-hoc stdio probe kills the running daemon | Kill the orphan process, restart with `npm run mcp:server:daemon` |

---

## AC/High-Voltage Safety Rules

If the board contains AC mains or high-voltage circuits:

- **Creepage and clearance:** IEC 60950/62368 requires ≥ 6 mm creepage and ≥ 3 mm clearance between mains and SELV (Safety Extra-Low Voltage) traces at 250 VAC for basic insulation.
- **Physical zone separation:** Place an explicit keep-out zone (text or copper pour cutout) between the AC zone and the LV zone. Document the boundary in the schematic.
- **AC trace width:** Use ≥ 30 mil (0.75 mm) for mains-carrying traces to handle fault current before a fuse clears.
- **Fuse placement:** Place the fuse in series with the AC live (L) line before any other AC component.
- **VDR/MOV placement:** Place MOVs directly across the mains input, before the fuse on the protected side.
- **Isolation barrier:** Optocouplers and isolated DC/DC converters must span the isolation boundary — do not route any net across it without a proper isolation device.
