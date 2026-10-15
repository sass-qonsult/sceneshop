# SceneShop v0.19 — How to Run (Step by Step)

This folder has everything needed to run SceneShop. The libraries (`node_modules`) are already included, so you do not need to install them.

There are two ways to run it:

| | **A. Demo / Pilot on your computer** | **B. Production with Docker** |
|---|---|---|
| For | Trying it out, presentations, running a pilot with your own video and products | A real installation on a server, for real users |
| Data | Saved in the `data` folder | Saved in PostgreSQL and Redis (Docker volumes) |
| Starts with | Sample accounts and sample content | Empty. You create the accounts. |
| Time to start | About 1 minute | About 10 minutes |

Most people should start with **A**.

---

## Part A — Demo / Pilot on your computer

### A1. Windows (recommended path)

1. **Unzip the package.** Right-click the zip file and choose **Extract All…**. Pick a simple location such as `C:\SceneShop`.
   - Do not run it from inside the zip file. Windows does not let programs run correctly from there.
   - Avoid OneDrive-synced folders if possible. Syncing can slow down or lock files.
2. **Open the extracted `SceneShop` folder.** Double-click **`Iniciar SceneShop.bat`** ("Start SceneShop").
3. **If Windows shows "Windows protected your PC",** click **More info**, then **Run anyway**. The file is a plain text script; you can open it in Notepad to read it.
4. **The first time only,** if your computer does not have Node.js 20 or newer, the launcher downloads a portable copy (about 30 MB) into the `runtime` folder.
   - Nothing is installed in Windows itself.
   - This step needs internet access once.
5. **If Windows Firewall asks about "Node.js",** click **Allow access** and tick **Private networks**. This lets your phone, on the same Wi-Fi, connect by QR code.
6. **The browser opens by itself** on `http://localhost:3000/studio.html` once the server is ready. A black window stays open while SceneShop runs. **Do not close it.**
7. **To stop SceneShop,** close the black window.

> Already have Node.js 20+ installed? The launcher uses it automatically and skips the download.

### A2. Mac or Linux

1. Install **Node.js 20 or newer** (the LTS version) from <https://nodejs.org>.
2. Unzip the package and open a Terminal in the `SceneShop` folder.
3. Run:
   ```bash
   chmod +x iniciar.sh
   ./iniciar.sh
   ```
   - On a Mac you can instead rename `iniciar.sh` to `iniciar.command` and double-click it.
4. The browser opens on `http://localhost:3000/studio.html`.
5. To stop, press **Ctrl+C** in the Terminal.

### A3. Sign in to the Studio

The Studio sign-in screen has shortcuts for the sample accounts. All of them use the password **`demo1234`**.

| Account | Role | Use it to |
|---|---|---|
| `produtora` | Producer (official partner) | Upload videos, register products, tag scenes, see pilot results |
| `ana` | Community author | See the community side: tracks and commissions |
| `moderador` | Moderation / compliance | Review reports, KYC queue, anti-money-laundering alerts, audit log |

Anyone can also create a new community author account from the sign-in screen.

### A4. Useful addresses

All of these work while the black window (or Terminal) is open.

| Address | What it is |
|---|---|
| `http://localhost:3000/studio.html` | Studio, the back office for producers, authors and moderators |
| `http://localhost:3000/` | TV / desktop player with the demo video |
| `http://localhost:3000/marketplace` | Pilot marketplace storefront |

**Player keyboard shortcuts:**

| Key | Action |
|---|---|
| **Space** | Play / pause |
| **P** | Products in the current scene |
| **Q** | QR code to link a phone |
| **Arrows + Enter** | Navigate |
| **Esc** | Close |

### A5. Connect a phone

1. Keep the phone on the **same Wi-Fi** as the computer.
2. In the player, press **Q** to show the QR code.
3. Point the phone camera at the QR code. The phone shows the products of the scene playing on screen, and the list updates by itself when the scene changes.

If the phone cannot open the page, see the Troubleshooting section below (firewall).

### A6. Run a pilot with your own video and products

1. **Prepare the video.** Export it as **MP4 (H.264 video + AAC audio)**. iPhone `.mov` files (HEVC) often do not play in Chrome.
2. **Prepare the product photos** as JPG, PNG or WebP, up to 15 MB each. Name each file after the product, for example `Aurora-Classic-Watch-1.jpg`. The file name becomes the suggested product name.
3. **Sign in** as `produtora` / `demo1234`.
4. **Upload the video.** Go to **Obras** (Works) → **Enviar uma obra** (Upload a work). Choose the video, give it a title and click **Enviar** (Send).
5. **Register your products.** Go to **Produtos** (Products) and upload the photos:
   - **Uma foto = um produto** (one photo = one product) when each photo is a different item;
   - **Todas no mesmo produto** (all in the same product) when they are several angles of one item.

   Then fill in the name, brand, category, list price and description. Under **Vender no Marketplace Piloto** (sell in the pilot marketplace), set the guaranteed in-scene price and the commission.
