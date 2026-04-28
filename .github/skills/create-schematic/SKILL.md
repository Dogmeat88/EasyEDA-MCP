---
name: create-schematic
description: "Create a schematic in EasyEDA via the EasyEDA MCP server. Use when placing schematic components, wiring nets, connecting pins, setting designators, or completing a schematic ready for PCB import. Covers library search, component placement, pin wiring, net naming, wire-stub fallback, and save+verify workflow. Use alongside the easyeda-mcp-workflow instructions when the full board-to-Gerber flow is the goal."
argument-hint: "Describe the circuit to capture in the schematic"
user-invocable: true
---

# Create an EasyEDA Schematic via MCP

## When to Use

- Placing components on a new or existing EasyEDA schematic page.
- Wiring pins to named nets (power, signal, ground).
- Completing a schematic that will be imported into a PCB.
- Diagnosing incomplete wiring or ratline issues before PCB import.

---

## Operating Principles

- Follow the shared EasyEDA execution defaults in [../../copilot-instructions.md](../../copilot-instructions.md).
- This skill focuses on schematic planning, placement, wiring, property assignment, and save verification before PCB import.
- If `add_schematic_net_label` is unsupported at runtime, fall back to `connect_schematic_pins_to_nets` which handles wire-stubs automatically. Do not treat capability gaps as blockers.
- Before starting any numbered workflow step after the first stateful edit, run the relevant schematic DRC/ERC check and resolve every current issue before proceeding. Do not stack new edits on top of unresolved validation failures.

---

## Validation Step Before Every Step

Treat this as a recurring prerequisite for the full workflow below, not as a one-time check.

1. Run the current schematic validation flow in the EasyEDA UI or host runtime.
2. Read the reported issue list and resolve all current DRC/ERC problems before continuing to the next numbered step.
3. Re-run the validation after each repair until the issue list is clear or an item is proven to be a host-side false positive and documented.
4. Only then continue with the next numbered step in this skill.

Validation rule:
- Before Step 2, Step 3, Step 4, and every later step, there must be no unresolved schematic validation issues carried forward from earlier work.

## Schematic DRC/ERC Check

Use an explicit validation pass, not a vague "looks wired" judgment.

Preferred order:
1. Trigger the EasyEDA schematic DRC/ERC flow in the UI for the active schematic page.
2. If the UI tree is not visible, read the hidden result nodes or equivalent host-visible summary before deciding the page is clean.
3. Record the current totals for `All`, `Fatal Error`, `Error`, `Warn`, and any named categories before making the next edit.

Minimum acceptance for continuing:
- `Fatal Error(0)`
- `Error(0)`
- `Warn(0)` unless the warning is a verified host-side false positive and explicitly documented in the chat or repo notes for that run

Treat these as common schematic blockers until proven otherwise:
- Unconnected required pins
- Missing power or ground references
- Duplicate or conflicting net naming
- Pins that should be marked no-connect but are left floating
- Net-label or wire-stub omissions that leave the PCB import underconstrained

## Schematic Correction Loop

When validation fails, use this repair loop before resuming the workflow:

1. Capture the exact failing category and affected net, pin, or component.
2. Fix only the smallest local cause: add the missing connection, rename the conflicting net, mark an intentional NC pin, or repair the misplaced symbol choice.
3. Read back the schematic with `get_document_source`, `list_schematic_primitive_ids`, or `list_schematic_component_pins` to verify the intended mutation actually landed.
4. Re-run schematic DRC/ERC immediately.
5. If the same issue remains, do not continue wiring elsewhere. Stay on the same slice until the count drops or the host result is proven false.

Escalation rule:
- If a "successful" schematic write leaves the source unchanged, treat it as a bridge or host no-op defect and repair the session before continuing.

---

## Workflow Stages

| Stage | Steps | Gate condition |
|-------|-------|----------------|
| **1 · Bridge ready** | 1 | `bridge_status: connected:true`; active doc is `SCHEMATIC_PAGE` |
| **2 · Plan complete** | 2 | Full `pinNumber → net` map documented; board-edge intent and critical clusters noted |
| **3 · Components placed** | 3–4 | Inventory count matches plan; every `primitiveId` recorded |
| **4 · Nets wired** | 5–6 | Source contains wire/stub primitive for every connected pin |
| **5 · Properties set** | 7 | Every component has a non-empty designator |
| **6 · Schematic committed** | 8–9 | `saved: true`; `sourceHash` changed; routing-critical nets are obvious for PCB |

