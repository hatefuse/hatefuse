import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

export default async function handler(request) {
  console.log('Checkout function started');

  if (request.method !== 'POST') {
    console.log('Invalid method');
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    const body = await request.json();
    console.log('Received body:', body);

    if (!body.items) {
      console.log('No items in body');
      return new Response(JSON.stringify({ error: 'No items' }), { status: 400 });
    }

    console.log('Creating Stripe session...');
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: body.items.map(item => ({
        price_data: {
          currency: 'usd',
          product_data: { name: `${item.name} - ${item.license}` },
          unit_amount: item.price * 100,
        },
        quantity: 1,
      })),
      mode: 'payment',
      success_url: `${request.headers.get('origin')}/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: request.headers.get('origin') || 'https://hatefuse.vercel.app/',
      metadata: {
        beats: JSON.stringify(body.items.map(item => ({
          id: item.id,
          name: item.name,
          license: item.license,
          price: item.price
        }))),
      },
    });

    console.log('Session created:', session.id);
    return new Response(JSON.stringify({ url: session.url }), { status: 200 });
  } catch (error) {
    console.error('Checkout error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
