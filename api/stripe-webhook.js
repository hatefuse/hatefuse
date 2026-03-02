const Stripe = require("stripe");

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = [];
    req.on("data", (chunk) => data.push(chunk));
    req.on("end", () => resolve(Buffer.concat(data)));
    req.on("error", reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const rawBody = await getRawBody(req);
    const sig = req.headers["stripe-signature"];

    const event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    // TODO: your existing fulfillment logic here (R2 + Resend)
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      // your code...
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("stripe-webhook error:", err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
};
