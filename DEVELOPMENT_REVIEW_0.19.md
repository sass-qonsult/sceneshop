# SceneShop Development Review — v0.19

## v0.19.0-rc.1 — Release Candidate hardening

Status: code-complete RC-preparation candidate; deterministic repository validation completed. Official `release/v0.19` / `v0.19.0-rc.1` refs remain guarded by external live/build/QA/signing evidence.

### Scope

- production runtime configuration is centralized and fail-closed;
- RC release contract pins package, Node, PostgreSQL migration set, native bridge and application surfaces;
- PostgreSQL schema is intentionally unchanged from v0.18 beta.1 (27 migrations, latest `0027`);
- migration-set SHA-256 and per-migration checksums are verified;
- isolated live schema gate creates/applies/verifies/drops a temporary PostgreSQL schema;
- rollback to v0.18 beta.1 is allowed only while the exact frozen database contract remains true;
- `/api/live`, `/api/ready`, `/api/health` and `/api/ops/status` expose consistent RC metadata;
- Android/iOS/Desktop version metadata is aligned with the v0.19 candidate;
- RC manifest aggregates backend/recovery/schema, all application builds, QA and production signing as same-commit evidence;
- guarded promotion reserves only `release/v0.19` and `v0.19.0-rc.1`.
- foundation/recovery/build/QA evidence labels are generated from the current package version so v0.19 evidence cannot carry stale v0.17/v0.18 labels.

### External gates

The current sandbox cannot honestly produce the live PostgreSQL/Redis, signed Android/iOS or physical-device/browser QA evidence. Those remain explicit blockers rather than simulated PASS states.

### Deterministic validation

- v0.19-specific contract/governance tests: **18/18 PASS**.
- dependency-constrained executable regression: **217/217 PASS**.
- integral `npm test`: **217 PASS / 2 process-load failures**, both inherited `MODULE_NOT_FOUND: express` in this sandbox.
- strict release preflight: PASS.
- npm clean-install dry-run (offline lock validation): **143 packages** accepted.
- migrations: **27/27**, latest `0027_cache_coordination_recovery.sql`.
- migration set SHA-256: `58e73ab31399eb7db9641510baa9fc5a2e5d3dd725c6cefcdcf07eb8ecaccafa`.
- JavaScript/MJS and shell syntax: PASS.
- `git diff --check`: PASS.
- native development preflight: PASS; production toolchain/signing remains externally blocked.

### Promotion state

The official `release/v0.19` branch and `v0.19.0-rc.1` tag remain withheld until same-commit live infrastructure, recovery, live schema, platform build, QA, signing and signed mobile artifact evidence is complete.
## rcprep.3 — Browser/Offline RC findings

During attempted execution of the external Web/Desktop QA gate, three client-surface findings were identified and corrected before recording any PASS evidence:

- Web/Mobile now expose an explicit governed **Share** action. Native hosts use the existing allowlisted `SHARE` bridge; browsers use Web Share when available and fall back to copying the canonical SceneShop URL while preserving the session/deep-link context.
- the service-worker cache namespace is advanced to `sceneshop-app-v019-rc1`, avoiding a stale v0.18 alpha identifier during RC rollout;
- `native-bridge-contract.js` is now part of the offline core cache and `offline.html` is returned only for navigation failures, never as a fallback body for JavaScript or other asset requests.

Post-fix deterministic validation: **209/209 dependency-constrained regression PASS**. Integral `npm test`: **209 PASS / 2 process-load failures**, both the inherited local `MODULE_NOT_FOUND: express` constraint.

The installed Chromium runtime could not be used to certify the `web-chromium` or `desktop-linux` QA rows because the host applies enterprise policy `URLBlocklist=["*"]`, which blocks even the isolated `127.0.0.1` QA origin with `ERR_BLOCKED_BY_ADMINISTRATOR`. Those rows therefore remain externally blocked; no synthetic PASS was recorded.


## rcprep.4 — Portable Evidence Aggregation & Cryptographic Signing Proof

The RC promotion path is now independent of any single CI provider. `tools/v019-evidence-import.js` validates and imports a complete evidence transport directory from Linux/infrastructure, Android, macOS/iOS and QA runners. Every imported evidence file must match the current `gitCommit` and `packageVersion`; stale/cross-commit files are rejected before copy. The canonical staging directory `artifacts/external-evidence/` is ignored by Git so evidence transport does not contaminate the source worktree.

Signed mobile build evidence is also hardened. `--signed` is no longer a declarative boolean: `native-build-evidence.js` requires separate same-commit signature proof. Android proof is produced by `apksigner verify --print-certs` and must match the configured SHA-256 signing certificate fingerprint. iOS proof is produced by `codesign --verify --deep --strict` and must match the configured Apple TeamIdentifier. The signed-build manifest gate now requires `signatureVerified=true`.

Portable external execution is documented in `docs/release/V0_19_EXTERNAL_RUNNER_KIT_R0_1.md`. Gate messages were also normalized to the current package version rather than historical v0.17 labels.

Validation after rcprep.4 hardening: **18/18 v0.19 RC tests PASS**, **50/50 production-beta/native tests PASS**, **217/217 dependency-constrained regression PASS**. Integral `npm test`: **217 PASS / 2 process-load failures**, both unchanged local `MODULE_NOT_FOUND: express`. Strict preflight and npm lock dry-run remain PASS.

## rcprep.5 — Finalization Orchestrator & Evidence Transport Index

