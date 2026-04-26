const express = require('express');
const db = require('../db/database');
const { verifyWebhookSignature, getPayment } = require('../lib/mercadopago');

// ── Track ────────────────────────────────────────────────────────────────────
const trackRouter = express.Router();

trackRouter.post('/', (req, res) => {
  const { value, type } = req.body; // type: 'code' | 'phone'
  const ip = req.ip;

  // Rate limit: 10 tentativas por 15 min por IP
  const windowStart = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const attempts = db.prepare(
    `SELECT COUNT(*) as n FROM search_attempts WHERE ip = ? AND created_at > ?`
  ).get(ip, windowStart).n;

  if (attempts >= 10)
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde 15 minutos.' });

  db.prepare('INSERT INTO search_attempts (ip) VALUES (?)').run(ip);

  let orders = [];

  if (type === 'code') {
    const order = db.prepare(`
      SELECT o.*, c.name as customer_name, c.phone as customer_phone
      FROM orders o JOIN customers c ON c.id = o.customer_id
      WHERE o.code = ?
    `).get(value?.toUpperCase());

    if (order) {
      order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
      orders = [order];
    }
  } else {
    const customer = db.prepare('SELECT * FROM customers WHERE phone = ?').get(value);
    if (customer) {
      const raw = db.prepare(`
        SELECT o.* FROM orders o WHERE o.customer_id = ? ORDER BY o.created_at DESC LIMIT 20
      `).all(customer.id);
      orders = raw.map(o => {
        o.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id);
        o.customer_name = customer.name;
        o.customer_phone = customer.phone;
        return o;
      });
    }
  }

  res.json({ orders });
});

// ── Webhook ──────────────────────────────────────────────────────────────────
const webhookRouter = express.Router();

// Status que devem devolver o estoque ao receber notificação do MP
const RESTORE_STOCK_STATUSES = new Set(['REJECTED', 'CANCELLED', 'REFUNDED']);

/**
 * Devolve o estoque de todos os itens de um pedido.
 * Chamado dentro de uma transação para garantir atomicidade.
 */
function restoreStock(orderId) {
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);

  for (const item of items) {
    if (item.variation_id) {
      db.prepare('UPDATE product_variations SET stock = stock + ? WHERE id = ?')
        .run(item.quantity, item.variation_id);
    } else {
      db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?')
        .run(item.quantity, item.product_id);
    }
  }
}

webhookRouter.post('/', async (req, res) => {
  res.sendStatus(200); // responde imediatamente ao MP

  if (!verifyWebhookSignature(req)) {
    console.warn('Webhook: assinatura inválida');
    return;
  }

  const { type, data } = req.body;
  if (type !== 'payment' || !data?.id) return;

  try {
    const mpPayment = await getPayment(data.id);
    const orderCode = mpPayment.external_reference;
    if (!orderCode) return;

    const statusMap = {
      approved:   'APPROVED',
      rejected:   'REJECTED',
      refunded:   'REFUNDED',
      cancelled:  'CANCELLED',
      pending:    'PENDING',
      in_process: 'PENDING',
    };

    const newPaymentStatus = statusMap[mpPayment.status] || 'PENDING';

    const order = db.prepare('SELECT * FROM orders WHERE code = ?').get(orderCode);
    if (!order) return;

    // Evita processar o mesmo status duas vezes (webhooks duplicados do MP)
    if (order.payment_status === newPaymentStatus) return;

    // ── Atualiza pagamento e pedido + devolve estoque se necessário ──────────
    db.transaction(() => {
      db.prepare('UPDATE payments SET mp_payment_id = ?, mp_status = ? WHERE order_id = ?')
        .run(String(data.id), mpPayment.status, order.id);

      db.prepare('UPDATE orders SET payment_status = ? WHERE id = ?')
        .run(newPaymentStatus, order.id);

      if (newPaymentStatus === 'APPROVED') {
        db.prepare(`UPDATE orders SET order_status = 'CONFIRMED' WHERE id = ?`).run(order.id);
      }

      // Devolve estoque se o pagamento foi recusado, cancelado ou estornado
      // Só devolve se o status anterior era PENDING (nunca foi aprovado)
      if (RESTORE_STOCK_STATUSES.has(newPaymentStatus) && order.payment_status === 'PENDING') {
        restoreStock(order.id);
        console.log(`[webhook] Estoque devolvido para pedido ${orderCode} (${newPaymentStatus})`);
      }
    })();

  } catch (err) {
    console.error('Webhook error:', err.message);
  }
});

module.exports = { trackRouter, webhookRouter };