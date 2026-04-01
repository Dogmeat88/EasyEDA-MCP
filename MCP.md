# EasyEDA MCP Scaffold

This repository now includes a minimal MCP server scaffold and a matching EasyEDA extension bridge.

The scaffold now includes three additional pieces beyond the original bridge:

- optimistic revision checks for document-source overwrite
- ready-to-copy client configuration examples
- first-pass higher-level edit tools that do not require replacing the entire document source

It now also includes:

- bridge self-test tools for round-trip health checks
- library device search for component placement flows
- component placement and editing on schematic and PCB documents
- primitive ID and bounding-box query tools for supported primitive families
- PCB net inspection and display-color editing tools
- schematic pin and PCB pad inspection plus intent-level connection helpers
- bulk schematic pin-to-net workflows and waypoint-based PCB routing
- an opt-in live MCP integration test harness for real EasyEDA bridge sessions

## Components

1. `src/mcp-server.ts`

   Runs a local MCP server over stdio and exposes a small set of EasyEDA tools.

2. `src/easyeda-mcp-bridge.ts`

   Runs inside the EasyEDA Pro extension runtime and connects back to the MCP server over WebSocket.

3. `src/mcp-bridge-protocol.ts`

   Shared protocol definitions for the localhost bridge.

The MCP server also exposes a local Streamable HTTP endpoint for attach-style testing at `http://127.0.0.1:19733/mcp` by default.

## Included MCP Tools

- `bridge_status`
- `get_usage_guide`
- `ping_bridge`
- `echo_bridge`
- `search_library_devices`
- `get_capabilities`
- `get_current_context`
- `list_project_objects`
- `open_document`
- `save_active_document`
- `create_board`
- `create_pcb`
- `create_panel`
- `create_schematic`
- `create_schematic_page`
- `copy_board`
- `copy_pcb`
- `copy_panel`
- `copy_schematic`
- `copy_schematic_page`
- `add_schematic_component`
- `modify_schematic_component`
- `delete_schematic_component`
- `add_schematic_net_flag`
- `add_schematic_net_port`
- `add_schematic_short_circuit_flag`
- `list_schematic_component_pins`
- `set_schematic_pin_no_connect`
- `connect_schematic_pin_to_net`
- `connect_schematic_pins_to_nets`
- `connect_schematic_pins_with_prefix`
- `add_schematic_text`
- `add_schematic_net_label`
- `add_schematic_wire`
- `list_schematic_primitive_ids`
- `get_schematic_primitive`
- `get_schematic_primitives_bbox`
- `add_pcb_component`
- `modify_pcb_component`
- `delete_pcb_component`
- `list_pcb_component_pads`
- `route_pcb_line_between_component_pads`
- `route_pcb_lines_between_component_pads`
- `add_pcb_line`
- `add_pcb_text`
- `list_pcb_primitive_ids`
- `get_pcb_primitive`
- `get_pcb_primitives_bbox`
- `list_pcb_nets`
- `get_pcb_net`
- `set_pcb_net_color`
- `get_pcb_net_primitives`
- `modify_schematic_text`
- `delete_schematic_text`
- `modify_schematic_net_label`
- `modify_schematic_wire`
- `delete_schematic_wire`
- `modify_pcb_line`
- `delete_pcb_line`
- `modify_pcb_text`
- `delete_pcb_text`
- `rename_board`
- `rename_pcb`
- `rename_schematic`
- `rename_schematic_page`
- `rename_panel`
- `delete_board`
- `delete_pcb`
- `delete_schematic`
- `delete_schematic_page`
- `delete_panel`
- `get_document_source`
- `set_document_source`
- `compute_source_revision`

## Source Revisions

`get_document_source` now returns:

- `source`
- `sourceHash`
- `characters`

`set_document_source` now expects either:

- `expectedSourceHash`
- or `force: true`

It also accepts:

- `skipConfirmation: true` to suppress the bridge-side overwrite confirmation dialog

Recommended flow:

1. Call `get_document_source`.
2. Produce your edited source.
3. Call `set_document_source` with the returned `sourceHash` as `expectedSourceHash`.
4. If the hash mismatches, re-read the document before retrying.

Example request payload:

```
{
   "source": "...updated source...",
   "expectedSourceHash": "1234:deadbeef",
   "skipConfirmation": true
}
```

If you need to bypass the optimistic check:

```
{
   "source": "...updated source...",
   "force": true,
   "skipConfirmation": true
}
```

## Bridge Self-Test Tools

These tools are intended for bridge verification rather than CAD editing:

