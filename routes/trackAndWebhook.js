const express = require('express');
const db = require('../db/database');
const { verifyWebhookSignature, getPayment } = require('../lib/mercadopago');

// ── Track ────────────────────────────────────────────────────────────────────
const trackRouter = express.Router();

// ── Rate limit helper ─────────────────────────────────────────────────────────
function checkRateLimit(ip) {
  const windowStart = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const attempts = db.prepare(
    `SELECT COUNT(*) as n FROM search_attempts WHERE ip = ? AND created_at > ?`
  ).get(ip, windowStart).n;
  return attempts;
}

// ── Busca por código (GET /api/track/order/:code) ─────────────────────────────
trackRouter.get('/order/:code', (req, res) => {
  const ip = req.ip;

  if (checkRateLimit(ip) >= 10)
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde 15 minutos.' });

  db.prepare('INSERT INTO search_attempts (ip) VALUES (?)').run(ip);

  const code  = req.params.code?.toUpperCase();
  const order = db.prepare(`
    SELECT o.*, c.name as customer_name, c.phone as customer_phone
    FROM orders o JOIN customers c ON c.id = o.customer_id
    WHERE o.code = ?
  `).get(code);

  if (!order) return res.json({ orders: [] });

  order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  res.json({ orders: [order] });
});

// ── Busca por telefone (GET /api/track/phone/:phone) ──────────────────────────
trackRouter.get('/phone/:phone', (req, res) => {
  const ip = req.ip;

  if (checkRateLimit(ip) >= 10)
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde 15 minutos.' });

  db.prepare('INSERT INTO search_attempts (ip) VALUES (?)').run(ip);

  const phone    = req.params.phone?.replace(/\D/g, '');
  const customer = db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone);

  if (!customer) return res.json({ orders: [] });

  const raw = db.prepare(
    'SELECT o.* FROM orders o WHERE o.customer_id = ? ORDER BY o.created_at DESC LIMIT 20'
  ).all(customer.id);

  const orders = raw.map(o => {
    o.items          = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id);
    o.customer_name  = customer.name;
    o.customer_phone = customer.phone;
    return o;
  });

  res.json({ orders });
});

// ── POST legado (mantido para compatibilidade) ────────────────────────────────
trackRouter.post('/', (req, res) => {
  const { value, type } = req.body;
  const ip = req.ip;

  if (checkRateLimit(ip) >= 10)
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
      const raw = db.prepare(
        'SELECT o.* FROM orders o WHERE o.customer_id = ? ORDER BY o.created_at DESC LIMIT 20'
      ).all(customer.id);
      orders = raw.map(o => {
        o.items          = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id);
        o.customer_name  = customer.name;
        o.customer_phone = customer.phone;
        return o;
      });
    }
  }

  res.json({ orders });
});

// ── Webhook ──────────────────────────────────────────────────────────────────
const webhookRouter = express.Router();

const RESTORE_STOCK_STATUSES = new Set(['REJECTED', 'CANCELLED', 'REFUNDED']);

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
  try {
    const sig = req.headers['x-signature'];
    const qId = req.query.id;
    if (!verifyWebhookSignature(sig, qId, req.body))
      return res.status(400).json({ error: 'Assinatura inválida' });

    const { data } = req.body;
    if (!data?.id) return res.sendStatus(200);

    const payment = await getPayment(data.id);
    if (!payment) return res.sendStatus(200);

    const externalRef = payment.external_reference;
    const order = db.prepare('SELECT * FROM orders WHERE code = ?').get(externalRef);
    if (!order) return res.sendStatus(200);

    const mpStatus = payment.status?.toUpperCase();
    const newPaymentStatus =
      mpStatus === 'APPROVED' ? 'APPROVED' :
      mpStatus === 'REJECTED' ? 'REJECTED' :
      mpStatus === 'REFUNDED' ? 'REFUNDED' :
      mpStatus === 'CANCELLED' ? 'CANCELLED' : 'PENDING';

    db.transaction(() => {
      if (RESTORE_STOCK_STATUSES.has(newPaymentStatus) &&
          !RESTORE_STOCK_STATUSES.has(order.payment_status)) {
        restoreStock(order.id);
      }
      db.prepare('UPDATE orders SET payment_status = ? WHERE id = ?')
        .run(newPaymentStatus, order.id);
    })();

    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error:', err);
    res.sendStatus(500);
  }
});

module.exports = { trackRouter, webhookRouter };