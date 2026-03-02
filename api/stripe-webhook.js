import Stripe from 'stripe';
import { Resend } from 'resend';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
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

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      await request.text(),
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_details?.email;

    if (!email) {
      console.warn('No email in session');
      return new Response('No email', { status: 200 });
    }

    let beats = [];
    try {
      beats = JSON.parse(session.metadata?.beats || '[]');
    } catch (err) {
      console.error('Failed to parse beats metadata:', err);
    }

    const downloads = await Promise.all(
      beats.map(async (beat) => {
        const beatNumber = beat.id.split(' ')[0]; // e.g. '001' from '001 @hatefuse'
        const fileKey = `full/${beatNumber}_full.wav`;

        try {
          const command = new GetObjectCommand({
            Bucket: process.env.R2_BUCKET,
            Key: fileKey,
          });

          const signedUrl = await getSignedUrl(r2, command, { expiresIn: 604800 }); // 7 days

          return {
            name: beat.name || beat.id,
            license: beat.license,
            url: signedUrl,
          };
        } catch (err) {
          console.error(`Failed to sign URL for ${fileKey}:`, err);
          return null;
        }
      })
    ).then(results => results.filter(Boolean));

    try {
      await resend.emails.send({
        from: 'fuse@hatefuse.com',
        to: email,
        subject: 'Your @hatefuse Beat Download 🔥',
        html: `
          <h2>Thanks for copping!</h2>
          <p>Your download links (expire in 7 days — save them!):</p>
          <ul>
            ${downloads.map(d => `
              <li>
                ${d.name} (${d.license}): 
                <a href="${d.url}" style="color:#00ff9d;">Download WAV</a>
              </li>
            `).join('')}
          </ul>
          <p>License: Non-exclusive lease for WAV. Full rights for exclusive. Credit @hatefuse if used publicly.</p>
          <p>Questions? DM @hatefuse on X.</p>
        `,
      });
      console.log(`Email sent to ${email}`);
    } catch (err) {
      console.error('Failed to send email:', err);
    }
  }

  return new Response('OK', { status: 200 });
}