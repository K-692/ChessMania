import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

// Enable CORS
app.use(cors());

// Parse JSON body and capture raw body buffer for signature verification
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// Initialize Firebase Admin SDK
const serviceAccountPath = path.resolve('service-account.json');
if (fs.existsSync(serviceAccountPath)) {
  console.log('Found service-account.json. Initializing Firebase Admin...');
  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
  initializeApp({
    credential: cert(serviceAccount)
  });
} else {
  console.log('service-account.json not found. Falling back to application default credentials...');
  try {
    initializeApp();
  } catch (error) {
    console.error('Failed to initialize Firebase Admin SDK. Webhook functionality will fail until authorized.', error);
  }
}

const db = getFirestore();

// Coin packs metadata matching AddFundsModal.tsx configuration
const COIN_PACKS = {
  'pack_100': { coins: 100, priceINR: 9 },
  'pack_1000': { coins: 1000, priceINR: 99 },
  'pack_5000': { coins: 5000, priceINR: 449 },
  'pack_10000': { coins: 10000, priceINR: 899 },
  'pack_25000': { coins: 25000, priceINR: 1999 },
  'pack_50000': { coins: 50000, priceINR: 3999 },
  'pack_100000': { coins: 100000, priceINR: 6999 },
  'pack_250000': { coins: 250000, priceINR: 12999 },
  'pack_500000': { coins: 500000, priceINR: 19999 }
};

const CONVERSION_RATES = {
  INR: 1.0,
  USD: 95.4,
  EUR: 110.0,
  GBP: 127.7
};

// Calculate price in selected currency
function calculatePrice(priceINR, currency) {
  const rate = CONVERSION_RATES[currency] || 1.0;
  const finalPrice = priceINR / rate;
  return Math.round(finalPrice * 100) / 100;
}

// 1. Create Razorpay Order Endpoint
app.post('/api/create-order', async (req, res) => {
  const { packId, currency, userId } = req.body;

  if (!packId || !currency || !userId) {
    return res.status(400).json({ error: 'Missing required parameters: packId, currency, userId' });
  }

  const pack = COIN_PACKS[packId];
  if (!pack) {
    return res.status(400).json({ error: `Invalid packId: ${packId}` });
  }

  const keyId = process.env.VITE_RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    return res.status(500).json({ error: 'Razorpay keys are not configured on the server.' });
  }

  try {
    const finalPrice = calculatePrice(pack.priceINR, currency);
    // Amount must be in the smallest currency sub-unit (paise for INR, cents for USD/EUR/GBP)
    const amountInSubUnit = Math.round(finalPrice * 100);

    console.log(`Creating order for User: ${userId}, Pack: ${packId}, Amount: ${finalPrice} ${currency} (${amountInSubUnit} sub-units)`);

    // Call Razorpay API using native fetch
    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64')
      },
      body: JSON.stringify({
        amount: amountInSubUnit,
        currency: currency,
        receipt: `receipt_order_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        notes: {
          user_id: userId,
          pack_id: packId,
          coins: pack.coins.toString()
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Razorpay API error: ${response.status} - ${errorText}`);
    }

    const order = await response.json();
    return res.status(200).json(order);
  } catch (error) {
    console.error('Failed to create Razorpay order:', error);
    return res.status(500).json({ error: error.message || 'Failed to create order' });
  }
});

