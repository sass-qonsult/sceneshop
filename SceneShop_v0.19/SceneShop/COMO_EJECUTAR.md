# SceneShop v0.19 — Cómo ejecutarlo (paso a paso)

*También disponible en inglés (`HOW_TO_RUN.md`) y portugués (`COMO_RODAR.md`).*

Esta carpeta tiene todo lo necesario para ejecutar SceneShop. Las bibliotecas (`node_modules`) ya vienen incluidas, así que no necesitas instalarlas.

Hay dos formas de ejecutarlo:

| | **A. Demo / Piloto en tu computadora** | **B. Producción con Docker** |
|---|---|---|
| Para | Probarlo, hacer presentaciones, correr un piloto con tu propio video y tus productos | Una instalación real en un servidor, para usuarios reales |
| Datos | Se guardan en la carpeta `data` | Se guardan en PostgreSQL y Redis (volúmenes de Docker) |
| Empieza con | Cuentas de ejemplo y contenido de ejemplo | Vacío. Tú creas las cuentas. |
| Tiempo para arrancar | Alrededor de 1 minuto | Alrededor de 10 minutos |

La mayoría debería empezar por la **A**.

---

## Parte A — Demo / Piloto en tu computadora

### A1. Windows (camino recomendado)

1. **Descomprime el paquete.** Haz clic derecho en el archivo zip y elige **Extraer todo…**. Elige una ubicación sencilla, como `C:\SceneShop`.
   - No lo ejecutes desde dentro del zip. Windows no deja que los programas funcionen bien desde ahí.
   - Si puedes, evita las carpetas sincronizadas con OneDrive. La sincronización puede volver lentos o bloquear los archivos.
2. **Abre la carpeta `SceneShop` extraída.** Haz doble clic en **`Iniciar SceneShop.bat`** ("Iniciar SceneShop").
3. **Si Windows muestra "Windows protegió su PC",** haz clic en **Más información** y luego en **Ejecutar de todas formas**. El archivo es un script de texto simple; puedes abrirlo en el Bloc de notas para leerlo.
4. **Solo la primera vez,** si tu computadora no tiene Node.js 20 o más reciente, el iniciador descarga una copia portátil (unos 30 MB) en la carpeta `runtime`.
   - No se instala nada en Windows.
   - Este paso necesita internet una sola vez.
5. **Si el Firewall de Windows pregunta por "Node.js",** haz clic en **Permitir acceso** y marca **Redes privadas**. Así tu celular, en la misma Wi-Fi, puede conectarse por QR code.
6. **El navegador se abre solo** en `http://localhost:3000/studio.html` cuando el servidor está listo. Una ventana negra queda abierta mientras SceneShop está en ejecución. **No la cierres.**
7. **Para detener SceneShop,** cierra la ventana negra.

> ¿Ya tienes Node.js 20+ instalado? El iniciador lo usa automáticamente y se salta la descarga.

### A2. Mac o Linux

1. Instala **Node.js 20 o más reciente** (la versión LTS) desde <https://nodejs.org>.
2. Descomprime el paquete y abre una Terminal en la carpeta `SceneShop`.
3. Ejecuta:
   ```bash
   chmod +x iniciar.sh
   ./iniciar.sh
   ```
   - En una Mac también puedes renombrar `iniciar.sh` a `iniciar.command` y hacerle doble clic.
4. El navegador se abre en `http://localhost:3000/studio.html`.
5. Para detenerlo, presiona **Ctrl+C** en la Terminal.

### A3. Inicia sesión en el Estudio

La pantalla de inicio de sesión del Estudio tiene accesos directos para las cuentas de ejemplo. Todas usan la contraseña **`demo1234`**.

| Cuenta | Rol | Úsala para |
|---|---|---|
| `produtora` | Productora (socia oficial) | Subir videos, registrar productos, etiquetar escenas, ver los resultados del piloto |
| `ana` | Autora de la comunidad | Ver el lado de la comunidad: pistas y comisiones |
| `moderador` | Moderación / cumplimiento | Revisar denuncias, la fila de KYC, alertas de prevención de lavado de dinero, registro de auditoría |

Cualquier persona también puede crear una cuenta nueva de autor de la comunidad desde la pantalla de inicio de sesión.

### A4. Direcciones útiles

Todas funcionan mientras la ventana negra (o la Terminal) esté abierta.

