"""
Gera o vídeo de demonstração (5 cenas ilustradas), as miniaturas das cenas,
o catálogo de produtos (com a posição de cada produto na imagem) e a
trilha invisível WebVTT.  Tudo sai de uma única definição, para nunca
ficar dessincronizado.

Uso:  python3 tools/gen_demo.py
"""
import zlib, json, math, os, random, subprocess, shutil
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H, FPS, SCENE_SECONDS = 1280, 720, 12, 12
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_MEDIA = os.path.join(ROOT, "public", "media")
OUT_DATA = os.path.join(ROOT, "data")
TMP = os.path.join(ROOT, ".frames")
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_R = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def font(size, bold=True):
    return ImageFont.truetype(FONT if bold else FONT_R, size)


def vgrad(top, bottom):
    img = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(img)
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)], fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return img


# ---------------------------------------------------------------- produtos
# Cada função desenha um produto dentro da caixa (x, y, w, h) em pixels.

def jaqueta(d, x, y, w, h):
    c, dark = (122, 72, 40), (86, 48, 26)
    d.polygon([(x + w * .30, y), (x + w * .70, y), (x + w, y + h * .25), (x + w * .92, y + h),
               (x + w * .08, y + h), (x, y + h * .25)], fill=c)
    d.polygon([(x + w * .30, y), (x + w * .5, y + h * .35), (x + w * .70, y)], fill=(230, 220, 205))
    d.line([(x + w * .5, y + h * .35), (x + w * .5, y + h)], fill=dark, width=4)
    d.polygon([(x + w * .30, y), (x + w * .5, y + h * .35), (x + w * .38, y + h * .45), (x + w * .22, y + h * .12)], fill=dark)
    d.polygon([(x + w * .70, y), (x + w * .5, y + h * .35), (x + w * .62, y + h * .45), (x + w * .78, y + h * .12)], fill=dark)
    for i in range(5):
        d.ellipse([x + w * .47, y + h * (.45 + i * .1), x + w * .53, y + h * (.45 + i * .1) + 6], fill=(200, 190, 170))


def oculos(d, x, y, w, h):
    d.line([(x, y + h * .2), (x + w, y + h * .2)], fill=(200, 170, 60), width=5)
    for cx in (x + w * .25, x + w * .75):
        d.ellipse([cx - w * .22, y, cx + w * .22, y + h], fill=(30, 40, 50), outline=(200, 170, 60), width=4)
        d.ellipse([cx - w * .15, y + h * .15, cx - w * .02, y + h * .4], fill=(90, 110, 130))


def tenis(d, x, y, w, h):
    d.rounded_rectangle([x, y + h * .55, x + w, y + h], radius=int(h * .2), fill=(240, 240, 240), outline=(180, 180, 180), width=3)
    d.polygon([(x + w * .05, y + h * .6), (x + w * .15, y), (x + w * .55, y + h * .1), (x + w * .95, y + h * .6)], fill=(250, 250, 250), outline=(190, 190, 190))
    d.line([(x + w * .25, y + h * .25), (x + w * .5, y + h * .3)], fill=(40, 90, 200), width=6)
    d.rectangle([x, y + h * .88, x + w, y + h], fill=(60, 60, 60))


def cafeteira(d, x, y, w, h):
    d.rounded_rectangle([x, y, x + w, y + h * .25], radius=10, fill=(170, 170, 175))
    d.rectangle([x + w * .1, y + h * .25, x + w * .9, y + h * .8], fill=(50, 50, 55))
    d.rounded_rectangle([x, y + h * .8, x + w, y + h], radius=8, fill=(170, 170, 175))
    d.rectangle([x + w * .4, y + h * .25, x + w * .6, y + h * .4], fill=(120, 120, 125))
    d.ellipse([x + w * .7, y + h * .07, x + w * .8, y + h * .17], fill=(220, 60, 60))


def caneca(d, x, y, w, h):
    d.rounded_rectangle([x, y, x + w * .78, y + h], radius=12, fill=(235, 120, 80))
    d.ellipse([x + w * .6, y + h * .2, x + w, y + h * .7], outline=(235, 120, 80), width=10)
    d.ellipse([x + 4, y - 6, x + w * .78 - 4, y + 10], fill=(90, 55, 30))


