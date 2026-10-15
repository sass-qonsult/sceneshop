# SceneShop Development Review — v0.14

## v0.14.0-alpha.1 — Primary AI Pipeline

Implemented canonical `TARGETED`, `DISCOVERY` and `HYBRID` modes; governed Commercial Assets and visual references; organization-scoped analysis jobs; and frozen primary detections with SHA-256 fingerprints. The existing Gemini-assisted workflow feeds the durable pipeline while preserving current Studio behavior.

Validation at alpha.1: **152/152 tests PASS**.

## v0.14.0-alpha.2 — Isolated Redundancy & Human Review

Implemented redundant verification as a separate evidence layer with states `CONFIRMED`, `CONFLICT`, `NO_MATCH`, `INCONCLUSIVE` and `SOURCE_UNAVAILABLE`. Non-confirming states create operator flags. PostgreSQL now includes an immutable-primary trigger so redundant sources cannot alter frozen identification evidence.

Human review can approve/reject a candidate. Approval resolves to a governed CommercialAsset and creates a reviewed Placement without changing the original primary fingerprint. Discovery candidates may be manually resolved to a newly created CommercialAsset.

HTTP integration covers a Google-visual conflict scenario, flag creation, operator approval and placement creation while asserting primary fingerprint stability.

Validation: **158/158 tests PASS**, **96/96 HTTP integration checks PASS**, **22 contiguous migrations PASS**, local preflight PASS.

## RC gate

No alpha.3 is planned. Promotion to `v0.14.0-RC.1` requires the inherited strict dependency lock and live PostgreSQL/Redis gates, plus an authorized primary-AI provider smoke test when real provider credentials are available.
