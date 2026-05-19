const express = require('express');
const { getDb } = require('../database/init');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Create payment intent
router.post('/create-intent', authenticate, (req, res) => {
  const { orderId } = req.body;
  const db = getDb();

  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(orderId, req.user.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.payment_status === 'paid') return res.status(400).json({ error: 'Order already paid' });

  // If Stripe is configured, use it
  if (process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_SECRET_KEY.includes('REPLACE')) {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    stripe.paymentIntents.create({
      amount: Math.round(order.total * 100),
      currency: 'usd',
      metadata: { orderId: String(orderId) }
    }).then(intent => {
      db.prepare('UPDATE orders SET payment_intent = ? WHERE id = ?').run(intent.id, orderId);
      res.json({ clientSecret: intent.client_secret, publishableKey: process.env.STRIPE_PUBLISHABLE_KEY });
    }).catch(err => {
      res.status(500).json({ error: 'Payment service error' });
    });
  } else {
    // Demo mode - simulate payment
    const fakeIntentId = 'pi_demo_' + Date.now();
    db.prepare('UPDATE orders SET payment_intent = ? WHERE id = ?').run(fakeIntentId, orderId);
    res.json({ clientSecret: 'demo_' + fakeIntentId, publishableKey: 'demo', demoMode: true });
  }
});

// Confirm payment (for demo mode)
router.post('/confirm', authenticate, (req, res) => {
  const { orderId } = req.body;
  const db = getDb();

  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(orderId, req.user.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  db.prepare('UPDATE orders SET payment_status = ?, status = ? WHERE id = ?').run('paid', 'processing', orderId);
  res.json({ message: 'Payment confirmed', orderId });
});

// Stripe webhook (for production)
router.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY.includes('REPLACE')) {
    return res.json({ received: true });
  }

  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers['stripe-signature'];

  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object;
      const db = getDb();
      db.prepare('UPDATE orders SET payment_status = ?, status = ? WHERE payment_intent = ?')
        .run('paid', 'processing', intent.id);
    }
    res.json({ received: true });
  } catch {
    res.status(400).json({ error: 'Webhook error' });
  }
});

module.exports = router;