def notebook(d, x, y, w, h):
    d.rounded_rectangle([x + w * .08, y, x + w * .92, y + h * .8], radius=8, fill=(60, 64, 72))
    d.rectangle([x + w * .12, y + h * .06, x + w * .88, y + h * .74], fill=(120, 190, 240))
    d.polygon([(x, y + h * .82), (x + w, y + h * .82), (x + w * .95, y + h), (x + w * .05, y + h)], fill=(160, 165, 172))


def sofa(d, x, y, w, h):
    col, dk = (60, 110, 120), (45, 85, 95)
    d.rounded_rectangle([x, y, x + w, y + h * .6], radius=25, fill=dk)
    d.rounded_rectangle([x + w * .08, y + h * .4, x + w * .92, y + h * .8], radius=15, fill=col)
    d.rounded_rectangle([x, y + h * .3, x + w * .12, y + h * .85], radius=18, fill=dk)
    d.rounded_rectangle([x + w * .88, y + h * .3, x + w, y + h * .85], radius=18, fill=dk)
    for fx in (x + w * .1, x + w * .88):
        d.rectangle([fx, y + h * .85, fx + 12, y + h], fill=(80, 60, 40))


def luminaria(d, x, y, w, h):
    d.polygon([(x + w * .15, y), (x + w * .85, y), (x + w, y + h * .25), (x, y + h * .25)], fill=(245, 225, 170))
    d.line([(x + w * .5, y + h * .25), (x + w * .5, y + h * .95)], fill=(40, 40, 40), width=6)
    d.ellipse([x + w * .2, y + h * .93, x + w * .8, y + h], fill=(40, 40, 40))


def caixa_som(d, x, y, w, h):
    d.rounded_rectangle([x, y, x + w, y + h], radius=int(w * .3), fill=(35, 35, 40))
    for i in range(3):
        cy = y + h * (.22 + i * .28)
        d.ellipse([x + w * .25, cy - w * .25, x + w * .75, cy + w * .25], fill=(70, 70, 80), outline=(20, 20, 20), width=3)


def relogio_smart(d, x, y, w, h):
    d.rectangle([x + w * .3, y, x + w * .7, y + h], fill=(30, 30, 30))
    d.rounded_rectangle([x + w * .08, y + h * .25, x + w * .92, y + h * .75], radius=18, fill=(20, 20, 20), outline=(150, 150, 150), width=4)
    d.text((x + w * .5, y + h * .5), "10:24", fill=(120, 255, 170), anchor="mm", font=font(int(w * .2)))


def fone(d, x, y, w, h):
    d.arc([x + w * .05, y, x + w * .95, y + h * 1.2], 180, 360, fill=(230, 230, 235), width=14)
    for cx in (x + w * .05, x + w * .8):
        d.rounded_rectangle([cx - 8, y + h * .45, cx + w * .2, y + h], radius=18, fill=(230, 230, 235), outline=(150, 150, 160), width=3)


def garrafa(d, x, y, w, h):
    d.rounded_rectangle([x + w * .2, y + h * .15, x + w * .8, y + h], radius=16, fill=(60, 170, 150))
    d.rectangle([x + w * .32, y, x + w * .68, y + h * .17], fill=(40, 40, 40))
    d.rectangle([x + w * .2, y + h * .5, x + w * .8, y + h * .6], fill=(240, 240, 240))


def vestido(d, x, y, w, h):
    red = (170, 30, 60)
    d.polygon([(x + w * .35, y), (x + w * .65, y), (x + w * .7, y + h * .35), (x + w, y + h), (x, y + h), (x + w * .3, y + h * .35)], fill=red)
    d.rectangle([x + w * .3, y + h * .33, x + w * .7, y + h * .38], fill=(120, 20, 40))


def relogio_classico(d, x, y, w, h):
    d.rectangle([x + w * .32, y, x + w * .68, y + h], fill=(110, 70, 40))
    d.ellipse([x + w * .05, y + h * .2, x + w * .95, y + h * .8], fill=(215, 180, 90))
    d.ellipse([x + w * .15, y + h * .27, x + w * .85, y + h * .73], fill=(250, 248, 240))
    cx, cy = x + w * .5, y + h * .5
    d.line([(cx, cy), (cx, cy - h * .17)], fill=(20, 20, 20), width=4)
    d.line([(cx, cy), (cx + w * .22, cy)], fill=(20, 20, 20), width=3)


