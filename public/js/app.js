// ============================================
// YOUR BRAND - Shared Application JS
// ============================================

// --- API Helper ---
async function api(url, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {}
  };
  const token = localStorage.getItem('token');
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  try {
    const res = await fetch(url, opts);
    const data = await res.json();

    if (res.status === 401) {
      // Don't clear storage or redirect on login/admin pages (user is actively logging in)
      const path = window.location.pathname;
      const isAuthPage = path.includes('login') || path.includes('register') || path === '/admin.html';
      if (!isAuthPage) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login.html';
      }
      return { error: data.error || 'Authentication failed' };
    }

    if (!res.ok) {
      return { error: data.error || 'Something went wrong' };
    }

    return data;
  } catch (err) {
    console.error('API Error:', err);
    return { error: 'Network error. Please try again.' };
  }
}

// --- XSS Protection ---
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

// --- Toast Notifications ---
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast' + (type !== 'success' ? ' ' + type : '');
  const icon = type === 'error' ? 'fa-circle-exclamation' : type === 'warning' ? 'fa-triangle-exclamation' : 'fa-circle-check';
  toast.innerHTML = '<i class="fas ' + icon + '" style="font-size:18px;color:var(--' + (type === 'error' ? 'danger' : type === 'warning' ? 'warning' : 'success') + ')"></i><span>' + escapeHtml(message) + '</span>';
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// --- Star Rating ---
function renderStars(rating) {
  let stars = '';
  const full = Math.floor(rating);
  const half = rating % 1 >= 0.5;
  for (let i = 0; i < full; i++) stars += '<i class="fas fa-star"></i>';
  if (half) stars += '<i class="fas fa-star-half-alt"></i>';
  const empty = 5 - full - (half ? 1 : 0);
  for (let i = 0; i < empty; i++) stars += '<i class="far fa-star"></i>';
  return stars;
}

// --- Product Card Template ---
function productCard(p) {
  const discount = p.compare_price ? Math.round((1 - p.price / p.compare_price) * 100) : 0;
  return `
    <div class="product-card">
      <a href="/product.html?slug=${encodeURIComponent(p.slug)}">
        <div class="product-image">
          <img src="${escapeHtml(p.image || 'https://via.placeholder.com/400')}" alt="${escapeHtml(p.name)}" loading="lazy" onerror="this.src='https://via.placeholder.com/400x400?text=No+Image'">
          <div class="product-badge">
            ${discount > 0 ? '<span class="badge-sale">' + discount + '% OFF</span>' : ''}
            ${p.featured ? '<span class="badge-hot">Popular</span>' : ''}
          </div>
          <div class="product-quick-actions">
            <button onclick="event.preventDefault();addToCart(${p.id})" title="Add to Cart"><i class="fas fa-shopping-bag"></i></button>
            <button title="Wishlist"><i class="fas fa-heart"></i></button>
          </div>
        </div>
      </a>
      <div class="product-info">
        <div class="product-category">${escapeHtml(p.category_name || '')}</div>
        <h3><a href="/product.html?slug=${encodeURIComponent(p.slug)}">${escapeHtml(p.name)}</a></h3>
        <div class="product-rating">
          <div class="stars">${renderStars(p.rating || 0)}</div>
          <span>(${p.review_count || 0})</span>
        </div>
        <div class="product-price">
          <span class="current">\u20B9${p.price.toFixed(2)}</span>
          ${p.compare_price ? '<span class="original">\u20B9' + p.compare_price.toFixed(2) + '</span>' : ''}
          ${discount > 0 ? '<span class="discount">Save ' + discount + '%</span>' : ''}
        </div>
      </div>
      <button class="add-to-cart-btn" onclick="addToCart(${p.id})">
        <i class="fas fa-shopping-bag"></i> Add to Cart
      </button>
    </div>
  `;
}

// --- Add to Cart ---
async function addToCart(productId) {
  const token = localStorage.getItem('token');
  if (!token) {
    window.location.href = '/login.html';
    return;
  }
  const res = await api('/api/cart/add', 'POST', { productId, quantity: 1 });
  if (res.message) {
    showToast('Added to cart!', 'success');
    updateCartBadge();
  } else {
    showToast(res.error || 'Failed to add to cart', 'error');
  }
}