| Dirección | Qué es |
|---|---|
| `http://localhost:3000/studio.html` | Estudio, el back office para productoras, autores y moderadores |
| `http://localhost:3000/` | Reproductor de TV / computadora con el video de demo |
| `http://localhost:3000/marketplace` | Vitrina del marketplace piloto |

**Atajos de teclado del reproductor:**

| Tecla | Acción |
|---|---|
| **Espacio** | Reproducir / pausar |
| **P** | Productos de la escena actual |
| **Q** | QR code para vincular un celular |
| **Flechas + Enter** | Navegar |
| **Esc** | Cerrar |

### A5. Conecta un celular

1. Mantén el celular en la **misma Wi-Fi** que la computadora.
2. En el reproductor, presiona **Q** para mostrar el QR code.
3. Apunta la cámara del celular al QR code. El celular muestra los productos de la escena que se está reproduciendo en pantalla, y la lista se actualiza sola cuando cambia la escena.

Si el celular no logra abrir la página, consulta la sección Solución de problemas más abajo (firewall).

### A6. Corre un piloto con tu propio video y tus productos

1. **Prepara el video.** Expórtalo como **MP4 (video H.264 + audio AAC)**. Los archivos `.mov` del iPhone (HEVC) muchas veces no se reproducen en Chrome.
2. **Prepara las fotos de los productos** en JPG, PNG o WebP, de hasta 15 MB cada una. Ponle a cada archivo el nombre del producto, por ejemplo `Aurora-Classic-Watch-1.jpg`. El nombre del archivo se vuelve el nombre sugerido del producto.
3. **Inicia sesión** como `produtora` / `demo1234`.
4. **Sube el video.** Ve a **Obras** → **Subir una obra**. Elige el video, ponle un título y haz clic en **Subir**.
5. **Registra tus productos.** Ve a **Productos** y sube las fotos:
   - **Una foto = un producto** cuando cada foto es un artículo distinto;
   - **Todas en el mismo producto** cuando son varios ángulos de un mismo artículo.

   Después completa el nombre, la marca, la categoría, el precio de lista y la descripción. En **Vender en Marketplace Piloto**, define el precio garantizado en escena y la comisión.
6. **Etiqueta los productos.** Ve a **Obras** → **Etiquetar productos**. La pista nueva empieza como una sola escena.
   - Para cada producto, búscalo, haz clic en él y **dibuja un rectángulo** sobre el objeto en el cuadro del video.
   - Haz clic en **Publicar pista**.
   - Para dividir el video en varias escenas, usa **Detectar cortes** o **Nueva escena desde aquí**.
7. **Mira.** Haz clic en **Ver**. Presiona **P** para ver los productos y **Q** para el QR code del celular.
8. **Compra.** En el celular, **Comprar** abre el marketplace piloto: carrito, checkout, pago Pix simulado y la página del pedido.
9. **Mira los resultados.** La pestaña **Piloto** muestra:
   - espectadores y conversión;
   - el embudo (vio → abrió el panel → llevó al celular → hizo clic en comprar → compró);
   - el desempeño por escena y por producto;
   - los pedidos.

Todo lo que subes queda en tu computadora, en `data/uploads`. El resto de los datos de la demo está en `data/runtime.json`.

### A7. Opcional: etiquetado con IA usando Google Gemini

Gemini puede ver el video y sugerir escenas, artículos y productos correspondientes de tu catálogo. Tú revisas cada sugerencia antes de publicar.

**Windows (lo más fácil):**

1. Crea una clave gratuita en <https://aistudio.google.com/apikey> (haz clic en **Create API key** y cópiala; empieza con `AIza`).
2. En la carpeta `SceneShop`, haz doble clic en **`Configurar IA Gemini.bat`** (Configurar IA Gemini).
3. Pega la clave en la ventana (el clic derecho pega) y presiona Enter. El asistente:
   - verifica la clave con Google;
   - elige un modelo con cuota gratuita (`gemini-2.5-flash`);
   - escribe `sceneshop.env` por ti.
4. Cierra cualquier ventana negra de SceneShop que esté abierta y vuelve a iniciar **`Iniciar SceneShop.bat`**. La ventana debería mostrar **"IA Gemini: clave configurada"**.
5. En el Estudio, abre una pista en el editor y haz clic en **Analizar con Gemini**. Luego revisa las sugerencias y aplica las que quieras.

**Mac/Linux, o a mano:** crea un archivo de texto llamado exactamente `sceneshop.env` en la carpeta `SceneShop` (en Windows, activa **Vista → Extensiones de nombre de archivo** para que no termine como `sceneshop.env.txt`) con estas dos líneas, sin espacios alrededor del `=` y sin comillas:
```
GEMINI_API_KEY=your-key-here
GEMINI_MODEL=gemini-2.5-flash
```
Después reinicia SceneShop.

