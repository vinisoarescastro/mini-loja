const express = require('express');
const db = require('../db/database');
const { generateOrderCode } = require('../lib/utils');
const { createPaymentPreference } = require('../lib/mercadopago');

const router = express.Router();

/** Verifica se o prazo de encomenda já passou (fim do dia da data limite) */
function deadlinePassed(deadline) {
  if (!deadline) return false;
  const d = new Date(deadline);
  d.setHours(23, 59, 59, 999);
  return d < new Date();
}

/** Valida CPF com dígitos verificadores */
function validarCPF(cpf) {
  const c = String(cpf).replace(/\D/g, '');
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  let sum = 0;
  for (let i = 1; i <= 9; i++) sum += parseInt(c[i - 1]) * (11 - i);
  let rem = (sum * 10) % 11;
  if (rem === 10 || rem === 11) rem = 0;
  if (rem !== parseInt(c[9])) return false;
  sum = 0;
  for (let i = 1; i <= 10; i++) sum += parseInt(c[i - 1]) * (12 - i);
  rem = (sum * 10) % 11;
  if (rem === 10 || rem === 11) rem = 0;
  return rem === parseInt(c[10]);
}

router.post('/', async (req, res) => {
  const { name, phone, email, cpf, items } = req.body;

  // ── Validações obrigatórias ───────────────────────────────────────────────
  if (!name || !phone || !email || !cpf)
    return res.status(400).json({ error: 'Todos os campos são obrigatórios: nome, WhatsApp, e-mail e CPF.' });

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'E-mail inválido.' });

  const cpfDigits = String(cpf).replace(/\D/g, '');
  if (!validarCPF(cpfDigits))
    return res.status(400).json({ error: 'CPF inválido.' });

  if (!Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: 'Carrinho vazio.' });

  try {
    const { orderId, code, orderItems, customer } = db.transaction(() => {

      // Upsert customer
      let cust = db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone);
      if (!cust) {
        const r = db.prepare('INSERT INTO customers (name, phone, email, cpf) VALUES (?, ?, ?, ?)')
          .run(name, phone, email, cpfDigits);
        cust = db.prepare('SELECT * FROM customers WHERE id = ?').get(r.lastInsertRowid);
      } else {
        db.prepare('UPDATE customers SET name=?, email=COALESCE(?,email), cpf=COALESCE(?,cpf) WHERE id=?')
          .run(name, email, cpfDigits, cust.id);
      }

      let total = 0;
      const orderItems = [];

      for (const item of items) {
        const qty = Math.max(1, Math.floor(item.quantity || 1));

        const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(item.productId);
        if (!product)
          throw { status: 400, error: `Produto ${item.productId} não encontrado` };

        // ── Valida prazo de encomenda ─────────────────────────────────────
        if (product.made_to_order && deadlinePassed(product.preorder_deadline)) {
          throw {
            status: 400,
            error: `As encomendas para "${product.name}" foram encerradas em ${
              new Date(product.preorder_deadline).toLocaleDateString('pt-BR')
            }.`,
          };
        }

        if (item.variationId) {
          const variation = db.prepare(
            'SELECT * FROM product_variations WHERE id = ? AND product_id = ?'
          ).get(item.variationId, product.id);

          if (!variation)
            throw { status: 400, error: 'Variação inválida' };

          if (!product.made_to_order) {
            if (variation.stock < qty)
              throw {
                status: 400,
                error: `Estoque insuficiente para "${product.name} — ${variation.label}". Disponível: ${variation.stock}`,
              };
            db.prepare('UPDATE product_variations SET stock = stock - ? WHERE id = ?')
              .run(qty, variation.id);
          }

          orderItems.push({
            product_id:      product.id,
            variation_id:    variation.id,
            product_name:    product.name,
            variation_label: variation.label,
            quantity:        qty,
            unit_price:      product.price,
          });

        } else {
          if (!product.made_to_order) {
            if (product.stock < qty)
              throw {
                status: 400,
                error: `Estoque insuficiente para "${product.name}". Disponível: ${product.stock}`,
              };
            db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?')
              .run(qty, product.id);
          }

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

      const orderCode = generateOrderCode();
      const { lastInsertRowid: orderId } = db.prepare(
        'INSERT INTO orders (code, customer_id, total) VALUES (?, ?, ?)'
      ).run(orderCode, cust.id, total);

      const insItem = db.prepare(`
        INSERT INTO order_items
          (order_id, product_id, variation_id, product_name, variation_label, quantity, unit_price)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      orderItems.forEach(i =>
        insItem.run(orderId, i.product_id, i.variation_id, i.product_name, i.variation_label, i.quantity, i.unit_price)
      );

      return { orderId, code: orderCode, orderItems, customer: cust };
    })();

    // Mercado Pago
    let paymentUrl = null, preferenceId = null;
    try {
      const mp = await createPaymentPreference({
        order:   { id: orderId, code },
        items:   orderItems,
        customer,
        appUrl:  process.env.APP_URL || 'http://localhost:3000',
      });
      paymentUrl   = mp.paymentUrl;
      preferenceId = mp.preferenceId;
    } catch (mpErr) {
      console.error('MP error:', mpErr.message);
      db.transaction(() => {
        for (const i of orderItems) {
          const prod = db.prepare('SELECT made_to_order FROM products WHERE id = ?').get(i.product_id);
          if (!prod?.made_to_order) {
            if (i.variation_id) {
              db.prepare('UPDATE product_variations SET stock = stock + ? WHERE id = ?').run(i.quantity, i.variation_id);
            } else {
              db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(i.quantity, i.product_id);
            }
          }
        }
        db.prepare('DELETE FROM order_items WHERE order_id = ?').run(orderId);
        db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
      })();
      return res.status(502).json({
        error: 'Não foi possível conectar ao Mercado Pago. Verifique as credenciais no .env e tente novamente.',
      });
    }

    db.prepare('INSERT INTO payments (order_id, mp_preference_id, payment_url) VALUES (?, ?, ?)')
      .run(orderId, preferenceId, paymentUrl);

    res.json({ code, paymentUrl });

  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.error });
    console.error('Checkout error:', err);
    res.status(500).json({ error: 'Erro interno ao processar pedido' });
  }
});

module.exports = router;