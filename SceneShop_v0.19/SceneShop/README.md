# SceneShop

> **Guias de uso / User guides / Guías de uso:** [Como rodar (PT)](COMO_RODAR.md) · [How to run (EN)](HOW_TO_RUN.md) · [Cómo ejecutarlo (ES)](COMO_EJECUTAR.md).
> As telas funcionam em português, inglês e espanhol / Screens available in Portuguese, English and Spanish / Pantallas en portugués, inglés y español.

Camada de compras invisível para filmes, novelas, publicidade e clipes: a IA inventaria cada cena,
o espectador vê os produtos pelo controle ou pelo celular (QR code) e compra na loja indicada pela
produção, com preço garantido por código assinado.

## Começar aqui

### 1. Demonstração e piloto no seu computador (Windows, Mac ou Linux)

1. Descompacte esta pasta.
2. **Windows:** dê dois cliques em `Iniciar SceneShop.bat`.
   **Mac/Linux:** rode `./iniciar.sh` no Terminal (no Mac, pode renomear para `iniciar.command` e dar dois cliques).
3. O estúdio abre sozinho em `http://localhost:3000/studio.html` quando o servidor fica pronto.
   Contas de demonstração: `produtora`, `ana`, `moderador` — senha `demo1234`.

Não precisa instalar nada: as dependências já vêm na pasta e, no Windows, se não houver Node.js 20+
o lançador baixa uma cópia portátil (30 MB, uma vez) para a pasta `runtime`. Se o Windows perguntar
sobre o firewall, clique em **Permitir** (é o que deixa o celular, no mesmo Wi-Fi, ler o QR code).

