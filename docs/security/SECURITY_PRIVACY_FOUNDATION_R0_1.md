# SceneShop Security & Privacy Foundation R0.1

## Principles
1. Data minimization: anonymous consumer identifiers are hashed where persistence is required.
2. Purpose separation: analytics, personalization and marketing consent are independent controls.
3. Retention is explicit and organization-governed, but long-lived audit/financial records have enforced minimum ranges.
4. Data-subject requests are durable workflow objects; a request does not silently delete financial/audit evidence.
5. Security headers must not break the canonical Partner-Native / Companion / Embedded deployment model.

## HTTP baseline
Every request receives `X-Request-Id`. The SceneShop origin emits CSP, Referrer-Policy, Permissions-Policy, COOP/CORP and, on production HTTPS, HSTS. The headless Partner SDK JavaScript is explicitly served as a cross-origin resource.

## Privacy preferences
Authenticated users can govern analytics, personalization and marketing preferences. Companion devices can submit the same choices using an anonymous local device identifier; only its SHA-256 representation is persisted.

## Retention classes
Default operational retention: viewer state 30d, sync observations 30d, commerce activation metadata 180d, security events 365d. Audit and financial classes default to 2555d and have conservative minimums to prevent an operator from accidentally applying consumer-session retention to legally/audit-relevant records.

## Data-subject requests
`EXPORT` and `DELETE` requests enter a governed workflow. Actual export/anonymization execution is intentionally deferred to alpha.2 so that financial, KYC and audit preservation rules can be applied before any destructive action.