Do not advance a stage until its gate passes.

---

## Step 1 — Verify Bridge and Document

```
bridge_status → connected: true
get_current_context → confirm active document is a schematic page (not Start Page)
```

If the active document is a Start Page or another document type, open the target schematic:

```
open_document: { documentUuid: "<schematicPageUuid>" }
get_current_context → confirm documentType is SCHEMATIC_PAGE
```

If no schematic exists yet, create one following [the EasyEDA MCP workflow instructions](../../instructions/easyeda-mcp-workflow.instructions.md) Steps 1–2.

> **Gate — Stage 1 (Bridge ready):**
> - [ ] `bridge_status` → `connected: true`
> - [ ] `get_current_context` → `documentType: SCHEMATIC_PAGE` (not Start Page or PCB)

---

## Step 2 — Plan Components and Net Names

Before searching the library, list all components and their nets. Good net names make the PCB stage inspectable and reduce routing errors.

Naming conventions:
- Power: `+3V3`, `+5V`, `+12V`, `VCC`
- Ground: `GND`, `AGND`, `DGND`
- Signals: descriptive short names in UPPER_SNAKE — `ONE_WIRE`, `ZC`, `PSM`, `TX1`, `SCL`
- AC mains: `AC_L_IN`, `AC_L_SWITCH`, `AC_N`, `AC_MOTOR_L`

Document the pin → net mapping for every component before starting placement.

Also record the PCB-facing intent that the layout step will need: which connectors belong on which board edge, which nets are high-current or high-voltage, and which components form placement-critical clusters such as decoupler + IC pin, crystal + MCU pins, feedback divider + regulator, or sense resistor + amplifier.

Only split grounds (`AGND`, `DGND`, `PGND`) when the PCB strategy truly requires it. Avoid inventing separate ground names that the PCB stage cannot reconnect cleanly.

---

## Step 3 — Search the Library

Search for each component before placing it. Use `query` for keyword search or `lcscIds` for exact LCSC part number lookup:

```
search_library_devices: { query: "DS18B20" }
search_library_devices: { query: "HLK-5M05" }
search_library_devices: { lcscIds: ["C2040"] }
search_library_devices: { query: "0805 4.7k resistor" }
```

From each result's `devices` array, record for each candidate:
- `libraryUuid` — library container identifier, required for placement
- `uuid` — device identifier within the library, passed as `deviceUuid` for placement
- `title` and `description` — verify it is the right component
- Footprint information — confirm package matches your BOM

If the best match is ambiguous, search again with a more specific keyword, a full part number, or an exact `lcscIds` query before placing.

---

## Step 4 — Place Components

Place each component at a non-overlapping coordinate. Use a grid of ~200 mil between component centroids for readability.

**Tool operates on the active document** — no `documentUuid` param. Confirm the schematic page is active with `get_current_context` before placing.

```
add_schematic_component: {
  libraryUuid: "<libraryUuid from search>",
  deviceUuid: "<uuid from search result>",
  x: 200,
  y: 200,
  rotation: 0,        # optional, degrees
  addIntoBom: true,   # optional, default true
  addIntoPcb: true    # optional, default true
}
```

After each placement, verify the count increased:

```
list_schematic_primitive_ids: { family: "component" }
```

Do not move on until the component appears in the inventory. If placement silently fails (count unchanged), retry with the same `libraryUuid`/`deviceUuid` at a slightly different coordinate — EasyEDA occasionally drops placements that land exactly on an existing primitive.

**Placement strategy:**
- Arrange components so signal flows left-to-right or top-to-bottom.
- Place power supply components (AC/DC converters, regulators) on the left or top.
- Place the MCU centrally.
- Place connectors and sensors near the edges matching their board-edge intent.
- Leave gaps between functional groups for readability.
- Space components so wire runs are short and do not cross unnecessarily.

> **Gate — Stage 3 (Components placed):**
> - [ ] `list_schematic_primitive_ids { family: "component" }` count equals the total planned in Step 2
> - [ ] Every component's `primitiveId` is recorded for use in Steps 5–6

---

## Step 5 — Retrieve Pin Numbers

Before wiring, retrieve pin information for each component using its `primitiveId` (returned by `list_schematic_primitive_ids` or the placement response):

```
list_schematic_component_pins: { componentPrimitiveId: "<primitiveId>" }
```

