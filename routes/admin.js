const express = require('express');
const { getDb } = require('../database/init');
const { authenticate, adminOnly } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, adminOnly);

// Dashboard stats
router.get('/stats', (req, res) => {
  const db = getDb();
  const totalOrders = db.prepare('SELECT COUNT(*) as count FROM orders').get().count;
  const totalRevenue = db.prepare('SELECT COALESCE(SUM(total), 0) as total FROM orders WHERE payment_status = ?').get('paid').total;
  const totalCustomers = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'customer'").get().count;
  const totalProducts = db.prepare('SELECT COUNT(*) as count FROM products').get().count;

  const recentOrders = db.prepare(`
    SELECT o.*, u.name as customer_name, u.email as customer_email
    FROM orders o JOIN users u ON o.user_id = u.id
    ORDER BY o.created_at DESC LIMIT 10
  `).all();

  const monthlyRevenue = db.prepare(`
    SELECT strftime('%Y-%m', created_at) as month, SUM(total) as revenue, COUNT(*) as orders
    FROM orders WHERE payment_status = 'paid'
    GROUP BY month ORDER BY month DESC LIMIT 12
  `).all();

  const topProducts = db.prepare(`
    SELECT p.name, p.image, SUM(oi.quantity) as total_sold, SUM(oi.price * oi.quantity) as revenue
    FROM order_items oi JOIN products p ON oi.product_id = p.id
    GROUP BY oi.product_id ORDER BY total_sold DESC LIMIT 5
  `).all();

  const ordersByStatus = db.prepare(`
    SELECT status, COUNT(*) as count FROM orders GROUP BY status
  `).all();

  res.json({ totalOrders, totalRevenue, totalCustomers, totalProducts, recentOrders, monthlyRevenue, topProducts, ordersByStatus });
});

// Products CRUD
router.get('/products', (req, res) => {
  const db = getDb();
  const products = db.prepare(`
    SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id ORDER BY p.created_at DESC
  `).all();
  res.json(products);
});

router.post('/products', (req, res) => {
  const { name, description, price, compare_price, category_id, image, stock, featured, status } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'Name and price required' });

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const db = getDb();

  try {
    const result = db.prepare(`
      INSERT INTO products (name, slug, description, price, compare_price, category_id, image, stock, featured, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, slug, description, price, compare_price || null, category_id || null, image, stock || 0, featured ? 1 : 0, status || 'active');
    res.status(201).json({ id: result.lastInsertRowid, slug });
  } catch {
    res.status(409).json({ error: 'Product with this name already exists' });
  }
});

router.put('/products/:id', (req, res) => {
  const { name, description, price, compare_price, category_id, image, stock, featured, status } = req.body;
  const db = getDb();
  const slug = name ? name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : undefined;

  db.prepare(`
    UPDATE products SET name=?, slug=?, description=?, price=?, compare_price=?, category_id=?, image=?, stock=?, featured=?, status=? WHERE id=?
  `).run(name, slug, description, price, compare_price || null, category_id || null, image, stock || 0, featured ? 1 : 0, status || 'active', req.params.id);

  res.json({ message: 'Product updated' });
});

router.delete('/products/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ message: 'Product deleted' });
});

// Orders management
router.get('/orders', (req, res) => {
  const db = getDb();
  const { status, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  let where = '1=1';
  let params = [];

  if (status) { where += ' AND o.status = ?'; params.push(status); }

  const orders = db.prepare(`
    SELECT o.*, u.name as customer_name, u.email as customer_email
    FROM orders o JOIN users u ON o.user_id = u.id
    WHERE ${where} ORDER BY o.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);

  orders.forEach(o => {
    o.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id);
  });

  const total = db.prepare(`SELECT COUNT(*) as cnt FROM orders o WHERE ${where}`).get(...params).cnt;
  res.json({ orders, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) });
});

router.put('/orders/:id/status', (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const db = getDb();
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ message: 'Order status updated' });
});

// Customers
router.get('/customers', (req, res) => {
  const db = getDb();
  const customers = db.prepare(`
    SELECT u.id, u.name, u.email, u.phone, u.created_at,
    COUNT(DISTINCT o.id) as order_count,
    COALESCE(SUM(o.total), 0) as total_spent
    FROM users u LEFT JOIN orders o ON u.id = o.user_id
    WHERE u.role = 'customer'
    GROUP BY u.id ORDER BY u.created_at DESC
  `).all();
  res.json(customers);
});

// Categories CRUD
router.get('/categories', (req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT * FROM categories ORDER BY name').all());
});

router.post('/categories', (req, res) => {
  const { name, description, image } = req.body;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const db = getDb();
  try {
    const r = db.prepare('INSERT INTO categories (name, slug, description, image) VALUES (?, ?, ?, ?)').run(name, slug, description, image);
    res.status(201).json({ id: r.lastInsertRowid });
  } catch {
    res.status(409).json({ error: 'Category already exists' });
  }
});

router.delete('/categories/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.json({ message: 'Category deleted' });
});

// Coupons
router.get('/coupons', (req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT * FROM coupons ORDER BY id DESC').all());
});

router.post('/coupons', (req, res) => {
  const { code, discount_type, discount_value, min_order, max_uses, expires_at } = req.body;
  const db = getDb();
  try {
    db.prepare('INSERT INTO coupons (code, discount_type, discount_value, min_order, max_uses, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(code, discount_type, discount_value, min_order || 0, max_uses || null, expires_at || null);
    res.status(201).json({ message: 'Coupon created' });
  } catch {
    res.status(409).json({ error: 'Coupon code already exists' });
  }
});

router.delete('/coupons/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM coupons WHERE id = ?').run(req.params.id);
  res.json({ message: 'Coupon deleted' });
});

module.exports = router;
