const express = require('express');
const db = require('../db/database');
const { generateOrderCode } = require('../lib/utils');
const { createPaymentPreference } = require('../lib/mercadopago');

const router = express.Router();

router.post('/', async (req, res) => {
  const { name, phone, email, items } = req.body;

  if (!name || !phone || !Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: 'Dados incompletos' });

  try {
    // ── Etapa 1: validar, reservar estoque e criar pedido (atômico) ──────────
    const { orderId, code, orderItems, customer } = db.transaction(() => {

      // Upsert customer
      let cust = db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone);
      if (!cust) {
        const r = db.prepare('INSERT INTO customers (name, phone, email) VALUES (?, ?, ?)')
          .run(name, phone, email || null);
        cust = db.prepare('SELECT * FROM customers WHERE id = ?').get(r.lastInsertRowid);
      }

      let total = 0;
      const orderItems = [];

      for (const item of items) {
        const qty = Math.max(1, Math.floor(item.quantity || 1));

        const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(item.productId);
        if (!product)
          throw { status: 400, error: `Produto ${item.productId} não encontrado` };

        if (item.variationId) {
          // ── Produto com variação ─────────────────────────────────────────
          const variation = db.prepare(
            'SELECT * FROM product_variations WHERE id = ? AND product_id = ?'
          ).get(item.variationId, product.id);

          if (!variation)
            throw { status: 400, error: 'Variação inválida' };

          if (variation.stock < qty)
            throw {
              status: 400,
              error: `Estoque insuficiente para "${product.name} — ${variation.label}". Disponível: ${variation.stock}`,
            };

          db.prepare('UPDATE product_variations SET stock = stock - ? WHERE id = ?')
            .run(qty, variation.id);

          orderItems.push({
            product_id:      product.id,
            variation_id:    variation.id,
            product_name:    product.name,
            variation_label: variation.label,
            quantity:        qty,
            unit_price:      product.price,
          });

        } else {
          // ── Produto sem variação ─────────────────────────────────────────
          if (product.stock < qty)
            throw {
              status: 400,
              error: `Estoque insuficiente para "${product.name}". Disponível: ${product.stock}`,
            };

          db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?')
            .run(qty, product.id);

          orderItems.push({
            product_id:      product.id,
            variation_id:    null,
            product_name:    product.name,
            variation_label: null,
            quantity:        qty,
            unit_price:      product.price,
          });
        }

        total += product.price * qty;
      }

      // Criar pedido
      const orderCode = generateOrderCode();
      const { lastInsertRowid: orderId } = db.prepare(
        'INSERT INTO orders (code, customer_id, total) VALUES (?, ?, ?)'
      ).run(orderCode, cust.id, total);

      // Inserir itens
      const insItem = db.prepare(`
        INSERT INTO order_items
          (order_id, product_id, variation_id, product_name, variation_label, quantity, unit_price)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      orderItems.forEach(i =>
        insItem.run(orderId, i.product_id, i.variation_id, i.product_name, i.variation_label, i.quantity, i.unit_price)
      );

      return { orderId, code: orderCode, orderItems, customer: cust };

    })(); // executa a transação imediatamente

    // ── Etapa 2: criar preferência no Mercado Pago (fora da transação) ───────
    let paymentUrl = null;
    let preferenceId = null;

    try {
      const mp = await createPaymentPreference({
        order:   { id: orderId, code },
        items:   orderItems,
        customer,
        appUrl:  process.env.APP_URL || 'http://localhost:3000',
      });
      paymentUrl   = mp.paymentUrl;
      preferenceId = mp.preferenceId;
    } catch (err) {
      console.error('MP error:', err.message);
    }

    db.prepare('INSERT INTO payments (order_id, mp_preference_id, payment_url) VALUES (?, ?, ?)')
      .run(orderId, preferenceId, paymentUrl);

    res.json({ code, paymentUrl });

  } catch (err) {
    // Erros de negócio (estoque, produto inválido etc.)
    if (err.status) return res.status(err.status).json({ error: err.error });

    console.error('Checkout error:', err);
    res.status(500).json({ error: 'Erro interno ao processar pedido' });
  }
});

module.exports = router;