// 2. Razorpay Webhook Endpoint
app.post('/api/webhook/razorpay', async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    console.error('Signature verification failed: Missing signature header or webhook secret.');
    return res.status(400).send('Verification failed');
  }

  // Verify Razorpay signature using the raw body
  try {
    const shasum = crypto.createHmac('sha256', webhookSecret);
    shasum.update(req.rawBody);
    const digest = shasum.digest('hex');

    if (digest !== signature) {
      console.error('Signature verification failed: Hashes do not match.');
      return res.status(400).send('Signature verification failed');
    }
  } catch (err) {
    console.error('Error during signature verification:', err);
    return res.status(500).send('Error verifying signature');
  }

  console.log('Webhook signature verified successfully.');

  const event = req.body;

  // We only process 'payment.captured' event
  if (event.event !== 'payment.captured') {
    console.log(`Ignoring unsupported webhook event type: ${event.event}`);
    return res.status(200).send({ status: 'ignored', message: `Event type ${event.event} ignored` });
  }

  const payment = event.payload.payment.entity;
  const paymentId = payment.id;
  const orderId = payment.order_id;
  const amount = payment.amount; // in sub-units
  const currency = payment.currency;
  const notes = payment.notes || {};

  const userId = notes.user_id;
  const packId = notes.pack_id;
  const coinsStr = notes.coins;

  if (!userId || !packId || !coinsStr) {
    console.error('Webhook payload is missing notes metadata: user_id, pack_id, or coins.', notes);
    return res.status(400).send('Missing notes metadata in payment payload');
  }

  const coins = parseInt(coinsStr, 10);
  if (isNaN(coins) || coins <= 0) {
    console.error(`Invalid coins quantity parsed: ${coinsStr}`);
    return res.status(400).send('Invalid coins metadata value');
  }

  const pack = COIN_PACKS[packId];
  const pricePaidINR = pack ? pack.priceINR : Math.round((amount / 100) * (CONVERSION_RATES['INR'] / (CONVERSION_RATES[currency] || 1)));

  try {
    // Check if the database connection was initialized correctly
    if (!db) {
      throw new Error('Firestore DB has not been initialized. Check service-account.json.');
    }

    const txDocRef = db.collection('transactions').doc(paymentId);
    const userDocRef = db.collection('users').doc(userId);
    const ledgerColRef = db.collection('walletLedger');

    // Run a transaction to ensure idempotency and atomic updates
    const result = await db.runTransaction(async (transaction) => {
      // Idempotency check: look up transaction by paymentId doc ID
      const txDoc = await transaction.get(txDocRef);
      if (txDoc.exists) {
        return { status: 'duplicate' };
      }

      // Fetch user profile
      const userDoc = await transaction.get(userDocRef);
      if (!userDoc.exists) {
        throw new Error(`User profile with ID ${userId} does not exist.`);
      }

      const userData = userDoc.data();
      const balanceBefore = userData.bankBalance || 0;
      const balanceAfter = Math.round((balanceBefore + coins) * 10000) / 10000;
      const totalCoinsEarned = (userData.totalCoinsEarned || balanceBefore) + coins;

      // Update user bank balance
      transaction.update(userDocRef, {
        bankBalance: balanceAfter,
        totalCoinsEarned: totalCoinsEarned
      });

      // Write idempotency lock entry
      transaction.set(txDocRef, {
        payment_id: paymentId,
        order_id: orderId || null,
        user_id: userId,
        pack_id: packId,
        coins: coins,
        amount: amount / 100, // major units
        currency: currency,
        status: 'processed',
        processed_at: Date.now()
      });

      // Write ledger entry
      const newLedgerDocRef = ledgerColRef.doc();
      transaction.set(newLedgerDocRef, {
        uid: userId,
        type: 'purchase',
        amount: coins,
        matchId: null,
        balanceBefore: balanceBefore,
        balanceAfter: balanceAfter,
        createdAt: Date.now(),
        pricePaid: amount / 100,
        pricePaidINR: pricePaidINR,
        currency: currency,
        paymentGateway: 'razorpay',
        transactionId: paymentId
      });

      return { status: 'success', balanceBefore, balanceAfter };
    });

    if (result.status === 'duplicate') {
      console.log(`Duplicate webhook. Payment ${paymentId} has already been processed. Ignoring.`);
      return res.status(200).send({ status: 'ignored', message: 'Transaction already processed' });
    }

    console.log(`Successfully credited ${coins} coins to User: ${userId}. Balance: ${result.balanceBefore} -> ${result.balanceAfter}`);
    return res.status(200).json({ status: 'success', message: 'Coins credited successfully' });

  } catch (error) {
    console.error('Failed to process Razorpay webhook transaction:', error);
    return res.status(500).send(error.message || 'Internal database error');
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`Backend server is running on http://localhost:${PORT}`);
});
