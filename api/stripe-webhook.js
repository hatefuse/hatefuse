import Stripe from "stripe";
import { Resend } from "resend";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

// Needed for Stripe signature verification
export const config = {
  api: {
    bodyParser: false,
  },
};

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Extracts "001" from "001 @hatefuse"
function getR2KeyFromName(name) {
  const beatNumber = name.substring(0, 3);
  return `${beatNumber}_full.wav`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const rawBody = await getRawBody(req);
    const signature = req.headers["stripe-signature"];

    const event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    if (event.type !== "checkout.session.completed") {
      return res.status(200).json({ received: true });
    }

    const session = event.data.object;

    const buyerEmail = session.customer_details?.email;
    if (!buyerEmail) {
      return res.status(200).json({ received: true });
    }

    const items = session.metadata?.items
      ? JSON.parse(session.metadata.items)
      : [];

    if (!items.length) {
      return res.status(200).json({ received: true });
    }

    const links = [];

    for (const item of items) {
      const key = getR2KeyFromName(item.name);

      const signedUrl = await getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: process.env.R2_BUCKET,
          Key: key,
        }),
        { expiresIn: 60 * 60 * 24 } // 24 hours
      );

      links.push({
        name: item.name,
        url: signedUrl,
      });
    }

    const html = `
      <div style="font-family: Arial, sans-serif;">
        <h2>Your hatefuse download${links.length > 1 ? "s" : ""}</h2>
        <p>Links expire in 24 hours.</p>
        <ul>
          ${links
            .map(
              (l) =>
                `<li><a href="${l.url}" target="_blank">${l.name}</a></li>`
            )
            .join("")}
        </ul>
        <p>— hatefuse</p>
      </div>
    `;

    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL,
      to: buyerEmail,
      subject: "Your hatefuse download link",
      html,
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
}


