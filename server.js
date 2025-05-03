const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');
const admin = require('firebase-admin');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY); // ✅ use env var

// 🔐 Load Firebase credentials
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
  try {
    serviceAccount = JSON.parse(
      Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8')
    );
    console.log('✅ Loaded Firebase credentials from FIREBASE_SERVICE_ACCOUNT_BASE64');
  } catch (err) {
    console.error('❌ Failed to parse FIREBASE_SERVICE_ACCOUNT_BASE64:', err);
    process.exit(1);
  }
} else {
  try {
    serviceAccount = require('./serviceAccountKey.json');
    console.log('✅ Loaded Firebase credentials from serviceAccountKey.json');
  } catch (err) {
    console.error('❌ Failed to load serviceAccountKey.json:', err);
    console.error('Please ensure serviceAccountKey.json exists for local development.');
    process.exit(1);
  }
}

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const app = express();
const port = process.env.PORT || 3001;

// ✅ Allow both local and Vercel frontend
const allowedOrigins = [
  'http://localhost:3000',
  'https://coco-bubble-tea.vercel.app'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['POST'],
}));

app.use(express.json());

// Utility to create payment intent
const createPaymentIntent = async (amount, currency = 'gbp', metadata = {}) => {
  return await stripe.paymentIntents.create({
    amount,
    currency,
    metadata,
    // Removed success_url and cancel_url to let frontend handle navigation
  });
};

// 🔹 Route for CardElement-based checkout
app.post('/api/create-payment-intent', async (req, res) => {
  try {
    const { amount, metadata } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const paymentIntent = await createPaymentIntent(amount * 100, 'gbp', metadata); // Convert to cents
    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    console.error('Error in /api/create-payment-intent:', error.message);
    res.status(500).json({ error: error.message || 'Failed to create payment intent' });
  }
});

// 🔹 Route for Stripe Checkout redirect (optional, update success_url)
app.post('/create-checkout-session', async (req, res) => {
  try {
    const { amount } = req.body;
    console.log('🧾 Creating checkout session with amount (pence):', amount);

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const frontendBaseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'gbp',
            product_data: {
              name: 'Coco Bubble Tea Order',
            },
            unit_amount: amount, // Already in pence
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${frontendBaseUrl}/order-confirmation`, // Changed to /order-confirmation
      cancel_url: `${frontendBaseUrl}/`, // Changed to root for simplicity
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