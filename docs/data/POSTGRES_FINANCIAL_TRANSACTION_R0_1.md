# SceneShop PostgreSQL Financial Transaction — R0.1

Status: **CANONICAL FOR v0.9.0-alpha.4**  
Scope: official seller order confirmation and refund path.

## Purpose

Make PostgreSQL the durability authority for the first transaction-critical SceneShop domain. A seller webhook must never leave an order, sale, commission, audit event and downstream event in mutually inconsistent states.

## Atomic confirmation

For `POST /api/sellers/:id/orders`, after signature, offer, price and attribution validation, the PostgreSQL path performs one transaction:

1. acquire the SceneShop Data Plane transaction lock;
2. enforce idempotency with `sceneshop_orders (seller_id, order_id)`;
3. insert the order;
4. insert the attributed sale;
5. insert the frozen commission split;
6. consume the coupon when applicable;
7. append the tamper-evident audit record;
8. update the compatibility snapshot and monotonic revision;
9. append `commerce.order.confirmed` to the outbox;
10. commit;
11. only then publish the new snapshot to the Node process memory.

Any failure before COMMIT rolls the whole operation back.

## Frozen economics

Financial policy is captured at sale time. `sceneshop_commissions` stores:

- gross sale value;
- commission rate and gross commission;
- partner-share rate and amount;
- owner split rate and amount;
- SceneShop amount;
- release timestamp;
- status and reversal/payment timestamps.

The sale's compatibility payload also contains the frozen `financials` object. Consequently, a future change to store commission, partner share or creator split does not rewrite historic economics.

## Idempotency

Application-level duplicate detection remains for fast responses, but PostgreSQL is the authoritative barrier. The primary key `(seller_id, order_id)` prevents two processes from counting the same seller order twice.

A conflict found by the SQL writer skips the snapshot/outbox update and returns the already existing sale reference.

## Refunds

Refund processing has a native PostgreSQL transaction path:

- lock the order row;
- mark the order `devolvido`;
- reverse the sale only while it has not been paid out, preserving the previous business rule;
- mark the retained commission `estornado` when applicable;
- append audit;
- update compatibility snapshot;
- emit `commerce.order.reversed` through the outbox;
- commit.

## Compatibility snapshot

The v0.8 state snapshot still exists in alpha.4 because non-migrated modules remain synchronous. It is no longer the only durable financial write. The financial transaction updates the snapshot inside the same PostgreSQL transaction as normalized financial rows.

Later v0.9 increments will move reads and additional writes to domain repositories and progressively remove the whole-state projection.

## Concurrency

The Data Plane uses:

- PostgreSQL advisory transaction locking;
- row lock on the singleton compatibility snapshot;
- monotonic snapshot revision / optimistic conflict detection;
- SQL uniqueness for seller-order idempotency;
- a per-process domain commit queue.

Cross-process stale writers fail with `SCENESHOP_CONCURRENT_WRITE` instead of silently overwriting newer state.

## Validation status

Validated in alpha.4 with deterministic Node tests for:

- frozen commission economics;
- relational order/sale/commission/audit writes;
- duplicate-order SQL behavior;
- domain transaction sequence including snapshot and outbox;
- complete legacy test suite regression.

Live execution against a PostgreSQL daemon is still required before final `v0.9.0` because the current build environment does not expose PostgreSQL or Docker/Podman.