The response returns an array of pins. Each pin has:
- `pinNumber` — a string such as `"1"`, `"2"`, `"GND"`, `"VCC"`, `"DQ"` — this is what you pass to the wiring tools
- `x`, `y` — schematic coordinates of the pin endpoint

Build a map of `pinNumber → net` from your net plan in Step 2 and the component datasheet. Do not assume pin numbers are always integers — EasyEDA uses the datasheet's pin designator string verbatim.

For components with many pins (MCUs, connectors), retrieve all pins at once and map carefully — wrong pin assignments cause silent net errors that only surface at PCB import.

---

## Step 6 — Connect Pins to Nets

All three wiring tools operate on the active document (no `documentUuid` param) and target a single component per call identified by `componentPrimitiveId`.

**Single pin:**
```
connect_schematic_pin_to_net: {
  componentPrimitiveId: "<primitiveId>",
  pinNumber: "1",
  net: "GND"
}
```

**Multiple explicit pins in one call (preferred for most components):**
```
connect_schematic_pins_to_nets: {
  componentPrimitiveId: "<primitiveId>",
  connections: [
    { pinNumber: "1", net: "GND" },
    { pinNumber: "2", net: "+3V3" },
    { pinNumber: "3", net: "ONE_WIRE" }
  ]
}
```

**Prefix-derived bulk wiring (bus/GPIO banks):**
```
connect_schematic_pins_with_prefix: {
  componentPrimitiveId: "<primitiveId>",
  pinNumbers: ["0", "1", "2", "3"],
  netPrefix: "GPIO",
  separator: "_"       # optional, defaults to no separator → GPIO0, GPIO1 …
}
```

After connecting, call `get_document_source` and confirm new wire or net primitives appear for the expected nets.

**Power and ground flags:**

For visibility, place explicit power/ground flags at power pins using:
```
add_schematic_net_flag: {
  identification: "Power",    # or "Ground", "AnalogGround", "ProtectGround"
  net: "+3V3",
  x: 200,
  y: 200
}
```

**No-connect pins:**

Mark intentionally unconnected pins to suppress ERC warnings:
```
set_schematic_pin_no_connect: {
  componentPrimitiveId: "<primitiveId>",
  pinNumber: "NC",
  noConnected: true
}
```

**Wiring priorities:**
1. Power and ground first — the most error-prone if missed.
2. Primary signals the board depends on (clocks, data buses, control lines).
3. Secondary signals and optional pins last.

**Net-label availability:**
- At runtime, call `get_capabilities` to check if `add_schematic_net_label` is listed in `supportedMethods`.
- If available, you may also use it for explicit visible label placement on long wires: `add_schematic_net_label: { x, y, net }`.
- If unavailable, all three `connect_schematic_*` tools fall back to short wire stubs automatically — this is transparent and electrically equivalent. Do not treat the capability gap as a blocker.

> **Gate — Stage 4 (Nets wired):**
> - [ ] `get_document_source` contains a wire or net-stub primitive for every pin connected in this step
> - [ ] All power and ground pins are connected (check first — most common omission)
> - [ ] Every net from the Step 2 plan appears in the document source at least once

---

## Step 7 — Set Designators and Properties

After all components are placed and wired, set designators if not automatically assigned. Use `primitiveId` (the same ID used for wiring):

```
modify_schematic_component: {
  primitiveId: "<primitiveId>",
  designator: "U1",
  name: "DS18B20",             # optional — visible component value
  manufacturer: "Maxim",       # optional BOM fields
  manufacturerId: "DS18B20+"   # optional BOM fields
}
```

Standard designator prefixes:
- `U` — ICs, modules
- `R` — resistors
- `C` — capacitors
- `L` — inductors
- `J` — connectors, headers
- `F` — fuses
- `RV` — varistors, potentiometers
- `D` — diodes, LEDs
- `Q` — transistors, MOSFETs

Verify by calling `get_schematic_primitive` on each component and checking the `designator` field.

---

## Step 8 — Verify Completeness

Before saving, confirm every pin that requires a net is connected:

1. Call `get_document_source` and scan for any pin stubs that have no wire or net-label primitive attached.
2. Call `list_schematic_primitive_ids` and account for every component placed in Step 4.
3. For each critical net (power, ground, primary signals), grep the source to confirm at least two primitives reference it — one for each side of the connection.

If any expected nets are absent, return to Step 6 and complete the missing connections before saving.

