// netlify/functions/stripe-webhook.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Resend } = require('resend');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const resend = new Resend(process.env.RESEND_API_KEY);

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

exports.handler = async (event) => {
  const sig = event.headers['stripe-signature'];

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error(`Webhook signature verification failed: ${err.message}`);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const email = session.customer_details?.email;

    if (!email) {
      console.error('No email found in session');
      return { statusCode: 200 };
    }

    let beats = [];
    try {
      beats = JSON.parse(session.metadata?.beats || '[]');
    } catch (err) {
      console.error('Failed to parse metadata.beats:', err);
    }

    const downloads = await Promise.all(
      beats.map(async (beat) => {
        const beatNumber = beat.id.split(' ')[0]; // e.g. '007'
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
      const { data, error } = await resend.emails.send({
        from: 'fuse@hatefuse.com',  // ← Updated to your email
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
          <p>License terms: Non-exclusive lease for WAV. Full rights for exclusive. Credit @hatefuse if used publicly.</p>
          <p>Questions? Hit me on instagram @hatefuse.</p>
        `,
      });

      if (error) {
        console.error('Resend error:', error);
      } else {
        console.log('Email sent to', email, data);
      }
    } catch (err) {
      console.error('Failed to send email:', err);
    }
  }

  return { statusCode: 200 };
};