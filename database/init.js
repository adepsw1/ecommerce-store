const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

let db;

function getDb() {
  if (!db) {
    db = new Database(path.join(__dirname, '..', 'store.db'));
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initDatabase() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT DEFAULT '',
      role TEXT DEFAULT 'customer' CHECK(role IN ('customer','admin')),
      avatar TEXT,
      google_id TEXT,
      phone TEXT,
      phone_verified INTEGER DEFAULT 0,
      address TEXT,
      city TEXT,
      state TEXT,
      zip TEXT,
      country TEXT DEFAULT 'IN',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      image TEXT
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      compare_price REAL,
      category_id INTEGER REFERENCES categories(id),
      image TEXT,
      images TEXT,
      stock INTEGER DEFAULT 0,
      featured INTEGER DEFAULT 0,
      rating REAL DEFAULT 0,
      review_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active' CHECK(status IN ('active','draft','archived')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cart_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      quantity INTEGER DEFAULT 1,
      UNIQUE(user_id, product_id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      total REAL NOT NULL,
      subtotal REAL NOT NULL,
      tax REAL DEFAULT 0,
      shipping REAL DEFAULT 0,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','processing','shipped','delivered','cancelled')),
      payment_intent TEXT,
      payment_status TEXT DEFAULT 'unpaid',
      shipping_name TEXT,
      shipping_address TEXT,
      shipping_city TEXT,
      shipping_state TEXT,
      shipping_zip TEXT,
      shipping_country TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      product_name TEXT NOT NULL,
      product_image TEXT,
      price REAL NOT NULL,
      quantity INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
      comment TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, product_id)
    );

    CREATE TABLE IF NOT EXISTS wishlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      UNIQUE(user_id, product_id)
    );

    CREATE TABLE IF NOT EXISTS coupons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      discount_type TEXT NOT NULL CHECK(discount_type IN ('percentage','fixed')),
      discount_value REAL NOT NULL,
      min_order REAL DEFAULT 0,
      max_uses INTEGER,
      used_count INTEGER DEFAULT 0,
      expires_at DATETIME,
      active INTEGER DEFAULT 1
    );
  `);

  // Migration: add phone_verified column if missing
  const cols = db.prepare("PRAGMA table_info(users)").all();
  if (!cols.find(c => c.name === 'phone_verified')) {
    db.exec("ALTER TABLE users ADD COLUMN phone_verified INTEGER DEFAULT 0");
  }

  // Seed admin user
  const adminExists = db.prepare('SELECT id FROM users WHERE role = ?').get('admin');
  if (!adminExists) {
    const hash = bcrypt.hashSync('admin123', 12);
    db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)').run('Admin', 'admin@yourbrand.com', hash, 'admin');
  }

  // Seed categories
  const catCount = db.prepare('SELECT COUNT(*) as cnt FROM categories').get();
  if (catCount.cnt === 0) {
    const cats = [
      ['Painting Supplies', 'painting-supplies', 'Premium paints, brushes, and canvases for every artist', 'https://placehold.co/400x400/e8d5b7/8B4513?text=Painting+Supplies'],
      ['Drawing & Sketching', 'drawing-sketching', 'Pencils, charcoal, pastels, and sketchbooks', 'https://placehold.co/400x400/d4e8d5/2d5a2d?text=Drawing+%26+Sketching'],
      ['Handmade Crafts', 'handmade-crafts', 'Unique handcrafted art pieces and traditional crafts', 'https://placehold.co/400x400/e8d5e8/5a2d5a?text=Handmade+Crafts'],
      ['Art Tools & Accessories', 'art-tools', 'Easels, palettes, and essential art studio accessories', 'https://placehold.co/400x400/d5d5e8/2d2d5a?text=Art+Tools'],
      ['Resin & Mixed Media', 'resin-mixed-media', 'Epoxy resin kits, molds, and mixed media supplies', 'https://placehold.co/400x400/e8e8d5/5a5a2d?text=Resin+%26+Mixed+Media'],
      ['Home Decor Art', 'home-decor-art', 'Handpainted decor, wall art, and artistic home essentials', 'https://placehold.co/400x400/d5e8e8/2d5a5a?text=Home+Decor+Art']
    ];
    const stmt = db.prepare('INSERT INTO categories (name, slug, description, image) VALUES (?, ?, ?, ?)');
    cats.forEach(c => stmt.run(...c));
  }

  // Seed products
  const prodCount = db.prepare('SELECT COUNT(*) as cnt FROM products').get();
  if (prodCount.cnt === 0) {
    const products = [
      ['Professional Acrylic Paint Set - 24 Colors', 'professional-acrylic-paint-set', 'Premium quality artist-grade acrylic paint set with 24 vibrant colors. Rich pigmentation, smooth consistency, and excellent coverage. Ideal for canvas, wood, and mixed media projects.', 2499, 3499, 1, 'https://placehold.co/600x600/e8d5b7/8B4513?text=Acrylic+Paint+Set', 120, 1, 4.9, 234],
      ['Handcrafted Wooden Easel - Studio Grade', 'handcrafted-wooden-easel', 'Beautifully crafted adjustable wooden easel made from premium beechwood. Holds canvases up to 48 inches. Sturdy tripod design with brass fittings. Perfect for studio or plein air painting.', 6999, 9499, 4, 'https://placehold.co/600x600/d5d5e8/2d2d5a?text=Wooden+Easel', 35, 1, 4.8, 89],
      ['Artist Brush Collection - 18 Piece Set', 'artist-brush-collection', 'Complete set of 18 premium brushes including flat, round, filbert, and fan brushes. Natural and synthetic bristles with ergonomic wooden handles. Suitable for oil, acrylic, and watercolor.', 1799, 2499, 1, 'https://placehold.co/600x600/d4e8d5/2d5a2d?text=Brush+Set', 200, 1, 4.7, 178],
      ['Premium Stretched Canvas Pack - 5 Sizes', 'premium-stretched-canvas-pack', 'Gallery-quality triple-primed stretched canvases in 5 popular sizes. 100% cotton duck with kiln-dried wooden frames. Acid-free and ready to paint. Includes 8x10, 11x14, 12x16, 16x20, and 18x24 inch.', 2999, 3999, 1, 'https://placehold.co/600x600/f5f5f0/333333?text=Canvas+Pack', 80, 0, 4.6, 145],
      ['Professional Sketching Kit - 45 Pieces', 'professional-sketching-kit', 'Complete sketching kit with graphite pencils (2H-8B), charcoal sticks, blending stumps, kneaded erasers, sandpaper block, and premium sketchbook. Comes in a zippered carrying case.', 1999, 2799, 2, 'https://placehold.co/600x600/d4e8d5/2d5a2d?text=Sketching+Kit', 150, 1, 4.8, 312],
      ['Epoxy Resin Art Kit - Crystal Clear', 'epoxy-resin-art-kit', 'Professional-grade crystal clear epoxy resin kit with hardener. UV resistant, self-leveling formula. Includes measuring cups, stir sticks, gloves, and color pigments. Perfect for river tables, jewelry, and art.', 2299, 3299, 5, 'https://placehold.co/600x600/e8e8d5/5a5a2d?text=Resin+Kit', 90, 1, 4.7, 167],
      ['Handpainted Mandala Wall Art', 'handpainted-mandala-wall-art', 'Exquisite hand-painted mandala art on premium canvas. Traditional Indian design with gold leaf accents. Each piece is unique and signed by the artist. Size: 24x24 inches.', 4999, 6999, 6, 'https://placehold.co/600x600/d5e8e8/2d5a5a?text=Mandala+Art', 25, 1, 4.9, 56],
      ['Watercolor Paint Set - 48 Colors', 'watercolor-paint-set-48', 'Professional watercolor palette with 48 vivid colors. Highly pigmented, smooth blending. Includes refillable water brush pens, mixing palette, and sponge. Portable metal case.', 1499, 2299, 1, 'https://placehold.co/600x600/d5e8f0/2d4a5a?text=Watercolor+Set', 200, 0, 4.6, 423],
      ['Soft Pastel Set - 72 Colors', 'soft-pastel-set-72', 'Artist-quality soft pastels in 72 brilliant colors. Smooth, velvety texture with rich color laydown. Low dust formula. Presented in a sturdy wooden box with individual slots.', 2799, 3899, 2, 'https://placehold.co/600x600/f0d5e8/5a2d4a?text=Pastel+Set', 60, 0, 4.5, 98],
      ['Macrame Wall Hanging Kit', 'macrame-wall-hanging-kit', 'Complete DIY macrame wall hanging kit with natural cotton cord, wooden dowel, step-by-step instructions, and video tutorial access. Create beautiful bohemian wall art.', 1299, 1799, 3, 'https://placehold.co/600x600/e8d5e8/5a2d5a?text=Macrame+Kit', 130, 0, 4.7, 189],
      ['Oil Paint Set - 12 Premium Colors', 'oil-paint-set-12', 'Professional oil paint set with 12 rich, buttery colors in 50ml tubes. High pigment concentration, excellent lightfastness. Smooth mixing and blending properties.', 2199, 2999, 1, 'https://placehold.co/600x600/e8d5b7/8B4513?text=Oil+Paint+Set', 85, 0, 4.8, 134],
      ['Calligraphy Pen Set - Complete Kit', 'calligraphy-pen-set', 'Elegant calligraphy set with 3 wooden dip pens, 12 ink colors, 6 nib sizes, and practice sheets. Perfect for beginners and experienced calligraphers. Beautiful gift box packaging.', 1699, 2299, 2, 'https://placehold.co/600x600/333333/ffffff?text=Calligraphy+Set', 100, 1, 4.6, 267],
      ['Silicone Resin Mold Set - 30 Pieces', 'silicone-resin-mold-set', 'Premium silicone mold set for resin art and jewelry making. Includes geometric, sphere, heart, diamond, and pendant molds. Non-stick, flexible, and reusable.', 1199, 1799, 5, 'https://placehold.co/600x600/e8e8d5/5a5a2d?text=Resin+Molds', 175, 0, 4.5, 201],
      ['Handmade Pottery Vase - Terracotta', 'handmade-pottery-vase', 'Beautifully hand-thrown terracotta vase with traditional Indian design. Natural matte finish with hand-carved patterns. Each piece is unique. Height: 12 inches.', 1999, 2999, 3, 'https://placehold.co/600x600/c4a882/4a3520?text=Pottery+Vase', 40, 0, 4.8, 78],
      ['Artist Palette Knife Set - 10 Pieces', 'palette-knife-set-10', 'Professional stainless steel palette knife set with 10 different shapes and sizes. Wooden handles with secure riveted blades. Perfect for mixing paints and creating textured art.', 899, 1399, 4, 'https://placehold.co/600x600/d5d5e8/2d2d5a?text=Palette+Knives', 250, 0, 4.4, 156],
      ['Decorative Tealight Holders - Set of 6', 'decorative-tealight-holders', 'Hand-painted ceramic tealight holders with intricate traditional patterns. Set of 6 in assorted colors. Creates beautiful ambient lighting. Perfect housewarming gift.', 1499, 1999, 6, 'https://placehold.co/600x600/d5e8e8/2d5a5a?text=Tealight+Holders', 65, 0, 4.7, 143],
      ['Premium Sketchbook - A4 Hardbound', 'premium-sketchbook-a4', 'High-quality A4 hardbound sketchbook with 200 pages of 160gsm acid-free paper. Suitable for pencil, pen, marker, and light watercolor. Lay-flat binding with bookmark ribbon.', 699, 999, 2, 'https://placehold.co/600x600/f5f5f0/333333?text=Sketchbook+A4', 300, 0, 4.6, 534],
      ['Resin Pigment Set - 24 Colors', 'resin-pigment-set-24', 'Concentrated liquid resin pigments in 24 vibrant colors. Highly compatible with epoxy resin. Just a few drops create stunning color effects. UV stable and non-toxic.', 999, 1499, 5, 'https://placehold.co/600x600/e8e8d5/5a5a2d?text=Resin+Pigments', 180, 0, 4.5, 198],
      ['Handwoven Jute Basket Set', 'handwoven-jute-basket-set', 'Set of 3 handwoven jute baskets in different sizes. Natural and eco-friendly. Perfect for organizing art supplies or as decorative home accents. Traditional weaving technique.', 1799, 2499, 3, 'https://placehold.co/600x600/c4a882/4a3520?text=Jute+Baskets', 55, 0, 4.7, 87],
      ['Portable Art Supply Organizer', 'portable-art-supply-organizer', 'Multi-compartment wooden art supply organizer with carrying handle. Features adjustable dividers, brush holders, and foldout palette tray. Holds paints, brushes, pencils and more.', 3499, 4799, 4, 'https://placehold.co/600x600/d5d5e8/2d2d5a?text=Art+Organizer', 45, 1, 4.8, 112]
    ];
    const stmt = db.prepare('INSERT INTO products (name, slug, description, price, compare_price, category_id, image, stock, featured, rating, review_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    products.forEach(p => stmt.run(...p));
  }

  // Seed coupons
  const couponCount = db.prepare('SELECT COUNT(*) as cnt FROM coupons').get();
  if (couponCount.cnt === 0) {
    db.prepare('INSERT INTO coupons (code, discount_type, discount_value, min_order) VALUES (?, ?, ?, ?)').run('WELCOME10', 'percentage', 10, 500);
    db.prepare('INSERT INTO coupons (code, discount_type, discount_value, min_order) VALUES (?, ?, ?, ?)').run('SAVE20', 'fixed', 200, 999);
  }

  console.log('✅ Database initialized with seed data');
}

module.exports = { getDb, initDatabase };
