/**
 * Sidebar centralizada do painel admin — public/admin/js/sidebar.js
 * Requer que /js/site-config.js seja carregado antes (já incluso nas páginas admin).
 */
function sidebarHTML() {
  const cfg = typeof SITE_CONFIG !== 'undefined'
    ? SITE_CONFIG
    : { logoUrl: '/img/logo/logoipsum-3-write.png', logoAlt: 'MiniLoja' };

  return `
    <aside class="sidebar">
      <div class="sidebar-logo">
        <img src="${cfg.logoUrl}"
             alt="${cfg.logoAlt}"
             onerror="this.style.display='none';this.nextSibling.style.display='inline'"
             style="height:32px;width:auto;display:block;">
        <span style="display:none;font-size:1rem;font-weight:700;color:#fff">${cfg.siteName}</span>
      </div>
      <nav class="sidebar-nav">
        <a href="/admin/index.html">Dashboard</a>
        <a href="/admin/orders.html">Pedidos</a>
        <a href="/admin/products.html">Produtos</a>
        <a href="/admin/categories.html">Categorias</a>
        <a href="/admin/customers.html">Clientes</a>
        <a href="/admin/users.html">Usuários</a>
      </nav>
      <div class="sidebar-footer">
        <a href="/" target="_blank" style="font-size:.8rem;color:#64748b;display:block;margin-bottom:.5rem">↗ Ver Loja</a>
        <button onclick="logout()">Sair</button>
      </div>
    </aside>
  `;
}