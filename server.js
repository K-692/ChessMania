import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getDatabase } from 'firebase-admin/database';

// Load environment variables
dotenv.config();

// Razorpay Environment Diagnostics
const rzpKeyId = process.env.VITE_RAZORPAY_KEY_ID?.trim();
const rzpKeySecret = process.env.RAZORPAY_KEY_SECRET?.trim();

console.log('----------------------------------------------------');
console.log('📊 [Diagnostics] Checking Razorpay Configuration:');
if (!rzpKeyId) {
  console.error('❌ VITE_RAZORPAY_KEY_ID is missing from the environment!');
} else {
  console.log(`✅ VITE_RAZORPAY_KEY_ID: "${rzpKeyId.substring(0, 8)}..." (Length: ${rzpKeyId.length})`);
}

if (!rzpKeySecret) {
  console.error('❌ RAZORPAY_KEY_SECRET is missing from the environment!');
} else {
  const maskedSecret = rzpKeySecret.length > 6 
    ? `${rzpKeySecret.substring(0, 3)}...${rzpKeySecret.substring(rzpKeySecret.length - 3)}`
    : '***';
  console.log(`✅ RAZORPAY_KEY_SECRET: "${maskedSecret}" (Length: ${rzpKeySecret.length})`);
}
console.log('----------------------------------------------------');

const app = express();
const PORT = process.env.PORT || 5001;

// Enable CORS
app.use(cors());

// Parse JSON body
app.use(express.json());

// Initialize Firebase Admin SDK
const serviceAccountPath = path.resolve('service-account.json');
const databaseURL = process.env.FIREBASE_DATABASE_URL || 'https://check-mate-6e0a7-default-rtdb.firebaseio.com';
if (fs.existsSync(serviceAccountPath)) {
  console.log('Found service-account.json. Initializing Firebase Admin...');
  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
  initializeApp({
    credential: cert(serviceAccount),
    databaseURL
  });
} else {
  console.log('service-account.json not found. Falling back to application default credentials...');
  try {
    initializeApp({
      databaseURL
    });
  } catch (error) {
    console.error('Failed to initialize Firebase Admin SDK. Webhook functionality will fail until authorized.', error);
  }
}

const db = getFirestore();
const rtdb = getDatabase();

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

  const keyId = (process.env.VITE_RAZORPAY_KEY_ID || '').trim();
  const keySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();

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

