# SceneShop Privacy Execution & Compliance R0.1

## Scope
v0.16 alpha.2 turns privacy policy into governed execution. It does not equate a deletion request with blind database deletion.

## Data-subject workflow
- Authenticated users may export their current SceneShop-held profile/context directly.
- `EXPORT` and `DELETE` requests are durable workflow records.
- Internal processing of a request requires a SceneShop `moderator` session authenticated with MFA.
- Completed exports are fingerprinted with SHA-256 in the request record; the export payload itself is not written into the privacy-request table.

## Anonymization instead of destructive history rewriting
A valid `DELETE` request:
1. randomizes the account password and increments `tokenVersion`;
2. revokes all active sessions and removes MFA material;
3. clears direct author identity fields and masks/removes KYC presentation fields;
4. suspends active organization memberships;
5. disables analytics, personalization and marketing preferences;
6. preserves tamper-evident audit history, financial records and KYC document hashes required for duplicate/compliance controls.

A user who is the **last active OWNER** of an organization cannot be anonymized until ownership is transferred. This avoids orphaned tenants and accidental loss of governance.

The stable account/subject key may remain as a pseudonymous referential identifier where durable financial/audit foreign-key continuity is required. It is not treated as a public profile after anonymization.

## Retention execution
Organization retention policies may purge only eligible operational/ephemeral classes, including:
- playback viewer state;
- playback sessions;
- sync observations;
- distribution events;
- commerce activation metadata.

Audit and financial records are deliberately outside that destructive path and keep their separate minimum retention policy.

## Secret handling
SceneShop no longer accepts or persists Gemini API keys from Studio/browser input. AI secrets are supplied only through `GEMINI_API_KEY` or a future authorized secret-manager injection. The legacy `/api/ai/key` write route returns `SECRET_STORAGE_DISABLED`.

Platform connector secrets remain reference-only (`credentialsRef`); raw platform tokens/secrets are rejected by the connector domain.

## Compliance surface
Organizations with `ORG_SETTINGS` may read a compliance summary and, with a strong MFA session, execute retention. The summary reports policy state, pending privacy requests and core controls without exposing secrets.