def perfume(d, x, y, w, h):
    d.rounded_rectangle([x, y + h * .3, x + w, y + h], radius=12, fill=(240, 200, 210), outline=(200, 150, 170), width=3)
    d.rectangle([x + w * .35, y + h * .12, x + w * .65, y + h * .3], fill=(200, 170, 90))
    d.rounded_rectangle([x + w * .25, y, x + w * .75, y + h * .14], radius=6, fill=(30, 30, 30))
    d.rectangle([x + w * .2, y + h * .55, x + w * .8, y + h * .7], fill=(255, 255, 255))


# ---------------------------------------------------------------- cenas
# box em pixels (x, y, w, h); vira % no catálogo.
SCENES = [
    {"id": "s1", "title": "Encontro na rua", "bg": ((255, 150, 90), (90, 60, 110)),
     "set": "street",
     "products": [
         {"id": "jaqueta-couro", "name": "Jaqueta de couro marrom", "brand": "Urbano&Co", "cat": "Moda",
          "price": 499.90, "draw": jaqueta, "box": (520, 250, 240, 300)},
         {"id": "oculos-aviador", "name": "Óculos de sol aviador", "brand": "SolarMax", "cat": "Acessórios",
          "price": 289.00, "draw": oculos, "box": (560, 170, 160, 60)},
         {"id": "tenis-branco", "name": "Tênis casual branco", "brand": "PassoLeve", "cat": "Calçados",
          "price": 349.90, "draw": tenis, "box": (880, 560, 200, 110)},
     ]},
    {"id": "s2", "title": "Café da manhã", "bg": ((250, 230, 200), (200, 160, 120)),
     "set": "kitchen",
     "products": [
         {"id": "cafeteira-espresso", "name": "Cafeteira espresso automática", "brand": "Barista Pro", "cat": "Casa",
          "price": 1899.00, "draw": cafeteira, "box": (150, 250, 200, 250)},
         {"id": "caneca-ceramica", "name": "Caneca de cerâmica 350 ml", "brand": "Argila", "cat": "Casa",
          "price": 59.90, "draw": caneca, "box": (500, 400, 110, 100)},
         {"id": "notebook-14", "name": "Notebook 14\" ultrafino", "brand": "Nimbus", "cat": "Eletrônicos",
          "price": 4299.00, "draw": notebook, "box": (760, 320, 320, 180)},
     ]},
    {"id": "s3", "title": "Noite na sala", "bg": ((40, 45, 80), (20, 20, 35)),
     "set": "living",
     "products": [
         {"id": "sofa-3-lugares", "name": "Sofá 3 lugares veludo", "brand": "Lar Design", "cat": "Móveis",
          "price": 3290.00, "draw": sofa, "box": (330, 370, 560, 250)},
         {"id": "luminaria-piso", "name": "Luminária de piso", "brand": "Lumen", "cat": "Decoração",
          "price": 459.00, "draw": luminaria, "box": (130, 180, 140, 440)},
         {"id": "caixa-som-bt", "name": "Caixa de som Bluetooth", "brand": "Onda", "cat": "Eletrônicos",
          "price": 699.00, "draw": caixa_som, "box": (1000, 400, 100, 200)},
     ]},
    {"id": "s4", "title": "Corrida no parque", "bg": ((130, 200, 240), (120, 190, 110)),
     "set": "park",
     "products": [
         {"id": "smartwatch", "name": "Smartwatch esportivo GPS", "brand": "Pulse", "cat": "Eletrônicos",
          "price": 1199.00, "draw": relogio_smart, "box": (200, 260, 180, 240)},
         {"id": "fone-sem-fio", "name": "Fone sem fio com cancelamento de ruído", "brand": "Onda", "cat": "Eletrônicos",
          "price": 899.00, "draw": fone, "box": (540, 200, 220, 200)},
         {"id": "garrafa-termica", "name": "Garrafa térmica 750 ml", "brand": "Trilha", "cat": "Esporte",
          "price": 129.90, "draw": garrafa, "box": (930, 330, 110, 260)},
     ]},
    {"id": "s5", "title": "Jantar especial", "bg": ((90, 20, 40), (25, 10, 20)),
     "set": "dinner",
     "products": [
         {"id": "vestido-vermelho", "name": "Vestido longo vermelho", "brand": "Atelier Rosa", "cat": "Moda",
          "price": 689.00, "draw": vestido, "box": (520, 150, 240, 450)},
         {"id": "relogio-classico", "name": "Relógio clássico dourado", "brand": "Tempo", "cat": "Acessórios",
          "price": 1450.00, "draw": relogio_classico, "box": (180, 330, 150, 220)},
         {"id": "perfume", "name": "Perfume floral 100 ml", "brand": "Essência", "cat": "Beleza",
          "price": 389.00, "draw": perfume, "box": (950, 400, 110, 170)},
     ]},
]


