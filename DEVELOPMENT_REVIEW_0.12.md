# SceneShop Development Review — v0.12

## v0.12.0-alpha.1 — Payments & Immutable Journal
- Payment Provider abstrato e independente de marketplace.
- Conexões `EXTERNAL` e `MANAGED`.
- Payment Intent com Idempotency-Key.
- Eventos idempotentes por provider event.
- Journal double-entry, append-only no PostgreSQL.
- Captura MANAGED cria clearing; EXTERNAL não finge custódia.
- Migration `0017_payments_financial_journal.sql`.
- Validação: 125/125 testes PASS.

## v0.12.0-alpha.2 — Reconciliation, Refunds, Settlements & Payouts
- Refund request idempotente e reversão somente após confirmação do provider.
- Chargeback/dispute com movimentos reversores.
- Settlement `gross = net + fees` com `BANK_CASH`, `PROCESSOR_FEES` e `PROCESSOR_RECEIVABLE`.
- Payout limitado por saldo a pagar e caixa efetivamente liquidado.
- Reconciliação com MATCHED / AMOUNT_MISMATCH / MISSING / UNEXPECTED.
- SHA-256 da fonte conciliada.
- APIs e visão operacional no Studio.
- Migration `0018_reconciliation_refunds_payouts.sql`.
- Validação: 130/130 testes + 62/62 checks HTTP PASS.

## Release gate
O código v0.12 está funcionalmente fechado em alpha.2. O próximo estado é RC preparation. Os gates externos herdados permanecem: lockfile transitivo completo via npm e validação live PostgreSQL/Redis em ambiente com serviços disponíveis.

## RC preparation
A branch `release/v0.12` contém workflow de CI com PostgreSQL 16.15 + Redis 7.4.11. Nenhuma alpha.3 será aberta; a próxima tag será RC.1 somente após os gates externos.
