/**
 * Header centralizado — public/js/header.js
 * Requer que public/js/site-config.js seja carregado antes.
 *
 * Uso em cada página:
 *   <div id="header-root"></div>
 *   <script src="/js/site-config.js"></script>
 *   <script src="/js/header.js"></script>
 *   <script> renderHeader({ showCart: true }); </script>
 *
 * Opções:
 *   showCart  — exibe carrinho + "Meus Pedidos" (página inicial)
 *   backLink  — { href, label } exibe apenas um link de voltar
 */
function renderHeader(opts = {}) {
  const root = document.getElementById('header-root');
  if (!root) return;

  const cfg = typeof SITE_CONFIG !== 'undefined'
    ? SITE_CONFIG
    : { logoUrl: '/img/logo/logoipsum-3-write.png', logoAlt: 'MiniLoja', siteName: 'MiniLoja' };

  let navHTML = '';
  if (opts.backLink) {
    navHTML = `<a href="${opts.backLink.href}">${opts.backLink.label}</a>`;
  } else if (opts.showCart) {
    navHTML = `
      <a href="/track.html">Meus Pedidos</a>
      <button class="cart-btn" onclick="openDrawer()">
        🛒 Carrinho <span class="cart-count" id="cart-count-header">0</span>
      </button>`;
  }

  root.outerHTML = `
    <header class="site-header">
      <div class="container header-inner">
        <a href="/" class="site-logo">
          <img src="${cfg.logoUrl}"
               alt="${cfg.logoAlt}"
               onerror="this.style.display='none';this.nextSibling.style.display='inline'"
               style="height:36px;width:auto;display:block;">
          <span style="display:none;font-size:1.25rem;font-weight:700">${cfg.siteName}</span>
        </a>
        <nav class="header-nav">${navHTML}</nav>
      </div>
    </header>`;
}