6. **Tag the products.** Go to **Obras** → **Inventariar** (Inventory). The new track starts as one single scene.
   - For each product, search it, click it and **draw a rectangle** over the object in the video frame.
   - Click **Publicar** (Publish).
   - To split the video into several scenes, use **Detectar cortes** (Detect cuts) or **Nova cena a partir daqui** (New scene from here).
7. **Watch.** Click **Assistir** (Watch). Press **P** for products and **Q** for the phone QR code.
8. **Buy.** On the phone, **Comprar** (Buy) opens the pilot marketplace: cart, checkout, simulated Pix payment and the order page.
9. **See the results.** The **Piloto** tab shows:
   - viewers and conversion;
   - the funnel (watched → opened panel → sent to phone → clicked buy → bought);
   - performance by scene and by product;
   - the orders.

Everything you upload stays on your computer, in `data/uploads`. The rest of the demo data is in `data/runtime.json`.

### A7. Optional: AI tagging with Google Gemini

Gemini can watch the video and suggest scenes, items and matching products from your catalog. You review every suggestion before publishing.

1. Create a free key at <https://aistudio.google.com/apikey>.
2. In the `SceneShop` folder, copy **`sceneshop.env.example`** and rename the copy to **`sceneshop.env`**.
   - On Windows, turn on **View → File name extensions** first, so the file does not end up named `sceneshop.env.txt`.
3. Open `sceneshop.env` in Notepad and add this line, using your own key:
   ```
   GEMINI_API_KEY=your-key-here
   ```
4. Save the file, close the black window and start SceneShop again.
5. In the Studio, open a track in the editor and click **Analisar com Gemini** (Analyze with Gemini). Then review the suggestions and apply the ones you want.

For security, SceneShop never stores the key itself. It only reads it from `sceneshop.env` or from the environment. Keep this file private and do not share it.

**Other settings you can put in `sceneshop.env`** (one per line):
- `PORT=3001` uses another port if 3000 is busy.
- `PUBLIC_URL=https://…` sets the public address used in QR codes when SceneShop is published on the internet.

### A8. Reset the demo

In the Studio, go to **Ganhos** (Earnings) and click **Restaurar dados da demo** (Restore demo data). This resets the sample sales and keeps your pilot works, products and tracks.

To start completely from zero:
1. Close SceneShop.
2. Delete `data/runtime.json` and the contents of `data/uploads`.
3. Start SceneShop again.

---

## Part B — Production with Docker (PostgreSQL + Redis)

Use this for a real installation. Production starts **empty**: no demo accounts, no sample content and no fake prices.

### B1. Requirements

