# SceneShop Commercial Policy R0.1

**Baseline:** v0.9.0-alpha.4.1  
**Status:** canonical for v0.9 financial terms

## Principle

No commercial percentage is a hard-coded business truth. Percentages are contractual parameters and may change over time. Historical transactions are immutable.

SceneShop therefore separates:

1. **editable/versioned commercial policy** — applies to future transactions;
2. **offer-specific terms** — may override the default commission for a given product/seller/campaign;
3. **seller agreement terms** — may override selected policy fields for that seller agreement;
4. **frozen sale economics** — immutable values stored when the sale is confirmed.

## Resolution order

For a sale, SceneShop resolves rates in this order:

### Seller commission

`offer/sale explicit rate -> seller agreement -> active policy/store default -> policy default`

### Partner/channel share

`seller agreement -> active commercial policy`

Applied only when the sale has a partner attribution.

### Content-owner share

`seller agreement -> active policy split for official/community content`

The remaining amount after partner share and owner share belongs to SceneShop.

## Versioning

Each policy has:

- `id`
- `version`
- `effectiveFrom`
- `effectiveTo`
- `createdAt`
- `createdBy`
- `reason`
- `terms`

Updating commercial terms creates a **new policy version**. It does not mutate a prior version.

## Frozen sale record

At order confirmation, SceneShop stores at minimum:

- `policyId`
- `policyVersion`
- `commissionRate`
- `partnerShareRate`
- `splitOwnerRate`
- gross sale
- gross commission
- partner share
- owner share
- SceneShop share
- release date

A later policy change cannot recalculate these fields.

## Offer-specific example

The percentages below are illustrative only:

- Omega offer: 12%
- Tom Ford offer: 8%
- Aston Martin offer: 5%

All three may coexist in the same work because the contractual rate belongs to the offer/agreement, not to the SceneShop source code.

## Administration

In v0.9 the commercial-policy write API is temporarily protected by the existing internal `moderator` role. This is a transitional authorization seam only. v0.10 Identity/Multi-Tenant must introduce a dedicated commercial/finance permission instead of reusing compliance moderation.

Endpoints:

- `GET /api/commercial-policy` — producer/moderator can inspect the current policy; moderator receives history.
- `PUT /api/commercial-policy` — internal operator only in v0.9; creates a new policy version.

## PostgreSQL

Migration `0006_commercial_policies.sql` introduces `sceneshop_commercial_policies` and adds `commercial_policy_id` / `commercial_policy_version` to `sceneshop_commissions`.

The relational projection preserves policy history and the financial transaction writer stores the policy reference with every commission.

## Audit rule

**Editable future, immutable past.**

This is the governing rule for commercial percentages in SceneShop.
