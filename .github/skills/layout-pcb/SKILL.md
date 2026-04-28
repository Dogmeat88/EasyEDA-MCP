---
name: layout-pcb
description: "Lay out an imported EasyEDA PCB before routing using the EasyEDA MCP server. Use when planning functional zones, placing footprints, orienting connectors, defining the board outline, and validating routing readiness on an already imported PCB. Assumes the PCB already exists and the schematic import succeeded. Covers placement intent, outline rules, layout validation, and the save+verify loop before routing." 
argument-hint: "Describe the board outline, connector edges, functional zones, and any placement-critical constraints"
user-invocable: true
---

# Lay Out a PCB via EasyEDA MCP

## When to Use

- Refining an imported PCB before any routing begins.
- Planning functional zones, connector orientation, and current-loop placement.
- Placing components into a manufacturable, reviewable layout.
- Drawing the board outline and validating routing readiness.

---

## Operating Principles

- Follow the shared EasyEDA execution defaults in [../../copilot-instructions.md](../../copilot-instructions.md).
- This skill starts after schematic import has already succeeded and the active PCB contains the expected components and nets.
- None of the PCB tools take a `documentUuid` parameter. They all operate on the active PCB document. Confirm the active document is the PCB with `get_current_context` before calling them.
- Treat a write that returns success but leaves state unchanged as a no-op defect, not a transient error. Read back before retrying.
- Before starting any numbered workflow step after the first PCB mutation, run PCB DRC and resolve every current issue before proceeding. Do not keep building layout work on top of known DRC failures.
- Treat `get_layout_fitness_score` as a heuristic optimizer, not as a replacement for DRC or readback. If the score improves while DRC or readback regresses, the move still fails.

## Layout Optimization Loop

Use this loop after Stage 1 import verification and throughout manual placement refinement:

1. Capture a baseline:

```
get_layout_fitness_score: {}
```

2. Align edge-facing connectors first. For connectors with designators like `J1`, `J2`, and other board-entry parts, prefer the explicit edge tool over freehand moves:

```
align_to_board_edge: {
  componentId: "<connectorPrimitiveId>",
  edge: "NORTH",
  clearance: 1.5
}
```

3. Read back the component location and rerun the score:

```
get_pcb_primitive: { primitiveId: "<connectorPrimitiveId>" }
get_layout_fitness_score: {}
```

4. Revert the move immediately if any of these happen:
   - `totalScore` decreases.
   - `constraints.drcErrors` increases above the pre-move baseline.
   - `constraints.hasCollisions` becomes `true`.
   - `constraints.isMatingSideClear` becomes `false`.

5. Only then continue to the next local placement cluster.

Use this loop on one connector or one functional cluster at a time. Do not sweep the whole board with many speculative moves before rescoring.

---

## Validation Step Before Every Step

Treat this as a recurring prerequisite for the entire layout flow below, not as a one-time milestone.

1. Run the current PCB DRC check before each numbered step after any prior PCB edit.
2. Read the current DRC results and resolve all reported issues before continuing to the next numbered step.
3. Re-run PCB DRC after each repair until the board is clean or an item is proven to be a host-side false positive and documented.
4. Only then continue with the next numbered step in this skill.

Validation rule:
- Before Step 2, Step 3, Step 4, and every later step, there must be no unresolved PCB DRC issues carried forward from earlier work.

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
3. Repair only that slice first: move the conflicting component slightly, widen spacing, or fix the outline primitive.
4. Read back the mutated PCB state and verify the targeted primitive or net actually changed.
5. Re-run PCB DRC immediately.
6. If the same category persists, keep iterating on that same local defect instead of moving new components elsewhere.

Escalation rules:
- If a placement or outline write returns success but readback state is unchanged, treat it as a host no-op defect and recover before making more edits.
- If the current placement has accumulated many overlapping local failures, prefer resetting that local cluster to a clean arrangement over stacking more small nudges on bad geometry.

---

## Workflow Stages

