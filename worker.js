export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Crear factura de QvaPay
    if (url.pathname === "/api/create-invoice") {
      if (request.method !== "POST") {
        return new Response("Método no permitido", { status: 405 });
      }

      const response = await fetch("https://api.qvapay.com/v2/create_invoice", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "app-id": env.QVAPAY_APP_ID,
          "app-secret": env.QVAPAY_APP_SECRET
        },
        body: JSON.stringify({
          amount: 6.99,
          description: "100 Ideas para Ganar Dinero con tu Teléfono en 2026",
          remote_id: "aurora-" + crypto.randomUUID(),
          webhook: new URL("/callback", request.url).href,
          products: [
            {
              name: "100 Ideas para Ganar Dinero con tu Teléfono en 2026",
              price: 6.99,
              quantity: 1
            }
          ]
        })
      });

      const data = await response.json();

      if (!response.ok || !data.url) {
        return Response.json(
          { error: "No se pudo crear la factura", details: data },
          { status: 500 }
        );
      }

      return Response.json({ url: data.url });
    }

    // Callback de QvaPay
    if (url.pathname === "/callback") {
      return new Response("OK", { status: 200 });
    }

    // Servir la página principal
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Aurora Digital", { status: 200 });
  }
};