# SceneShop v0.19 — Como rodar (passo a passo)

*Também disponível em inglês (`HOW_TO_RUN.md`) e espanhol (`COMO_EJECUTAR.md`).*

Esta pasta tem tudo o que é preciso para rodar o SceneShop. As bibliotecas (`node_modules`) já vêm incluídas, então você não precisa instalá-las.

Há duas formas de rodar:

| | **A. Demo / Piloto no seu computador** | **B. Produção com Docker** |
|---|---|---|
| Para | Experimentar, fazer apresentações, rodar um piloto com seu próprio vídeo e seus produtos | Uma instalação real em um servidor, para usuários reais |
| Dados | Salvos na pasta `data` | Salvos no PostgreSQL e no Redis (volumes do Docker) |
| Começa com | Contas de exemplo e conteúdo de exemplo | Vazio. Você cria as contas. |
| Tempo para iniciar | Cerca de 1 minuto | Cerca de 10 minutos |

A maioria das pessoas deve começar pela **A**.

---

## Parte A — Demo / Piloto no seu computador

### A1. Windows (caminho recomendado)

1. **Descompacte o pacote.** Clique com o botão direito no arquivo zip e escolha **Extrair Tudo…**. Escolha um local simples, como `C:\SceneShop`.
   - Não rode de dentro do arquivo zip. O Windows não deixa os programas funcionarem direito a partir dali.
   - Se possível, evite pastas sincronizadas com o OneDrive. A sincronização pode deixar os arquivos lentos ou bloqueá-los.
2. **Abra a pasta `SceneShop` extraída.** Dê dois cliques em **`Iniciar SceneShop.bat`**.
3. **Se o Windows mostrar "O Windows protegeu o computador",** clique em **Mais informações** e depois em **Executar assim mesmo**. O arquivo é um script de texto simples; você pode abri-lo no Bloco de Notas para lê-lo.
4. **Só na primeira vez,** se o seu computador não tiver o Node.js 20 ou mais recente, o inicializador baixa uma cópia portátil (cerca de 30 MB) para a pasta `runtime`.
   - Nada é instalado no Windows.
   - Esta etapa precisa de internet uma única vez.
5. **Se o Firewall do Windows perguntar sobre o "Node.js",** clique em **Permitir acesso** e marque **Redes privadas**. Assim o seu celular, na mesma rede Wi-Fi, consegue se conectar pelo QR code.
6. **O navegador abre sozinho** em `http://localhost:3000/studio.html` assim que o servidor estiver pronto. Uma janela preta fica aberta enquanto o SceneShop roda. **Não feche essa janela.**
7. **Para parar o SceneShop,** feche a janela preta.

> Já tem o Node.js 20+ instalado? O inicializador usa essa versão automaticamente e pula o download.

### A2. Mac ou Linux

1. Instale o **Node.js 20 ou mais recente** (a versão LTS) em <https://nodejs.org>.
2. Descompacte o pacote e abra um Terminal na pasta `SceneShop`.
3. Rode:
   ```bash
   chmod +x iniciar.sh
   ./iniciar.sh
   ```
   - No Mac, você também pode renomear `iniciar.sh` para `iniciar.command` e dar dois cliques nele.
4. O navegador abre em `http://localhost:3000/studio.html`.
5. Para parar, pressione **Ctrl+C** no Terminal.

### A3. Entre no Estúdio

A tela de login do Estúdio tem atalhos para as contas de exemplo. Todas usam a senha **`demo1234`**.

| Conta | Papel | Use para |
|---|---|---|
| `produtora` | Produtora (parceira oficial) | Enviar vídeos, cadastrar produtos, inventariar cenas, ver os resultados do piloto |
| `ana` | Autora da comunidade | Ver o lado da comunidade: trilhas e comissões |
| `moderador` | Moderação / compliance | Analisar denúncias, fila de KYC, alertas de prevenção à lavagem de dinheiro, log de auditoria |

Qualquer pessoa também pode criar uma nova conta de autor da comunidade na tela de login.

### A4. Endereços úteis

Todos funcionam enquanto a janela preta (ou o Terminal) estiver aberta.

| Endereço | O que é |
|---|---|
| `http://localhost:3000/studio.html` | Estúdio, o painel de gestão para produtoras, autores e moderadores |
| `http://localhost:3000/` | Player de TV / computador com o vídeo de demonstração |
| `http://localhost:3000/marketplace` | Vitrine do marketplace piloto |

**Atalhos de teclado do player:**

| Tecla | Ação |
|---|---|
| **Espaço** | Reproduzir / pausar |
| **P** | Produtos da cena atual |
| **Q** | QR code para conectar um celular |
| **Setas + Enter** | Navegar |
| **Esc** | Fechar |

