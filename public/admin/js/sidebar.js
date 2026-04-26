function sidebarHTML() {
  return `
    <div class="sidebar-overlay" id="sidebar-overlay" onclick="closeSidebar()"></div>
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-logo">
        <img src="/img/logo/logoipsum-3-write.png" alt="MiniLoja">
        <button class="sidebar-close-btn" onclick="closeSidebar()" aria-label="Fechar menu">✕</button>
      </div>
      <nav class="sidebar-nav">
        <a href="/admin/index.html">Dashboard</a>
        <a href="/admin/orders.html">Pedidos</a>
        <a href="/admin/products.html">Produtos</a>
        <a href="/admin/customers.html">Clientes</a>
        <a href="/admin/users.html">Usuários</a>
      </nav>
      <div class="sidebar-footer">
        <a href="/" target="_blank">↗ Ver Loja</a>
        <button onclick="logout()">Sair</button>
      </div>
    </aside>
  `;
}

function openSidebar() {
  document.getElementById('sidebar')?.classList.add('open');
  document.getElementById('sidebar-overlay')?.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebar-overlay')?.classList.remove('open');
  document.body.style.overflow = '';
}

// Close sidebar on ESC
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeSidebar();
});