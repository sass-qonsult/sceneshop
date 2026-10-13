# SceneShop Development Review — v0.16

## v0.16.0-alpha.1 — Security / Privacy Foundation

Status: implemented and locally validated.

### Scope
- centralized HTTP security middleware with request correlation IDs;
- CSP, Permissions-Policy, Referrer-Policy, COOP/CORP and production HSTS;
- Partner SDK static resource remains explicitly cross-origin consumable;
- user privacy preferences (analytics, personalization, marketing);
- anonymous device consent stored only under SHA-256 device identity;
- privacy data-subject requests (`EXPORT` / `DELETE`);
- organization retention policy with bounded operational, audit and financial classes;
- PostgreSQL privacy/retention authority via migration `0024_security_privacy_foundation.sql`.

### Validation
- 170/170 unit/contract/regression tests PASS.
- 105/105 existing HTTP integration checks PASS.
- 24 contiguous migrations PASS.

### Next alpha
`v0.16.0-alpha.2` will execute retention/anonymization, produce governed data exports, harden legacy secrets and expose a compliance status/report surface. No alpha.3 is planned.

## v0.16.0-alpha.2 — Privacy Execution / Retention / Secrets Hardening

Status: implemented and locally validated.

### Scope
- governed self export and durable privacy-request processing;
- moderator+MFA execution for EXPORT/DELETE workflows;
- DELETE implemented as anonymization + access revocation, not destructive ledger/audit deletion;
- last active organization OWNER cannot be anonymized before ownership transfer;
- organization retention execution for ephemeral playback/sync/distribution/activation data;
- organization compliance report;
- Gemini secrets are environment/secret-manager only; browser/server-file key persistence removed;
- PostgreSQL anonymization markers via migration `0025_privacy_execution_anonymization.sql`.

### Preservation doctrine
Financial records, tamper-evident audit entries and KYC document hashes required for compliance are preserved. The operational profile is anonymized, active memberships are suspended, sessions are revoked and optional consent is disabled.

### Validation
- 177/177 unit/contract/regression tests PASS.
- 125/125 HTTP integration checks PASS.
- 25 contiguous migrations PASS.
- local preflight PASS.

No alpha.3 is planned. The next state is `release/v0.16` / RC preparation, with the same external npm/PostgreSQL/Redis live gates explicitly open.

## release/v0.16 — RC preparation

The alpha.2 feature line is frozen on `release/v0.16`. CI gate definition `v0.16-release-gate.yml` requires exact npm installation, the full regression suite, HTTP integration, strict preflight and live PostgreSQL+Redis validation. No `v0.16.0-RC.1` tag is created until those external gates pass.
