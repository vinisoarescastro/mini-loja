// sidebar HTML string used by all admin pages
function sidebarHTML() {
  return `
    <aside class="sidebar">
      <div class="sidebar-logo">
        <img src="/img/logo/logoipsum-3-write.png" alt="MiniLoja" style="height:32px;width:auto;display:block;">
      </div>
      <nav class="sidebar-nav">
        <a href="/admin/index.html">Dashboard</a>
        <a href="/admin/orders.html">Pedidos</a>
        <a href="/admin/products.html">Produtos</a>
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