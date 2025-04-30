// server.js
const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');
const admin = require('firebase-admin');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY); // ✅ use env var

// 🔐 Load Firebase credentials from base64 env var
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
  try {
    serviceAccount = JSON.parse(
      Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8')
    );
  } catch (err) {
    console.error('❌ Failed to parse FIREBASE_SERVICE_ACCOUNT_BASE64:', err);
  }
} else {
  console.error('❌ FIREBASE_SERVICE_ACCOUNT_BASE64 not defined');
}

if (serviceAccount) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Utility to create payment intent
const createPaymentIntent = async (amount, currency = 'gbp', metadata = {}) => {
  return await stripe.paymentIntents.create({
    amount,
    currency,
    metadata,
  });
};

// 🔹 Route for CardElement-based checkout
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

// 🔹 Route for Stripe Checkout redirect
app.post('/create-checkout-session', async (req, res) => {
  try {
    const { amount } = req.body;
    console.log('🧾 Creating checkout session with amount (pence):', amount);

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

    console.log('✅ Stripe session created:', session.url);
    res.json({ url: session.url });
  } catch (error) {
    console.error('❌ Error in /create-checkout-session:', error.message);
    res.status(500).json({ error: error.message || 'Failed to create checkout session' });
  }
});

app.listen(port, () => {
  console.log(`✅ Server running on http://localhost:${port}`);
});