def draw_set(img, kind, t):
    d = ImageDraw.Draw(img, "RGBA")
    rnd = random.Random(kind)
    if kind == "street":
        for i in range(8):
            bx = i * 170 - 30
            bh = rnd.randint(220, 420)
            d.rectangle([bx, H - 150 - bh, bx + 150, H - 150], fill=(60, 40, 80, 200))
            for wy in range(H - 130 - bh, H - 170, 40):
                for wx in range(bx + 15, bx + 140, 35):
                    on = (wx * 7 + wy + int(t * 2)) % 5 != 0
                    d.rectangle([wx, wy, wx + 18, wy + 22], fill=(255, 220, 140, 220 if on else 60))
        d.rectangle([0, H - 150, W, H], fill=(70, 70, 80))
        d.ellipse([560, 90, 720, 250], fill=(230, 190, 160))  # cabeça do personagem
    elif kind == "kitchen":
        d.rectangle([0, 500, W, H], fill=(160, 110, 70))
        d.rectangle([0, 500, W, 520], fill=(120, 80, 50))
        d.rectangle([900, 60, 1200, 260], fill=(200, 230, 250), outline=(255, 255, 255), width=10)
        for i in range(3):  # vapor
            yy = 380 - ((t * 30 + i * 25) % 70)
            d.ellipse([540 + i * 8, yy, 560 + i * 8, yy + 20], fill=(255, 255, 255, 110))
    elif kind == "living":
        d.rectangle([0, 600, W, H], fill=(50, 35, 30))
        d.rectangle([700, 90, 1000, 260], fill=(15, 15, 20), outline=(90, 90, 100), width=6)
        glow = int(120 + 60 * math.sin(t * 2))
        d.rectangle([710, 100, 990, 250], fill=(60, 80, glow, 255))
        d.ellipse([90, 140, 310, 300], fill=(255, 230, 150, 50))
    elif kind == "park":
        d.rectangle([0, 520, W, H], fill=(90, 160, 80))
        for i, tx in enumerate((80, 420, 1150)):
            d.rectangle([tx, 280, tx + 30, 530], fill=(100, 70, 40))
            d.ellipse([tx - 80, 150, tx + 110, 330], fill=(60, 130, 60))
        cx = (t * 90) % (W + 200) - 100
        d.ellipse([cx, 60, cx + 120, 110], fill=(255, 255, 255, 200))
    elif kind == "dinner":
        d.rectangle([0, 560, W, H], fill=(60, 20, 30))
        d.rectangle([0, 540, W, 575], fill=(240, 235, 225))
        for cx in (430, 850):
            fl = 6 * math.sin(t * 8 + cx)
            d.rectangle([cx, 440, cx + 16, 545], fill=(245, 240, 220))
            d.ellipse([cx - 4, 410 + fl, cx + 20, 445], fill=(255, 190, 80, 230))
        d.ellipse([570, 70, 710, 190], fill=(210, 160, 130))


def render_scene(scene, t, local_t):
    img = vgrad(*scene["bg"])
    draw_set(img, scene["set"], t)
    d = ImageDraw.Draw(img, "RGBA")
    for p in scene["products"]:
        x, y, w, h = p["box"]
        # sombra suave
        d.ellipse([x + w * .1, y + h - 6, x + w * .9, y + h + 12], fill=(0, 0, 0, 60))
        p["draw"](d, x, y, w, h)
    # título da cena (como em uma vinheta)
    if local_t < 3:
        a = int(255 * min(1, (3 - local_t)))
        d.rounded_rectangle([40, 40, 40 + 30 + len(scene["title"]) * 22, 100], radius=10, fill=(0, 0, 0, int(a * .55)))
        d.text((60, 70), scene["title"], font=font(32), fill=(255, 255, 255, a), anchor="lm")
    # marca d'água da obra
    d.text((W - 30, H - 25), "Demo SceneShop • obra fictícia", font=font(18, False), fill=(255, 255, 255, 150), anchor="rs")
    # fade entre cenas
    fade = 0
    if local_t < .4:
        fade = 1 - local_t / .4
    elif local_t > SCENE_SECONDS - .4:
        fade = (local_t - (SCENE_SECONDS - .4)) / .4
    if fade > 0:
        img = Image.blend(img, Image.new("RGB", (W, H)), fade)
    return img


