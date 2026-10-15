# SceneShop v0.12 RC Gate R0.1

A v0.12 não abre alpha.3. A linha de release nasce após `v0.12.0-alpha.2`.

## Gates locais concluídos
- 130/130 testes unitários/contratuais.
- 62/62 checks HTTP reais.
- 18 migrations contíguas.
- Preflight local PASS.
- Payment/financial journal, refunds, chargebacks, settlements, payouts e reconciliation implementados.

## Gates externos obrigatórios para RC
1. `npm ci` com lockfile transitivo completo (`pg`, `redis`, `@socket.io/redis-adapter`).
2. PostgreSQL 16.15 real com migrations 0001–0018.
3. Redis 7.4.11 real, incluindo realtime/session validation.
4. `npm run preflight:rc` PASS.
5. `npm run validate:live` PASS.

A tag `v0.12.0-RC.1` só deve existir depois desses gates.
