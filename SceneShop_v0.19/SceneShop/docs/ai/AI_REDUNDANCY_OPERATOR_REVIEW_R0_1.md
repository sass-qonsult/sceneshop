# SceneShop AI — Redundant Verification & Operator Review R0.1

## Purpose

External visual services are **redundant verification only**. They do not participate in primary identification and cannot rewrite frozen primary evidence.

## Verification states

- `CONFIRMED`
- `CONFLICT`
- `NO_MATCH`
- `INCONCLUSIVE`
- `SOURCE_UNAVAILABLE`

Supported provider classes include `GOOGLE_VISUAL`, manufacturer catalogs, retailer catalogs, SceneShop catalog checks and other isolated adapters.

## Isolation rule

Each primary candidate is frozen with `primary_frozen_at` and a SHA-256 `primary_fingerprint`. Redundant verification is stored in a separate relation. PostgreSQL includes a trigger that rejects changes to primary identification fields after freeze.

`CONFIRMED` is corroboration only and does not publish anything automatically.

`CONFLICT`, `NO_MATCH`, `INCONCLUSIVE` and `SOURCE_UNAVAILABLE` create an `OperatorFlag`.

## Human review

The operator can:

- `APPROVE` and resolve the candidate to a governed CommercialAsset;
- `REJECT` as false positive / non-commercial / unauthorized.

Approval creates a reviewed Placement with its own commercial display window. Discovery candidates without a target asset must first be resolved to a CommercialAsset; the original primary candidate remains unchanged.

## Canonical lifecycle

`DETECTED → REVIEWED/APPROVED → PLACEMENT → COMMERCE TRACK`

AI detection never equals publication.