| Stage | Steps | Gate condition |
|-------|-------|----------------|
| **1 · Import verified** | 1 | Component count, intended footprints, and all nets match schematic |
| **2 · Layout planned** | 2 | Zones, orientations, and routing channels documented before moving any component |
| **3 · Placed** | 3 | Functional zones remain intentional; components fit the planned routing corridors |
| **4 · Outline defined** | 4 | All `BoardOutLine` lines have `net: ""`; all parts remain inside the outline |
| **5 · Layout committed** | 5 | `saved: true`; `sourceHash` changed; placement state is ready for routing |

Do not advance a stage until its gate passes.

---

## Step 1 — Verify Active PCB and Import State

Confirm the correct PCB is active:

```
get_current_context: {}
```

Then confirm imported components and nets exist:

```
list_pcb_primitive_ids: { family: "component" }
list_pcb_nets: {}
```

Spot-check imported connectors, power parts, modules, and unusual packages:

```
get_pcb_primitive: { primitiveId: "<id>" }
```

If component count, footprint choice, or expected nets are wrong, return to the schematic/import flow before doing any layout work.

> **Gate — Stage 1 (Import verified):**
> - [ ] `get_current_context` confirms the active document is the target PCB
> - [ ] `list_pcb_primitive_ids { family: "component" }` count matches the schematic component count
> - [ ] `list_pcb_nets` contains every expected net (power, ground, all signal nets)
> - [ ] `get_document_source` on the PCB is non-empty
> - [ ] A spot-check with `get_pcb_primitive` confirms imported connectors, power parts, modules, and unusual packages use the intended footprints

---

## Step 2 — Plan the Layout

Before placing any component, define:

1. **Board dimensions and mounting constraints** — choose the outline first. Match the enclosure, mounting pattern, connector cutouts, or panel boundary.
2. **Functional zones** — group related components:
   - AC mains / high-voltage in an isolated zone with a safety clearance boundary.
   - Power supply circuitry near the input.
   - MCU or controller in a central logic zone.
   - Signal connectors and headers aligned with board edges.
   - Sensors, transceivers, and support circuitry near their connectors or host IC pins.
3. **Connector orientation** — connectors should face outward toward the board edge in the direction they will be plugged in.
4. **Keep-out regions** — leave clearance around high-voltage components, mounting holes, and board edges.
5. **Routing channels** — identify the critical nets and reserve direct channels before placing secondary parts.
6. **Current loops and return paths** — mark the high-di/dt loops and quiet reference areas that must not be cut apart by later routing.
7. **Layer strategy** — decide the dominant routing direction per layer and which areas should preserve the broadest ground reference.

If the plan cannot explain how power reaches loads directly, how quiet nets avoid noisy zones, and how the board will preserve continuous return paths, placement is not ready yet.

> **Gate — Stage 2 (Layout planned):**
> - [ ] Functional zones are explicit enough to drive placement without guesswork
> - [ ] Connector edge orientation and user/service access direction are defined
> - [ ] Critical loops, noisy areas, and quiet reference areas are identified before placement
> - [ ] The layer strategy and routing corridors are clear enough to judge routing readiness later

---

## Step 3 — Run Auto Layout, Then Refine Placement

Concrete first action for this step: run EasyEDA auto layout in the host UI. Do not begin by manually moving components.

Recommended sequence:

1. Trigger EasyEDA auto layout in the host UI to generate the initial footprint spread.
2. Read back the resulting component positions and inspect the result against the functional zoning and connector-orientation plan from Step 2.
3. Capture a placement baseline with `get_layout_fitness_score` before the first manual move.
4. Use `align_to_board_edge` on connector primitives first, then use `modify_pcb_component` to move every remaining critical part into an intentional final location.
5. After each connector move or local cluster move, run `get_layout_fitness_score` again and revert immediately if the score worsens or any hard constraint regresses.
6. Do not accept the auto-layout output unchanged unless it already satisfies all placement gates.

List all component primitive IDs from the import:

```
list_pcb_primitive_ids: { family: "component" }
```

For each component, read its current position and footprint:

```
get_pcb_primitive: { primitiveId: "<id>" }
```

Move components into their planned positions:

```
modify_pcb_component: {
  primitiveId: "<primitiveId>",
  x: 1200,
  y: -800,
  rotation: 0
}
```

For edge-facing connectors, prefer the dedicated edge-alignment tool before freehand refinement:

```
align_to_board_edge: {
  componentId: "<primitiveId>",
  edge: "WEST",
  clearance: 1.5
}
```

