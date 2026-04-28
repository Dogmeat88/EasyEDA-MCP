# Project Guidelines

## Canonical Agent Files

- `.github/copilot-instructions.md` holds the repo-wide defaults that apply to every EasyEDA customization task.
- `.github/instructions/easyeda-mcp-workflow.instructions.md` is the canonical end-to-end EasyEDA MCP workflow (project → schematic → PCB → Gerber).
- `.github/skills/create-schematic/SKILL.md` covers schematic capture and pre-PCB validation.
- `.github/skills/layout-pcb/SKILL.md` covers PCB layout planning, placement, outline creation, and routing-readiness validation.
- `.github/skills/create-pcb-from-schematic/SKILL.md` covers PCB import validation, routing, DRC, and export readiness.
- `.github/skills/improve-mcp/SKILL.md` covers autonomous MCP repair and live end-to-end validation.
- `.github/skills/review-pcb-completion/SKILL.md` is the PCB completion review skill — use it to audit any in-progress or finished board against the completion bar.
- Keep `.github/` as the single source of truth for these customizations.

## EasyEDA Execution Defaults

- Use EasyEDA MCP as the primary execution path.
- Use Chrome DevTools MCP only for bridge recovery, blocking dialogs, DRC or export UI flows, or other UI-only checks that EasyEDA MCP cannot perform directly.
- After every stateful EasyEDA write, read back context, primitive inventory, or document source before proceeding.
- Treat a success response with unchanged readback state as a defect or no-op, not as a completed step.

## PCB Completion Bar

- Do not treat a board as complete until footprint import, functional zoning, connector orientation, loop-critical support-part placement, board outline validity, routing quality, DRC cleanliness, and export readiness all pass.
- Treat DRC warnings as blocking unless they are verified host-side false positives and explicitly documented.

## Customization Maintenance

- Put only repo-wide defaults in this file.
- Keep `.instructions.md` files focused on one concern and one workflow family.
- Keep skills task-specific and reference shared defaults here instead of duplicating them.
- When adding or renaming customization files under `.github/`, update any affected skills, instructions, or templates in the same change.