> **Gate — Stage 5 (Ready to save):**
> - [ ] `list_schematic_primitive_ids { family: "component" }` count still matches the placement count from Step 4
> - [ ] `get_document_source` references every expected net at least twice (once per connected endpoint)
> - [ ] No required pin is without a wire-stub or net-label primitive
> - [ ] High-current, high-voltage, timing-critical, and sensitive analog nets are named explicitly enough for the PCB stage to zone and prioritize them without guesswork

---

## Step 9 — Save

```
save_active_document: {}
```

Confirm `saved: true` in the response. If a modal or confirmation dialog blocks the save, use Chrome DevTools MCP only to dismiss it, then rerun the save.

After saving, call `get_document_source` one final time and verify the `sourceHash` changed from the pre-save value, confirming the server received the mutation.

> **Gate — Stage 6 (Schematic committed):**
> - [ ] `save_active_document` returned `saved: true`
> - [ ] `get_document_source` → `sourceHash` differs from the pre-save value
> - [ ] Component count and net names are intact (quick re-read confirms no rollback)

---

## Step 10 — Handoff to PCB

The schematic is ready for PCB import when:
- All components have designators.
- All signal, power, and ground pins are connected to named nets.
- `save_active_document` confirms `saved: true`.
- `get_document_source` returns a non-empty source with the expected component and net primitives.
- Connector roles and intended board-edge orientation are obvious from the net names and component designators.
- Nets that need special PCB handling — high-current, high-voltage, clocks, feedback, sensitive analog — are explicitly named and easy to identify.
- Placement-critical clusters are obvious from the schematic so the PCB stage can keep their loops tight.

Continue with the [create-pcb-from-schematic skill](../create-pcb-from-schematic/SKILL.md) starting from Step 3 (Create a Board and Linked PCB). After import verification there, switch to the [layout-pcb skill](../layout-pcb/SKILL.md) before returning for routing. For the complete workflow reference including project setup, see the [EasyEDA MCP workflow instructions](../../instructions/easyeda-mcp-workflow.instructions.md) from Step 6 onward.

---

## Common Failure Modes

| Symptom | Likely Cause | Fix |
|---|---|---|
| `list_schematic_primitive_ids` count does not increase after `add_schematic_component` | Placement silently failed or timed out | Record the returned `primitiveId` from placement — if present, the component placed despite the apparent failure. Retry with same `libraryUuid`/`deviceUuid` at a different coordinate otherwise. |
| `connect_schematic_pins_to_nets` succeeds but net absent from source | Wire-stub was created on the wrong active page | Call `get_current_context` to confirm the correct schematic page is active, re-open if needed, then reconnect |
| `search_library_devices` returns empty `devices` | Keyword too vague or no match | Try the LCSC part number with `lcscIds: ["C…"]` instead of `query` |
| `add_schematic_component` rejects the call | `libraryUuid`/`deviceUuid` came from an old search result | Re-search and use the fresh `libraryUuid` + `uuid` pair |
| PCB import shows fewer components than expected | A component was placed but not saved before import | Save schematic with `save_active_document`, re-import |
| PCB import shows ratlines for expected-connected nets | Pin connected to wrong net name (typo), or `pinNumber` string mismatch | Call `list_schematic_component_pins` again and compare exact `pinNumber` strings, fix and re-save |
| PCB placement or routing priorities are unclear after import | Nets were too generic or the board-edge/critical-cluster intent was never documented | Rename nets, add the missing intent in Step 2, then save and re-import before starting PCB placement |
| `get_capabilities` returns no schematic entries | Bridge version mismatch or bridge disconnected | Call `bridge_status`, restart MCP server if needed, reconnect bridge |
| `add_schematic_net_flag` fails or is unsupported | Host SDK version too old | Skip power flags; the `connect_schematic_*` wiring tools are sufficient for PCB netlist |

---

## Wire-Stub Fallback Reference

When `add_schematic_net_label` is unsupported, EasyEDA MCP automatically uses wire stubs. Wire stubs are short wire segments attached to each pin that carry the net name without a visible label. They are electrically equivalent to net labels for netlist import purposes.

No manual fallback needed — `connect_schematic_pin_to_net`, `connect_schematic_pins_to_nets`, and `connect_schematic_pins_with_prefix` all handle this transparently. Confirm stubs appear in `get_document_source` as `WIRE` or equivalent primitives after connection.
