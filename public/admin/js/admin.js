// ── Shared admin utilities ───────────────────────────────────────────────────

function fmt(val) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
}

function fmtDate(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

const STATUS_LABEL = {
  PENDING:'Pendente', CONFIRMED:'Confirmado', PREPARING:'Preparando',
  SHIPPED:'Enviado', DELIVERED:'Entregue', CANCELLED:'Cancelado',
};
const PAY_LABEL = {
  PENDING:'Aguardando', APPROVED:'Aprovado', REJECTED:'Recusado',
  REFUNDED:'Reembolsado', CANCELLED:'Cancelado',
};

function badgeClass(status) {
  const map = { APPROVED:'approved', REJECTED:'rejected', CANCELLED:'cancelled',
    CONFIRMED:'confirmed', PREPARING:'preparing', SHIPPED:'shipped',
    DELIVERED:'delivered', REFUNDED:'refunded', PENDING:'pending' };
  return 'badge badge-' + (map[status] || 'pending');
}

// ── Auth check ───────────────────────────────────────────────────────────────
async function requireAdmin() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) throw new Error();
    return await res.json();
  } catch {
    window.location.href = '/admin/login.html';
  }
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/admin/login.html';
}

// ── Active nav link ──────────────────────────────────────────────────────────
function setActiveNav() {
  const path = window.location.pathname;
  document.querySelectorAll('.sidebar-nav a').forEach(a => {
    a.classList.toggle('active', a.getAttribute('href') === path);
  });
}

document.addEventListener('DOMContentLoaded', setActiveNav);
