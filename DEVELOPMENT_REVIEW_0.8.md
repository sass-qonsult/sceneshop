# SceneShop — Development Review / Baseline v0.8.0

## Estado encontrado

O pacote recebido já é um MVP funcional, não apenas uma prova visual. Ele contém player/SDK, segunda tela via QR/Socket.IO, estúdio, trilhas oficial e comunidade, catálogo, marketplace de piloto, ofertas assinadas Ed25519, conciliação de pedidos com HMAC, KYC/AML demonstrativo, antifraude, auditoria encadeada e marcação assistida por Gemini.

Validação inicial do pacote original:
- 36/36 testes unitários: PASS.
- testes E2E e do piloto: não iniciaram porque `playwright` não está instalado/declarado no pacote; o README orienta instalação manual.
- `package.json` estava em 0.7.0, enquanto a raiz do `package-lock.json` ainda marcava 0.1.0.

## Alterações desta baseline v0.8.0

1. Controle TV ↔ celular separado do código público de sessão.
   - `sessions.create()` gera `controllerToken` criptograficamente aleatório.
   - `publicView()` nunca expõe o token.
   - `POST /api/sessions` entrega o token somente ao player criador.
   - `tv:attach` exige código + token.
   - troca de trilha via socket é limitada à mesma obra e não aceita trilha removida.
   - o tempo recebido do player é limitado à duração da obra.

2. Modo produção mais seguro.
   - `DEMO` continua ligado por padrão em desenvolvimento local.
   - em `NODE_ENV=production`, o padrão passa a ser `DEMO=false`.
   - inicialização em produção exige `SESSION_SECRET` com pelo menos 32 caracteres e `PUBLIC_URL` HTTPS.
   - credenciais seed da demonstração são marcadas com `demo: true` e não autenticam quando `DEMO=0`, inclusive em runtimes antigos migrados.

3. Rate limit / proxy.
   - o servidor deixa de confiar diretamente em `X-Forwarded-For` fornecido pelo cliente.
   - `req.ip` passa a ser a origem, respeitando `trust proxy` apenas quando `TRUST_PROXY=1`.

4. Operação.
   - endpoint `GET /api/health` para health check do deploy.
   - versão sincronizada em `package.json` e `package-lock.json` para 0.8.0.

5. Testes.
   - novo teste garante que o QR público não contém a credencial de controle e que tokens falsos não controlam a sessão.
   - 37/37 testes unitários: PASS.

## Pontos fortes da arquitetura atual

- Separação de módulos de negócio razoavelmente boa para o tamanho do MVP (`auth`, `tracks`, `money`, `official`, `aml`, `audit`, `pilot`, `ai`).
- Assinatura Ed25519 das ofertas e HMAC para webhooks são escolhas coerentes para o modelo de integração.
- Idempotência de pedidos por vendedor + `orderId` e tratamento de devolução já estão modelados.
- Persistência atômica do JSON reduz risco de arquivo truncado no MVP.
- O fluxo de piloto cobre a cadeia inteira: obra → inventário → sessão → clique → compra → comissão → painel.
- Testes unitários cobrem regras importantes de dinheiro, KYC, AML, ofertas e moderação.

## Riscos que ainda impedem classificar o código como production-ready

### P0 — antes de dinheiro/usuários reais
- Persistência em `runtime.json`: não oferece transação, concorrência, isolamento ou escala horizontal. Migrar para PostgreSQL.
- Sessões Socket.IO apenas em memória: migrar para Redis + adapter do Socket.IO antes de múltiplas instâncias.
- Identidade: autores podem se cadastrar, mas provisionamento seguro de `producer`/`moderator`, MFA/2FA, recuperação de conta e rotação de sessão ainda não existem.
- Segredos: chaves de vendedor e chave privada Ed25519 vivem no estado local. Migrar para secret manager/KMS/HSM ou, no mínimo, variáveis/arquivos de segredo separados com rotação.
- Pagamentos/KYC/AML atuais são uma simulação de produto. Para operação real, integrar PSP/KYC regulado e transformar regras AML em política validada por jurídico/compliance.

### P1 — segurança e integridade de plataforma
- CORS do Socket.IO ainda está aberto (`origin: "*"`). Criar política baseada em origens próprias/parceiros.
- A chave de parceiro vive no JavaScript do parceiro e funciona essencialmente como identificador + restrição de domínio; para distribuição real, adotar tokens curtos/assinados para obra/sessão.
- Endpoints de VTT/metadata precisam de estratégia de autorização compatível com `<track>` e parceiros; hoje os IDs funcionam como parte da descoberta.
- `localStorage` guarda o bearer token do Estúdio. Migrar para sessão segura com cookie HttpOnly/Secure/SameSite ou BFF, reduzindo impacto de XSS.
- Adicionar CSP robusta e revisão sistemática dos usos de `innerHTML`.
- Upload de mídia valida assinatura inicial, mas produção deve incluir varredura, transcodificação isolada, storage de objetos, limites por conta e lifecycle.

### P1 — confiabilidade
- Tornar Playwright dependência de desenvolvimento versionada e executar E2E em CI.
- Acrescentar testes de API/Socket para autorização da TV, reconexão, expiração e corrida entre dispositivos.
- Testar webhooks com replay, concorrência e pedidos simultâneos.
- Introduzir logging estruturado, request-id/correlation-id, métricas e tracing.
- Graceful shutdown e readiness separada de liveness.

### P2 — evolução funcional
- Adaptadores reais de varejo (começando por uma integração-piloto, não várias simultaneamente).
- Motor de correspondência produto↔cena com revisão humana, versionamento de modelo e trilha de proveniência.
- Gestão de catálogo multi-tenant, variações/SKUs e disponibilidade por região.
- Painel analítico com eventos append-only e agregações assíncronas, em vez de derivar tudo do estado principal.
- Apps/SDKs específicos para Tizen/webOS depois de estabilizar contrato de API e telemetria.

## Sequência recomendada de desenvolvimento

### Rev 0.9 — Data Plane
PostgreSQL + migrações + repositories; Redis para sessão/cache; IDs estáveis; transações em pedido/comissão; seed da demo separado de dados reais.

### Rev 0.10 — Identity & Tenant
Organizações/produtoras, membership, papéis, convites, MFA para producer/moderator, sessão HttpOnly, recuperação e auditoria de autenticação.

### Rev 0.11 — Commerce Integrity
Segredos fora do banco principal, rotação de chaves, webhook replay protection persistente, ledger append-only, reconciliação e modelo de payout externo.

### Rev 0.12 — Partner/SDK Gateway
Tokens de sessão/obra de curta duração, CORS/origin policy, SDK versionado, telemetry contract e autorização segura de metadata/VTT.

### Rev 0.13 — AI/Content Pipeline
Jobs persistentes, fila, transcodificação, frame extraction, model provenance, revisão humana e métricas de qualidade por categoria.

### Rev 0.14 — Pilot Production
Observabilidade, CI/CD, backups, restore testado, staging, load test, privacy/LGPD controls e runbooks.

## Próximo incremento indicado

O maior ganho técnico agora é a Rev 0.9: separar domínio de persistência e substituir `runtime.json` por PostgreSQL sem quebrar os módulos existentes. A abordagem deve preservar as APIs públicas e introduzir repositories por trás de `store`, reduzindo o risco de uma reescrita total.
