# SceneShop — RBAC, Invitations & MFA R0.1

Status: canonical foundation for v0.10.0-alpha.3.

## 1. Authorization model
Organization membership is the tenant boundary. Global account roles are not the primary authorization mechanism for tenant content.

Capabilities by role:
- OWNER: organization settings, member management, content, AI, commerce and analytics.
- ADMIN: same operational capabilities as OWNER, except protected owner-role transitions remain restricted by governance rules.
- EDITOR: content read/write, AI run, commerce read and analytics read.
- COMMERCIAL: content read, commerce read/write and analytics read.
- ANALYST: content/commerce read and analytics read.
- VIEWER: content/commerce read only.

Organization-scoped routes authorize against capabilities such as `CONTENT_WRITE`, `COMMERCE_WRITE`, `AI_RUN`, `MEMBERS_MANAGE` and `ANALYTICS_READ`.

## 2. Secure invitations
Invitation tokens are generated with cryptographic randomness and are returned only at creation time. SceneShop persists only SHA-256 token hashes. Invitations are bound to a target username, role, organization, expiration and status. A token is single-use and can be revoked or expire.

## 3. MFA TOTP
SceneShop supports TOTP-compatible authenticators. The TOTP seed is encrypted at rest with AES-256-GCM using a key derived from the server session secret. The database never stores the clear TOTP seed.

Login with MFA enabled is two-phase:
1. password validation returns a short-lived signed MFA challenge;
2. successful TOTP validation creates an authenticated session with `auth_strength=MFA`.

Bearer tokens issued from strong sessions carry an MFA claim. PostgreSQL session validation verifies that an MFA-bearing token is backed by an MFA-strength session.

## 4. Organization security policy
An organization can enable `settings.security.requireMfaForWrites`. When enabled, tenant write capabilities (content, commerce, AI, member/settings management) reject password-only sessions with `MFA_REQUIRED`.

Changing the security policy itself always requires a strong MFA session.

## 5. Session hardening
Authentication sessions are individually addressable. Users can list active sessions, revoke one session, or use logout-all. PostgreSQL limits active sessions per user by revoking older sessions beyond the configured operational cap (currently 10 in this baseline).

## 6. Track provenance vs authority
Track provenance still records the author who performed the edit. Official/community classification for tenant-owned tracks is determined by the organization kind, not by the editor's legacy global account role. `CONTENT_OWNER`, `PRODUCER`, `CHANNEL` and `PLATFORM` organizations publish official tracks; individual/other workspaces remain community by default.