### A5. Conecte um celular

1. Deixe o celular na **mesma rede Wi-Fi** do computador.
2. No player, pressione **Q** para mostrar o QR code.
3. Aponte a câmera do celular para o QR code. O celular mostra os produtos da cena que está passando na tela, e a lista se atualiza sozinha quando a cena muda.

Se o celular não conseguir abrir a página, veja a seção Solução de problemas abaixo (firewall).

### A6. Rode um piloto com seu próprio vídeo e seus produtos

1. **Prepare o vídeo.** Exporte em **MP4 (vídeo H.264 + áudio AAC)**. Arquivos `.mov` do iPhone (HEVC) muitas vezes não tocam no Chrome.
2. **Prepare as fotos dos produtos** em JPG, PNG ou WebP, com até 15 MB cada. Dê a cada arquivo o nome do produto, por exemplo `Aurora-Classic-Watch-1.jpg`. O nome do arquivo vira o nome sugerido do produto.
3. **Entre** como `produtora` / `demo1234`.
4. **Envie o vídeo.** Vá em **Obras** → **Enviar uma obra**. Escolha o vídeo, dê um título e clique em **Enviar**.
5. **Cadastre seus produtos.** Vá em **Produtos** e envie as fotos:
   - **Uma foto = um produto** quando cada foto for de um item diferente;
   - **Todas no mesmo produto** quando forem vários ângulos de um mesmo item.

   Depois preencha nome, marca, categoria, preço de tabela e descrição. Em **Vender no Marketplace Piloto**, defina o preço garantido na cena e a comissão.
6. **Inventarie os produtos.** Vá em **Obras** → **Inventariar**. A nova trilha começa com uma única cena.
   - Para cada produto, busque-o, clique nele e **desenhe um retângulo** sobre o objeto no quadro do vídeo.
   - Clique em **Publicar trilha**.
   - Para dividir o vídeo em várias cenas, use **Detectar cortes** ou **Nova cena a partir daqui**.
7. **Assista.** Clique em **Assistir**. Pressione **P** para ver os produtos e **Q** para o QR code do celular.
8. **Compre.** No celular, **Comprar agora** abre o marketplace piloto: carrinho, finalização da compra, pagamento Pix simulado e a página do pedido.
9. **Veja os resultados.** A aba **Piloto** mostra:
   - espectadores e conversão;
   - o funil (assistiu → abriu o painel → enviou ao celular → clicou em comprar → comprou);
   - o desempenho por cena e por produto;
   - os pedidos.

Tudo o que você envia fica no seu computador, em `data/uploads`. O restante dos dados da demo fica em `data/runtime.json`.

### A7. Opcional: inventário com IA usando o Google Gemini

O Gemini pode assistir ao vídeo e sugerir cenas, itens e os produtos correspondentes do seu catálogo. Você revisa cada sugestão antes de publicar.

**Windows (mais fácil):**

1. Crie uma chave gratuita em <https://aistudio.google.com/apikey> (clique em **Criar chave de API** e copie a chave; ela começa com `AIza`).
2. Na pasta `SceneShop`, dê dois cliques em **`Configurar IA Gemini.bat`**.
3. Cole a chave na janela (o botão direito do mouse cola) e pressione Enter. O assistente:
   - verifica a chave com o Google;
   - escolhe um modelo com cota gratuita (`gemini-2.5-flash`);
   - cria o `sceneshop.env` para você.
4. Feche as janelas pretas do SceneShop que estiverem abertas e abra de novo o **`Iniciar SceneShop.bat`**. A janela deve mostrar **"IA Gemini: chave configurada"**.
5. No Estúdio, abra uma trilha no editor e clique em **Analisar com Gemini**. Depois revise as sugestões e aplique as que quiser.

**Mac/Linux, ou manualmente:** crie um arquivo de texto chamado exatamente `sceneshop.env` na pasta `SceneShop` (no Windows, ative **Exibir → Extensões de nomes de arquivos** para que ele não acabe virando `sceneshop.env.txt`) com estas duas linhas, sem espaços em volta do `=` e sem aspas:
```
GEMINI_API_KEY=your-key-here
GEMINI_MODEL=gemini-2.5-flash
```
Depois reinicie o SceneShop.

Por segurança, o SceneShop nunca guarda a chave. Ele só a lê do `sceneshop.env` ou das variáveis de ambiente. Mantenha esse arquivo em sigilo e não o compartilhe.

