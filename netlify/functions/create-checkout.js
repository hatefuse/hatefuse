const Stripe = require("stripe");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: "Method Not Allowed"
    };
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const { items } = JSON.parse(event.body || "{}");

    if (!Array.isArray(items) || items.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Cart is empty" })
      };
    }

    const origin =
      event.headers.origin ||
      `https://${event.headers.host}`;

    const line_items = items.map((item) => ({
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: Math.round(Number(item.price) * 100),
        product_data: {
          name: `${item.name} — ${item.license}`
        }
      }
    }));

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items,
      success_url: `${origin}/?success=true`,
      cancel_url: `${origin}/?canceled=true`,
      metadata: {
        items: JSON.stringify(items)
      }
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};