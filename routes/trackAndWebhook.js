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
      approved: 'APPROVED', rejected: 'REJECTED',
      refunded: 'REFUNDED', cancelled: 'CANCELLED',
      pending: 'PENDING', in_process: 'PENDING',
    };

    const paymentStatus = statusMap[mpPayment.status] || 'PENDING';
    const order = db.prepare('SELECT * FROM orders WHERE code = ?').get(orderCode);
    if (!order) return;

    db.prepare('UPDATE payments SET mp_payment_id = ?, mp_status = ? WHERE order_id = ?')
      .run(String(data.id), mpPayment.status, order.id);

    db.prepare('UPDATE orders SET payment_status = ? WHERE id = ?')
      .run(paymentStatus, order.id);

    if (paymentStatus === 'APPROVED')
      db.prepare(`UPDATE orders SET order_status = 'CONFIRMED' WHERE id = ?`).run(order.id);

  } catch (err) {
    console.error('Webhook error:', err.message);
  }
});

module.exports = { trackRouter, webhookRouter };
