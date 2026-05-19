const express = require('express');
const { getDb } = require('../database/init');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Get cart
router.get('/', authenticate, (req, res) => {
  const db = getDb();
  const items = db.prepare(`
    SELECT ci.id, ci.quantity, p.id as product_id, p.name, p.slug, p.price, p.compare_price, p.image, p.stock
    FROM cart_items ci
    JOIN products p ON ci.product_id = p.id
    WHERE ci.user_id = ?
  `).all(req.user.id);

  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  res.json({ items, subtotal, itemCount: items.reduce((sum, i) => sum + i.quantity, 0) });
});

// Add to cart
router.post('/add', authenticate, (req, res) => {
  const { productId, quantity = 1 } = req.body;
  const db = getDb();

  const product = db.prepare('SELECT id, stock FROM products WHERE id = ? AND status = ?').get(productId, 'active');
  if (!product) return res.status(404).json({ error: 'Product not found' });
  if (product.stock < quantity) return res.status(400).json({ error: 'Insufficient stock' });

  const existing = db.prepare('SELECT id, quantity FROM cart_items WHERE user_id = ? AND product_id = ?').get(req.user.id, productId);
  if (existing) {
    const newQty = existing.quantity + parseInt(quantity);
    if (newQty > product.stock) return res.status(400).json({ error: 'Insufficient stock' });
    db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').run(newQty, existing.id);
  } else {
    db.prepare('INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, ?)').run(req.user.id, productId, parseInt(quantity));
  }

  res.json({ message: 'Added to cart' });
});

// Update cart item quantity
router.put('/:id', authenticate, (req, res) => {
  const { quantity } = req.body;
  const db = getDb();

  const item = db.prepare(`
    SELECT ci.*, p.stock FROM cart_items ci JOIN products p ON ci.product_id = p.id
    WHERE ci.id = ? AND ci.user_id = ?
  `).get(req.params.id, req.user.id);

  if (!item) return res.status(404).json({ error: 'Cart item not found' });
  if (quantity > item.stock) return res.status(400).json({ error: 'Insufficient stock' });
  if (quantity < 1) return res.status(400).json({ error: 'Quantity must be at least 1' });

  db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').run(parseInt(quantity), item.id);
  res.json({ message: 'Cart updated' });
});

// Remove from cart
router.delete('/:id', authenticate, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM cart_items WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ message: 'Removed from cart' });
});

// Clear cart
router.delete('/', authenticate, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(req.user.id);
  res.json({ message: 'Cart cleared' });
});

// Apply coupon
router.post('/coupon', authenticate, (req, res) => {
  const { code } = req.body;
  const db = getDb();

  const coupon = db.prepare('SELECT * FROM coupons WHERE code = ? AND active = 1').get(code);
  if (!coupon) return res.status(404).json({ error: 'Invalid coupon code' });
  if (coupon.max_uses && coupon.used_count >= coupon.max_uses) return res.status(400).json({ error: 'Coupon has been fully redeemed' });
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) return res.status(400).json({ error: 'Coupon has expired' });

  const items = db.prepare(`
    SELECT ci.quantity, p.price FROM cart_items ci JOIN products p ON ci.product_id = p.id WHERE ci.user_id = ?
  `).all(req.user.id);
  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  if (subtotal < coupon.min_order) return res.status(400).json({ error: `Minimum order of \u20B9${coupon.min_order} required` });

  let discount = coupon.discount_type === 'percentage'
    ? subtotal * (coupon.discount_value / 100)
    : coupon.discount_value;

  res.json({ discount: Math.min(discount, subtotal), coupon: { code: coupon.code, type: coupon.discount_type, value: coupon.discount_value } });
});

module.exports = router;
