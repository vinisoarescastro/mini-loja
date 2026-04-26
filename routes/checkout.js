const express = require('express');
const db = require('../db/database');
const { generateOrderCode } = require('../lib/utils');
const { createPaymentPreference } = require('../lib/mercadopago');

const router = express.Router();

router.post('/', async (req, res) => {
  const { name, phone, email, items } = req.body;

  if (!name || !phone || !Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: 'Dados incompletos' });

  // Upsert customer
  let customer = db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone);
  if (!customer) {
    const r = db.prepare('INSERT INTO customers (name, phone, email) VALUES (?, ?, ?)')
      .run(name, phone, email || null);
    customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(r.lastInsertRowid);
  }

  // Validate items and calc total
  let total = 0;
  const orderItems = [];

  for (const item of items) {
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(item.productId);
    if (!product) return res.status(400).json({ error: `Produto ${item.productId} não encontrado` });

    let variation = null;
    if (item.variationId) {
      variation = db.prepare('SELECT * FROM product_variations WHERE id = ? AND product_id = ?')
        .get(item.variationId, product.id);
      if (!variation) return res.status(400).json({ error: 'Variação inválida' });
    }

    const qty = item.quantity || 1;
    total += product.price * qty;
    orderItems.push({
      product_id: product.id,
      variation_id: variation?.id || null,
      product_name: product.name,
      variation_label: variation?.label || null,
      quantity: qty,
      unit_price: product.price,
    });
  }

  // Create order
  const code = generateOrderCode();
  const orderInsert = db.prepare(
    'INSERT INTO orders (code, customer_id, total) VALUES (?, ?, ?)'
  ).run(code, customer.id, total);
  const orderId = orderInsert.lastInsertRowid;

  const insItem = db.prepare(
    `INSERT INTO order_items (order_id, product_id, variation_id, product_name, variation_label, quantity, unit_price)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  orderItems.forEach(i => insItem.run(orderId, i.product_id, i.variation_id, i.product_name, i.variation_label, i.quantity, i.unit_price));

  // Mercado Pago
  let paymentUrl = null;
  let preferenceId = null;

  try {
    const mp = await createPaymentPreference({
      order: { id: orderId, code },
      items: orderItems,
      customer,
      appUrl: process.env.APP_URL || 'http://localhost:3000',
    });
    paymentUrl = mp.paymentUrl;
    preferenceId = mp.preferenceId;
  } catch (err) {
    console.error('MP error:', err.message);
  }

  db.prepare('INSERT INTO payments (order_id, mp_preference_id, payment_url) VALUES (?, ?, ?)')
    .run(orderId, preferenceId, paymentUrl);

  res.json({ code, paymentUrl });
});

module.exports = router;