**Outras configurações que você pode colocar no `sceneshop.env`** (uma por linha):
- `PORT=3001` usa outra porta se a 3000 estiver ocupada.
- `PUBLIC_URL=https://…` define o endereço público usado nos QR codes quando o SceneShop estiver publicado na internet.

### A7b. Idiomas: português, inglês e espanhol

Todas as telas (Estúdio, celular, player de TV, marketplace, lojas) estão disponíveis em **português, inglês e espanhol**.

- O SceneShop abre no idioma do aparelho ou do navegador. Qualquer outro idioma abre em inglês.
- Para trocar, use o **menu de idioma** no topo da tela (no player de TV, no canto superior esquerdo). A escolha fica gravada naquele aparelho.
- Um link pode forçar um idioma com `?lang=pt`, `?lang=en` ou `?lang=es`, por exemplo `http://localhost:3000/mobile?lang=es`.
- O inicializador do Windows e os dois assistentes de configuração falam o idioma do Windows. O conteúdo que você mesmo digita (títulos, nomes de produtos e de cenas) aparece do jeito que você escreveu.

### A8. Restaure a demo

No Estúdio, vá em **Ganhos** e clique em **Restaurar dados da demo**. Isso zera as vendas de exemplo e mantém as obras, os produtos e as trilhas do seu piloto.

Para começar totalmente do zero:
1. Feche o SceneShop.
2. Apague `data/runtime.json` e o conteúdo de `data/uploads`.
3. Inicie o SceneShop de novo.

### A9. Opcional: reconhecer vídeos pelo som (ACRCloud)

Com isso ativado, o espectador abre o SceneShop no celular e toca em **Sincronizar com o que estou assistindo**. O celular escuta por 10 segundos, a ACRCloud reconhece qual vídeo cadastrado está passando e em que segundo, e o celular vai direto para os produtos daquela cena. O QR code e o código de letras continuam funcionando como alternativas.

