# SceneShop Payments Reconciliation, Refunds & Payouts R0.1

## Escopo
A alpha.2 fecha os controles financeiros do Passo 4/11 sem pressupor que SceneShop seja banco ou adquirente.

## Refunds e chargebacks
Refund é solicitado de forma idempotente e só afeta o journal quando o provider confirma `REFUND_SUCCEEDED`. Em fluxo MANAGED, a confirmação cria lançamento reversor do valor efetivamente devolvido. Chargeback abre estado `DISPUTED`; o journal representa a retirada do valor. Caso o dispute seja ganho, um lançamento reversor restaura a posição. O histórico original nunca é editado.

## Settlements
Settlement MANAGED exige `gross = net + fees`.
Journal:
- DEBIT `BANK_CASH` = net
- DEBIT `PROCESSOR_FEES` = fees
- CREDIT `PROCESSOR_RECEIVABLE` = gross

## Payouts
Payout só pode ser solicitado até o menor entre:
1. saldo credor de `MERCHANT_GROSS_PAYABLE` da organização; e
2. caixa liquidado em `BANK_CASH`.

Ao ser marcado como pago:
- DEBIT `MERCHANT_GROSS_PAYABLE`
- CREDIT `BANK_CASH`

## Reconciliation
Um batch compara transações capturadas do SceneShop com linhas reportadas pelo provider dentro de uma janela. Cada item recebe um dos estados:
- `MATCHED`
- `AMOUNT_MISMATCH`
- `MISSING`
- `UNEXPECTED`

O batch grava SHA-256 da fonte, totais, diferença e quantidade de exceções.

## Studio
O Studio passa a exibir saldos operacionais, settlements, payouts e conciliações. Escritas financeiras exigem MFA forte.

## Imutabilidade
O journal continua append-only. Correções são novas transações. Triggers PostgreSQL impedem `UPDATE`/`DELETE` dos lançamentos postados.
