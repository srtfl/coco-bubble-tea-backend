require('dotenv').config({ path: process.env.NODE_ENV === 'development' ? '.env.local' : '.env' });

  const express = require('express');
  const cors = require('cors');
  const Stripe = require('stripe');
  const admin = require('firebase-admin');

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

  // Load Firebase credentials
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

  // Allow both local and Vercel frontend
  const allowedOrigins = [
    'http://localhost:3000',
    'https://coco-bubble-tea-4th1.vercel.app', // Updated to match your frontend URL
    'https://coco-bubble-tea-backend.onrender.com' 
  ];

  app.use(cors({
    origin: function (origin, callback) {
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

  app.use(express.json());

  // Utility to create payment intent
  const createPaymentIntent = async (amount, currency = 'gbp', metadata = {}) => {
    return await stripe.paymentIntents.create({
      amount,
      currency,
      metadata,
    });
  };

  // Route for CardElement-based checkout
  app.post('/api/create-payment-intent', async (req, res) => {
    try {
      const { amount, metadata } = req.body;
      if (!amount || amount <= 0) {
        return res.status(400).json({ error: 'Invalid amount' });
      }

      const paymentIntent = await createPaymentIntent(amount * 100, 'gbp', metadata);
      res.json({ clientSecret: paymentIntent.client_secret });
    } catch (error) {
      console.error('Error in /api/create-payment-intent:', error.message);
      res.status(500).json({ error: error.message || 'Failed to create payment intent' });
    }
  });

  // Route for Stripe Checkout redirect
  app.post('/create-checkout-session', async (req, res) => {
    try {
      const { cartItems, totalAmount } = req.body;
      console.log('🧾 Creating checkout session with totalAmount (pounds):', totalAmount);
      console.log('🧾 Cart Items:', cartItems);

      if (!cartItems || cartItems.length === 0 || !totalAmount || totalAmount <= 0) {
        return res.status(400).json({ error: 'Invalid cartItems or totalAmount' });
      }

      const frontendBaseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      console.log('Using frontendBaseUrl:', frontendBaseUrl); // Debug log

      const lineItems = cartItems.map(item => {
        const lineItem = {
          price_data: {
            currency: 'gbp',
            product_data: {
              name: item.name,
              metadata: {
                size: item.size,
              },
            },
            unit_amount: Math.round(item.price * 100), // Convert price to pence
          },
          quantity: item.quantity,
        };
        return lineItem;
      });

      console.log('🧾 Generated lineItems:', lineItems);

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: lineItems,
        mode: 'payment',
        success_url: `${frontendBaseUrl}/success`,
        cancel_url: `${frontendBaseUrl}/cancel`,
        metadata: {
          cartItems: JSON.stringify(cartItems),
        },
      });

      console.log('✅ Stripe session created:', session.id);
      res.json({ id: session.id });
    } catch (error) {
      console.error('❌ Error in /create-checkout-session:', error.message);
      console.error('❌ Full error:', error);
      res.status(500).json({ error: error.message || 'Failed to create checkout session' });
    }
  });

  // Route to verify session
  app.get('/verify-session', async (req, res) => {
    try {
      const { session_id } = req.query;
      const session = await stripe.checkout.sessions.retrieve(session_id);
      if (session.payment_status === 'paid') {
        const cartItems = JSON.parse(session.metadata.cartItems);
        res.json({ totalAmount: session.amount_total / 100, cartItems });
      } else {
        const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent);
        res.status(400).json({
          error: paymentIntent.last_payment_error
            ? paymentIntent.last_payment_error.message
            : 'Payment not completed'
        });
      }
    } catch (error) {
      console.error('❌ Error in /verify-session:', error.message);
      res.status(500).json({ error: error.message || 'Failed to verify session' });
    }
  });

  app.listen(port, () => {
    console.log(`✅ Server running on http://localhost:${port}`);
  });