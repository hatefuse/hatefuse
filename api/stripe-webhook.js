import stripePackage from 'stripe';
import { Resend } from 'resend';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const stripe = stripePackage(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

export default async function handler(request) {
  const sig = request.headers.get('stripe-signature');

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      await request.text(),
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error(`Webhook Error: ${err.message}`);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const email = session.customer_details?.email;

    if (!email) return new Response('No email', { status: 200 });

    let beats = [];
    try {
      beats = JSON.parse(session.metadata?.beats || '[]');
    } catch (err) {
      console.error('Metadata parse error:', err);
    }

    const downloads = await Promise.all(
      beats.map(async (beat) => {
        const beatNumber = beat.id.split(' ')[0];
        const fileKey = `full/${beatNumber}_full.wav`;

        try {
          const command = new GetObjectCommand({
            Bucket: process.env.R2_BUCKET,
            Key: fileKey,
          });
          const signedUrl = await getSignedUrl(r2, command, { expiresIn: 604800 });
          return {
            name: beat.name || beat.id,
            license: beat.license,
            url: signedUrl,
          };
        } catch (err) {
          console.error(`Sign URL failed for ${fileKey}:`, err);
          return null;
        }
      })
    ).then(r => r.filter(Boolean));

    try {
      await resend.emails.send({
        from: 'fuse@hatefuse.com',
        to: email,
        subject: 'Your @hatefuse Beat Download 🔥',
        html: `
          <h2>Thanks for copping!</h2>
          <p>Your download links (expire in 7 days):</p>
          <ul>
            ${downloads.map(d => `<li>${d.name} (${d.license}): <a href="${d.url}">Download</a></li>`).join('')}
          </ul>
          <p>License: Non-exclusive lease for WAV. Full rights for exclusive. Credit @hatefuse.</p>
          <p>Questions? DM @hatefuse on instagram.</p>
        `,
      });
      console.log('Email sent to', email);
    } catch (err) {
      console.error('Email failed:', err);
    }
  }

  return new Response('OK', { status: 200 });
}