**1. Configure a ACRCloud** (uma vez, em <https://console.acrcloud.com>):
1. Crie uma conta e confirme seu e-mail.
2. Crie um **bucket** do tipo **Audio & Video** (conteúdo próprio). Anote o **ID** dele (um número) e a região.
3. Crie um **projeto de reconhecimento** (Audio & Video Recognition) e vincule esse bucket a ele. Copie o **Host**, a **Access Key** e o **Access Secret** do projeto.
4. Vá em **Account → Developer settings** e crie um **access token** (usado para cadastrar seus vídeos no bucket).

A ACRCloud é um serviço pago depois do período de teste (ela cobra pelas consultas de reconhecimento e pelo conteúdo armazenado). Confira os preços atuais antes de entrar em produção.

**2. Conecte o SceneShop:**
1. Na pasta `SceneShop`, dê dois cliques em **`Configurar ACRCloud.bat`**.
2. Cole os cinco valores quando forem pedidos. O assistente testa o projeto e o token com a ACRCloud e só então os salva no `sceneshop.env`.
3. Feche as janelas pretas do SceneShop e abra de novo o **`Iniciar SceneShop.bat`**. A janela deve mostrar **"Reconhecimento por audio: ACRCloud configurada"**.

**3. Use:**
- Toda obra nova enviada no Estúdio é mandada automaticamente para a ACRCloud. Em **Obras**, cada obra mostra **"Reconhecimento por áudio: pronto"** quando o celular já consegue reconhecê-la.
- Obras enviadas antes de você configurar a ACRCloud precisam de um clique em **Reconhecimento por áudio** no cartão delas.
- No celular, abra o SceneShop (ou o app Android) e toque em **Sincronizar com o que estou assistindo**.

**Importante:**
- **O microfone do celular só funciona em `https`.** Os navegadores de celular bloqueiam o microfone em endereços `http://` que não sejam o próprio computador; por isso, teste o reconhecimento pelo som com o SceneShop publicado em um endereço `https` (Parte B), ou com o app Android apontando para ele. No próprio computador, `http://localhost:3000/mobile` funciona para um teste rápido.
- **Privacidade:** o trecho de 10 segundos é enviado ao seu servidor SceneShop e à ACRCloud apenas para identificar o vídeo; o SceneShop não o armazena. O microfone só liga quando o espectador toca no botão. Mencione isso na sua política de privacidade (LGPD).
- Se a ACRCloud não reconhecer o trecho, os mesmos 10 segundos são testados no reconhecimento de som próprio do SceneShop (junto com o link do vídeo, se o espectador tiver colado um). Sem a ACRCloud configurada, o botão usa só o reconhecimento próprio, que conhece os vídeos indexados com `tools/build-sync-index.js`.
- O QR code, o código de 6 letras e o link do vídeo continuam funcionando o tempo todo, então o espectador sempre pode escolher o jeito que preferir.

---

## Parte B — Produção com Docker (PostgreSQL + Redis)

Use esta opção para uma instalação real. A produção começa **vazia**: sem contas de demonstração, sem conteúdo de exemplo e sem preços fictícios.

### B1. Requisitos

- **Docker Desktop** (Windows/Mac) ou Docker Engine com Compose (Linux): <https://www.docker.com/products/docker-desktop>
- Para uma publicação na internet: um domínio e um proxy **HTTPS** na frente do SceneShop (por exemplo Caddy, Nginx, Cloudflare ou o balanceador de carga do seu provedor de nuvem).

### B2. Configure

1. Abra um terminal na pasta `SceneShop` (no Windows, use o **PowerShell**).
2. Crie seu arquivo de configuração:
   - Windows: `copy sceneshop.env.example sceneshop.env`
   - Mac/Linux: `cp sceneshop.env.example sceneshop.env`
3. Gere um segredo aleatório:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Se você não tiver o Node.js instalado, qualquer texto aleatório com 32 ou mais caracteres serve.
4. Edite o `sceneshop.env` e defina pelo menos:
   ```
   PUBLIC_URL=https://your-domain.com
   SESSION_SECRET=the-random-secret-from-step-3
   TRUST_PROXY=1
   GEMINI_API_KEY=your-key        # optional, for AI tagging
   # optional, recognize videos by sound (see A9 for where each value comes from):
   ACRCLOUD_HOST=identify-eu-west-1.acrcloud.com
   ACRCLOUD_ACCESS_KEY=...
   ACRCLOUD_ACCESS_SECRET=...
   ACRCLOUD_BUCKET_ID=...
   ACRCLOUD_CONSOLE_TOKEN=...
   ```
   Observações:
   - `PUBLIC_URL` deve começar com `https://`.
   - `SESSION_SECRET` deve ter 32 ou mais caracteres e não pode conter palavras como `example`, `changeme` ou `password`.
   - Mantenha `TRUST_PROXY=1` somente quando houver um proxy HTTPS na frente do SceneShop.
   - Para um teste local rápido do modo produção, você pode deixar esse arquivo sem essas configurações. O Compose tem valores padrão locais seguros, e o app responde em `http://localhost:3000`.

### B3. Inicie

```bash
docker compose up -d --build
```

Na primeira vez, ele baixa o PostgreSQL 16.15 e o Redis 7.4.11 e compila o app, o que leva alguns minutos. As migrações do banco de dados rodam automaticamente.

Confira se está rodando:

```bash
docker compose ps
```

Depois abra <http://localhost:3000/api/health> no navegador. A resposta deve conter `"ok":true`.

### B4. Crie as primeiras contas

Produtoras e moderadores são criados pelo administrador, pela linha de comando. A tela pública de cadastro só cria autores da comunidade.

**Produtora** (isso também cria a organização da produtora):
```bash
docker compose run --rm -e SCENESHOP_NEW_PASSWORD="a-strong-password-12+" app node tools/create-account.js --role=producer --username=o2filmes --name="O2 Filmes" --org="O2 Filmes"
```

**Moderador:**
```bash
docker compose run --rm -e SCENESHOP_NEW_PASSWORD="another-strong-password" app node tools/create-account.js --role=moderator --username=compliance
```

As senhas precisam ter pelo menos 12 caracteres. Os nomes de usuário usam de 3 a 24 letras minúsculas, números ou `_`.

### B5. Cadastre uma loja parceira

Uma loja parceira é um vendedor com acordo comercial. Pare o app antes, porque a lista de lojas é lida na inicialização:

```bash
docker compose stop app
docker compose run --rm app node tools/create-seller.js --id=urbano --name="Urbano&Co Official Store" --cnpj=11.222.333/0001-81 --store-url=https://store.example.com/sceneshop
docker compose start app
```

Troque o `--cnpj` e o `--store-url` de exemplo pelo CNPJ real da loja e pelo endereço **https** real dela. O comando mostra um **segredo de webhook uma única vez**. Entregue-o à loja de forma segura. A loja usa esse segredo para assinar os avisos de pedido enviados para `POST <PUBLIC_URL>/api/sellers/<id>/orders`.

### B6. Operação do dia a dia

| Tarefa | Comando |
|---|---|
| Ver os logs | `docker compose logs -f app` |
| Parar tudo | `docker compose down` (os dados ficam guardados nos volumes do Docker) |
| Iniciar de novo | `docker compose up -d` |
| Atualizar para uma nova versão | Substitua a pasta (mantendo o seu `sceneshop.env`) e rode `docker compose up -d --build` |
| Verificar se está saudável | Abra `http://localhost:3000/api/health` (deve mostrar `"ok":true`) |

> **Atenção:** `docker compose down -v` apaga os volumes, ou seja, **todos os dados**: banco de dados, vídeos e imagens enviados. Faça um backup antes.

### B7. Produção sem Docker (seus próprios servidores)

Você precisa de Node.js 20+, PostgreSQL 16 e Redis 7. Defina estas variáveis de ambiente:

```
NODE_ENV=production
DEMO=0
DATA_BACKEND=postgres
DATABASE_URL=postgres://user:password@host:5432/sceneshop
REDIS_URL=redis://host:6379
SESSION_BACKEND=redis
CACHE_BACKEND=redis
SESSION_SECRET=<32+ random characters>
PUBLIC_URL=https://your-domain.com
TRUST_PROXY=1
```

Depois rode `node server/index.js`. Crie contas e lojas com os mesmos comandos `tools/create-account.js` e `tools/create-seller.js`, sem o prefixo `docker compose run --rm app`.

---

## Solução de problemas

| Problema | Solução |
|---|---|
| A janela abre e fecha na hora | Abra um Prompt de Comando na pasta e rode `"Iniciar SceneShop.bat"` para ler a mensagem de erro. |
| "Nao consegui baixar o Node.js" | Verifique a conexão com a internet, ou instale o Node.js 22 LTS em <https://nodejs.org> e inicie de novo. |
| `EADDRINUSE` / porta 3000 já em uso | Outro programa, ou outra janela do SceneShop, está usando a porta. Feche-o, ou adicione `PORT=3001` ao `sceneshop.env`. |
| O navegador não abriu | Abra `http://localhost:3000/studio.html` manualmente. |
| O celular não consegue abrir o link do QR code | Confira se o celular está na mesma rede Wi-Fi (e não nos dados móveis ou numa rede de convidados). Permita o **Node.js** no Firewall do Windows (Painel de Controle → Firewall do Windows Defender → Permitir um aplicativo). |
| O vídeo não toca | Exporte de novo em MP4 (H.264 + AAC). |
| O botão de IA diz que o Gemini não está configurado | Rode o `Configurar IA Gemini.bat` de novo, depois feche **todas** as janelas do SceneShop e reinicie. A janela de início deve mostrar "IA Gemini: chave configurada". |
| Erro do Gemini mencionando "quota" ou 429 | Sua chave não tem cota gratuita para o modelo escolhido. Confira se o `sceneshop.env` tem `GEMINI_MODEL=gemini-2.5-flash` (o assistente adiciona essa linha). |
| O celular diz que o microfone não está disponível | A página precisa estar em `https` (ou em `localhost`, no próprio computador). No app Android, permita o microfone quando for pedido. |
| "Conteúdo não reconhecido" | Confira se a obra mostra "Reconhecimento por áudio: pronto" no Estúdio, aproxime o celular do alto-falante e tente de novo com menos barulho ao redor. |
| Docker: o app reinicia com erros de "SESSION_SECRET" ou "PUBLIC_URL" | Corrija esses valores no `sceneshop.env` (veja B2) e rode `docker compose up -d` de novo. |
| Docker: "port is already allocated" | Pare a demo local (feche a janela preta) ou o que mais estiver usando a porta 3000. |

---

## O que há nesta pasta

| Item | Para que serve |
|---|---|
| `Iniciar SceneShop.bat` | Inicializador para Windows |
| `iniciar.sh` | Inicializador para Mac/Linux |
| `Configurar IA Gemini.bat` | Assistente que configura a chave da IA Gemini |
| `Configurar ACRCloud.bat` | Assistente que conecta a ACRCloud (reconhecer vídeos pelo som) |
| `sceneshop.env.example` | Modelo de configuração (chave da IA, porta, endereço público) |
| `server/`, `public/`, `node_modules/` | A aplicação e suas bibliotecas |
| `data/` | Dados da demo/piloto e os seus envios (modo local) |
| `Dockerfile`, `compose.yaml` | Produção com Docker |
| `tools/` | Comandos do administrador (criar contas e lojas) e ferramentas de release |
| `apps/`, `clients/` | Código-fonte dos apps para computador, Android e iOS |
| `test/` | Testes automatizados (para desenvolvedores) |
| `README.md` | Documentação técnica completa (em português) |

**Versão:** SceneShop v0.19.0-rc.1, build de preparação rcprep.8. O commit exato está em `V0_19_RCPREP8_CANDIDATE_IDENTITY.json`.
