// ── Shared admin utilities ───────────────────────────────────────────────────

// Oculta imediatamente para evitar flash de conteúdo antes da verificação de auth.
// A visibilidade é restaurada pelo requireAdmin() após confirmar a sessão.
document.documentElement.style.visibility = 'hidden';

// Cache da promise para evitar chamadas duplicadas quando a página
// chama requireAdmin() manualmente E o DOMContentLoaded também chama.
let _authPromise = null;

function fmt(val) {
  return new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' }).format(val);
}

function fmtDate(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleDateString('pt-BR', {
    day:'2-digit', month:'2-digit', year:'numeric',
    hour:'2-digit', minute:'2-digit',
  });
}

const STATUS_LABEL = {
  PENDING:'Pendente', CONFIRMED:'Confirmado', PREPARING:'Preparando',
  SHIPPED:'Enviado',  DELIVERED:'Entregue',   CANCELLED:'Cancelado',
};
const PAY_LABEL = {
  PENDING:'Aguardando', APPROVED:'Aprovado', REJECTED:'Recusado',
  REFUNDED:'Reembolsado', CANCELLED:'Cancelado',
};

function badgeClass(status) {
  const map = {
    APPROVED:'approved', REJECTED:'rejected', CANCELLED:'cancelled',
    CONFIRMED:'confirmed', PREPARING:'preparing', SHIPPED:'shipped',
    DELIVERED:'delivered', REFUNDED:'refunded', PENDING:'pending',
  };
  return 'badge badge-' + (map[status] || 'pending');
}

// ── Auth ──────────────────────────────────────────────────────────────────────
async function requireAdmin() {
  if (!_authPromise) {
    _authPromise = fetch('/api/auth/me')
      .then(res => {
        if (!res.ok) throw new Error('not authenticated');
        return res.json();
      })
      .then(user => {
        // Autenticado: exibe a página
        document.documentElement.style.visibility = 'visible';
        return user;
      })
      .catch(() => {
        // Não autenticado: redireciona sem exibir nada
        window.location.replace('/admin/login.html');
        // Promise que nunca resolve para parar qualquer cadeia de await
        return new Promise(() => {});
      });
  }
  return _authPromise;
}

async function logout() {
  await fetch('/api/auth/logout', { method:'POST' });
  window.location.replace('/admin/login.html');
}

// ── Active nav link ───────────────────────────────────────────────────────────
function setActiveNav() {
  const path = window.location.pathname;
  document.querySelectorAll('.sidebar-nav a').forEach(a => {
    a.classList.toggle('active', a.getAttribute('href') === path);
  });
}

// ── Mobile hamburger injection ────────────────────────────────────────────────
function injectMenuBtn() {
  const topbar = document.querySelector('.admin-topbar');
  if (!topbar || topbar.querySelector('.menu-btn')) return;

  const h1 = topbar.querySelector('h1');
  if (!h1) return;

  const btn = document.createElement('button');
  btn.className = 'menu-btn';
  btn.setAttribute('aria-label', 'Abrir menu');
  btn.innerHTML = '☰';
  btn.onclick = openSidebar;

  topbar.insertBefore(btn, h1);
}

// ── Inicialização ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Dispara a verificação de auth imediatamente em TODAS as páginas admin.
  // Se a página também chamar requireAdmin() manualmente, o cache (_authPromise)
  // garante que só haverá UMA requisição ao servidor — sem duplicata.
  requireAdmin();

  setActiveNav();
  injectMenuBtn();
});