- `bridge_status`: inspect current bridge connection state from the MCP server side
- `get_usage_guide`: return a compact operational guide describing recommended tool order, common identifiers, and workflow sequencing
- `ping_bridge`: verify MCP server -> websocket bridge -> EasyEDA extension -> websocket bridge -> MCP server round-trip health
- `echo_bridge`: send a message through the same path and verify the returned payload

`bridge_status` and `get_current_context` also include `recommendedNextSteps` in their structured responses so MCP clients can choose the next tool with less guesswork.

## Higher-Level Edit Tools

These tools avoid whole-document source replacement for common edit cases:

- `add_schematic_text`: add a text primitive to the active schematic page
- `add_schematic_net_label`: add a net label to the active schematic page
- `add_schematic_wire`: add a wire primitive to the active schematic page
- `add_pcb_line`: add a line primitive to the active PCB document
- `add_pcb_text`: add a text primitive to the active PCB document
- `save_active_document`: save the active schematic page, PCB, or panel

Each edit tool accepts `saveAfter: true` if you want the document saved immediately after the primitive is created.

`add_pcb_text` requires a `fontFamily` that already exists in the EasyEDA Pro environment.

The same primitive families now also support targeted modification and, where the host SDK allows it, deletion.

Delete tools also accept `skipConfirmation: true` to suppress the bridge-side confirmation prompt before the delete request is sent to EasyEDA.

## Document Lifecycle Tools

The bridge now covers the main project object lifecycle:

- `create_board`: create a board, optionally linking an existing schematic UUID and PCB UUID
- `create_pcb`: create a PCB, optionally under a named board
- `create_panel`: create a panel document
- `create_schematic`: create a schematic, optionally under a named board
- `create_schematic_page`: add a new page to an existing schematic
- `copy_board`: duplicate a board by board name
- `copy_pcb`: duplicate a PCB, optionally placing the copy under a named board
- `copy_panel`: duplicate a panel by UUID
- `copy_schematic`: duplicate a schematic, optionally placing the copy under a named board
- `copy_schematic_page`: duplicate a schematic page, optionally into another schematic

Recommended duplication flow:

1. Call `list_project_objects` to find the source board, PCB, schematic, page, or panel.
2. Call the matching `copy_*` tool with the source identifier.
3. If needed, follow with the existing rename tools to assign final names.

## Component Placement And Query Tools

The bridge now supports a fuller component and inspection workflow:

- `search_library_devices`: search the EasyEDA library by keyword or LCSC part number(s)
- `add_schematic_component`: place a searched library device onto the active schematic page
- `add_pcb_component`: place a searched library device onto the active PCB document
- `modify_schematic_component` and `modify_pcb_component`: adjust placed component properties such as coordinates, rotation, designator, and metadata
- `delete_schematic_component` and `delete_pcb_component`: remove placed components with native EasyEDA confirmation dialogs
- `delete_*` tools: accept `skipConfirmation: true` to suppress the bridge-side delete prompt
- `add_schematic_net_flag` and `add_schematic_net_port`: place common net-aware schematic marker components without editing whole source text
- `add_schematic_short_circuit_flag`: place the EasyEDA short-circuit marker component without editing whole source text
- `list_schematic_component_pins`: inspect resolved symbol pins, including coordinates and pin numbers
- `set_schematic_pin_no_connect`: toggle a pin's explicit no-connect marker
- `connect_schematic_pin_to_net`: attach a net label at a chosen component pin location
- `connect_schematic_pins_to_nets`: attach multiple explicit pin-to-net mappings in one request
- `connect_schematic_pins_with_prefix`: derive net names like `BUS_1`, `BUS_2`, and so on from a prefix and pin numbers
- `list_schematic_primitive_ids` and `list_pcb_primitive_ids`: enumerate supported primitive IDs by family
- `get_schematic_primitive` and `get_pcb_primitive`: read the full primitive payload for a specific ID
- `get_schematic_primitives_bbox` and `get_pcb_primitives_bbox`: compute combined BBoxes for selected primitive IDs
- `list_pcb_component_pads`: inspect resolved footprint pads, including coordinates, pad numbers, and current nets
- `route_pcb_line_between_component_pads`: create a direct PCB line segment between two component pads while deriving the net when possible
- `route_pcb_lines_between_component_pads`: create multiple PCB line segments between two component pads using caller-supplied waypoints

Recommended component-placement flow:

1. Call `search_library_devices` with `query` or `lcscIds`.
2. Take a returned `libraryUuid` and `uuid`.
3. Call `add_schematic_component` or `add_pcb_component` with those identifiers and target coordinates.

Recommended pin-to-net flow:

