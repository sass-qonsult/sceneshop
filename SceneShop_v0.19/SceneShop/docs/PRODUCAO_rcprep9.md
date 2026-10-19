# SceneShop v0.19 rcprep.9 — colocar em produção (sem demonstração)

## 1. Antes de atualizar
- Faça backup do banco: `docker compose exec postgres pg_dump -U sceneshop sceneshop > backup-antes-rcprep9.sql`
- Esta versão começa **limpa**: as contas e dados de demonstração não são usados com `DEMO=0`.
  Para apagar também os dados de teste que você já cadastrou: `docker compose down -v` (apaga banco, Redis e vídeos enviados).

## 2. Configuração (`sceneshop.env`, ao lado do compose.yaml)
```
PUBLIC_URL=https://sceneshop.qonsult.cc
SESSION_SECRET=<openssl rand -hex 32>
TRUST_PROXY=1
GEMINI_API_KEY=<chave do Google AI Studio>
```
O reconhecimento pelo som é do próprio SceneShop (**SceneShop ID**) e não precisa de chave: cada obra é indexada no envio
e o índice fica em `data/uploads/audioid` (mesmo volume dos vídeos — mantenha esse volume no backup).
A ACRCloud passa a ser **opcional**, só como reserva. Se quiser mantê-la, acrescente:
```
ACRCLOUD_HOST=identify-<região>.acrcloud.com
ACRCLOUD_ACCESS_KEY=...
ACRCLOUD_ACCESS_SECRET=...
ACRCLOUD_BUCKET_ID=...
ACRCLOUD_CONSOLE_TOKEN=...
```
(`SCENESHOP_AUDIO_ID=acrcloud` faz a ACRCloud ser tentada primeiro.)
Não deixe `DEMO=1` no arquivo. Troque também a senha do PostgreSQL do compose (`sceneshop_dev_only`) se o banco estiver exposto.

## 3. Subir
```
docker compose up -d postgres redis
docker compose build app
docker compose run --rm app node tools/criar-admin.js --usuario miguel --nome "Miguel" --empresa "SceneShop"
docker compose up -d app
```
`criar-admin.js` pede a senha (mín. 10 caracteres) e cria: conta de produtora, organização (tipo PRODUCER, você como OWNER) e acesso às telas de Moderação. Rodar de novo com o mesmo usuário troca a senha.

## 4. Proxy reverso (nginx)
Vídeos podem ter vários GB. No nginx: `client_max_body_size 4g; proxy_request_buffering off; proxy_read_timeout 3600s;`

## 5. Conferir
- `https://sceneshop.qonsult.cc/api/health` → `"demo": false`, `"backend": "postgres"`.
- Na aba Obras, cada título mostra **"Reconhecimento pelo som (SceneShop ID): pronto"** depois de alguns segundos. Títulos que já existiam são indexados sozinhos quando o app sobe; se algum ficar sem índice, use **Indexar agora**.
- Entrar no Studio com o administrador: abas Obras, Produtos, Editor de trilha, IA & Publicação, Ganhos, Ofertas oficiais, Desempenho, Equipe & Segurança e Moderação.

## 6. Conectar a loja oficial (cupom por clique + leitura dos pedidos)
No Studio, em Ofertas oficiais → Cadastrar/Editar loja, escolha a plataforma (VTEX, Shopify ou Nuvemshop), a conta e o desconto do cupom.
As chaves ficam **só** no `sceneshop.env`, com o prefixo `SCENESHOP_LOJA_<ID DA LOJA>` (o cartão da loja mostra os nomes exatos):

| Plataforma | Variáveis | O que pedir à loja |
| --- | --- | --- |
| VTEX | `_KEY` (AppKey) e `_TOKEN` (AppToken) | Chave de API com acesso a OMS (leitura de pedidos) e Promoções/Cupons; uma promoção "SceneShop" com condição utm_source = sceneshop e o desconto combinado |
| Shopify | `_TOKEN` (Admin API access token) | App personalizado com `read_orders`, `write_price_rules`, `write_discounts` |
| Nuvemshop | `_TOKEN` (access token) | App com permissão de pedidos (leitura) e cupons (escrita) |
| Awin | `_TOKEN` (token da API de publisher, em ui.awin.com → API Credentials) | Nada da loja: o SceneShop entra como publisher no programa da marca na Awin. Conta = ID do publisher SceneShop; anunciante = awinmid da marca |

Depois de editar o `sceneshop.env`: `docker compose up -d app`. No cartão da loja: **Testar conexão** e **Ler pedidos agora**.
A leitura automática roda a cada 10 minutos (`SCENESHOP_STORE_SYNC_MINUTES`).

Marcas grandes como **JBL** (site em Salesforce Commerce Cloud) e **Oakley** (SAP Commerce) não abrem cupom nem pedidos a terceiros: o caminho é o programa de afiliados delas na **Awin**. O link de cada clique leva `clickref=<referência>` e o SceneShop lê as transações pela API da Awin (pendente/aprovada = venda; recusada = estorno).

Marketplaces (Mercado Livre, Amazon, Magalu): escolha "Marketplace: programa de afiliados", use o link de afiliado como link do produto e importe o CSV do relatório do programa no cartão da loja.
