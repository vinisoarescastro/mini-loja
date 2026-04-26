const { customAlphabet } = require('nanoid');

const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const nanoid = customAlphabet(alphabet, 5);

function generateOrderCode() {
  const year = new Date().getFullYear();
  return `PED-${year}-${nanoid()}`;
}

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

const ORDER_STATUS_LABEL = {
  PENDING: 'Pendente', CONFIRMED: 'Confirmado',
  PREPARING: 'Preparando', SHIPPED: 'Enviado',
  DELIVERED: 'Entregue', CANCELLED: 'Cancelado',
};

const PAYMENT_STATUS_LABEL = {
  PENDING: 'Aguardando', APPROVED: 'Aprovado',
  REJECTED: 'Recusado', REFUNDED: 'Reembolsado', CANCELLED: 'Cancelado',
};

module.exports = { generateOrderCode, formatCurrency, ORDER_STATUS_LABEL, PAYMENT_STATUS_LABEL };
