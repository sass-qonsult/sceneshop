# SceneShop v0.14 Release Gate R0.1

The v0.14 implementation is functionally frozen at `v0.14.0-alpha.2`.

## Local gates completed

- 158/158 unit/contract/regression tests PASS.
- 96/96 HTTP integration checks PASS.
- 22 contiguous migrations PASS.
- local release preflight PASS.
- primary identification fingerprint remains unchanged across redundant verification and operator review.

## Required before `v0.14.0-RC.1`

1. regenerate and verify the exact npm lock tree for `pg`, `redis` and `@socket.io/redis-adapter`;
2. execute the live PostgreSQL + Redis harness;
3. run the v0.14 CI release workflow;
4. perform an authorized smoke test against the selected real primary AI provider using approved credentials and non-sensitive test content;
5. if a Google visual adapter is enabled later, validate it strictly as redundant verification, never as input to primary identification.

No alpha.3 is planned.
