import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(request) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    const body = await request.json();  // <-- correct for Vercel Web Request
    const { items } = body;

    if (!items || !Array.isArray(items)) {
      return new Response(JSON.stringify({ error: 'Invalid items' }), { status: 400 });
    }

    const lineItems = items.map(item => ({
      price_data: {
        currency: 'usd',
        product_data: { name: `${item.name} - ${item.license}` },
        unit_amount: item.price * 100,
      },
      quantity: 1,
    }));

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: `${request.headers.get('origin') || 'https://hatefuse.vercel.app'}/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${request.headers.get('origin') || 'https://hatefuse.vercel.app'}/`,
      metadata: {
        beats: JSON.stringify(items.map(item => ({
          id: item.id,
          name: item.name,
          license: item.license,
          price: item.price
        }))),
      },
    });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Checkout error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
