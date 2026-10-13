# SceneShop v0.16 Release Gate R0.1

## Deterministic local gate
The v0.16 release line requires:
- complete JS/MJS syntax validation;
- full unit/contract/regression suite;
- HTTP integration suite;
- contiguous migration manifest through `0025_privacy_execution_anonymization.sql`;
- local release preflight PASS.

## Security/privacy acceptance
Before RC promotion, verify:
- request IDs and HTTP security headers on representative Partner-Native, Companion and Embedded surfaces;
- privacy export contains subject data but no password hash, bearer/session secret or provider credential;
- DELETE workflow blocks the last OWNER, then anonymizes after ownership transfer;
- anonymization revokes sessions/MFA and preserves financial/audit evidence;
- retention purges eligible ephemeral records only;
- Gemini/browser secret storage remains disabled;
- organization compliance report and retention execution require correct authorization/MFA.

## External RC blockers
RC remains blocked until a networked environment can additionally pass:
1. reproducible `npm ci` with a complete lock tree (`pg`, `redis`, `@socket.io/redis-adapter`);
2. live PostgreSQL migration/transaction/restart validation;
3. live Redis TTL/PubSub/multi-node session validation;
4. authorized platform/AI provider smoke tests where credentials are required.

No local substitute may be reported as a live-service PASS.
