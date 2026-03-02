const Stripe = require("stripe");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    // Vercel may give req.body as object OR string depending on client + headers
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const items = body.items;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Cart is empty" });
    }

    const origin = req.headers.origin || `https://${req.headers.host}`;

    const line_items = items.map((item) => ({
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: Math.round(Number(item.price) * 100),
        product_data: {
          name: `${item.name} — ${item.license}`,
        },
      },
    }));

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items,
      success_url: `${origin}/?success=true`,
      cancel_url: `${origin}/?canceled=true`,
      metadata: { items: JSON.stringify(items) },
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("create-checkout error:", err);
    return res.status(500).json({ error: err.message || "Checkout error" });
  }
};