Por seguridad, SceneShop nunca guarda la clave por su cuenta. Solo la lee de `sceneshop.env` o del entorno. Mantén este archivo privado y no lo compartas.

**Otros ajustes que puedes poner en `sceneshop.env`** (uno por línea):
- `PORT=3001` usa otro puerto si el 3000 está ocupado.
- `PUBLIC_URL=https://…` define la dirección pública que se usa en los QR codes cuando SceneShop está publicado en internet.

### A7b. Idiomas: portugués, inglés y español

Todas las pantallas (Estudio, celular, reproductor de TV, marketplace, tiendas) están disponibles en **portugués, inglés y español**.

- SceneShop se abre en el idioma del dispositivo o del navegador. Cualquier otro idioma se abre en inglés.
- Para cambiarlo, usa el **menú de idioma** en la parte superior de la pantalla (en el reproductor de TV, arriba a la izquierda). La elección se recuerda en ese dispositivo.
- Un enlace puede forzar un idioma agregando `?lang=pt`, `?lang=en` o `?lang=es`, por ejemplo `http://localhost:3000/mobile?lang=es`.
- El iniciador de Windows y los dos asistentes de configuración hablan el idioma de Windows. El contenido que escribes tú (títulos, nombres de productos y de escenas) se muestra tal como lo escribiste.

### A8. Reinicia la demo

En el Estudio, ve a **Ganancias** y haz clic en **Restaurar datos de la demo**. Esto reinicia las ventas de ejemplo y conserva las obras, los productos y las pistas de tu piloto.

Para empezar completamente desde cero:
1. Cierra SceneShop.
2. Borra `data/runtime.json` y el contenido de `data/uploads`.
3. Vuelve a iniciar SceneShop.

### A9. Opcional: reconoce videos por el sonido (ACRCloud)

Con esto activado, el espectador abre SceneShop en el celular y toca **Sincronizar con lo que estoy viendo**. El celular escucha durante 10 segundos, ACRCloud reconoce qué video registrado se está reproduciendo y en qué segundo, y el celular salta directo a los productos de esa escena. El QR code y el código de letras siguen funcionando como alternativas.

