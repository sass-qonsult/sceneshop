# SceneShop Studio — AI & Publication Workspace R0.1

## Purpose
v0.15 introduces an operator-facing workspace over the persistent AI pipeline created in v0.14. The goal is to let editorial/commercial teams understand the state of an audiovisual asset without navigating raw API objects or the legacy Gemini suggestion modal.

## Canonical workflow
1. Select an organization-owned work.
2. Configure `TARGETED`, `DISCOVERY` or `HYBRID`, scan depth, discovery categories and authorized Commercial Assets.
3. Start the governed primary analysis. Primary evidence is frozen before any external redundancy.
4. Review persistent candidates, their primary fingerprint, redundant verification state and operator flags.
5. Approve or reject. Approval requires a governed Commercial Asset and creates a Placement; rejection never creates a Placement.
6. Inspect approved Placements and the latest published Commerce Timeline.

## Design rules
- Detection is not publication.
- Primary identification remains immutable after freeze.
- Redundant verification is evidence only and never rewrites primary fields.
- `CONFLICT`, `NO_MATCH`, `INCONCLUSIVE` and `SOURCE_UNAVAILABLE` remain visible until an operator resolves them.
- The workspace is tenant-scoped through the organization context.
- The UI does not embed marketplace price into the temporal track; commerce remains resolved dynamically.

## Studio surface
The `IA & Publicação` tab contains:
- work selector;
- operational KPIs;
- governed analysis launcher;
- recent jobs;
- candidate review board;
- redundancy/flag evidence;
- approved Placement list;
- latest Commerce Timeline preview.

The existing track editor remains available for detailed scene editing and backwards-compatible workflows.