// 2. Verify Razorpay Payment Endpoint
app.post('/api/verify-payment', async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing required parameters: razorpay_order_id, razorpay_payment_id, razorpay_signature' });
  }

  const keyId = (process.env.VITE_RAZORPAY_KEY_ID || '').trim();
  const keySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();

  if (!keyId || !keySecret) {
    return res.status(500).json({ error: 'Razorpay keys are not configured on the server.' });
  }

  // Verify the signature
  try {
    const generated_signature = crypto
      .createHmac('sha256', keySecret)
      .update(razorpay_order_id + '|' + razorpay_payment_id)
      .digest('hex');

    if (generated_signature !== razorpay_signature) {
      console.error('Payment verification failed: Signature mismatch.');
      return res.status(400).json({ error: 'Signature verification failed.' });
    }
  } catch (err) {
    console.error('Error during signature verification:', err);
    return res.status(500).json({ error: 'Error verifying signature.' });
  }

  console.log(`Payment signature verified. Fetching order details from Razorpay: ${razorpay_order_id}`);

  try {
    // Fetch order details from Razorpay to safely read notes (coins, packId, userId)
    const response = await fetch(`https://api.razorpay.com/v1/orders/${razorpay_order_id}`, {
      method: 'GET',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64')
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Razorpay API error fetching order: ${response.status} - ${errorText}`);
    }

    const orderData = await response.json();
    const notes = orderData.notes || {};
    const userId = notes.user_id;
    const packId = notes.pack_id;
    const coinsStr = notes.coins;

    if (!userId || !packId || !coinsStr) {
      console.error('Razorpay order notes are missing required metadata:', notes);
      return res.status(400).json({ error: 'Missing metadata notes in Razorpay order.' });
    }

    const coins = parseInt(coinsStr, 10);
    if (isNaN(coins) || coins <= 0) {
      console.error(`Invalid coins quantity parsed: ${coinsStr}`);
      return res.status(400).json({ error: 'Invalid coins quantity in order metadata.' });
    }

    const amount = orderData.amount; // in sub-units
    const currency = orderData.currency;

    const pack = COIN_PACKS[packId];
    const pricePaidINR = pack ? pack.priceINR : Math.round((amount / 100) * (CONVERSION_RATES['INR'] / (CONVERSION_RATES[currency] || 1)));

    // Check if the database connection was initialized correctly
    if (!db) {
      throw new Error('Firestore DB has not been initialized. Check service-account.json.');
    }

    const txDocRef = db.collection('transactions').doc(razorpay_payment_id);
    const userDocRef = db.collection('users').doc(userId);

    // Run a transaction to ensure idempotency and atomic updates
    const result = await db.runTransaction(async (transaction) => {
      // Idempotency check
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
      const balanceBefore = userData.currentBalance || userData.bankBalance || 0;
      const balanceAfter = Math.round((balanceBefore + coins) * 10000) / 10000;
      const totalCoinsEarned = (userData.totalCoinsEarned || 0) + coins;

      // Update user bank balance
      transaction.update(userDocRef, {
        currentBalance: balanceAfter,
        bankBalance: balanceAfter, // compatibility
        totalCoinsEarned: totalCoinsEarned,
        updatedAt: Date.now()
      });

      // Write unified transaction entry (Mark order as completed)
      transaction.set(txDocRef, {
        transactionId: razorpay_payment_id,
        userId: userId,
        type: 'coinPack',
        amount: amount / 100, // major units
        coins: coins,
        currency: currency,
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        packId: packId,
        status: 'processed',
        processedAt: Date.now(),
        createdAt: Date.now(),
        balanceBefore: balanceBefore,
        balanceAfter: balanceAfter,
        matchId: null,
        pricePaid: amount / 100,
        pricePaidINR: pricePaidINR,
        paymentGateway: 'razorpay',
        // backward compatibility keys
        payment_id: razorpay_payment_id,
        order_id: razorpay_order_id,
        user_id: userId,
        pack_id: packId,
        processed_at: Date.now()
      });

      return { status: 'success', balanceBefore, balanceAfter };
    });

    if (result.status === 'duplicate') {
      console.log(`Duplicate verify call. Payment ${razorpay_payment_id} has already been processed.`);
      return res.status(200).json({ status: 'success', message: 'Transaction already processed' });
    }

    console.log(`Successfully credited ${coins} coins to User: ${userId}. Balance: ${result.balanceBefore} -> ${result.balanceAfter}`);
    return res.status(200).json({ status: 'success', message: 'Coins credited successfully' });

  } catch (error) {
    console.error('Failed to process payment verification:', error);
    return res.status(500).json({ error: error.message || 'Internal database error' });
  }
});

// Periodic matchmaking queue cleanup function in RTDB
async function cleanExpiredMatchmaking() {
  try {
    const now = Date.now();
    const oneMinAgo = now - 60000;
    const fiveMinsAgo = now - 300000;
    
    const dbRef = rtdb.ref('match_queue');
    const snapshot = await dbRef.once('value');
    if (!snapshot.exists()) return;

    const queues = snapshot.val();
    let deleteCount = 0;

    for (const timeControl in queues) {
      const entries = queues[timeControl];
      for (const playerId in entries) {
        const entry = entries[playerId];
        const timestamp = entry.queuedAt || entry.createdAt || 0;
        const status = entry.status || 'waiting';
        const limit = (status === 'waiting') ? oneMinAgo : fiveMinsAgo;

        if (timestamp < limit) {
          await rtdb.ref(`match_queue/${timeControl}/${playerId}`).remove();
          deleteCount++;
        }
      }
    }

    if (deleteCount > 0) {
      console.log(`[Cleanup] Deleted ${deleteCount} expired matchmaking entries from RTDB.`);
    }
  } catch (error) {
    console.error('[Cleanup] Failed to clean expired matchmaking entries:', error);
  }
}

// Run matchmaking queue cleanup every 5 minutes
setInterval(cleanExpiredMatchmaking, 5 * 60 * 1000);

// Start Server
app.listen(PORT, () => {
  console.log(`Backend server is running on http://localhost:${PORT}`);
});