1. Call `list_schematic_component_pins` for a placed component.
2. Select the desired `pinNumber`.
3. Call `connect_schematic_pin_to_net` with the component primitive ID, pin number, and target net name.

Recommended bus or grouped-net flow:

1. Call `list_schematic_component_pins` for a placed component.
2. Choose the pins that should be attached to a shared prefix-based naming scheme.
3. Call `connect_schematic_pins_with_prefix` with `netPrefix` and optional `separator` or `pinOffset`.

Recommended explicit bulk-net flow:

1. Call `list_schematic_component_pins` for a placed component.
2. Build a `connections` array of `{ "pinNumber": ..., "net": ... }` objects.
3. Call `connect_schematic_pins_to_nets` to place all requested net labels in one request.

Recommended pad-to-pad route flow:

1. Call `list_pcb_component_pads` for each placed PCB component.
2. Choose the source and destination `padNumber` values.
3. Call `route_pcb_line_between_component_pads` with both component primitive IDs, pad numbers, and a PCB line layer.

Recommended waypoint route flow:

1. Call `list_pcb_component_pads` for each placed PCB component.
2. Choose one or more intermediate `{ "x": ..., "y": ... }` waypoints.
3. Call `route_pcb_lines_between_component_pads` to emit a multi-segment line path between the resolved pad centers.

## PCB Net Tools

The PCB tool surface now includes:

- `list_pcb_nets`: full net inventory for the active PCB
- `get_pcb_net`: detail, routed length, and current display color for a net
- `set_pcb_net_color`: update a net's display color using `{ "r": ..., "g": ..., "b": ..., "alpha": ... }` or `null`
- `get_pcb_net_primitives`: fetch primitives associated with a net, optionally filtered by numeric PCB primitive type IDs

SDK limitation: schematic net labels are implemented as attribute primitives, and the EasyEDA Pro API does not expose attribute deletion. The bridge therefore supports `modify_schematic_net_label` but not delete for that primitive type.

Host compatibility limitation: some EasyEDA builds do not expose the `sch_PrimitiveAttribute` runtime API even though it exists in the published type definitions. On those builds, `add_schematic_net_label`, `connect_schematic_pin_to_net`, `connect_schematic_pins_to_nets`, `connect_schematic_pins_with_prefix`, and `modify_schematic_net_label` will return a compatibility error instead of creating or editing net labels.

Routing limitation: the current SDK surface exposed here supports creating PCB line segments and inspecting connected pads, but it does not expose a true interactive autorouter API for arbitrary multi-segment pathfinding from the extension bridge. `route_pcb_line_between_component_pads` therefore creates a direct segment between the resolved pad centers, while `route_pcb_lines_between_component_pads` follows caller-supplied waypoints rather than performing automatic obstacle-aware routing.

## Usage

1. Build and install the EasyEDA extension package.

   ```bash
   npm run build
   ```

2. Start the MCP server locally.

   ```bash
   npm run mcp:server
   ```

   If the local MCP server is already running, starting it again will stop the older instance and replace it with the new one.

   This starts both:

   - the stdio MCP transport used by normal MCP hosts
   - a local Streamable HTTP MCP endpoint at `http://127.0.0.1:19733/mcp` for attach-style testing

   For local regression coverage while developing the bridge:

   ```bash
   npm test
   ```

   For an opt-in live MCP smoke test against a real EasyEDA bridge session:

   ```bash
   EASYEDA_MCP_LIVE_TEST=1 npm run test:live
   ```

   To fail if EasyEDA is not actually connected to the bridge:

   ```bash
   EASYEDA_MCP_LIVE_TEST=1 EASYEDA_MCP_LIVE_REQUIRE_CONNECTED=1 npm run test:live
   ```

   To attach the live test to an already-running MCP server instead of spawning a second server:

   ```bash
   EASYEDA_MCP_LIVE_TEST=1 EASYEDA_MCP_LIVE_ATTACH_EXISTING=1 EASYEDA_MCP_LIVE_REQUIRE_CONNECTED=1 npm run test:live
   ```

   To override the attach URL for that mode:

   ```bash
   EASYEDA_MCP_LIVE_TEST=1 EASYEDA_MCP_LIVE_ATTACH_EXISTING=1 EASYEDA_MCP_LIVE_SERVER_URL=http://127.0.0.1:19733/mcp npm run test:live
   ```

3. In EasyEDA Pro, ensure the extension has permission for external interaction.

4. Open the extension menu and use `Reconnect` if EasyEDA needs to reattach to the local bridge.

5. Inspect `Status` to confirm that the bridge is connected.

## Client Config Examples

