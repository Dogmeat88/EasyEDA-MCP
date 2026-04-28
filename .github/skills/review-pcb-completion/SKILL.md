---
name: review-pcb-completion
description: "Review an EasyEDA PCB against this repo's finished two-layer PCB standard. Use when auditing placement quality, routing quality, DRC status, board outline validity, connector orientation, loop-critical support-part placement, or fabrication and export readiness."
argument-hint: "Describe the board, current workflow state, and any known issues"
user-invocable: true
---

# Review PCB Completion

## When to Use

- Checking whether an in-progress or finished EasyEDA PCB meets the repo's two-layer completion bar.
- Auditing placement intent, routing quality, DRC status, board outline validity, or export readiness.
- Deciding which workflow gate to return to when a board is not finished.

---

## Authoritative References

Load these files as the checklist before forming a verdict:

- [Workspace instructions](../../copilot-instructions.md) — repo-wide execution defaults and PCB completion bar
- [EasyEDA MCP workflow instructions](../../instructions/easyeda-mcp-workflow.instructions.md) — gate definitions and workflow stages for the full project-to-Gerber flow
- [Layout PCB skill](../layout-pcb/SKILL.md) — zoning, placement intent, board outline, and routing-readiness detail
- [Create PCB from schematic skill](../create-pcb-from-schematic/SKILL.md) — import validation, routing priorities, DRC, and export-readiness detail
- [Create schematic skill](../create-schematic/SKILL.md) — schematic capture and pre-PCB validation detail
- [Improve MCP skill](../improve-mcp/SKILL.md) — bridge reliability and live end-to-end validation

---

## Review Procedure

1. Read the authoritative references above.
2. Use EasyEDA MCP to inspect live board state: `get_current_context`, `list_pcb_primitive_ids`, `list_pcb_nets`, `get_pcb_net_primitives`, `get_document_source`.
3. Apply the gate checklist below to each phase.
4. Return the review in the output format below.

---

## Gate Checklist

### Footprint + Import Intent
- [ ] `list_pcb_primitive_ids { family: "component" }` count matches the schematic component count
- [ ] `list_pcb_nets` contains every expected net name (power, ground, all signal nets)
- [ ] Spot-check with `get_pcb_primitive` confirms connectors, power parts, modules, and unusual packages use the intended footprints

### Placement Intent
- [ ] Components are grouped by function and signal flow
- [ ] Connectors, switches, and mounting features align with the intended board edge and access direction
- [ ] Decouplers, crystals, feedback parts, and other loop-critical support parts sit adjacent to the pins they serve
- [ ] Power-entry, regulator, switch-node, and high-current parts form compact clusters away from quiet circuitry
- [ ] Polarized parts and pin-1 markers are oriented consistently

### Board Outline
- [ ] `list_pcb_primitive_ids { family: "line", layer: "BoardOutLine" }` returns the expected outline lines
- [ ] `get_document_source` → every `BoardOutLine` primitive has `net: ""`
- [ ] All components are inside the outline and respect the edge-clearance target

### Routing Quality
- [ ] Every intended net has routing primitives confirmed via `get_pcb_net_primitives`
- [ ] No unresolved ratlines remain
- [ ] Critical nets (power, ground returns, clocks, high-current) are routed first and run short and direct
- [ ] One dominant routing direction per layer is maintained where practical
- [ ] Return paths are not fractured by switching or high-current traces crossing beneath quiet signals
- [ ] No unnecessary detours, repeated layer swaps, or acute-angle bends

### DRC
- [ ] EasyEDA DRC reports `All(0)`, `Fatal Error(0)`, `Error(0)`, `Warn(0)`
- [ ] Any `Warn` item is explicitly identified as a verified host-side false positive and documented

### Export Readiness
- [ ] Gerber export dialog opens without a board-outline warning
- [ ] `list_project_objects` shows a correctly linked board/PCB pair with non-empty `parentBoardName`

---

## Output Format

Return the review in this structure:

1. **Overall verdict**: `ready`, `not ready`, or `blocked by external dependency`
2. **Gate status** for each gate above: `pass`, `fail`, `not reached`, or `blocked by external dependency`
3. **Blocking findings only**, ordered by severity
4. **Exact next validation or repair steps**, using EasyEDA MCP tool names where possible
5. **Earliest workflow gate to return to** if the board is not finished

---

## Rules

- Do not mark a PCB complete just because components exist, traces exist, or DRC passes.
- Require logical functional zoning, intentional connector orientation, loop-critical support-part placement, and sensible two-layer routing.
- Treat long detours, repeated layer swaps, fractured return paths, unresolved ratlines, or outline/export failures as blockers.
- Treat DRC warnings as blockers unless explicitly identified as verified host-side false positives and documented.
