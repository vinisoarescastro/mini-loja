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

/**
 * addItem — aceita dois formatos:
 *   1. addItem({ id, name, price, image_url, images }, variation?, qty?)
 *   2. addItem({ id, name, price, image, variationId, variationLabel }, _, qty?)
 */
function addItem(product, variation, qty = 1) {
  // Suporte ao formato "flat" usado no index.html
  const variationId    = variation?.id    ?? product.variationId    ?? null;
  const variationLabel = variation?.label ?? product.variationLabel ?? null;
  // Aceita image_url, image ou images[0]
  const productImage   = product.image_url || product.image
    || (Array.isArray(product.images) ? product.images[0] : null) || null;
  // Todas as imagens para lightbox no carrinho
  const productImages  = product.images?.length ? product.images
    : (productImage ? [productImage] : []);

  const cart = loadCart();
  const key  = variationId ? `${product.id}-${variationId}` : String(product.id);
  const existing = cart.find(i => i.key === key);

  if (existing) {
    existing.quantity += qty;
  } else {
    cart.push({
      key,
      productId:      product.id,
      productName:    product.name,
      productImage,
      productImages,
      variationId,
      variationLabel,
      price:    product.price,
      quantity: qty,
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

// ── Drawer UI ─────────────────────────────────────────────────────────────────
function updateCartUI() {
  const count = cartCount();
  document.querySelectorAll('.cart-count').forEach(el => el.textContent = count);
  const drawer = document.getElementById('cart-drawer');
  if (drawer?.classList.contains('open')) renderDrawer();
}

function renderDrawer() {
  const body        = document.getElementById('cart-body');
  const total       = document.getElementById('cart-total');
  const checkoutBtn = document.getElementById('cart-checkout-btn');
  if (!body) return;

  const items = loadCart();
  if (!items.length) {
    body.innerHTML = '<div class="cart-empty">🛒<br>Seu carrinho está vazio</div>';
    if (total) total.textContent = '';
    if (checkoutBtn) checkoutBtn.disabled = true;
    return;
  }

  const PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' fill='%23f1f5f9'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-size='24' fill='%23cbd5e1'%3E📦%3C/text%3E%3C/svg%3E";

  body.innerHTML = items.map(item => `
    <div class="cart-item">
      <img src="${item.productImage || PLACEHOLDER}"
           alt="${item.productName}"
           onerror="this.src='${PLACEHOLDER}'">
      <div class="cart-item-info">
        <div class="cart-item-name">${item.productName}</div>
        ${item.variationLabel ? `<div class="cart-item-var">${item.variationLabel}</div>` : ''}
        <div class="cart-item-price">${fmt(item.price)}</div>
        <div class="cart-item-qty">
          <button class="qty-btn" onclick="updateQty('${item.key}', ${item.quantity - 1})">−</button>
          <span>${item.quantity}</span>
          <button class="qty-btn" onclick="updateQty('${item.key}', ${item.quantity + 1})">+</button>
          <button class="qty-btn" onclick="removeItem('${item.key}')"
                  style="color:var(--danger);margin-left:4px">✕</button>
        </div>
      </div>
    </div>
  `).join('');

  if (total) total.textContent = fmt(cartTotal());
  if (checkoutBtn) checkoutBtn.disabled = false;
}

function openDrawer() {
  renderDrawer();
  document.getElementById('cart-drawer')?.classList.add('open');
  document.getElementById('cart-overlay')?.classList.add('open');
}

function closeDrawer() {
  document.getElementById('cart-drawer')?.classList.remove('open');
  document.getElementById('cart-overlay')?.classList.remove('open');
}

document.addEventListener('DOMContentLoaded', updateCartUI);