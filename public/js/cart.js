// ── Cart (localStorage) ───────────────────────────────────────────────────────
const CART_KEY = 'miniloja_cart';

function loadCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; }
  catch { return []; }
}

function saveCart(items) {
  localStorage.setItem(CART_KEY, JSON.stringify(items));
  updateCartUI();
}

function clearCart() { saveCart([]); }

function addItem(product, variation, qty = 1) {
  const cart = loadCart();
  const key = variation ? `${product.id}-${variation.id}` : String(product.id);
  const existing = cart.find(i => i.key === key);

  if (existing) {
    existing.quantity += qty;
  } else {
    cart.push({
      key, productId: product.id, productName: product.name,
      productImage: product.image_url,
      variationId: variation?.id || null,
      variationLabel: variation?.label || null,
      price: product.price, quantity: qty,
    });
  }
  saveCart(cart);
}

function updateQty(key, qty) {
  const cart = loadCart();
  const item = cart.find(i => i.key === key);
  if (!item) return;
  if (qty <= 0) return removeItem(key);
  item.quantity = qty;
  saveCart(cart);
}

function removeItem(key) {
  saveCart(loadCart().filter(i => i.key !== key));
}

function cartTotal() {
  return loadCart().reduce((s, i) => s + i.price * i.quantity, 0);
}

function cartCount() {
  return loadCart().reduce((s, i) => s + i.quantity, 0);
}

function fmt(val) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
}

// ── UI ───────────────────────────────────────────────────────────────────────
function updateCartUI() {
  const count = cartCount();
  document.querySelectorAll('.cart-count').forEach(el => el.textContent = count);
}

function renderDrawer() {
  const body  = document.getElementById('cart-body');
  const total = document.getElementById('cart-total');
  const checkoutBtn = document.getElementById('cart-checkout-btn');
  if (!body) return;

  const items = loadCart();

  if (items.length === 0) {
    body.innerHTML = '<div class="cart-empty">🛒<br>Seu carrinho está vazio</div>';
    if (total) total.textContent = '';
    if (checkoutBtn) checkoutBtn.disabled = true;
    return;
  }

  body.innerHTML = items.map(item => `
    <div class="cart-item">
      <img src="${item.productImage || 'https://via.placeholder.com/64'}" alt="${item.productName}">
      <div class="cart-item-info">
        <div class="cart-item-name">${item.productName}</div>
        ${item.variationLabel ? `<div class="cart-item-var">${item.variationLabel}</div>` : ''}
        <div class="cart-item-price">${fmt(item.price)}</div>
        <div class="cart-item-qty">
          <button class="qty-btn" onclick="updateQty('${item.key}', ${item.quantity - 1})">−</button>
          <span>${item.quantity}</span>
          <button class="qty-btn" onclick="updateQty('${item.key}', ${item.quantity + 1})">+</button>
          <button class="qty-btn" onclick="removeItem('${item.key}')" style="color:var(--danger);margin-left:4px">✕</button>
        </div>
      </div>
    </div>
  `).join('');

  if (total) total.textContent = fmt(cartTotal());
  if (checkoutBtn) checkoutBtn.disabled = false;
}

function openDrawer()  {
  renderDrawer();
  document.getElementById('cart-drawer')?.classList.add('open');
  document.getElementById('cart-overlay')?.classList.add('open');
}
function closeDrawer() {
  document.getElementById('cart-drawer')?.classList.remove('open');
  document.getElementById('cart-overlay')?.classList.remove('open');
}

document.addEventListener('DOMContentLoaded', updateCartUI);
