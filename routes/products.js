const express = require('express');
const { getDb } = require('../database/init');
const { optionalAuth } = require('../middleware/auth');

const router = express.Router();

// Get all products with filters
router.get('/', optionalAuth, (req, res) => {
  const db = getDb();
  const { category, search, sort, featured, page = 1, limit = 12 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  let where = ['p.status = ?'];
  let params = ['active'];

  if (category) {
    where.push('c.slug = ?');
    params.push(category);
  }
  if (search) {
    where.push('(p.name LIKE ? OR p.description LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (featured === 'true') {
    where.push('p.featured = 1');
  }

  let orderBy = 'p.created_at DESC';
  if (sort === 'price_asc') orderBy = 'p.price ASC';
  else if (sort === 'price_desc') orderBy = 'p.price DESC';
  else if (sort === 'rating') orderBy = 'p.rating DESC';
  else if (sort === 'name') orderBy = 'p.name ASC';

  const whereClause = where.join(' AND ');
  const countResult = db.prepare(`SELECT COUNT(*) as total FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE ${whereClause}`).get(...params);

  const products = db.prepare(`
    SELECT p.*, c.name as category_name, c.slug as category_slug
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE ${whereClause}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);

  res.json({
    products,
    total: countResult.total,
    page: parseInt(page),
    totalPages: Math.ceil(countResult.total / parseInt(limit))
  });
});

// Get single product
router.get('/:slug', (req, res) => {
  const db = getDb();
  const product = db.prepare(`
    SELECT p.*, c.name as category_name, c.slug as category_slug
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.slug = ?
  `).get(req.params.slug);

  if (!product) return res.status(404).json({ error: 'Product not found' });

  const reviews = db.prepare(`
    SELECT r.*, u.name as user_name
    FROM reviews r
    JOIN users u ON r.user_id = u.id
    WHERE r.product_id = ?
    ORDER BY r.created_at DESC
    LIMIT 10
  `).all(product.id);

  const relatedProducts = db.prepare(`
    SELECT * FROM products WHERE category_id = ? AND id != ? AND status = 'active' LIMIT 4
  `).all(product.category_id, product.id);

  res.json({ product, reviews, relatedProducts });
});

// Get categories
router.get('/meta/categories', (req, res) => {
  const db = getDb();
  const categories = db.prepare(`
    SELECT c.*, COUNT(p.id) as product_count
    FROM categories c
    LEFT JOIN products p ON p.category_id = c.id AND p.status = 'active'
    GROUP BY c.id
  `).all();
  res.json(categories);
});

module.exports = router;