**IA (opcional):** copie `sceneshop.env.example` para `sceneshop.env` e coloque a sua
`GEMINI_API_KEY` (gratuita em <https://aistudio.google.com/apikey>). O lançador lê esse arquivo.

O roteiro do piloto com o seu vídeo e as suas fotos está em [Roteiro do Piloto](#roteiro-do-piloto-com-o-seu-vídeo-e-as-suas-fotos).

### 2. Produção com Docker (PostgreSQL + Redis)

```bash
cp sceneshop.env.example sceneshop.env   # defina PUBLIC_URL (https) e SESSION_SECRET (32+ caracteres)
docker compose up -d --build
```

Produção começa **vazia** (sem obra, contas ou lojas de exemplo). Crie o primeiro acesso:

```bash
# produtora (cria também a organização dela)
docker compose run --rm -e SCENESHOP_NEW_PASSWORD='senha-forte-12+' app \
  node tools/create-account.js --role=producer --username=o2filmes --name="O2 Filmes" --org="O2 Filmes"
# moderador
docker compose run --rm -e SCENESHOP_NEW_PASSWORD='outra-senha-12+' app \
  node tools/create-account.js --role=moderator --username=compliance
# loja com acordo comercial (mostra o segredo do webhook uma única vez)
docker compose stop app
docker compose run --rm app node tools/create-seller.js --id=urbano --name="Urbano&Co" \
  --cnpj=11.222.333/0001-81 --store-url=https://loja.exemplo.com.br/sceneshop
docker compose start app
```

Os vídeos e imagens enviados ficam no volume `sceneshop_uploads`. Coloque o serviço atrás de um
proxy HTTPS (o `PUBLIC_URL` precisa ser `https://`) e use `TRUST_PROXY=1`.

### 3. Produção em servidores próprios

Node.js 20+, PostgreSQL 16 e Redis 7. Variáveis mínimas: `NODE_ENV=production`, `DEMO=0`,
`DATA_BACKEND=postgres`, `DATABASE_URL`, `REDIS_URL`, `SESSION_BACKEND=redis`, `CACHE_BACKEND=redis`,
`SESSION_SECRET`, `PUBLIC_URL` (https). As migrações rodam sozinhas na inicialização.
Contas e lojas: os mesmos comandos `tools/create-account.js` e `tools/create-seller.js`.

### Reconhecer os vídeos pelo som (ACRCloud)

O celular ouve 10 segundos do que está passando e entra direto nos produtos da cena, sem QR code.
Configure com **`Configurar ACRCloud.bat`** (Windows) ou com as variáveis `ACRCLOUD_*` do
`sceneshop.env.example`: projeto de reconhecimento (host, access key, access secret), bucket
"Audio & Video" (ID) e token da Console API. Cada obra enviada pelo estúdio é cadastrada sozinha;
obras antigas usam o botão **Reconhecimento por áudio** na aba Obras. O microfone do celular só
funciona com o SceneShop publicado em `https`. O áudio vai à ACRCloud só para identificar e não é guardado.
Passo a passo completo em `HOW_TO_RUN.md`, seção A9.

### Verificar que está tudo certo

```bash
npm test                      # 277 testes de regras (sem banco)
npm run test:api              # integração HTTP (125 verificações)
npm run validate:live         # com LIVE_DATABASE_URL e LIVE_REDIS_URL: PostgreSQL + Redis reais
node test/production.smoke.mjs  # cliente real de ponta a ponta contra um servidor DEMO=0
```

Testes de navegador (Playwright): `test/e2e.mjs`, `test/pilot.e2e.mjs`, `test/ai.e2e.mjs` — passam com
o servidor em arquivo e em PostgreSQL + Redis.

---

## Histórico de versões

## v0.19.0-rc.1 — Release Candidate Preparation

SceneShop v0.19 is the convergence/hardening line built on the frozen v0.18 Production Beta candidate. It intentionally keeps the exact 27-migration PostgreSQL schema so application rollback to v0.18 beta.1 remains possible while that schema contract is unchanged. Production configuration, native/web version alignment, release metadata, isolated schema verification and same-commit RC promotion are fail-closed. See `docs/release/V0_19_RC_GATE_R0_1.md` and `docs/release/V0_19_ROLLOUT_ROLLBACK_R0_1.md`.

> Current development line: **v0.19 Release Candidate — rc.1 preparation**

RC browser-gate hardening also adds an explicit governed Web/Mobile share-out action and corrects the offline service-worker boundary so HTML fallback is navigation-only and the native bridge contract is cached as part of the RC shell.

RC evidence can now be produced on separate infrastructure/Android/macOS/device runners and imported fail-closed with `npm run rc:evidence:import`; all evidence is same-commit/version validated. Production mobile artifacts additionally require cryptographic signer verification (`apksigner` / `codesign`) before signed build evidence is accepted. See `docs/release/V0_19_EXTERNAL_RUNNER_KIT_R0_1.md`. Final handoff can be executed with `npm run rc:finalize:dry` and, once complete, `npm run rc:finalize`; this performs evidence import, manifest verification and guarded branch/tag promotion as one fail-closed operation.

## v0.18.0-beta.1 — Production Beta RC Preparation

The v0.18 feature line is code-complete. This branch carries the exact `0.18.0-beta.1` package version that must receive same-commit live infrastructure, Desktop/Android/iOS build, and 12-row QA evidence before guarded promotion to `release/v0.18` and the official `v0.18.0-beta.1` tag. No new feature work is planned on this candidate.

> Current development line: **v0.18 Production Beta — beta.1 RC preparation**

## v0.18.0-alpha.4 — Production Beta Acceptance Candidate

SceneShop now has a fail-closed Production Beta acceptance manifest that requires same-commit evidence from live PostgreSQL/Redis + recovery, Desktop/Android/iOS builds and the complete Web/Desktop/Mobile QA matrix. Production distribution readiness is tracked separately and additionally requires signing authority plus signed Android/iOS artifacts. Promotion to `release/v0.18` / `v0.18.0-beta.1` is guarded and cannot overwrite conflicting refs. See `docs/ux/PRODUCTION_BETA_ACCEPTANCE_R0_1.md`.

> Current development line: **v0.18 Production Beta — alpha.4 acceptance-orchestrator candidate**

## v0.18.0-alpha.3 — Production Beta Lifecycle & Platform Gates Candidate

Web/HTML, Desktop and Mobile now share a governed lifecycle contract across foreground/background and online/offline transitions. Android and iOS accept native shares, notification permission is explicitly user initiated, iOS has an APNS registration seam, and platform build workflows emit SHA-256 build evidence bound to the current commit/version. Production signing remains secret/environment driven and device QA remains a real platform gate. See `docs/ux/NATIVE_APPLICATION_LIFECYCLE_R0_1.md` and `docs/ux/PRODUCTION_BETA_ACCEPTANCE_R0_1.md`.

> Current development line: **v0.18 Production Beta — alpha.3 lifecycle/platform-gates candidate**

## v0.18.0-alpha.2 — Native Application Packaging Candidate

SceneShop now has three explicit product surfaces over one commerce runtime: Web/HTML (`/app`), Desktop (`/desktop`) and Mobile (`/mobile`). Alpha.2 adds a packaged desktop host plus Android/iOS native wrapper projects, a versioned allowlisted native bridge, secure storage seams (Android Keystore/AES-GCM and iOS Keychain), origin-restricted WebViews, deep-link normalization and deterministic package generation. Production-signed Android/iOS binaries remain gated on their platform toolchains and signing identities; the repository does not misreport those external gates as PASS. See `docs/ux/NATIVE_APPLICATION_PACKAGING_R0_1.md`.

> Current development line: **v0.18 Production Beta — alpha.2 native application packaging candidate**

## v0.17.0-alpha.2 — Release Promotion Candidate

The Scale & Reliability feature scope is code-complete and frozen as a promotion candidate. `npm run gate:alpha2` performs the exact-install PostgreSQL/Redis foundation gate plus an isolated PostgreSQL backup→restore drill with a brand-new empty Redis. `npm run release:verify` accepts only same-commit PASS evidence, and `npm run release:promote` is fail-closed: it creates `release/v0.17` and the annotated `v0.17.0-alpha.2` tag only after the manifest is eligible. The official tag remains withheld until the connected live gate produces those evidences. See `docs/operations/V0_17_RELEASE_GATE_R0_1.md`.

> Previous frozen line: **v0.17 Scale & Reliability — alpha.2 release-promotion candidate**

## v0.17.0-alpha.2-dev.1 — Distributed Cache / Coordination / Recovery Candidate

Production cache coordination is Redis-backed with generation-scoped invalidation, token-safe distributed leases and instance presence. PostgreSQL remains the durable authority and stores recovery checkpoints; Redis is explicitly rebuildable.

## v0.17.0-alpha.1.1 — Foundation Gate Closure

The inherited npm dependency risk is closed at repository level: the committed lock contains the exact, transitively complete production graph for `pg@8.23.1`, `redis@6.3.0` and `@socket.io/redis-adapter@8.3.0`, with strict closure/integrity checks. Node >=20 is explicit (Node 22 remains the operational baseline), the production Docker build uses `npm ci`, and the foundation gate requires clean install + regression + HTTP + real PostgreSQL/Redis validation. See `docs/operations/V0_17_FOUNDATION_GATE_R0_1.md`.

## v0.17.0-alpha.1 — Scale & Reliability Foundation

SceneShop now turns its transactional PostgreSQL outbox into a horizontally safe leased delivery queue with `FOR UPDATE SKIP LOCKED`, bounded retries, durable dead letters and worker heartbeats. A dedicated `npm run worker:outbox` process delivers events to an HTTP(S) sink using the event ID as the downstream idempotency key. W3C Trace Context, AsyncLocalStorage context propagation, process metrics and a moderator-protected `/api/ops/status` surface provide the first operations/observability layer. See `docs/operations/SCALE_RELIABILITY_FOUNDATION_R0_1.md`.

> Previous v0.17 feature checkpoint: **alpha.1 implemented**

## v0.16.0-alpha.2 — Privacy Execution / Compliance

Privacy requests now execute through a governed workflow: user export, moderator+MFA processing, ownership-safe anonymization, session/MFA revocation, bounded retention of ephemeral playback/sync/distribution data and an organization compliance report. Financial/audit history and compliance hashes are preserved. AI provider keys can no longer be stored from the browser or in SceneShop files; they are environment/secret-manager only. See `docs/security/PRIVACY_EXECUTION_COMPLIANCE_R0_1.md`.

> Previous frozen line: **v0.16 Security / Privacy / Compliance — alpha.2 implemented**

## v0.16.0-alpha.1 — Security / Privacy Foundation

SceneShop now has centralized HTTP hardening, request correlation, user/device privacy preferences, durable EXPORT/DELETE requests and organization retention policies. Anonymous device consent is stored under SHA-256 identity rather than raw device IDs. See `docs/security/SECURITY_PRIVACY_FOUNDATION_R0_1.md`.


## v0.15.0-alpha.1 — Studio AI & Publication Workspace

The Studio now exposes the governed v0.14 AI pipeline as an operational workspace: TARGETED/DISCOVERY/HYBRID configuration, Commercial Asset targeting, persistent jobs, immutable primary evidence, redundant-verification/flag visibility, human approval/rejection, approved Placements and Commerce Timeline preview. The legacy detailed track editor remains available. See `docs/ux/STUDIO_AI_PUBLICATION_R0_1.md`.

## v0.15.0-alpha.2 — Consumer / Companion UX

The consumer surface now runs on the published Commerce Timeline and the shared Companion state machine: independent Playback/Browse Heads, spoiler policy, persisted browsing, “Enquanto você explorava”, explicit Go Live vs Re-sync, and dynamic commerce resolution through SceneShop activation URLs. Studio operators can also govern timeline visibility/thumbnails/missed-items/seek policy. See `docs/ux/CONSUMER_COMPANION_UX_R0_1.md`.

RC hardening also makes **CommercialAsset-only campaigns/routing** first-class and guarantees that timeline gaps clear the LIVE commercial scene instead of carrying a stale offer forward. Migration chain: **23 migrations**, latest `0023_campaign_assets_commerce_timeline.sql`.


## v0.11.0-alpha.2 — Dynamic Commerce Resolution & Attribution

SceneShop now resolves the authorized offer at interaction time rather than freezing marketplace/price into the Commerce Track. Territory, campaign, placement, product, availability and routing policy determine the ordered offer set. A 30-minute Resolution freezes what was shown; the consumer receives SceneShop activation links, and activation is recorded before the HTTP/HTTPS redirect to the authorized merchant. Brand-direct can be prioritized over marketplaces, or policies can select priority/first-available/lowest-price among explicitly authorized offers.

Validation: **119/119 unit/contract PASS + 62 HTTP integration checks PASS**. PostgreSQL migration chain: **16 migrations**, latest `0016_commerce_resolution_attribution.sql`. See `docs/data/COMMERCE_RESOLUTION_ATTRIBUTION_R0_1.md`.

## v0.11.0-alpha.1 — Governed Commerce Core

SceneShop has an organization-governed commercial domain: Sponsor/Brand → Campaign → Product/CommercialAsset → Merchant Connection → External Offer → Routing Policy. Providers such as Amazon, Mercado Livre and Shopee are adapters alongside brand-direct, custom and private destinations; they are not architectural dependencies.

Validation: **114/114 unit/contract PASS + 57 HTTP integration checks PASS**. PostgreSQL migration chain: **15 migrations**, latest `0015_commerce_core.sql`. See `docs/data/COMMERCE_CORE_R0_1.md`.

## v0.10.0-alpha.3 — Tenant Ownership & Isolation

### Alpha.2 highlights
- Business resources are owned by `Organization`, not by the individual user who happened to create them.
- Repository-level tenant scoping for Studio works, products and tracks.
- Organization ownership prepared for campaigns, Commerce Track publications and commerce connections.
- Cross-tenant product/track mutation is rejected before the domain write.
- Studio supports organization switching and sends `X-SceneShop-Organization` automatically.
- New creator accounts receive a personal workspace.

See `docs/data/TENANT_OWNERSHIP_ISOLATION_R0_1.md`.

The second roadmap step has started on an isolated feature branch. SceneShop now separates global login identity from tenant organizations: one account can belong to multiple producers, channels, brands, agencies or platforms with different organization roles (`OWNER`, `ADMIN`, `EDITOR`, `COMMERCIAL`, `ANALYST`, `VIEWER`). Tenant selection uses the verified `X-SceneShop-Organization` context instead of issuing a new token per organization. PostgreSQL migration `0012_multi_tenant_foundation.sql` creates organization, membership and invitation foundations.

Current regression: **96/96 PASS + 20 HTTP integration checks PASS**. See `DEVELOPMENT_REVIEW_0.10.md` and `docs/data/MULTITENANT_FOUNDATION_R0_1.md`. The v0.9 release line remains isolated on `release/v0.9` while its external live/lockfile gates await a networked PostgreSQL/Redis/npm environment.

## v0.9.0-alpha.8 — Release Validation / Viewer-State Authority

Alpha.8 hardens the v0.9 release gate. Browse Head authority is now explicitly per viewer/device in Redis **and PostgreSQL** (`sceneshop_playback_viewers`), while the shared playback session carries only the Playback Head. Migration manifests are SHA-256 checked and PostgreSQL health detects migration drift. A strict RC preflight and a live PostgreSQL+Redis validation harness are included.

Current deterministic regression: **89/89 PASS**. The live PostgreSQL+Redis gate remains externally blocked in this sandbox because the daemons/packages cannot be installed here; the RC preflight deliberately refuses to hide that. See `docs/data/ALPHA8_RELEASE_VALIDATION_R0_1.md`.

# SceneShop — protótipo (MVP)

**Development baseline:** v0.19.0-rc.1 Release Candidate preparation, built cumulatively on the frozen v0.18.0-beta.1 Production Beta candidate. Historical release lines remain preserved; stable historical baseline v0.8.0.

Uma camada de compras invisível por trás de filmes, novelas, propagandas e clipes.

> **Arquitetura canônica:** SceneShop não pretende hospedar permanentemente o vídeo. O conteúdo é reproduzido no ambiente do dono/parceiro ou em plataforma externa. Os três modos oficiais são `PARTNER_NATIVE`, `COMPANION` e `EMBEDDED`; Companion e Embedded são esperados como os modos predominantes. Veja `docs/architecture/SCENESHOP_DISTRIBUTION_SYNC_COMMERCE_R0_2.md`.
O espectador aperta um botão e vê os produtos da cena. Se quiser, lê um QR code e
a lista passa para o celular, acompanhando o programa em tempo real.




### v0.9.0-alpha.5.1 — Author/KYC Authority + Distribution/Sync Foundation

PostgreSQL passa a ser autoridade também para o estado KYC do autor: hash único do documento, máscara, PF/PJ, PEP, submissão, decisão e reviewer. O número bruto do documento não é persistido. O projector legado só pode bootstrapar autores/KYC ausentes (`ON CONFLICT DO NOTHING`) e não pode reverter uma decisão de compliance. `/api/me/ledger`, a fila `/api/aml/kyc` e a elegibilidade de saque passam a consultar o author/KYC autoritativo quando PostgreSQL está ativo.

As migrations `0008_author_kyc_authority.sql` e `0009_distribution_commerce_sync_foundation.sql` também congelam no schema os conceitos aprovados: `PARTNER_NATIVE / COMPANION / EMBEDDED`, bindings externos (YouTube/Instagram/TikTok por adapters neutros), Sync ID/fingerprints temporais, `Playback Head` separado de `Browse Head`, Commerce Timeline com política de spoilers, sessões `LIVE/BROWSING`, Commerce Providers/marketplaces e roteamento de ofertas. O SceneShop continua não sendo host permanente do vídeo.

Suíte atual: **72/72 PASS**. Detalhes em `docs/data/POSTGRES_AUTHOR_KYC_AUTHORITY_R0_1.md` e `docs/architecture/SCENESHOP_DISTRIBUTION_SYNC_COMMERCE_R0_2.md`.

### v0.9.0-alpha.5 — PostgreSQL Identity Authority

PostgreSQL agora é a fonte de verdade para credenciais de conta, `tokenVersion` e novas sessões de login. Tokens novos recebem um `sid` aleatório; a validação bearer consulta conta e sessão ativas no banco, permitindo revogação entre múltiplas instâncias. `logout-all` incrementa `tokenVersion` e revoga todas as sessões em uma transação de domínio.

O projector genérico deixou de apagar ou sobrescrever contas existentes, impedindo que um snapshot Node obsoleto reverta credenciais ou revogações. Tokens legados sem `sid` continuam temporariamente válidos apenas sob conferência autoritativa de `tokenVersion`, até expirarem. Migration `0007_identity_authority.sql`. Suíte: **62/62 PASS**. Veja `docs/data/POSTGRES_IDENTITY_AUTHORITY_R0_1.md`.


### v0.9.0-alpha.4.1 — Versioned Commercial Policy

Percentuais econômicos deixaram de ser interpretados como constantes do produto. Comissão de seller/oferta, participação do canal parceiro e split produtor/autor × SceneShop são termos comerciais editáveis e versionados para transações futuras. Cada venda congela `policyId`, `policyVersion`, taxas e valores monetários efetivamente aplicados; alterações posteriores não reescrevem o histórico. Ofertas específicas continuam podendo ter taxas próprias.

Migration `0006_commercial_policies.sql` registra o histórico no PostgreSQL. O estado interno passa a v8 e a suíte fecha em **57/57 testes PASS**. Veja `docs/data/COMMERCIAL_POLICY_R0_1.md`.

### v0.9.0-alpha.4 — PostgreSQL Financial Transactions

Alpha.4 makes the official-order financial path transaction-critical in PostgreSQL. A confirmed partner order now persists the order, attributed sale, frozen commission split, tamper-evident audit entry, compatibility snapshot and outbox event in one database transaction. The database primary key `(seller_id, order_id)` is also the cross-process idempotency barrier.

Commission economics are frozen at sale time (`gross commission`, partner share, owner share and SceneShop share), so future policy changes do not retroactively rewrite historical sales. Migration `0005_financial_transactions.sql` adds `sceneshop_commissions`; legacy sales are upgraded to state version 7 with their economics frozen once. Refunds have a native PostgreSQL transaction path as well.

Validation after alpha.4: **54/54 Node tests PASS**, including deterministic transaction/idempotency tests. Live execution against PostgreSQL remains a release gate because this build environment has no PostgreSQL daemon/container runtime.

### v0.9.0-alpha.3 — PostgreSQL Relational Core

Alpha.3 constructs the real relational PostgreSQL model. In addition to the transitional compatibility snapshot, PostgreSQL now receives normalized rows for identity, works/products, tracks/scenes, sellers/offers, clicks, sales, orders, reports, AML/audit data and events. The same transaction updates both the compatibility snapshot and relational projection.

The Commerce Track foundation is also represented natively in PostgreSQL, including commercial assets, reference media, TARGETED/DISCOVERY/HYBRID analysis jobs, primary detection candidates, isolated redundant verification, operator flags, placements, campaigns and versioned Commerce Track publications.

See `docs/data/POSTGRES_RELATIONAL_SCHEMA_R0_1.md`.

## Rev 0.9 — Data Plane (em desenvolvimento)

A v0.9 começou a separar a lógica de negócio da persistência. O `store` agora atua como uma fachada de compatibilidade e delega I/O para backends em `server/data/`. Desenvolvimento local continua usando `DATA_BACKEND=file`; a direção de produção é PostgreSQL com migrations verificadas por checksum.

Configuração local padrão:

```bash
DATA_BACKEND=file npm start
```

A configuração-alvo de produção usa `DATA_BACKEND=postgres`, `DATABASE_URL`, `SESSION_BACKEND=redis` e `REDIS_URL`. Até a alpha.8, PostgreSQL já cobre as autoridades migradas de identidade/KYC, finanças e conteúdo/Commerce Track, enquanto Redis cobre o realtime efêmero e o Socket.IO distribuído. A execução live PostgreSQL+Redis e a regeneração completa do lockfile são agora gates formais para o 0.9-RC. Consulte `DEVELOPMENT_REVIEW_0.9.md`.

A doutrina do Commerce Track permanece em `docs/architecture/SCENESHOP_COMMERCE_TRACK_R0_1.md`; distribuição/sincronização/comércio multicanal está congelada em `docs/architecture/SCENESHOP_DISTRIBUTION_SYNC_COMMERCE_R0_2.md`.

## Como usar a demonstração

| Ação | Computador | Controle de TV |
| --- | --- | --- |
| Tocar / pausar | Espaço ou clique no vídeo | Play/Pause |
| Produtos da cena | Tecla **P** ou botão "Produtos" | Botão **vermelho** |
| Vincular celular (QR code) | Tecla **Q** ou botão "Celular" | Botão **verde** |
| Navegar na lista | Setas ↑ ↓ e Enter | Setas e OK |
| Fechar | Esc | Voltar |

**Celular:** ele precisa estar **no mesmo Wi-Fi** do computador. Aponte a câmera para o
QR code. A lista abre na cena em que você estava e muda sozinha quando a cena muda.
Toque em outra cena na faixa de miniaturas para ver só os produtos dela; "Voltar ao vivo"
retoma o acompanhamento. O coração guarda o produto em "Salvos".

## Parceiros corporativos e oferta oficial (v4)

**Canal do parceiro:** abra `http://localhost:3000/parceiro/aurora.html`. É um site fictício
de emissora ("Aurora Play") com o player do SceneShop embutido e com a marca dela. O parceiro
só adiciona o SDK ao player que já tem:

```html
<link rel="stylesheet" href="https://SEU-SERVIDOR/css/sdk.css" />
<script src="https://SEU-SERVIDOR/socket.io/socket.io.js"></script>
<script src="https://SEU-SERVIDOR/js/sceneshop-sdk.js"></script>
<script>SceneShop.attach(document.querySelector("video"), { workId: "demo-01", partnerKey: "pk_aurora_demo" });</script>
```

A chave só funciona nos domínios cadastrados do parceiro e nas obras liberadas para ele.

**Oferta oficial com preço garantido:**

1. A produtora indica, no estúdio (aba "Ofertas oficiais"), o vendedor oficial, o preço
   garantido e a comissão de cada produto.
2. No clique em "Comprar", o SceneShop gera um **código de oferta assinado** (Ed25519) e o
   coloca no link: `/loja/urbano-oficial?produto=...&ss_offer=so1....`.
3. A loja confere o código com a chave pública (`GET /api/offers/public-key`) e cobra o preço
   garantido. Lojas sem criptografia podem usar `GET /api/offers/verify?token=...`.
4. A loja avisa o pedido em `POST /api/sellers/:id/orders`, com os cabeçalhos
   `X-SceneShop-Timestamp` e `X-SceneShop-Signature` (HMAC-SHA256 de `timestamp.corpo` com o
   segredo da loja). Corpo: `{ offer, orderId, quantity, unitPrice, status: "pago" | "devolvido" }`.
5. O SceneShop confere e registra a comissão. Se o valor cobrado ficar acima do garantido, o
   pedido é recusado e abre um alerta de compliance contra a loja. O mesmo pedido nunca conta
   duas vezes, e uma devolução estorna a comissão.

**Qualquer loja com acordo, inclusive grandes varejistas (v5).** Com acordo comercial
direto com a produtora, a loja honra o preço de uma destas formas (campo `integration`):

| Integração | Como o preço é aplicado | Confirmação da venda |
| --- | --- | --- |
| `assinatura` | Loja confere o código `ss_offer` | Aviso por pedido (`/orders`) com `offer` |
| `codigos_unicos` | Varejista entrega lote de cupons; cada clique recebe um (`?cupom=`) | Relatório diário (`POST /api/sellers/:id/report`) com `coupon` |
| `link_campanha` | Varejista cria campanha com preço negociado (`?campanha=&ss_ref=`) | Aviso ou relatório com `ref` |

Relatório: `{ orders: [{ orderId, coupon | ref | offer, quantity, unitPrice, orderedAt, status }] }`,
assinado como o aviso. Pedidos de até 45 dias atrás são aceitos se foram feitos dentro da
validade da oferta. Cupom repetido é recusado com alerta. A produtora carrega lotes de cupons e
registra campanhas na aba "Ofertas oficiais". Os varejistas da demo (MegaLoja e ShopCenter) são
fictícios.

As lojas de demonstração (`server/demo-store.js`) fazem exatamente esse papel, por HTTP de verdade.
Ela tem um botão para simular uma loja cobrando acima do garantido.

Os percentuais de comissão, participação do canal/parceiro e split produtor/SceneShop são **termos comerciais editáveis e versionados**. Valores como 12%, 20% ou 50/50 usados na demo são apenas exemplos; cada oferta/contrato pode usar condições diferentes, congeladas na venda para preservar o histórico.

## Duas linhas de implantação

| | Oficial | Comunidade |
| --- | --- | --- |
| Quem cadastra | Equipe SceneShop, depois a própria produtora | Qualquer pessoa, como legendas |
| Selo no app | Oficial (amarelo) | Comunidade (azul) |
| Prioridade | Sempre primeiro | Ordenada pela reputação (votos e denúncias) |
| Divide a comissão com | Produtora | Autor do inventário |

**No player:** tecla **T** (botão amarelo do controle) troca a trilha. Teclas **[** e **]**
ajustam a sincronia em 0,5 s, como uma legenda atrasada. `/?track=ID` abre uma trilha específica.

**No celular:** o espectador vota se a trilha está correta e denuncia produto que não está na cena.

## Estúdio (`http://localhost:3000/studio.html`)

O estúdio exige login. No modo demonstração, a tela de entrada tem atalhos para as contas
de exemplo (senha de todas: `demo1234`):

| Conta | Papel | O que mostra |
| --- | --- | --- |
| `ana` | Autora da comunidade | Trilha bem avaliada, comissões liberadas |
| `produtora` | Produtora parceira | Trilha oficial |
| `promo_x` | Autor da comunidade | Fraude: trilha em revisão e alerta de autocompra |
| `moderador` | Moderação e compliance | Alertas de AML, fila de KYC, denúncias e auditoria |

A conta `produtora` também tem a aba **Ofertas oficiais**.

Qualquer pessoa pode criar uma conta de autor pela própria tela de login.

- **Editor de trilha:** toque o vídeo e clique em "Nova cena a partir daqui" em cada corte.
  Selecione a cena, busque ou cadastre produtos, marque "exato" ou "parecido" e arraste
  sobre a imagem para marcar onde o produto aparece. "Publicar trilha" gera a trilha WebVTT.
- **Ganhos:** comissões de cada venda, por situação:
  - **Em custódia:** retida por 30 dias (cobre devoluções e denúncias).
  - **Congelado:** trilha em revisão por excesso de denúncias.
  - **Aguardando verificação:** prazo cumprido, mas o autor ainda não passou pelo KYC.
  - **Liberado:** disponível para saque. **Estornado:** devolução ou trilha condenada.
  Inclui o formulário de onboarding (KYC/AML) e controles de demonstração
  (simular venda, avançar 30 dias, restaurar dados).
- **Moderação** (só moderador):
  - **Alertas de AML:** autocompra, pico de vendas, comissão elevada, volume mensal e PEP.
    Alerta grave bloqueia o saque sem revelar o motivo ao autor. A decisão fica registrada
    ("sem irregularidade" ou "comunicado ao COAF", com parecer obrigatório).
  - **Fila de KYC:** aprovar ou reprovar cadastros.
  - **Trilhas e denúncias:** peso 3 coloca a trilha em revisão. "Aprovar" devolve ao ar;
    "Condenar" remove e estorna o que estava retido.
  - **Auditoria:** registros encadeados por hash, com verificação de integridade.

## Segurança e antifraude

- **Contas:** senhas com scrypt e sal; sessão por token assinado (HMAC-SHA256, 7 dias);
  cada papel só acessa as próprias rotas. Contas de demonstração ficam marcadas e não autenticam com `DEMO=0`.
- **Sessão TV ↔ celular:** o código de 6 caracteres pode aparecer no QR; o player recebe também uma credencial de controle aleatória, que não é exposta ao celular e é exigida para publicar tempo/trocar trilha.
- **Produção:** com `NODE_ENV=production`, `DEMO` fica desligado por padrão e a inicialização exige `SESSION_SECRET` forte e `PUBLIC_URL` HTTPS.
- **Prova de audiência:** só vota ou denuncia quem entrou pelo QR code de uma sessão ativa
  daquela obra. Um voto por aparelho; denúncia repetida é recusada.
- **Reputação de quem denuncia:** denúncias confirmadas aumentam o peso (até 2); rejeitadas
  diminuem (até 0,25).
- **Cliques e atribuição:** cliques repetidos do mesmo aparelho em 10 min contam uma vez;
  clique sem aparelho nem sessão não gera comissão; a venda só é do autor se vier de clique
  nas últimas 24 h.
- **KYC:** confere dígitos de CPF/CNPJ, maioridade e documento já usado em outra conta.
  O documento é guardado só como hash e mascarado (minimização de dados, LGPD).
- **Limites por IP:** login, cadastro, votos, denúncias e cliques.
- **Auditoria:** login, publicação, moderação, KYC, alertas e saques.

Percentuais de comissão e divisão ficam em `server/config.js` (valores de exemplo).
Os dados da demo ficam em `data/runtime.json`; apague o arquivo para recomeçar.

## Como funciona

```
public/
  index.html            player (simula TV/computador)
  mobile.html           app do celular (segunda tela)
  studio.html           estúdio: trilhas, ganhos, ofertas oficiais e moderação
  parceiro/aurora.html  site fictício de parceiro com o player embutido
  loja.html             página da loja oficial de demonstração
  js/sceneshop-sdk.js   SDK que vai "dentro" de qualquer player <video>
  js/mobile.js          lógica do celular
data/
  catalog.json          obras, cenas, produtos e posição de cada produto na imagem
  demo-01.vtt           exemplo de "legenda invisível" (as trilhas são geradas em /api/tracks/ID.vtt)
  runtime.json          trilhas, votos, denúncias, cliques e vendas (criado ao rodar)
server/
  index.js              API REST + tempo real (Socket.IO)
  sessions.js           sessões TV <-> celular (código de 6 letras, 4 h de validade)
  tracks.js             trilhas oficiais e da comunidade, ranking, votos, denúncias, moderação
  money.js              clique rastreado, comissão, custódia de 30 dias, KYC, saque
  config.js             percentuais, prazo de custódia, limite de denúncias
  store.js              fachada de estado compatível com os módulos atuais
  data/                  Persistence Gateway, adapters e migrations do Data Plane
  auth.js, passwords.js contas, senhas, tokens e papéis
  antifraud.js          prova de audiência, aparelho, limites por IP, cliques
  aml.js                regras de alerta de lavagem de dinheiro
  audit.js              trilha de auditoria encadeada por hash
  partners.js           parceiros corporativos: chave, domínios, obras liberadas, marca
  official.js           oferta garantida: código assinado, cupons, campanhas, avisos e relatórios
  demo-store.js         lojas de demonstração (marca e grandes varejistas)
  catalog.js            leitura do catálogo
  offers.js             motor de ofertas (consulta lojas em paralelo, cache de 1 h)
  adapters/index.js     um adaptador por loja: Amazon, Mercado Livre, Magalu
tools/gen_demo.py       gera o vídeo de demonstração, miniaturas e catálogo
test/unit.test.js       testes das regras (dinheiro, antifraude, AML, auditoria, login)
test/e2e.mjs            teste de ponta a ponta: TV, celular, estúdio, ganhos e moderação
```

- **Trilha invisível:** o SDK adiciona ao vídeo uma trilha de legenda do tipo `metadata`.
  O navegador não mostra nada, mas avisa o SDK a cada troca de cena.
- **Sincronização:** a TV envia o tempo do vídeo 1x por segundo (e na hora, a cada pulo);
  entre um aviso e outro o celular estima o tempo pelo próprio relógio, então a troca de
  cena aparece sem atraso.
- **Preços:** no MVP são **simulados** (variação de -12% a +10% sobre o preço de
  referência). Os botões "Comprar" já abrem uma busca real na loja.

## Marcação com IA (Gemini)

O Gemini assiste ao vídeo da obra e sugere:
- as cenas, pelos cortes de câmera (ou uma cena só);
- os itens compráveis de cada cena (roupas, joias, acessórios, objetos), com a posição na imagem;
- o produto correspondente do seu catálogo, com um grau de certeza.

Você revisa tudo antes de publicar. A revisão mostra o recorte do vídeo de cada item. Itens sem produto no catálogo viram um rascunho de produto com a imagem recortada do vídeo.

**Como ligar:**
1. Crie uma chave gratuita em <https://aistudio.google.com/apikey>.
2. No estúdio, abra **Editor de trilha** com uma obra do piloto e clique em **Conectar Gemini**.
3. Cole a chave. Ela fica só no seu computador, em `data/secrets.json`.
4. Escolha **Dividir pelos cortes** ou **Uma cena só** e clique em **Analisar com Gemini**. Um vídeo curto leva cerca de 1 minuto.
5. Clique em **Revisar sugestões**, confira os itens e clique em **Aplicar selecionados**. Depois publique a trilha.

O vídeo é enviado ao Gemini só para a análise e apagado de lá em seguida. O modelo escolhido é o mais recente disponível na sua chave (Gemini 3, se houver; senão 2.5). Para fixar um modelo, use a variável `GEMINI_MODEL`.

## Roteiro do Piloto (com o seu vídeo e as suas fotos)

O piloto roda inteiro no seu computador: o vídeo e as fotos ficam em `data/uploads/`.

**Antes de começar:** exporte o vídeo em **MP4 (H.264 + áudio AAC)**. É o formato que
qualquer navegador e TV tocam. Arquivos `.mov` de iPhone (HEVC) costumam não abrir no Chrome.
Tenha as fotos dos produtos em JPG, PNG ou WebP (até 15 MB cada). Dê às fotos o nome do
produto (ex.: `Relogio-Aurora-Classic-1.jpg`), porque o nome do arquivo vira o nome sugerido.

1. **Entrar.** Abra `http://localhost:3000/studio.html` e entre como `produtora` / `demo1234`.
2. **Obras → Enviar uma obra.** Escolha o vídeo. O estúdio confere se o navegador consegue
   tocá-lo e mostra a duração. Dê um título e clique em **Enviar**.
3. **Produtos → Cadastrar produtos com as suas fotos.** Selecione as fotos:
   - **Uma foto = um produto** quando cada foto é de um item diferente;
   - **Todas no mesmo produto** quando são vários ângulos do mesmo item (faça um envio por produto).

   Complete nome, marca, categoria, preço de tabela e descrição. Em **Vender no Marketplace
   Piloto**, informe o **preço garantido em cena** e a **comissão**. Na galeria, clique numa
   miniatura para torná-la a foto principal; o × remove.
4. **Obras → Inventariar.** No editor, a trilha nova já começa com **uma cena só**,
   do início ao fim do vídeo (o jeito mais simples para o primeiro piloto):
   - dê um nome à cena, busque cada produto (os seus aparecem primeiro), clique nele e
     **desenhe um retângulo** sobre o objeto na imagem;
   - **Publicar**. A miniatura da cena é capturada do próprio vídeo.

   Quando quiser separar em várias cenas, use **Detectar cortes** (divide automaticamente) ou
   **Nova cena a partir daqui**. O botão **Uma cena só** junta tudo de novo, mantendo os produtos.
5. **Assistir.** O botão *Assistir* abre `/assistir/<sua-obra>`: aperte **P** para os
   produtos e **Q** para o QR code (o celular precisa estar no mesmo Wi-Fi).
6. **Comprar.** No celular (ou na TV), **Comprar** leva ao **Marketplace Piloto** com o
   preço garantido pela produção. De lá: carrinho, checkout, **Pix simulado**, **Simular
   pagamento** e a página do pedido. Em "Nos bastidores do piloto" você vê a loja avisando
   o SceneShop com uma mensagem assinada e a comissão registrada. *Cancelar pedido*
   simula uma devolução e estorna a comissão.
7. **Piloto.** A aba mostra os números da obra:
   - espectadores, abertura do painel, conversão, receita e comissão;
   - o **funil** (assistiu → abriu o painel → levou ao celular → clicou em comprar → comprou);
   - desempenho por **cena** e por **produto**;
   - os pedidos do marketplace.

A vitrine do marketplace fica em `http://localhost:3000/marketplace`. Compras feitas direto
nela, sem vir de uma cena, são vendas comuns: não geram comissão, e o teste confere isso.
"Restaurar demo" (na aba Ganhos) zera a demonstração e **mantém** as obras, os produtos e as
trilhas do piloto.

## Próximos passos (fase 2)

- Amazon real: conta no Programa de Associados + Creators API; preencher
  `AMAZON_CREDENTIAL_ID` e `AMAZON_ASSOCIATE_TAG` e implementar o `TODO` em `server/adapters/index.js`.
- Trocar o `catalog.json` e o `runtime.json` por um banco (PostgreSQL) e as sessões por Redis.
- Login de autores e produtoras; KYC, custódia e repasse via parceiro de pagamentos regulado.
- Vendas reais a partir dos relatórios de conversão de cada programa de afiliados.
- Reconhecimento automático da obra (impressão digital de vídeo/áudio) para o plugin.
- Estúdio de marcação com detecção de objetos por IA (hoje: detecção de cortes + marcação assistida).
- Empacotar o SDK como app Tizen (Samsung) e webOS (LG).

## Variáveis de ambiente

| Variável | Para quê |
| --- | --- |
| `PORT` | Porta do servidor (padrão 3000) |
| `NODE_ENV` | Use `production` no deploy real; ativa os guardas de configuração |
| `SESSION_SECRET` | Chave que assina os logins (obrigatória em produção; mínimo recomendado nesta baseline: 32 caracteres) |
| `DEMO` | `0` desliga contas de exemplo e botões de simulação; em `NODE_ENV=production` o padrão já é desligado |
| `TRUST_PROXY` | `1` somente quando o app estiver atrás de proxy reverso confiável; controla IP real/rate limit |
| `PUBLIC_URL` | Endereço usado no QR code quando publicado na internet (ex.: `https://app.sceneshop.com`) |
| `AMAZON_ASSOCIATE_TAG` | Seu código de afiliado da Amazon |
| `GEMINI_API_KEY` | Chave do Gemini (alternativa a colar no estúdio) |
| `GEMINI_MODEL` | Fixa o modelo do Gemini (padrão: o mais recente da chave) |

## Testes

```
npm test               # regras de negócio (não precisa do servidor)
```

Teste de ponta a ponta (abre navegadores de verdade):

```
npm install -D playwright
npx playwright install chromium
npm start              # em um terminal
npm run test:e2e       # em outro
npm run test:pilot     # roteiro completo do piloto, com 4 cenas (vídeo de teste em test/fixtures/pilot)
npm run test:pilot:one # o mesmo roteiro com a obra inteira em uma cena só

# marcação com IA contra um SIMULADOR do Gemini (não usa a API real):
GEMINI_BASE=http://127.0.0.1:3999 GEMINI_POLL_MS=200 npm start   # em um terminal
npm run test:ai                                                 # em outro
```


### v0.10.0-alpha.3 — RBAC / Team Invitations / MFA

The v0.10 identity layer now includes capability-based organization authorization, cryptographically secure team invitations, TOTP MFA, MFA-enforced tenant write policies, active-session management and Studio UI for team/security administration. See `docs/data/RBAC_INVITES_MFA_R0_1.md`.


## v0.12.0-alpha.1 — Payments & Financial Controls

A camada de pagamentos agora separa fluxos EXTERNAL e MANAGED, usa Payment Intents idempotentes e journal financeiro double-entry imutável. Veja `docs/data/PAYMENTS_FINANCIAL_JOURNAL_R0_1.md`.


## v0.12.0-alpha.2 — Financial Controls

Refunds, chargebacks, settlements, payouts e reconciliação foram adicionados ao Payments Core. O journal permanece double-entry e imutável. Veja `docs/data/PAYMENTS_RECONCILIATION_PAYOUTS_R0_1.md`.

## v0.13.0-alpha.1 — Distribution / Sync / Partner SDK Core

SceneShop now treats YouTube, Instagram, TikTok, owner sites/apps and OTT environments as playback bindings over the same canonical Content/Sync ID. Companion can recognize a temporal fingerprint and create a synchronized second-screen session; Partner-Native/Embedded use a headless browser SDK backed by short-lived scoped tokens. SceneShop still does not host the audiovisual master. See `DEVELOPMENT_REVIEW_0.13.md`.

## v0.13.0-alpha.2 — Governed Platform Connectors & Mobile Core

YouTube, Instagram and TikTok can now be configured as Organization-owned platform connections using secret references instead of raw tokens. Playback bindings may attach to a same-tenant/same-platform connection and refresh metadata through a provider adapter. The Companion PWA accepts shared URLs and the new framework-independent `clients/mobile-core` preserves the canonical Playback Head/Browse Head semantics for the future native app. See `docs/data/DISTRIBUTION_PLATFORM_CONNECTORS_MOBILE_R0_1.md`.

## v0.13 RC preparation

`release/v0.13` is frozen from `v0.13.0-alpha.2`. Local tests and HTTP integration pass; RC promotion remains gated by the strict npm lockfile + live PostgreSQL/Redis/provider validation described in `docs/data/V0_13_RELEASE_GATE_R0_1.md`.

## v0.18.0-alpha.1 — Production Beta Application Surfaces

SceneShop now exposes three explicit consumer applications over the same Commerce Timeline and Companion state machine: `/app` for the zero-install HTML/web application, `/desktop` for the installable desktop surface, and `/mobile` for the touch/Companion surface. All three reuse `mobile-core.js`, `app-core.js`, dynamic Commerce Core resolution and the same governed backend; surface switching preserves session/deep-link context. See `docs/ux/APPLICATION_SURFACES_R0_1.md`.

Alpha.1 uses standalone installable PWAs for desktop/mobile so application behavior can be validated without forking the product logic. Packaged desktop plus iOS/Android wrappers are the next v0.18 increment and must consume the existing native bridge seam rather than reimplement pricing, attribution, placements or synchronization.