// --- Cart Badge ---
async function updateCartBadge() {
  const badge = document.getElementById('cartBadge');
  if (!badge) return;
  const token = localStorage.getItem('token');
  if (!token) {
    badge.style.display = 'none';
    return;
  }
  try {
    const data = await api('/api/cart');
    if (data.itemCount > 0) {
      badge.textContent = data.itemCount;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  } catch {
    badge.style.display = 'none';
  }
}

// --- Search ---
function handleSearch(event) {
  if (event.key === 'Enter') {
    const query = event.target.value.trim();
    if (query) {
      window.location.href = '/shop.html?search=' + encodeURIComponent(query);
    }
  }
}

// --- User Dropdown ---
function toggleUserDropdown() {
  const dropdown = document.getElementById('userDropdown');
  if (dropdown) dropdown.classList.toggle('hidden');
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('userDropdown');
  const userMenu = document.getElementById('userMenu');
  if (dropdown && userMenu && !userMenu.contains(e.target)) {
    dropdown.classList.add('hidden');
  }
});

// --- Logout ---
function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  localStorage.removeItem('coupon_code');
  localStorage.removeItem('coupon_discount');
  window.location.href = '/';
}

// --- Pincode Lookup (India Post API) ---
let _pincodeTimer = null;
function lookupPincode(pincode, cityFieldId, stateFieldId) {
  clearTimeout(_pincodeTimer);
  const cleaned = pincode.replace(/\D/g, '');
  if (cleaned.length !== 6) return;
  _pincodeTimer = setTimeout(async () => {
    try {
      const res = await fetch('https://api.postalpincode.in/pincode/' + cleaned);
      const data = await res.json();
      if (data[0] && data[0].Status === 'Success' && data[0].PostOffice && data[0].PostOffice.length > 0) {
        const po = data[0].PostOffice[0];
        const cityEl = document.getElementById(cityFieldId);
        const stateEl = document.getElementById(stateFieldId);
        if (cityEl) cityEl.value = po.District || po.Division || '';
        if (stateEl) stateEl.value = po.State || '';
      }
    } catch (e) {
      console.warn('Pincode lookup failed:', e.message);
    }
  }, 300);
}

// --- Auth State ---
function initAuthState() {
  const token = localStorage.getItem('token');
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  const authButtons = document.getElementById('authButtons');
  const userMenu = document.getElementById('userMenu');
  const userName = document.getElementById('userName');
  const userEmail = document.getElementById('userEmail');
  const adminLink = document.getElementById('adminLink');

  if (token && user) {
    if (authButtons) authButtons.style.display = 'none';
    if (userMenu) userMenu.style.display = 'block';
    if (userName) userName.textContent = user.name;
    if (userEmail) userEmail.textContent = user.email;
    if (adminLink && user.role === 'admin') adminLink.style.display = 'block';
    updateCartBadge();
  } else {
    if (authButtons) authButtons.style.display = 'block';
    if (userMenu) userMenu.style.display = 'none';
  }
}

// --- Initialize on DOM Ready ---
document.addEventListener('DOMContentLoaded', () => {
  initAuthState();
  initScrollReveal();
  initNavbarScroll();
});

// --- Scroll Reveal Animation ---
function initScrollReveal() {
  const revealEls = document.querySelectorAll('.section, .features-bar, .newsletter, .artisan-section');
  if (!revealEls.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

  revealEls.forEach((el, i) => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(30px)';
    el.style.transition = `opacity 0.7s cubic-bezier(0.16, 1, 0.3, 1) ${i * 0.05}s, transform 0.7s cubic-bezier(0.16, 1, 0.3, 1) ${i * 0.05}s`;
    observer.observe(el);
  });
}

// --- Navbar Scroll Effect ---
function initNavbarScroll() {
  const navbar = document.querySelector('.navbar');
  if (!navbar) return;

  let lastScroll = 0;
  window.addEventListener('scroll', () => {
    const scrollY = window.scrollY;
    if (scrollY > 50) {
      navbar.classList.add('scrolled');
    } else {
      navbar.classList.remove('scrolled');
    }
    lastScroll = scrollY;
  }, { passive: true });
}
