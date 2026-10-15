# SceneShop Payments & Financial Journal R0.1

## Objetivo
A v0.12 introduz uma camada de pagamentos neutra em relação ao adquirente. O SceneShop distingue venda/pagamento externo de fluxo gerenciado por gateway integrado e não presume que toda receita bruta passa por contas SceneShop.

## Modos de conexão
- `EXTERNAL`: marketplace/loja confirma pagamento externamente. O SceneShop registra estado e atribuição, mas não cria lançamentos de custódia.
- `MANAGED`: um gateway integrado processa recursos em nome do fluxo configurado. A captura pode gerar journal financeiro balanceado.

## Payment Intent
Cada intenção possui chave de idempotência por organização, valor/moeda, conexão, referências opcionais à resolução/ativação/pedido/venda e estado controlado.

Estados: `PENDING`, `REQUIRES_ACTION`, `AUTHORIZED`, `CAPTURED`, `FAILED`, `CANCELED`, `PARTIALLY_REFUNDED`, `REFUNDED`, `DISPUTED`.

## Eventos
Eventos de provider são únicos por `(connection_id, provider_event_id)`. Reentrega do mesmo webhook não cria segunda captura ou journal duplicado. O corpo recebido é representado por SHA-256 para auditoria.

## Journal financeiro
O journal é double-entry. Toda transação exige soma de débitos igual à soma de créditos. Registros postados são append-only no PostgreSQL: `UPDATE`/`DELETE` são bloqueados por trigger; correções devem ser lançamentos reversores.

No fluxo `MANAGED`, uma captura inicial registra:
- débito `PROCESSOR_RECEIVABLE`
- crédito `MERCHANT_GROSS_PAYABLE`

Esse lançamento representa custódia/clearing apenas quando a conexão foi explicitamente configurada como `MANAGED`.

## Segurança
Operações administrativas de pagamentos exigem capability comercial e MFA forte. Secrets de providers não devem ser armazenados diretamente em payloads públicos; `credentials_ref` é a referência prevista para secret management.

## Próxima etapa
Alpha.2: reconciliação, refund/chargeback reversals, settlement/payout controls e painel operacional.