Verify each move:

```
get_pcb_primitive: { primitiveId: "<primitiveId>" }
get_layout_fitness_score: {}
```

Placement rules:
- Treat the auto-layout result as a draft, not as a finished layout.
- Rotate connectors so their entry side faces the board edge.
- Use `align_to_board_edge` for connectors before tuning the surrounding passives and support parts.
- Place decoupling capacitors within 1–2 mm of their target IC power pin.
- Maintain at least 0.3 mm clearance from pad edges to the board outline.
- Place large components first; fill smaller parts around them.
- Keep power-entry, regulator, switch-node, and other high-current parts near each other so those loops remain compact and local.
- Keep crystals, feedback dividers, shunts, and analog references adjacent to the pins they support.
- Use consistent orientation for polarized parts and visible pin-1 markers where practical.
- If critical nets already require obvious crossovers or long detours, stop and re-place components instead of routing around the problem.
- If the score improves but `isMatingSideClear` flips false for an edge connector, reject the move anyway. Connector usability beats local congestion wins.

Before advancing, do a routing-readiness pass: the board should have a clear functional flow, clean corridors for power and critical signals, and a plausible continuous return path. If not, revise placement now.

> **Gate — Stage 3 (Placed):**
> - [ ] EasyEDA auto layout was run first and the resulting spread was reviewed before manual moves
> - [ ] Connectors, switches, and mounting features align with the intended board edges and access direction
> - [ ] Power/high-current/noisy sections remain separated from sensitive analog, sensing, or timing sections
> - [ ] Decouplers, crystals, feedback parts, and other loop-critical support parts sit adjacent to the pins they serve
> - [ ] Placement leaves a clean routing corridor per layer for the critical nets from Step 2
> - [ ] The routing-readiness pass says critical nets can be routed without crossing the wrong functional zone

---

## Step 4 — Draw the Board Outline

The outline **must** be on `BoardOutLine` layer with `net: ""` (empty string). A non-empty net causes Gerber export to reject the outline even when DRC passes.

```
add_pcb_line: {
  layer: "BoardOutLine",
  startX: 0,   startY: 0,
  endX: 4000,  endY: 0,
  net: ""
}
```

Add all sides needed to close the outline. After placing them:

```
list_pcb_primitive_ids: { family: "line", layer: "BoardOutLine" }
```

Confirm the expected outline primitives appear. Call `get_document_source` and verify each has `net: ""`.

Outline best practices:
- Define the outline early. It sets the placement boundary and connector alignment reference.
- Add mounting holes at this stage if required.
- Keep components inside the outline with the intended edge clearance.
- Round or chamfer corners if the enclosure or panel requires it.

> **Gate — Stage 4 (Outline defined):**
> - [ ] `list_pcb_primitive_ids { family: "line", layer: "BoardOutLine" }` returns the expected outline lines
> - [ ] `get_document_source` shows every `BoardOutLine` primitive with `net: ""`
> - [ ] All components are inside the outline (verify with `get_pcb_primitives_bbox` when needed)
> - [ ] Outline geometry matches the connector, mounting, and enclosure assumptions from Step 2

---

## Step 5 — Save and Verify Layout Readiness

```
save_active_document: {}
```

Confirm `saved: true`. Then run the layout readback:

```
get_document_source: {}
list_pcb_primitive_ids: { family: "component" }
list_pcb_primitive_ids: { family: "line", layer: "BoardOutLine" }
```

Confirm the source is non-empty and the `sourceHash` changed from before the save.

If the board still relies on long detours, fractured return paths, or ambiguous connector access just to make routing plausible, the layout is not finished. Rework placement or outline before handing off to routing.

> **Gate — Stage 5 (Layout committed):**
> - [ ] `save_active_document` returned `saved: true`
> - [ ] `get_document_source` → `sourceHash` differs from the pre-save value
> - [ ] Component count is unchanged (no accidental deletions)
> - [ ] Outline primitives are still present and valid on `BoardOutLine`
> - [ ] The board is routing-ready rather than merely placeable

---

## Handoff

After Step 5 passes, continue with the [create-pcb-from-schematic skill](../create-pcb-from-schematic/SKILL.md) at Step 6 (Plan the Routing).