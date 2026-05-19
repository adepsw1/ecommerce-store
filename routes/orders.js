const express = require('express');
const { getDb } = require('../database/init');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Get user orders
router.get('/', authenticate, (req, res) => {
  const db = getDb();
  const orders = db.prepare(`
    SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC
  `).all(req.user.id);

  orders.forEach(order => {
    order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  });

  res.json(orders);
});

// Get single order
router.get('/:id', authenticate, (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  res.json(order);
});

// Create order from cart
router.post('/', authenticate, (req, res) => {
  const { shipping_name, shipping_address, shipping_city, shipping_state, shipping_zip, shipping_country, notes, coupon_code } = req.body;
  const db = getDb();

  const cartItems = db.prepare(`
    SELECT ci.quantity, p.id as product_id, p.name, p.price, p.image, p.stock
    FROM cart_items ci
    JOIN products p ON ci.product_id = p.id
    WHERE ci.user_id = ?
  `).all(req.user.id);

  if (cartItems.length === 0) return res.status(400).json({ error: 'Cart is empty' });

  // Validate stock
  for (const item of cartItems) {
    if (item.stock < item.quantity) {
      return res.status(400).json({ error: `Insufficient stock for ${item.name}` });
    }
  }

  const subtotal = cartItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const tax = Math.round(subtotal * 0.05 * 100) / 100; // 5% GST
  const shipping = subtotal >= 999 ? 0 : 99;

  let discount = 0;
  if (coupon_code) {
    const coupon = db.prepare('SELECT * FROM coupons WHERE code = ? AND active = 1').get(coupon_code);
    if (coupon && subtotal >= coupon.min_order) {
      discount = coupon.discount_type === 'percentage'
        ? subtotal * (coupon.discount_value / 100)
        : coupon.discount_value;
      discount = Math.min(discount, subtotal);
      db.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?').run(coupon.id);
    }
  }

  const total = Math.round((subtotal + tax + shipping - discount) * 100) / 100;

  const createOrder = db.transaction(() => {
    const orderResult = db.prepare(`
      INSERT INTO orders (user_id, total, subtotal, tax, shipping, shipping_name, shipping_address, shipping_city, shipping_state, shipping_zip, shipping_country, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.user.id, total, subtotal, tax, shipping, shipping_name, shipping_address, shipping_city, shipping_state, shipping_zip, shipping_country, notes);

    const orderId = orderResult.lastInsertRowid;

    const insertItem = db.prepare('INSERT INTO order_items (order_id, product_id, product_name, product_image, price, quantity) VALUES (?, ?, ?, ?, ?, ?)');
    const updateStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');

    cartItems.forEach(item => {
      insertItem.run(orderId, item.product_id, item.name, item.image, item.price, item.quantity);
      updateStock.run(item.quantity, item.product_id);
    });

    db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(req.user.id);

    return orderId;
  });

  const orderId = createOrder();
  res.status(201).json({ orderId, total });
});

// Add review
router.post('/review', authenticate, (req, res) => {
  const { productId, rating, comment } = req.body;
  if (!productId || !rating || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Valid product ID and rating (1-5) required' });
  }

  const db = getDb();

  // Check if user purchased this product
  const purchased = db.prepare(`
    SELECT 1 FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    WHERE o.user_id = ? AND oi.product_id = ? AND o.status != 'cancelled'
  `).get(req.user.id, productId);

  if (!purchased) return res.status(403).json({ error: 'You can only review products you have purchased' });

  try {
    db.prepare('INSERT INTO reviews (user_id, product_id, rating, comment) VALUES (?, ?, ?, ?)')
      .run(req.user.id, productId, rating, comment);

    // Update product rating
    const stats = db.prepare('SELECT AVG(rating) as avg_rating, COUNT(*) as count FROM reviews WHERE product_id = ?').get(productId);
    db.prepare('UPDATE products SET rating = ?, review_count = ? WHERE id = ?')
      .run(Math.round(stats.avg_rating * 10) / 10, stats.count, productId);

    res.json({ message: 'Review added' });
  } catch {
    res.status(409).json({ error: 'You have already reviewed this product' });
  }
});

module.exports = router;
