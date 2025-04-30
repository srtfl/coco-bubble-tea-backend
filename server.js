
const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');
const admin = require('firebase-admin');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const createPaymentIntent = async (amount, currency = 'gbp', metadata = {}) => {
  return await stripe.paymentIntents.create({
    amount,
    currency,
    metadata,
  });
};

app.post('/api/create-payment-intent', async (req, res) => {
  try {
    const { amount, metadata } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const paymentIntent = await createPaymentIntent(amount, 'gbp', metadata);
    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    console.error('Error in /api/create-payment-intent:', error.message);
    res.status(500).json({ error: error.message || 'Failed to create payment intent' });
  }
});

app.post('/create-checkout-session', async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'gbp',
            product_data: {
              name: 'Coco Bubble Tea Order',
            },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: 'https://coco-bubble-tea.vercel.app/success',
      cancel_url: 'https://coco-bubble-tea.vercel.app/cancel',
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('Error in /create-checkout-session:', error.message);
    res.status(500).json({ error: error.message || 'Failed to create checkout session' });
  }
});

app.listen(port, () => {
  console.log(`✅ Server running on http://localhost:${port}`);
});
