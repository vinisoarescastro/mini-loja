const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../../db/database');
const { requireAuth, requireAdmin } = require('../../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// ── Dashboard ────────────────────────────────────────────────────────────────
router.get('/dashboard', (req, res) => {
  const totalOrders = db.prepare('SELECT COUNT(*) as n FROM orders').get().n;
  const totalGross = db.prepare('SELECT COALESCE(SUM(total),0) as s FROM orders').get().s;
  const totalApproved = db.prepare(
    `SELECT COALESCE(SUM(total),0) as s FROM orders WHERE payment_status = 'APPROVED'`
  ).get().s;

  const productBreakdown = db.prepare(`
    SELECT oi.product_name, SUM(oi.quantity) as qty, SUM(oi.quantity * oi.unit_price) as revenue
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.payment_status = 'APPROVED'
    GROUP BY oi.product_name
    ORDER BY revenue DESC
    LIMIT 10
  `).all();

  const recentOrders = db.prepare(`
    SELECT o.*, c.name as customer_name, c.phone as customer_phone
    FROM orders o JOIN customers c ON c.id = o.customer_id
    ORDER BY o.created_at DESC LIMIT 10
  `).all();

  res.json({ totalOrders, totalGross, totalApproved, productBreakdown, recentOrders });
});

// ── Orders ───────────────────────────────────────────────────────────────────
router.get('/orders', (req, res) => {
  const { paymentStatus, orderStatus, search } = req.query;
  // node:sqlite é estrito com tipos — garantir inteiros para LIMIT e OFFSET
  const limit  = 20;
  const page   = Math.max(1, parseInt(req.query.page, 10) || 1);
  const offset = (page - 1) * limit;

  let where = '1=1';
  const params = [];

  if (paymentStatus) { where += ' AND o.payment_status = ?'; params.push(paymentStatus); }
  if (orderStatus)   { where += ' AND o.order_status = ?';   params.push(orderStatus); }
  if (search)        {
    where += ' AND (o.code LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const total = db.prepare(
    `SELECT COUNT(*) as n FROM orders o JOIN customers c ON c.id = o.customer_id WHERE ${where}`
  ).get(...params).n;

  const orders = db.prepare(`
    SELECT o.*, c.name as customer_name, c.phone as customer_phone
    FROM orders o JOIN customers c ON c.id = o.customer_id
    WHERE ${where}
    ORDER BY o.created_at DESC LIMIT ${limit} OFFSET ${offset}
  `).all(...params);

  res.json({ orders, total, pages: Math.ceil(total / limit) });
});

router.get('/orders/:id', (req, res) => {
  const order = db.prepare(`
    SELECT o.*, c.name as customer_name, c.phone as customer_phone, c.email as customer_email,
           p.payment_url, p.mp_payment_id
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    LEFT JOIN payments p ON p.order_id = o.id
    WHERE o.id = ?
  `).get(req.params.id);

  if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });

  order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  res.json(order);
});

router.patch('/orders/:id', (req, res) => {
  const { orderStatus, paymentStatus } = req.body;
  const fields = [];
  const params = [];

  if (orderStatus)   { fields.push('order_status = ?');   params.push(orderStatus); }
  if (paymentStatus) { fields.push('payment_status = ?'); params.push(paymentStatus); }
  if (!fields.length) return res.status(400).json({ error: 'Nada a atualizar' });

  params.push(parseInt(req.params.id, 10));
  db.prepare(`UPDATE orders SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  res.json({ ok: true });
});

// ── Customers ────────────────────────────────────────────────────────────────
router.get('/customers', (req, res) => {
  const { search } = req.query;
  const limit  = 20;
  const page   = Math.max(1, parseInt(req.query.page, 10) || 1);
  const offset = (page - 1) * limit;

  let where = '1=1';
  const params = [];
  if (search) {
    where += ' AND (c.name LIKE ? OR c.phone LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  const total = db.prepare(`SELECT COUNT(*) as n FROM customers c WHERE ${where}`).get(...params).n;

  const customers = db.prepare(`
    SELECT c.*,
      COUNT(o.id) as total_orders,
      COALESCE(SUM(o.total),0) as total_spent,
      MAX(o.created_at) as last_order
    FROM customers c
    LEFT JOIN orders o ON o.customer_id = c.id
    WHERE ${where}
    GROUP BY c.id
    ORDER BY c.created_at DESC LIMIT ${limit} OFFSET ${offset}
  `).all(...params);

  res.json({ customers, total, pages: Math.ceil(total / limit) });
});

// ── Users ────────────────────────────────────────────────────────────────────
router.get('/users', requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, name, email, role, active, created_at FROM users ORDER BY id').all();
  res.json(users);
});

router.post('/users', requireAdmin, (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Dados incompletos' });

  const hash = bcrypt.hashSync(password, 10);
  const r = db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
    .run(name, email, hash, role === 'ADMIN' ? 'ADMIN' : 'VIEWER');

  res.status(201).json({ id: r.lastInsertRowid });
});

router.patch('/users/:id', requireAdmin, (req, res) => {
  const { role, active } = req.body;
  if (Number(req.params.id) === req.user.id)
    return res.status(400).json({ error: 'Você não pode editar sua própria conta' });

  const fields = [];
  const params = [];
  if (role !== undefined)   { fields.push('role = ?');   params.push(role === 'ADMIN' ? 'ADMIN' : 'VIEWER'); }
  if (active !== undefined) { fields.push('active = ?'); params.push(active ? 1 : 0); }
  if (!fields.length) return res.status(400).json({ error: 'Nada a atualizar' });

  params.push(parseInt(req.params.id, 10));
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  res.json({ ok: true });
});

router.delete('/users/:id', requireAdmin, (req, res) => {
  if (Number(req.params.id) === req.user.id)
    return res.status(400).json({ error: 'Você não pode excluir sua própria conta' });
  db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(parseInt(req.params.id, 10));
  res.json({ ok: true });
});

module.exports = router;