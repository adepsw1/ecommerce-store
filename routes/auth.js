const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const https = require('https');
const { getDb } = require('../database/init');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Return Google Client ID to frontend
router.get('/config', (req, res) => {
  res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || '' });
});

// Verify Google ID token via Google's tokeninfo endpoint
function verifyGoogleToken(idToken) {
  return new Promise((resolve, reject) => {
    const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`;
    https.get(url, (resp) => {
      let data = '';
      resp.on('data', chunk => data += chunk);
      resp.on('end', () => {
        try {
          const payload = JSON.parse(data);
          if (payload.error_description) {
            return reject(new Error(payload.error_description));
          }
          if (payload.aud !== process.env.GOOGLE_CLIENT_ID) {
            return reject(new Error('Token audience mismatch'));
          }
          resolve(payload);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// Google Sign-In redirect handler (for mobile)
router.post('/google/redirect', async (req, res) => {
  const { credential } = req.body;
  if (!credential) {
    return res.redirect('/login.html?error=missing_credential');
  }

  try {
    const payload = await verifyGoogleToken(credential);
    const { email, name, picture, sub: googleId } = payload;

    if (!email) {
      return res.redirect('/login.html?error=no_email');
    }

    const db = getDb();
    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    if (!user) {
      const result = db.prepare(
        'INSERT INTO users (name, email, password, avatar, google_id) VALUES (?, ?, ?, ?, ?)'
      ).run(name || email.split('@')[0], email, '', picture || null, googleId);
      user = { id: result.lastInsertRowid, name: name || email.split('@')[0], email, role: 'customer', phone: null };
    } else {
      if (!user.google_id) {
        db.prepare('UPDATE users SET google_id = ?, avatar = COALESCE(avatar, ?) WHERE id = ?')
          .run(googleId, picture || null, user.id);
      }
    }

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    // Redirect to a page that stores the token in localStorage
    const userData = JSON.stringify({ id: user.id, name: user.name, email: user.email, role: user.role, phone: user.phone || null });
    res.send(`<!DOCTYPE html><html><head><title>Signing in...</title></head><body><script>
      localStorage.setItem('token', '${token}');
      localStorage.setItem('user', ${JSON.stringify(userData)});
      window.location.href = '/';
    </script></body></html>`);
  } catch (err) {
    console.error('Google redirect auth error:', err.message);
    return res.redirect('/login.html?error=invalid_credential');
  }
});

// Google Sign-In (API for popup mode)
router.post('/google', async (req, res) => {
  const { credential } = req.body;
  if (!credential) {
    return res.status(400).json({ error: 'Google credential is required' });
  }

  try {
    const payload = await verifyGoogleToken(credential);
    const { email, name, picture, sub: googleId } = payload;

    if (!email) {
      return res.status(400).json({ error: 'Email not provided by Google' });
    }

    const db = getDb();
    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    if (!user) {
      // Create new user from Google profile (no password needed)
      const result = db.prepare(
        'INSERT INTO users (name, email, password, avatar, google_id) VALUES (?, ?, ?, ?, ?)'
      ).run(name || email.split('@')[0], email, '', picture || null, googleId);
      user = { id: result.lastInsertRowid, name: name || email.split('@')[0], email, role: 'customer', phone: null };
    } else {
      // Update Google ID and avatar if not set
      if (!user.google_id) {
        db.prepare('UPDATE users SET google_id = ?, avatar = COALESCE(avatar, ?) WHERE id = ?')
          .run(googleId, picture || null, user.id);
      }
    }

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, phone: user.phone || null }
    });
  } catch (err) {
    console.error('Google auth error:', err.message);
    return res.status(401).json({ error: 'Invalid Google credential' });
  }
});

// Register (kept as fallback)
router.post('/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  const hash = bcrypt.hashSync(password, 12);
  const result = db.prepare('INSERT INTO users (name, email, password) VALUES (?, ?, ?)').run(name, email, hash);

  const token = jwt.sign({ userId: result.lastInsertRowid }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.status(201).json({
    token,
    user: { id: result.lastInsertRowid, name, email, role: 'customer' }
  });
});

// Login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role }
  });
});

// Get profile
router.get('/profile', authenticate, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, name, email, role, phone, address, city, state, zip, country, created_at FROM users WHERE id = ?').get(req.user.id);
  res.json(user);
});

// Update profile
router.put('/profile', authenticate, (req, res) => {
  const { name, phone, address, city, state, zip, country } = req.body;
  const db = getDb();
  db.prepare('UPDATE users SET name=?, phone=?, address=?, city=?, state=?, zip=?, country=? WHERE id=?')
    .run(name, phone, address, city, state, zip, country, req.user.id);
  res.json({ message: 'Profile updated' });
});

module.exports = router;