def ts(sec):
    h, m = int(sec // 3600), int(sec % 3600 // 60)
    return f"{h:02d}:{m:02d}:{sec % 60:06.3f}"


def main():
    shutil.rmtree(TMP, ignore_errors=True)
    os.makedirs(TMP)
    os.makedirs(os.path.join(OUT_MEDIA, "thumbs"), exist_ok=True)
    os.makedirs(os.path.join(OUT_MEDIA, "products"), exist_ok=True)
    os.makedirs(OUT_DATA, exist_ok=True)

    n = 0
    for si, sc in enumerate(SCENES):
        for f in range(SCENE_SECONDS * FPS):
            lt = f / FPS
            t = si * SCENE_SECONDS + lt
            fr = render_scene(sc, t, lt)
            fr.save(os.path.join(TMP, f"{n:05d}.png"))
            if f == int(SCENE_SECONDS * FPS / 2):
                fr.resize((320, 180)).save(os.path.join(OUT_MEDIA, "thumbs", f"{sc['id']}.jpg"), quality=85)
            n += 1
        # imagem de cada produto (recorte limpo sobre fundo claro)
        for p in sc["products"]:
            x, y, w, h = p["box"]
            pad = 20
            canvas = Image.new("RGB", (w + pad * 2, h + pad * 2), (245, 245, 248))
            p["draw"](ImageDraw.Draw(canvas, "RGBA"), pad, pad, w, h)
            canvas.thumbnail((240, 240))
            sq = Image.new("RGB", (240, 240), (245, 245, 248))
            sq.paste(canvas, ((240 - canvas.width) // 2, (240 - canvas.height) // 2))
            sq.save(os.path.join(OUT_MEDIA, "products", f"{p['id']}.jpg"), quality=88)

    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", os.path.join(TMP, "%05d.png"),
                    "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-shortest",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "30", "-preset", "slow", "-movflags", "+faststart",
                    "-c:a", "aac", "-b:a", "32k", os.path.join(OUT_MEDIA, "demo.mp4")], check=True)
    # WebM (VP9) para navegadores sem H.264, como o Chromium puro
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", os.path.join(OUT_MEDIA, "demo.mp4"),
                    "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "40", "-row-mt", "1", "-an",
                    os.path.join(OUT_MEDIA, "demo.webm")], check=True)
    shutil.rmtree(TMP)

    # ---- catálogo + trilha invisível
    work = {"id": "demo-01", "title": "Cidade em Cenas (demo)", "duration": len(SCENES) * SCENE_SECONDS,
            "video": "/media/demo.mp4", "track": "/data/demo-01.vtt", "scenes": []}
    products = {}
    vtt = ["WEBVTT", "", "NOTE Trilha invisível SceneShop: cada bloco = uma cena e seus produtos", ""]
    for si, sc in enumerate(SCENES):
        start, end = si * SCENE_SECONDS, (si + 1) * SCENE_SECONDS
        work["scenes"].append({"id": sc["id"], "title": sc["title"], "start": start, "end": end,
                               "thumb": f"/media/thumbs/{sc['id']}.jpg",
                               "products": [p["id"] for p in sc["products"]]})
        for p in sc["products"]:
            x, y, w, h = p["box"]
            products[p["id"]] = {"id": p["id"], "name": p["name"], "brand": p["brand"], "category": p["cat"],
                                 "image": f"/media/products/{p['id']}.jpg", "referencePrice": p["price"],
                                 "box": {"x": round(x / W * 100, 2), "y": round(y / H * 100, 2),
                                         "w": round(w / W * 100, 2), "h": round(h / H * 100, 2)},
                                 "storeIds": {"amazon": "B0DEMO" + p["id"][:4].upper(),
                                              "mercadolivre": "MLB" + str(zlib.crc32(p["id"].encode()) % 10 ** 9)}}
        vtt += [f"{ts(start)} --> {ts(end)}",
                json.dumps({"scene": sc["id"], "products": [p["id"] for p in sc["products"]]}, ensure_ascii=False), ""]

    with open(os.path.join(OUT_DATA, "catalog.json"), "w", encoding="utf-8") as f:
        json.dump({"works": {work["id"]: work}, "products": products}, f, ensure_ascii=False, indent=2)
    with open(os.path.join(OUT_DATA, "demo-01.vtt"), "w", encoding="utf-8") as f:
        f.write("\n".join(vtt))
    print("ok", n, "frames")


if __name__ == "__main__":
    main()