- **Docker Desktop** (Windows/Mac) or Docker Engine with Compose (Linux): <https://www.docker.com/products/docker-desktop>
- For a public deployment: a domain name and an **HTTPS** proxy in front of SceneShop (for example Caddy, Nginx, Cloudflare or your cloud provider's load balancer).

### B2. Configure

1. Open a terminal in the `SceneShop` folder (on Windows, use **PowerShell**).
2. Create your settings file:
   - Windows: `copy sceneshop.env.example sceneshop.env`
   - Mac/Linux: `cp sceneshop.env.example sceneshop.env`
3. Generate a random secret:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   If you do not have Node.js installed, any random text of 32+ characters works.
4. Edit `sceneshop.env` and set at least:
   ```
   PUBLIC_URL=https://your-domain.com
   SESSION_SECRET=the-random-secret-from-step-3
   TRUST_PROXY=1
   GEMINI_API_KEY=your-key        # optional, for AI tagging
   ```
   Notes:
   - `PUBLIC_URL` must start with `https://`.
   - `SESSION_SECRET` must be 32+ characters and must not contain words such as `example`, `changeme` or `password`.
   - Keep `TRUST_PROXY=1` only when an HTTPS proxy sits in front of SceneShop.
   - For a quick local test of production mode, you can leave this file without these settings. Compose has safe local defaults, and the app answers on `http://localhost:3000`.

### B3. Start

```bash
docker compose up -d --build
```

The first run downloads PostgreSQL 16.15 and Redis 7.4.11 and builds the app, which takes a few minutes. Database migrations run automatically.

Check that it is running:

```bash
docker compose ps
```

Then open <http://localhost:3000/api/health> in a browser. It should answer with `"ok":true`.

### B4. Create the first accounts

Producers and moderators are created by the administrator, from the command line. The public sign-up screen only creates community authors.

**Producer** (this also creates the producer's organization):
```bash
docker compose run --rm -e SCENESHOP_NEW_PASSWORD="a-strong-password-12+" app node tools/create-account.js --role=producer --username=o2filmes --name="O2 Filmes" --org="O2 Filmes"
```

**Moderator:**
```bash
docker compose run --rm -e SCENESHOP_NEW_PASSWORD="another-strong-password" app node tools/create-account.js --role=moderator --username=compliance
```

Passwords need at least 12 characters. Usernames use 3 to 24 lowercase letters, numbers or `_`.

### B5. Register a partner store

A partner store is a seller with a commercial agreement. Stop the app first, because the store list is read at start-up:

```bash
docker compose stop app
docker compose run --rm app node tools/create-seller.js --id=urbano --name="Urbano&Co Official Store" --cnpj=11.222.333/0001-81 --store-url=https://store.example.com/sceneshop
docker compose start app
```

Replace the sample `--cnpj` and `--store-url` with the store's real CNPJ and its real **https** address. The command prints a **webhook secret once**. Give it to the store securely. The store uses it to sign its order notifications to `POST <PUBLIC_URL>/api/sellers/<id>/orders`.

### B6. Daily operations

| Task | Command |
|---|---|
| See logs | `docker compose logs -f app` |
| Stop everything | `docker compose down` (data is kept in Docker volumes) |
| Start again | `docker compose up -d` |
| Update to a new version | Replace the folder (keep your `sceneshop.env`), then `docker compose up -d --build` |
| Check that it is healthy | Open `http://localhost:3000/api/health` (should show `"ok":true`) |

> **Warning:** `docker compose down -v` deletes the volumes, which means **all data**: database, uploaded videos and images. Back up first.

### B7. Production without Docker (your own servers)

You need Node.js 20+, PostgreSQL 16 and Redis 7. Set these environment variables:

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

Then run `node server/index.js`. Create accounts and stores with the same `tools/create-account.js` and `tools/create-seller.js` commands, without the `docker compose run --rm app` prefix.

---

## Troubleshooting

| Problem | Solution |
|---|---|
| The window opens and closes immediately | Open a Command Prompt in the folder and run `"Iniciar SceneShop.bat"` to read the error message. |
| "Não consegui baixar o Node.js" (could not download Node.js) | Check the internet connection, or install Node.js 22 LTS from <https://nodejs.org> and start again. |
| `EADDRINUSE` / port 3000 already in use | Another program, or another SceneShop window, is using the port. Close it, or add `PORT=3001` to `sceneshop.env`. |
| The browser did not open | Open `http://localhost:3000/studio.html` manually. |
| The phone cannot open the QR code link | Check the phone is on the same Wi-Fi (not mobile data or a guest network). Allow **Node.js** in Windows Firewall (Control Panel → Windows Defender Firewall → Allow an app). |
| The video does not play | Re-export it as MP4 (H.264 + AAC). |
| AI button says Gemini is not configured | Check that the file is named exactly `sceneshop.env` (not `.txt`), that the line is `GEMINI_API_KEY=...`, and that you restarted SceneShop. |
| Docker: the app restarts with "SESSION_SECRET" or "PUBLIC_URL" errors | Fix those values in `sceneshop.env` (see B2) and run `docker compose up -d` again. |
| Docker: "port is already allocated" | Stop the local demo (close the black window) or whatever else uses port 3000. |

---

## What is in this folder

| Item | Purpose |
|---|---|
| `Iniciar SceneShop.bat` | Windows launcher |
| `iniciar.sh` | Mac/Linux launcher |
| `sceneshop.env.example` | Settings template (AI key, port, public address) |
| `server/`, `public/`, `node_modules/` | The application and its libraries |
| `data/` | Demo/pilot data and your uploads (local mode) |
| `Dockerfile`, `compose.yaml` | Production with Docker |
| `tools/` | Administrator commands (create accounts and stores) and release tools |
| `apps/`, `clients/` | Desktop, Android and iOS app sources |
| `test/` | Automated tests (for developers) |
| `README.md` | Full technical documentation (Portuguese) |

**Version:** SceneShop v0.19.0-rc.1, preparation build rcprep.6 (commit `9a154b9`).