Ready-to-adapt example files are included in [examples/mcp/claude_desktop_config.json](/home/i/repos/EasyEDA-MCP/examples/mcp/claude_desktop_config.json) and [examples/mcp/vscode.mcp.json](/home/i/repos/EasyEDA-MCP/examples/mcp/vscode.mcp.json).

Data structure notes:

- `easyeda-mcp` is just the server name key. You can rename it, but the same name should be used consistently within that config object.
- Claude Desktop expects a top-level `mcpServers` object.
- VS Code expects a top-level `servers` object.
- The value under `easyeda-mcp` is the actual server definition.
- `command` is the executable to run.
- `args` is the argument array passed to that executable.
- `cwd` is the working directory where the command should run.
- VS Code also requires `"type": "stdio"` for this server.

### Claude Desktop

Structure:

```
{
   "mcpServers": {
      "<server-name>": {
         "command": "<executable>",
         "args": ["<arg1>", "<arg2>"],
         "cwd": "/absolute/path/to/project"
      }
   }
}
```

Example structure:

```
{
   "mcpServers": {
      "easyeda-mcp": {
         "command": "npm",
         "args": ["run", "mcp:server"],
         "cwd": "/home/i/repos/EasyEDA-MCP"
      }
   }
}
```

### VS Code

Structure:

```
{
   "servers": {
      "<server-name>": {
         "type": "stdio",
         "command": "<executable>",
         "args": ["<arg1>", "<arg2>"],
         "cwd": "/absolute/path/to/project"
      }
   }
}
```

Workspace or user `mcp.json` example:

```
{
   "servers": {
      "easyeda-mcp": {
         "type": "stdio",
         "command": "npm",
         "args": ["run", "mcp:server"],
         "cwd": "/home/i/repos/EasyEDA-MCP"
      }
   }
}
```

## Default Bridge Endpoint

`ws://127.0.0.1:19732/easyeda-mcp`

## Environment Variables

- `EASYEDA_MCP_BRIDGE_HOST`
- `EASYEDA_MCP_BRIDGE_PORT`
- `EASYEDA_MCP_BRIDGE_PATH`
- `EASYEDA_MCP_BRIDGE_TIMEOUT_MS` base bridge timeout in milliseconds, default `30000`
- `EASYEDA_MCP_GET_DOCUMENT_SOURCE_TIMEOUT_MS` optional per-method override for `get_document_source`
- `EASYEDA_MCP_SET_DOCUMENT_SOURCE_TIMEOUT_MS` optional per-method override for `set_document_source`
- `EASYEDA_MCP_HTTP_ENABLED`
- `EASYEDA_MCP_HTTP_HOST`
- `EASYEDA_MCP_HTTP_PORT`
- `EASYEDA_MCP_HTTP_PATH`
- `EASYEDA_MCP_LIVE_ATTACH_EXISTING`
- `EASYEDA_MCP_LIVE_SERVER_URL`

Slow bridge operations such as `get_document_source`, `set_document_source`, and primitive BBox queries use higher internal per-method timeout floors so large EasyEDA documents are less likely to fail spuriously. The current server defaults are `60000` for `get_document_source` and `120000` for `set_document_source`.

If your EasyEDA build is still slow on large source writes, set `EASYEDA_MCP_SET_DOCUMENT_SOURCE_TIMEOUT_MS` explicitly when starting the server.

Bridge requests are also serialized server-side so the EasyEDA runtime only handles one in-flight MCP operation at a time. This reduces instability from overlapping long-running bridge calls.

## Notes

- The extension side depends on EasyEDA Pro's external interaction permission for WebSocket access.
- This scaffold intentionally starts with a small, explicit tool set rather than exposing arbitrary `eda.*` execution.
- `ping_bridge` and `echo_bridge` are minimal round-trip bridge diagnostics and are useful for proving the MCP call path independently of document edits.
- Destructive tools are explicit MCP calls, and the EasyEDA extension shows a bridge-side confirmation dialog before delete or overwrite operations unless `skipConfirmation: true` is provided on the supported delete and source-overwrite tools.
- The VS Code client configuration format follows the documented `mcp.json` `servers` structure for local stdio servers, and the Claude example follows the documented `claude_desktop_config.json` `mcpServers` structure.
- The included tests cover tool registration, local schema validation for optimistic source writes, and revision-hash stability without requiring a live EasyEDA instance.
- The included tests also cover bridge-session timeout handling, disconnect rejection, and out-of-order response correlation without requiring a live EasyEDA instance.
- The live integration test is intentionally opt-in so normal local development and CI do not depend on an interactive EasyEDA Pro session being open and bridge-connected.
