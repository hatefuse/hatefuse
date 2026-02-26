const Stripe = require("stripe");
const { Resend } = require("resend");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const resend = new Resend(process.env.RESEND_API_KEY);

  const sig = event.headers["stripe-signature"];
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (stripeEvent.type !== "checkout.session.completed") {
    return { statusCode: 200, body: "Ignored" };
  }

  try {
    const session = stripeEvent.data.object;

    const buyerEmail =
      session.customer_details?.email ||
      session.customer_email;

    if (!buyerEmail) {
      return { statusCode: 400, body: "No customer email found." };
    }

    const items = JSON.parse(session.metadata?.items || "[]");
    if (!Array.isArray(items) || items.length === 0) {
      return { statusCode: 400, body: "No items in metadata." };
    }

    const s3 = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });

    // IMPORTANT: Upload your zips to R2 like:
    // full/001_wav.zip
    // full/001_exclusive.zip
    const keyFor = (name, license) => {
      const num = String(name).trim().split(" ")[0]; // "001"
      const lic = license === "Exclusive" ? "exclusive" : "wav";
      return `full/${num}_${lic}.zip`;
    };

    const links = [];
    for (const it of items) {
      const Key = keyFor(it.name, it.license);

      const cmd = new GetObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key,
      });

      const url = await getSignedUrl(s3, cmd, { expiresIn: 60 * 60 * 24 }); // 24h
      links.push({ name: it.name, license: it.license, url });
    }

    const html = `
      <div style="font-family:Arial,sans-serif;">
        <h2>Your hatefuse download links</h2>
        <p>Links expire in 24 hours.</p>
        <ul>
          ${links.map(l => `
            <li>
              <b>${l.name}</b> — ${l.license}<br/>
              <a href="${l.url}">Download</a>
            </li>
          `).join("")}
        </ul>
        <p>If anything breaks, reply to this email: ${process.env.FROM_EMAIL}</p>
      </div>
    `;

    await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to: buyerEmail,
      subject: "Your hatefuse beat download",
      html,
    });

    return { statusCode: 200, body: "OK" };
  } catch (err) {
    return { statusCode: 500, body: `Server Error: ${err.message}` };
  }
};