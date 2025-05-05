
require('dotenv').config({ path: process.env.NODE_ENV === 'development' ? '.env.local' : '.env' });

const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');
const admin = require('firebase-admin');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
if (!endpointSecret) {
  console.error('❌ STRIPE_WEBHOOK_SECRET is not defined');
  process.exit(1);
}

let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
  try {
    serviceAccount = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8'));
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
    process.exit(1);
  }
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

const app = express();
const port = process.env.PORT || 3001;

const allowedOrigins = [
  'http://localhost:3000',
  'https://coco-bubble-tea.vercel.app',
  'https://coco-bubble-tea-backend.onrender.com',
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.options('*', cors());
app.use(express.json({ limit: '10mb' }));

// Test Firestore endpoint
app.get('/test-firestore', async (req, res) => {
  try {
    await db.collection('test').doc('test').set({ test: 'ok' });
    res.json({ status: 'Firestore write successful' });
  } catch (error) {
    console.error('❌ Firestore test error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create Payment Intent
app.post('/api/create-payment-intent', async (req, res) => {
  try {
    const { amount, metadata } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount * 100,
      currency: 'gbp',
      metadata,
    });
    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    console.error('❌ Error in /api/create-payment-intent:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Checkout Session
app.post('/create-checkout-session', async (req, res) => {
  try {
    const { cartItems, totalAmount } = req.body;
    const frontendBaseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    const lineItems = cartItems.map(item => ({
      price_data: {
        currency: 'gbp',
        product_data: {
          name: item.name,
          metadata: { size: item.size },
        },
        unit_amount: Math.round(item.price * 100),
      },
      quantity: item.quantity,
    }));

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: `${frontendBaseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendBaseUrl}/cancel`,
      metadata: {
        cartItems: JSON.stringify(cartItems),
        totalAmount: totalAmount.toString(),
      },
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('❌ Error in /create-checkout-session:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Stripe Webhook — must use raw body
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  console.log('Webhook received:', req.headers['stripe-signature']);
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], endpointSecret);
    console.log('Webhook event type:', event.type);
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log('Processing checkout.session.completed:', session.id);

    if (session.payment_status !== 'paid') {
      console.log('Payment not paid, skipping:', session.id);
      return res.json({ received: true });
    }

    const orderRef = db.collection('orders').doc(session.id);
    const orderSnap = await orderRef.get();

    if (!orderSnap.exists) {
      console.log('Writing new order:', session.id);
      let items;
      try {
        items = JSON.parse(session.metadata.cartItems);
      } catch (error) {
        console.error('Failed to parse cartItems:', session.metadata.cartItems, error);
        return res.status(500).json({ error: 'Invalid cartItems format' });
      }
      const totalAmount = parseFloat(session.metadata.totalAmount);
      if (isNaN(totalAmount)) {
        console.error('Invalid totalAmount:', session.metadata.totalAmount);
        return res.status(500).json({ error: 'Invalid totalAmount' });
      }

      try {
        await orderRef.set({
          id: session.id,
          items,
          totalAmount,
          status: 'paid',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log('✅ Order saved successfully:', session.id);
      } catch (error) {
        console.error('❌ Failed to save order:', session.id, error);
        return res.status(500).json({ error: 'Failed to save order' });
      }
    } else {
      console.log('Order already exists:', session.id);
    }
  }

  res.json({ received: true });
});

// Verify Session
app.get('/verify-session', async (req, res) => {
  console.log('Verify-session called with session_id:', req.query.session_id);
  try {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: 'Session ID is required' });

    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.payment_status !== 'paid') {
      const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent);
      return res.status(400).json({
        error: paymentIntent.last_payment_error
          ? paymentIntent.last_payment_error.message
          : 'Payment not completed',
      });
    }

    const orderRef = db.collection('orders').doc(session_id);
    const orderSnap = await orderRef.get();

    if (orderSnap.exists) {
      console.log('✅ Returning existing order for session:', session_id);
      return res.json(orderSnap.data());
    }

    console.log('Writing new order via verify-session:', session_id);
    let cartItems;
    try {
      cartItems = JSON.parse(session.metadata.cartItems);
    } catch (error) {
      console.error('Failed to parse cartItems:', session.metadata.cartItems, error);
      return res.status(500).json({ error: 'Invalid cartItems format' });
    }
    const totalAmount = parseFloat(session.metadata.totalAmount);
    if (isNaN(totalAmount)) {
      console.error('Invalid totalAmount:', session.metadata.totalAmount);
      return res.status(500).json({ error: 'Invalid totalAmount' });
    }

    const newOrder = {
      id: session.id,
      items: cartItems,
      totalAmount,
      status: 'paid',
      prepTime: 15,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    try {
      await orderRef.set(newOrder);
      console.log('✅ Order created via verify-session for session:', session_id);
      return res.json(newOrder);
    } catch (error) {
      console.error('❌ Failed to save order via verify-session:', session_id, error);
      return res.status(500).json({ error: 'Failed to save order' });
    }
  } catch (error) {
    console.error('❌ Error in /verify-session:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`✅ Server running on http://localhost:${port}`);
  console.log('🔥 Backend Firebase project ID:', admin.app().options.credential.projectId);
});