The final RC handoff now has a single fail-closed finalization command. `tools/v019-finalize.js` validates the complete external evidence transport set, imports only same-commit/version evidence, rebuilds the v0.19 RC manifest, verifies promotion eligibility, creates `release/v0.19` and `v0.19.0-rc.1`, verifies both refs point to the exact candidate commit, and writes a finalization receipt. No release branch or official tag is created before evidence import and manifest verification succeed.

Runner evidence can also be exported through `tools/v019-evidence-export.js`. The exporter preserves the canonical external-evidence directory layout and writes `evidence-index.json` with candidate commit, package version, file sizes and SHA-256 hashes, simplifying safe transport/merge from independent Linux, Android, macOS/iOS and QA runners.

New operator commands:

- `npm run rc:evidence:export`
- `npm run rc:finalize:dry`
- `npm run rc:finalize`

Validation after rcprep.5 orchestration: **21/21 v0.19 RC tests PASS**, **71/71 focused release/app tests PASS**, **220/220 dependency-constrained executable regression PASS**. Integral `npm test`: **220 PASS / 2 process-load failures**, both unchanged local `MODULE_NOT_FOUND: express`. Strict preflight remains PASS; npm clean-install dry-run continues to accept **143 packages**; migrations remain **27/27** with no schema change.

## rcprep.6 — Validação ao vivo, correções de execução e instalação de produção

O rcprep.5 nunca tinha rodado contra PostgreSQL/Redis reais nem com navegador. Uma análise independente executou os gates ao vivo (PostgreSQL 16.13 e Redis 7.0.15 nativos, versões próximas às do contrato) e os testes de navegador, e corrigiu tudo o que falhou. Nenhuma migração mudou: o contrato de schema (27 migrações, mesmo SHA-256) e a compatibilidade de rollback com a v0.18 beta.1 continuam valendo.

**Bloqueadores corrigidos**

- O servidor não iniciava em PostgreSQL novo (FK `sceneshop_tracks_organization_id_fkey`) desde v0.10.0-alpha.2: a projeção não gravava organizações. Agora grava organizações e membros antes de obras/produtos/trilhas.
- `validate:live`: `io.close()` do socket.io 4.8 quebrava sem servidor HTTP.
- `rc:schema:live`: usava um schema efêmero que nunca era criado.
- Recovery: o manifesto contava `sceneshop_commerce_offers` (inexistente desde v0.17); a tabela é `sceneshop_external_offers`.
- CSP `script-src 'self'` (v0.16) bloqueava scripts embutidos: player da TV, `/assistir`, loja e demonstração do parceiro não carregavam. Scripts movidos para arquivos.
- Celular: sem ofertas do Commerce Core, nenhum produto podia ser comprado; volta às ofertas oficiais da trilha. A Commerce Timeline oficial só é usada com a trilha oficial (denúncias da comunidade voltaram a funcionar).
- Estúdio/Ganhos quebrava com a política comercial versionada e não mostrava lançamentos nem o estado do botão de saque.
- Linha da comunidade: workspaces que não são donos de conteúdo publicam trilha "Comunidade" sobre qualquer obra (memória e PostgreSQL); organizações oficiais continuam isoladas.
- PostgreSQL: `atomicDomain` substituía o objeto de estado e escritas feitas por referências guardadas se perdiam (aviso de venda do marketplace ficava "Pendente"); agora sincroniza preservando a identidade. Busca de produtos colocava os globais primeiro (`NULL` em `ORDER BY ... DESC`) e não ignorava acentos. Moderação e denúncias não gravavam o status da trilha no repositório autoritativo.

**Produção (DEMO=0)**

- Banco de produção nascia com os dados de demonstração (9 vendas fictícias, contas, lojas, obra de exemplo) e preços simulados de lojas. Produção agora começa vazia (só chaves e política comercial) e sem preços simulados.
- Não havia como criar produtora, moderador ou loja: `tools/create-account.js` e `tools/create-seller.js`.
- O site do próprio SceneShop acessa obras sem chave de parceiro; outros sites continuam exigindo chave e domínio.
- `/r` respondia 500 quando não havia oferta.
- Contêiner Docker não subia (`EACCES` em `data/uploads`); compose ganhou volumes, `CACHE_BACKEND` e `sceneshop.env`.
- Lançadores exigem Node 20+ (a checagem antiga falhava no Node 22), leem `sceneshop.env` e abrem o navegador quando o servidor responde.

**Validação do rcprep.6**

- `npm test`: **277/277**; `test:api`: **125** verificações; preflight estrito e contrato do RC: PASS.
- Ao vivo (PostgreSQL 16.13 + Redis 7.0.15): `validate:live`, `rc:schema:live` (27/27) e recovery (backup, restore, verificação, Redis zerado): PASS.
- Navegador, servidor em arquivo **e** em PostgreSQL + Redis: e2e **43/43**, piloto **37/37**, piloto em cena única **38/38**, IA (simulador) **20/20**.
- Produção do zero (`test/production.smoke.mjs`): conta da produtora, obra, produto, oferta oficial, trilha, compra com código assinado, aviso assinado da loja, comissão atribuída e moderador: PASS.

**Continua externo** (não pode ser produzido sem a infraestrutura/credenciais certas): evidência nas versões exatas do contrato (PostgreSQL 16.15, Redis 7.4.11), builds Android/iOS, assinatura de produção e as 12 linhas de QA em aparelhos reais. Use o External Runner Kit R0.4.