**1. Configura ACRCloud** (una sola vez, en <https://console.acrcloud.com>):
1. Crea una cuenta y confirma tu correo.
2. Crea un **bucket** de tipo **Audio & Video** (contenido propio). Anota su **ID** (un número) y su región.
3. Crea un **proyecto de reconocimiento** (Audio & Video Recognition) y vincúlale ese bucket. Copia el **Host**, el **Access Key** y el **Access Secret** del proyecto.
4. Ve a **Account → Developer settings** y crea un **access token** (sirve para registrar tus videos en el bucket).

ACRCloud es un servicio pago después del período de prueba (cobra por las consultas de reconocimiento y por el contenido almacenado). Revisa sus precios actuales antes de salir a producción.

**2. Conecta SceneShop:**
1. En la carpeta `SceneShop`, haz doble clic en **`Configurar ACRCloud.bat`** (Configurar ACRCloud).
2. Pega los cinco valores cuando te los pida. El asistente prueba el proyecto y el token con ACRCloud y solo entonces los guarda en `sceneshop.env`.
3. Cierra cualquier ventana negra de SceneShop y vuelve a iniciar **`Iniciar SceneShop.bat`**. La ventana debería mostrar **"Reconocimiento por audio: ACRCloud configurada"**.

**3. Úsalo:**
- Cada obra nueva que subes en el Estudio se envía a ACRCloud automáticamente. En **Obras**, cada obra muestra **"Reconocimiento por audio: listo"** cuando el celular ya puede reconocerla.
- Las obras subidas antes de configurar ACRCloud necesitan un clic en **Reconocimiento por audio** en su tarjeta.
- En el celular, abre SceneShop (o la app de Android) y toca **Sincronizar con lo que estoy viendo**.

**Importante:**
- **El micrófono del celular solo funciona con `https`.** Los navegadores del celular bloquean el micrófono en direcciones `http://` que no sean la propia computadora, así que prueba el reconocimiento por sonido con SceneShop publicado en una dirección `https` (Parte B), o con la app de Android apuntando a ella. En la propia computadora, `http://localhost:3000/mobile` sirve para una prueba rápida.
- **Privacidad:** el fragmento de 10 segundos se envía a tu servidor SceneShop y a ACRCloud solo para identificar el video; SceneShop no lo guarda. El micrófono se activa solo cuando el espectador toca el botón. Menciona esto en tu política de privacidad (LGPD).
- Si ACRCloud no reconoce el fragmento, esos mismos 10 segundos se prueban en la comparación de sonido integrada de SceneShop (junto con el enlace del video, si el espectador pegó uno). Sin ACRCloud configurado, el botón usa solo la comparación integrada, que conoce los videos indexados con `tools/build-sync-index.js`.
- El QR code, el código de 6 letras y el enlace del video siguen funcionando siempre, así que los espectadores pueden elegir la forma que más les convenga.

---

## Parte B — Producción con Docker (PostgreSQL + Redis)

Usa esto para una instalación real. La producción empieza **vacía**: sin cuentas de demo, sin contenido de ejemplo y sin precios ficticios.

### B1. Requisitos

- **Docker Desktop** (Windows/Mac) o Docker Engine con Compose (Linux): <https://www.docker.com/products/docker-desktop>
- Para un despliegue público: un nombre de dominio y un proxy **HTTPS** delante de SceneShop (por ejemplo Caddy, Nginx, Cloudflare o el balanceador de carga de tu proveedor de nube).

### B2. Configura

1. Abre una terminal en la carpeta `SceneShop` (en Windows, usa **PowerShell**).
2. Crea tu archivo de configuración:
   - Windows: `copy sceneshop.env.example sceneshop.env`
   - Mac/Linux: `cp sceneshop.env.example sceneshop.env`
3. Genera un secreto aleatorio:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Si no tienes Node.js instalado, sirve cualquier texto aleatorio de 32 caracteres o más.
4. Edita `sceneshop.env` y define como mínimo:
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
   Notas:
   - `PUBLIC_URL` debe empezar con `https://`.
   - `SESSION_SECRET` debe tener 32 caracteres o más y no debe contener palabras como `example`, `changeme` o `password`.
   - Deja `TRUST_PROXY=1` solo cuando haya un proxy HTTPS delante de SceneShop.
   - Para una prueba local rápida del modo producción, puedes dejar este archivo sin estos ajustes. Compose tiene valores locales seguros por defecto, y la app responde en `http://localhost:3000`.

### B3. Inicia

```bash
docker compose up -d --build
```

La primera vez descarga PostgreSQL 16.15 y Redis 7.4.11 y compila la app, lo que tarda unos minutos. Las migraciones de la base de datos se ejecutan automáticamente.

Verifica que esté funcionando:

```bash
docker compose ps
```

Luego abre <http://localhost:3000/api/health> en un navegador. Debería responder con `"ok":true`.

### B4. Crea las primeras cuentas

Las productoras y los moderadores los crea el administrador, desde la línea de comandos. La pantalla pública de registro solo crea autores de la comunidad.

**Productora** (esto también crea la organización de la productora):
```bash
docker compose run --rm -e SCENESHOP_NEW_PASSWORD="a-strong-password-12+" app node tools/create-account.js --role=producer --username=o2filmes --name="O2 Filmes" --org="O2 Filmes"
```

**Moderador:**
```bash
docker compose run --rm -e SCENESHOP_NEW_PASSWORD="another-strong-password" app node tools/create-account.js --role=moderator --username=compliance
```

Las contraseñas necesitan al menos 12 caracteres. Los nombres de usuario usan de 3 a 24 letras minúsculas, números o `_`.

### B5. Registra una tienda asociada

Una tienda asociada es un vendedor con un acuerdo comercial. Primero detén la app, porque la lista de tiendas se lee al arrancar:

```bash
docker compose stop app
docker compose run --rm app node tools/create-seller.js --id=urbano --name="Urbano&Co Official Store" --cnpj=11.222.333/0001-81 --store-url=https://store.example.com/sceneshop
docker compose start app
```

Reemplaza los valores de ejemplo de `--cnpj` y `--store-url` por el CNPJ real de la tienda y su dirección **https** real. El comando muestra un **secreto de webhook una sola vez**. Entrégaselo a la tienda de forma segura. La tienda lo usa para firmar sus notificaciones de pedidos a `POST <PUBLIC_URL>/api/sellers/<id>/orders`.

### B6. Operación diaria

| Tarea | Comando |
|---|---|
| Ver los logs | `docker compose logs -f app` |
| Detener todo | `docker compose down` (los datos se conservan en los volúmenes de Docker) |
| Volver a iniciar | `docker compose up -d` |
| Actualizar a una versión nueva | Reemplaza la carpeta (conserva tu `sceneshop.env`) y luego `docker compose up -d --build` |
| Verificar que esté sano | Abre `http://localhost:3000/api/health` (debería mostrar `"ok":true`) |

> **Atención:** `docker compose down -v` borra los volúmenes, es decir, **todos los datos**: base de datos, videos e imágenes subidos. Haz una copia de seguridad antes.

### B7. Producción sin Docker (tus propios servidores)

Necesitas Node.js 20+, PostgreSQL 16 y Redis 7. Define estas variables de entorno:

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

Luego ejecuta `node server/index.js`. Crea cuentas y tiendas con los mismos comandos `tools/create-account.js` y `tools/create-seller.js`, sin el prefijo `docker compose run --rm app`.

---

## Solución de problemas

| Problema | Solución |
|---|---|
| La ventana se abre y se cierra de inmediato | Abre un Símbolo del sistema en la carpeta y ejecuta `"Iniciar SceneShop.bat"` para leer el mensaje de error. |
| "No se pudo descargar Node.js" | Revisa la conexión a internet, o instala Node.js 22 LTS desde <https://nodejs.org> y vuelve a iniciar. |
| `EADDRINUSE` / el puerto 3000 ya está en uso | Otro programa, u otra ventana de SceneShop, está usando el puerto. Ciérralo, o agrega `PORT=3001` a `sceneshop.env`. |
| El navegador no se abrió | Abre `http://localhost:3000/studio.html` manualmente. |
| El celular no logra abrir el enlace del QR code | Verifica que el celular esté en la misma Wi-Fi (no en datos móviles ni en una red de invitados). Permite **Node.js** en el Firewall de Windows (Panel de control → Firewall de Windows Defender → Permitir una aplicación). |
| El video no se reproduce | Vuelve a exportarlo como MP4 (H.264 + AAC). |
| El botón de IA dice que Gemini no está configurado | Vuelve a ejecutar `Configurar IA Gemini.bat`, luego cierra **todas** las ventanas de SceneShop y reinicia. La ventana de inicio debe mostrar "IA Gemini: clave configurada". |
| Error de Gemini que menciona "quota" o 429 | Tu clave no tiene cuota gratuita para el modelo elegido. Asegúrate de que `sceneshop.env` tenga `GEMINI_MODEL=gemini-2.5-flash` (el asistente lo agrega). |
| El celular dice que el micrófono no está disponible | La página debe estar en `https` (o en `localhost` en la propia computadora). En la app de Android, permite el micrófono cuando te lo pida. |
| "Contenido no reconocido" | Verifica que la obra muestre "Reconocimiento por audio: listo" en el Estudio, acerca el celular al parlante e inténtalo de nuevo con menos ruido de fondo. |
| Docker: la app se reinicia con errores de "SESSION_SECRET" o "PUBLIC_URL" | Corrige esos valores en `sceneshop.env` (ver B2) y vuelve a ejecutar `docker compose up -d`. |
| Docker: "port is already allocated" | Detén la demo local (cierra la ventana negra) o lo que sea que esté usando el puerto 3000. |

---

## Qué hay en esta carpeta

| Elemento | Para qué sirve |
|---|---|
| `Iniciar SceneShop.bat` | Iniciador para Windows |
| `iniciar.sh` | Iniciador para Mac/Linux |
| `Configurar IA Gemini.bat` | Asistente que configura la clave de la IA Gemini |
| `Configurar ACRCloud.bat` | Asistente que conecta ACRCloud (reconocer videos por el sonido) |
| `sceneshop.env.example` | Plantilla de configuración (clave de IA, puerto, dirección pública) |
| `server/`, `public/`, `node_modules/` | La aplicación y sus bibliotecas |
| `data/` | Datos de demo/piloto y lo que subes (modo local) |
| `Dockerfile`, `compose.yaml` | Producción con Docker |
| `tools/` | Comandos de administrador (crear cuentas y tiendas) y herramientas de release |
| `apps/`, `clients/` | Código fuente de las apps de escritorio, Android e iOS |
| `test/` | Pruebas automatizadas (para desarrolladores) |
| `README.md` | Documentación técnica completa (en portugués) |

**Versión:** SceneShop v0.19.0-rc.1, build de preparación rcprep.8. El commit exacto está en `V0_19_RCPREP8_CANDIDATE_IDENTITY.json`.
