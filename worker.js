export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const PRODUCTS = {
      ebook100: {
        id: "ebook100",
        name: "100 Ideas para Ganar Dinero con tu Teléfono en 2026",
        price: 6.99,
        category: "Libros",
        emoji: "📱",
        available: true,
        description: "Guía práctica con 100 ideas, plan de acción y consejos para evitar estafas."
      },
      single: {
        id: "single",
        name: "Canción individual",
        price: 1.99,
        category: "Música",
        emoji: "🎵",
        available: false
      },
      album: {
        id: "album",
        name: "Aurora Sessions",
        price: 7.99,
        category: "Música",
        emoji: "💿",
        available: false
      },
      soundpack: {
        id: "soundpack",
        name: "Pack de sonidos",
        price: 5.99,
        category: "Packs",
        emoji: "🔊",
        available: false
      }
    };

    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          "Cache-Control": "no-store"
        }
      });

    async function qvapay(path, options = {}) {
      if (!env.QVAPAY_APP_ID || !env.QVAPAY_APP_SECRET) {
        return {
          ok: false,
          status: 500,
          error: "Faltan QVAPAY_APP_ID y/o QVAPAY_APP_SECRET en Cloudflare."
        };
      }

      try {
        const r = await fetch("https://api.qvapay.com" + path, {
          ...options,
          headers: {
            "Content-Type": "application/json",
            "app-id": env.QVAPAY_APP_ID,
            "app-secret": env.QVAPAY_APP_SECRET,
            ...(options.headers || {})
          }
        });

        const text = await r.text();
        let data = {};

        try {
          data = text ? JSON.parse(text) : {};
        } catch {
          data = { raw: text };
        }

        return { ok: r.ok, status: r.status, data };
      } catch (e) {
        return {
          ok: false,
          status: 502,
          error: "No se pudo contactar con QvaPay: " + (e?.message || "error de red")
        };
      }
    }

    /* =========================
       COMPROBAR QVAPAY
    ========================= */

    if (url.pathname === "/api/qvapay-check") {
      if (request.method !== "GET") {
        return json({ error: "Método no permitido." }, 405);
      }

      const r = await qvapay("/v2/info", {
        method: "POST",
        body: "{}"
      });

      if (!r.ok) {
        return json({
          ok: false,
          qvapay_status: r.status,
          error:
            r.error ||
            r.data?.error ||
            r.data?.message ||
            "QvaPay rechazó la solicitud.",
          details: r.data || null
        }, r.status || 500);
      }

      return json({
        ok: true,
        message: "La conexión con QvaPay funciona.",
        app: r.data
      });
    }

    /* =========================
       CREAR FACTURA
    ========================= */

    if (url.pathname === "/api/create-invoice") {
      if (request.method !== "POST" && request.method !== "GET") {
        return json({ error: "Método no permitido." }, 405);
      }

      let requested = [];

      try {
        if (request.method === "POST") {
          const body = await request.json();
          requested = Array.isArray(body.items) ? body.items : [];
        } else {
          requested = [{ id: "ebook100", quantity: 1 }];
        }
      } catch {
        return json({ error: "Datos del carrito inválidos." }, 400);
      }

      if (!requested.length) {
        return json({ error: "El carrito está vacío." }, 400);
      }

      const products = [];
      let total = 0;

      for (const item of requested) {
        const product = PRODUCTS[String(item.id)];
        const quantity = Math.max(
          1,
          Math.min(20, Number.parseInt(item.quantity, 10) || 1)
        );

        if (!product) {
          return json({
            error: "Producto no encontrado: " + String(item.id)
          }, 400);
        }

        if (!product.available) {
          return json({
            error: product.name + " todavía no está disponible para compra."
          }, 409);
        }

        products.push({
          name: product.name,
          price: product.price,
          quantity
        });

        total += product.price * quantity;
      }

      total = Number(total.toFixed(2));

      const remote_id =
        "aurora-" +
        Date.now().toString(36) +
        "-" +
        crypto.randomUUID();

      const webhook = new URL("/callback", request.url).href;

      const r = await qvapay("/v2/create_invoice", {
        method: "POST",
        body: JSON.stringify({
          amount: total,
          description:
            products.length === 1
              ? products[0].name
              : "Compra en Aurora Digital",
          remote_id,
          webhook,
          products
        })
      });

      if (!r.ok) {
        return json({
          ok: false,
          error:
            r.data?.error ||
            r.data?.message ||
            r.error ||
            "QvaPay rechazó la factura.",
          qvapay_status: r.status,
          details: r.data || null
        }, r.status || 502);
      }

      const paymentUrl =
        r.data?.url ||
        r.data?.data?.url ||
        null;

      if (!paymentUrl) {
        return json({
          ok: false,
          error: "QvaPay no devolvió una URL de pago.",
          details: r.data || null
        }, 502);
      }

      return Response.redirect(paymentUrl, 302);
    }

    /* =========================
       CALLBACK QVAPAY
    ========================= */

    if (url.pathname === "/callback") {
      if (request.method === "POST") {
        try {
          const payload = await request.json();
          console.log(
            "QvaPay webhook recibido:",
            JSON.stringify(payload)
          );
        } catch {
          console.log("Webhook recibido sin JSON válido.");
        }
      }

      return new Response("OK", {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=UTF-8"
        }
      });
    }

    /* =========================
       ÉXITO
    ========================= */

    if (url.pathname === "/success") {
      return new Response(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pago recibido · Aurora Digital</title>
<style>
body{margin:0;background:#05030d;color:#fff;font-family:Arial;text-align:center}
.box{max-width:650px;margin:90px auto;padding:40px 25px;border:1px solid #342956;border-radius:24px;background:#0e0a1d}
h1{font-size:42px}
p{color:#aaa5c4;line-height:1.7}
a{display:inline-block;margin-top:20px;padding:14px 22px;border-radius:12px;text-decoration:none;color:white;background:linear-gradient(90deg,#9e1fff,#563cff)}
</style>
</head>
<body>
<div class="box">
<div style="font-size:70px">✨</div>
<h1>Gracias por tu compra</h1>
<p>Tu pago fue enviado correctamente.</p>
<a href="/">Volver a Aurora Digital</a>
</div>
</body>
</html>`, {
        headers: {
          "Content-Type": "text/html; charset=UTF-8"
        }
      });
    }

    /* =========================
       CANCELACIÓN
    ========================= */

    if (url.pathname === "/cancel") {
      return new Response(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pago cancelado · Aurora Digital</title>
<style>
body{margin:0;background:#05030d;color:#fff;font-family:Arial;text-align:center}
.box{max-width:650px;margin:90px auto;padding:40px 25px;border:1px solid #342956;border-radius:24px;background:#0e0a1d}
p{color:#aaa5c4;line-height:1.7}
a{display:inline-block;margin-top:20px;padding:14px 22px;border-radius:12px;text-decoration:none;color:white;background:#19112d;border:1px solid #342956}
</style>
</head>
<body>
<div class="box">
<div style="font-size:70px">🛒</div>
<h1>Pago cancelado</h1>
<p>No se realizó el pago.</p>
<a href="/">Volver a la tienda</a>
</div>
</body>
</html>`, {
        headers: {
          "Content-Type": "text/html; charset=UTF-8"
        }
      });
    }

    /* =========================
       AURORA DIGITAL
    ========================= */

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#080612">
<meta name="description" content="Aurora Digital — música, libros, packs, arte y colecciones digitales.">
<title>Aurora Digital</title>

<style>
:root{
--bg:#05030d;
--panel:#0e0a1d;
--panel2:#13102a;
--purple:#a832ff;
--purple2:#d34cff;
--blue:#4c6fff;
--text:#f7f4ff;
--muted:#aaa5c4;
--line:#292247
}

*{box-sizing:border-box}
html{scroll-behavior:smooth}

body{
margin:0;
background:
radial-gradient(circle at 75% 5%,#28105a,transparent 40%),
radial-gradient(circle at 15% 35%,#111d4c,transparent 38%),
var(--bg);
color:var(--text);
font-family:Arial,Helvetica,sans-serif
}

body.cart-open{overflow:hidden}
a{color:inherit}

header{
position:sticky;
top:0;
z-index:50;
min-height:72px;
padding:12px 5%;
display:flex;
align-items:center;
justify-content:space-between;
gap:15px;
background:#05030df2;
border-bottom:1px solid var(--line);
backdrop-filter:blur(14px)
}

.logo{
text-decoration:none;
font-weight:900;
letter-spacing:5px;
font-size:21px
}

.logo span{
display:block;
font-size:9px;
letter-spacing:7px;
color:#c7bfff
}

nav{
display:flex;
align-items:center;
justify-content:center;
flex-wrap:wrap;
gap:2px
}

nav a{
text-decoration:none;
padding:9px 7px;
font-size:10px;
border-radius:8px
}

nav a:hover{
color:#d34cff;
background:#19112d
}

.actions{
display:flex;
gap:8px
}

.icon-btn{
width:38px;
height:38px;
border:1px solid #342956;
background:#0d091b;
color:white;
border-radius:11px;
display:grid;
place-items:center;
font-size:17px;
cursor:pointer;
text-decoration:none
}

.cart-icon{position:relative}

.cart-count{
position:absolute;
top:-6px;
right:-6px;
min-width:19px;
height:19px;
display:grid;
place-items:center;
border-radius:20px;
background:#d34cff;
font-size:10px;
font-weight:bold
}

main{
max-width:1180px;
margin:auto;
padding:0 5%
}

.hero{
min-height:570px;
display:grid;
grid-template-columns:1.1fr .9fr;
gap:45px;
align-items:center;
padding:70px 0
}

.eyebrow{
color:#d46aff;
letter-spacing:3px;
font-size:11px;
font-weight:bold
}

h1{
font-size:clamp(43px,7vw,76px);
line-height:.98;
margin:16px 0 20px;
letter-spacing:-2px
}

.gradient{
background:linear-gradient(90deg,#fff,#d34cff,#5fa7ff);
-webkit-background-clip:text;
background-clip:text;
color:transparent
}

.lead{
color:var(--muted);
font-size:18px;
line-height:1.7;
max-width:650px
}

.cta-row{
display:flex;
gap:12px;
flex-wrap:wrap;
margin-top:28px
}

.btn{
display:inline-flex;
align-items:center;
justify-content:center;
gap:8px;
text-decoration:none;
border-radius:12px;
padding:14px 20px;
font-weight:bold;
border:1px solid #3b2b60;
background:#100b22;
color:#fff;
cursor:pointer
}

.btn.primary{
background:linear-gradient(90deg,#9e1fff,#563cff);
border-color:transparent;
box-shadow:0 0 25px #8b2dff44
}

.hero-art{
min-height:390px;
border:1px solid #4a2774;
border-radius:30px;
background:
radial-gradient(circle at 50% 35%,#7829ff55,transparent 35%),
linear-gradient(145deg,#180d35,#070611);
display:grid;
place-items:center;
box-shadow:0 0 65px #7a1cff22
}

.orbit{
width:245px;
height:245px;
border:1px solid #a832ff88;
border-radius:50%;
box-shadow:0 0 55px #8b2dff44;
display:grid;
place-items:center
}

.orbit:before{
content:"✦";
font-size:95px;
color:#d34cff;
text-shadow:0 0 35px #a832ff
}

.section{
padding:75px 0;
border-top:1px solid #1e1834
}

.section-head{
display:flex;
justify-content:space-between;
align-items:end;
margin-bottom:25px
}

.section h2{
font-size:34px;
margin:0 0 8px
}

.section-head p{
color:var(--muted);
margin:0
}

.grid{
display:grid;
grid-template-columns:repeat(4,1fr);
gap:16px
}

.card{
background:linear-gradient(145deg,#100b20,#0a0714);
border:1px solid var(--line);
border-radius:18px;
overflow:hidden
}

.card:hover{border-color:#4b2e70}

.card-visual{
height:180px;
display:grid;
place-items:center;
font-size:62px;
background:
radial-gradient(circle at 50% 40%,#6b2ad955,transparent 45%),
#0b0817
}

.card-body{padding:18px}

.tag{
display:inline-block;
color:#d57aff;
border:1px solid #6d3296;
background:#241039;
padding:5px 9px;
border-radius:20px;
font-size:9px;
letter-spacing:1px
}

.card h3{
font-size:17px;
margin:12px 0 7px
}

.card p{
color:var(--muted);
font-size:13px;
line-height:1.55;
min-height:42px
}

.price{
font-size:21px;
font-weight:900;
color:#d46aff;
margin:13px 0
}

.buy{
display:inline-flex;
align-items:center;
justify-content:center;
gap:7px;
width:100%;
background:linear-gradient(90deg,#9e1fff,#563cff);
color:#fff;
border-radius:11px;
padding:12px;
font-weight:bold;
border:0;
cursor:pointer
}

.buy.disabled{
background:#151021;
color:#77718f;
box-shadow:none;
cursor:not-allowed
}

.search-box{
display:flex;
gap:10px;
margin:10px 0 30px
}

.search-box input{
width:100%;
background:#0c0818;
border:1px solid var(--line);
color:#fff;
padding:14px;
border-radius:12px;
outline:none
}

.feature{
display:grid;
grid-template-columns:repeat(3,1fr);
gap:18px
}

.feature-box{
border:1px solid var(--line);
border-radius:18px;
padding:25px;
background:#0c0818
}

.feature-box .big{font-size:28px}
.feature-box h3{margin:12px 0 7px}
.feature-box p{
color:var(--muted);
line-height:1.6;
font-size:14px
}

.about,.contact{
display:grid;
grid-template-columns:1fr 1fr;
gap:20px
}

.panel{
border:1px solid var(--line);
border-radius:20px;
padding:28px;
background:#0c0818
}

.panel p{
color:var(--muted);
line-height:1.7
}

footer{
margin-top:30px;
padding:45px 5%;
border-top:1px solid var(--line);
text-align:center;
color:#77718f;
line-height:1.7
}

footer strong{color:#c9c1e0}

/* CARRITO */

.cart-overlay{
position:fixed;
inset:0;
z-index:100;
background:#0008;
display:none
}

.cart-overlay.open{display:block}

.cart-panel{
position:absolute;
right:0;
top:0;
height:100%;
width:min(440px,100%);
background:#0b0817;
border-left:1px solid #342956;
box-shadow:-20px 0 70px #0008;
padding:22px;
overflow:auto
}

.cart-head{
display:flex;
align-items:center;
justify-content:space-between;
padding-bottom:16px;
border-bottom:1px solid var(--line)
}

.cart-head h2{margin:0}

.cart-item{
display:grid;
grid-template-columns:52px 1fr auto;
gap:12px;
align-items:center;
padding:15px 0;
border-bottom:1px solid #1e1834
}

.cart-item-icon{
width:52px;
height:52px;
display:grid;
place-items:center;
border-radius:13px;
background:#16102a;
font-size:25px
}

.cart-item strong{font-size:13px}

.cart-item small{
display:block;
color:var(--muted);
margin-top:4px
}

.qty{
display:flex;
align-items:center;
gap:7px;
margin-top:8px
}

.qty button{
width:26px;
height:26px;
border-radius:7px;
border:1px solid #3a2b58;
background:#120d21;
color:#fff
}

.remove{
color:#ff8fbb;
font-size:11px;
cursor:pointer;
margin-top:5px
}

.cart-total{
display:flex;
justify-content:space-between;
margin:25px 0 15px;
font-size:21px;
font-weight:900
}

.cart-note{
color:#77718f;
font-size:11px;
line-height:1.5;
margin-top:12px
}

.empty{
text-align:center;
padding:50px 15px;
color:var(--muted)
}

.toast{
position:fixed;
left:50%;
bottom:22px;
transform:translate(-50%,120px);
z-index:200;
background:#16102a;
border:1px solid #4b2e70;
color:#fff;
padding:13px 17px;
border-radius:12px;
transition:.25s;
max-width:90%;
text-align:center
}

.toast.show{
transform:translate(-50%,0)
}

@media(max-width:950px){
nav{display:none}
.hero{grid-template-columns:1fr}
.grid{grid-template-columns:repeat(2,1fr)}
}

@media(max-width:620px){
header{padding:11px 4%}
.account{display:none}
.hero{padding:48px 0}
.grid,.feature,.about,.contact{grid-template-columns:1fr}
h1{font-size:48px}
.section{padding:55px 0}
.hero-art{min-height:300px}
}
</style>
</head>

<body>

<header>

<a class="logo" href="#inicio">
AURORA
<span>DIGITAL</span>
</a>

<nav>
<a href="#inicio">INICIO</a>
<a href="#tienda">TIENDA</a>
<a href="#musica">MÚSICA</a>
<a href="#libros">LIBROS</a>
<a href="#packs">PACKS</a>
<a href="#arte">ARTE DIGITAL</a>
<a href="#colecciones">COLECCIONES</a>
<a href="#sobre">SOBRE MÍ</a>
<a href="#contacto">CONTACTO</a>
</nav>

<div class="actions">

<a class="icon-btn" href="#buscar">⌕</a>

<button class="icon-btn cart-icon" id="openCart">
🛒
<span class="cart-count" id="cartCount">0</span>
</button>

<a class="icon-btn account" href="#sobre">◯</a>

</div>
</header>

<main>

<section class="hero" id="inicio">

<div>

<div class="eyebrow">
CREATIVIDAD · TECNOLOGÍA · PRODUCTOS DIGITALES
</div>

<h1>
Bienvenido a
<span class="gradient">Aurora Digital</span>
</h1>

<p class="lead">
Un espacio digital para descubrir música, libros,
packs, arte y colecciones creadas con creatividad
y tecnología.
</p>

<div class="cta-row">
<a class="btn primary" href="#tienda">Explorar tienda ✦</a>
<a class="btn" href="#colecciones">Ver colecciones</a>
</div>

</div>

<div class="hero-art">
<div class="orbit"></div>
</div>

</section>

<section class="section" id="tienda">

<div class="section-head">
<div>
<h2>Tienda</h2>
<p>Descubre productos digitales de Aurora Digital.</p>
</div>
</div>

<div class="search-box" id="buscar">
<input id="searchInput" type="search" placeholder="Buscar productos...">
</div>

<div class="grid" id="productGrid">

<article class="card product-card"
data-search="100 ideas ganar dinero telefono ebook libro">

<div class="card-visual">📱</div>

<div class="card-body">

<span class="tag">NUEVO · EBOOK</span>

<h3>100 Ideas para Ganar Dinero con tu Teléfono en 2026</h3>

<p>
Guía práctica con 100 ideas, plan de acción
y consejos para evitar estafas.
</p>

<div class="price">$6.99</div>

<button class="buy add-cart" data-id="ebook100">
🛒 Añadir al carrito
</button>

</div>
</article>

<article class="card product-card"
data-search="cancion musica single">

<div class="card-visual">🎵</div>

<div class="card-body">

<span class="tag">MÚSICA</span>

<h3>Canción individual</h3>

<p>Música original para escuchar y disfrutar.</p>

<div class="price">$1.99</div>

<button class="buy disabled" disabled>
🎵 Próximamente
</button>

</div>
</article>

<article class="card product-card"
data-search="album musica aurora sessions">

<div class="card-visual">💿</div>

<div class="card-body">

<span class="tag">MÚSICA</span>

<h3>Aurora Sessions</h3>

<p>Colección de música original.</p>

<div class="price">$7.99</div>

<button class="buy disabled" disabled>
🎵 Próximamente
</button>

</div>
</article>

<article class="card product-card"
data-search="pack sonidos recursos">

<div class="card-visual">🔊</div>

<div class="card-body">

<span class="tag">PACK DIGITAL</span>

<h3>Pack de sonidos</h3>

<p>Recursos digitales para proyectos creativos.</p>

<div class="price">$5.99</div>

<button class="buy disabled" disabled>
🛒 Próximamente
</button>

</div>
</article>

</div>
</section>

<section class="section" id="musica">

<div class="section-head">
<div>
<h2>🎵 Música</h2>
<p>Canciones, álbumes y pistas instrumentales.</p>
</div>
</div>

<div class="grid">

<article class="card">
<div class="card-visual">🎧</div>
<div class="card-body">
<span class="tag">PISTA</span>
<h3>Single digital</h3>
<p>Una pieza musical original para tu colección.</p>
<div class="price">$1.99</div>
<button class="buy disabled" disabled>🎵 Próximamente</button>
</div>
</article>

<article class="card">
<div class="card-visual">💿</div>
<div class="card-body">
<span class="tag">ÁLBUM</span>
<h3>Aurora Sessions</h3>
<p>Colección de música original.</p>
<div class="price">$7.99</div>
<button class="buy disabled" disabled>🎵 Próximamente</button>
