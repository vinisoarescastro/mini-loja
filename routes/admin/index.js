const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('../../db/database');
const { generateOrderCode } = require('../../lib/utils');
const { requireAuth, requireAdmin } = require('../../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function fetchImagesMap(productIds) {
  if (!productIds.length) return {};
  const rows = db.prepare(
    `SELECT product_id, url FROM product_images WHERE product_id IN (${productIds.map(()=>'?').join(',')}) ORDER BY sort_order`
  ).all(...productIds);
  const map = {};
  for (const r of rows) {
    if (!map[r.product_id]) map[r.product_id] = [];
    map[r.product_id].push(r.url);
  }
  return map;
}

const PAY_LABEL    = { PENDING:'Aguardando', APPROVED:'Aprovado', REJECTED:'Recusado', REFUNDED:'Estornado' };
const STATUS_LABEL = { PENDING:'Pendente', CONFIRMED:'Confirmado', PREPARING:'Preparando', SHIPPED:'Enviado', DELIVERED:'Entregue', CANCELLED:'Cancelado' };

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get('/dashboard', (req, res) => {
  // Pedidos cancelados excluídos de todas as métricas
  const totalOrders = db.prepare(
    "SELECT COUNT(*) as n FROM orders WHERE order_status != 'CANCELLED'"
  ).get().n;

  const totalApprovedOrders = db.prepare(
    "SELECT COUNT(*) as n FROM orders WHERE payment_status='APPROVED' AND order_status != 'CANCELLED'"
  ).get().n;

  const totalApproved = db.prepare(
    "SELECT COALESCE(SUM(total),0) as s FROM orders WHERE payment_status='APPROVED' AND order_status != 'CANCELLED'"
  ).get().s;

  const totalPending = db.prepare(
    "SELECT COALESCE(SUM(total),0) as s FROM orders WHERE payment_status='PENDING' AND order_status != 'CANCELLED'"
  ).get().s;

  const topProducts = db.prepare(`
    SELECT oi.product_name AS name, SUM(oi.quantity) AS qty, SUM(oi.quantity*oi.unit_price) AS revenue
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.order_status != 'CANCELLED'
    GROUP BY oi.product_name
    ORDER BY qty DESC
    LIMIT 10
  `).all();

  const recentOrders = db.prepare(`
    SELECT o.*, c.name as customer_name, c.phone as customer_phone
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    WHERE o.order_status != 'CANCELLED'
    ORDER BY o.created_at DESC
    LIMIT 10
  `).all();

  res.json({
    totalOrders,
    totalApprovedOrders,
    totalApproved,
    totalPending,
    topProducts,
    recentOrders,
  });
});

// ── Products (admin) ──────────────────────────────────────────────────────────
router.get('/products', (req, res) => {
  const rows = db.prepare(`
    SELECT p.*,
      COALESCE((SELECT SUM(oi.quantity) FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.product_id=p.id AND o.order_status != 'CANCELLED'),0) AS total_ordered,
      GROUP_CONCAT(pv.id||':'||pv.label||':'||pv.stock,'|') AS variations_raw
    FROM products p
    LEFT JOIN product_variations pv ON pv.product_id=p.id
    GROUP BY p.id ORDER BY p.id DESC
  `).all();

  const ids    = rows.map(p=>p.id);
  const imgMap = fetchImagesMap(ids);

  // Vendas por variação (excluindo cancelados)
  const varSales = ids.length ? db.prepare(`
    SELECT oi.variation_id, pv.label, SUM(oi.quantity) as sold
    FROM order_items oi
    JOIN product_variations pv ON pv.id = oi.variation_id
    JOIN orders o ON o.id = oi.order_id
    WHERE pv.product_id IN (${ids.map(()=>'?').join(',')})
      AND o.order_status != 'CANCELLED'
    GROUP BY oi.variation_id
  `).all(...ids) : [];

  const varSalesMap = {};
  for (const vs of varSales) {
    if (!varSalesMap[vs.variation_id]) varSalesMap[vs.variation_id] = {};
    varSalesMap[vs.variation_id] = { label: vs.label, sold: vs.sold };
  }

  res.json(rows.map(p => {
    const imgs = imgMap[p.id] || (p.image_url ? [p.image_url] : []);
    const variations = p.variations_raw
      ? p.variations_raw.split('|').map(v => {
          const [id, label, stock] = v.split(':');
          const vid  = Number(id);
          const sold = varSalesMap[vid]?.sold ?? 0;
          return { id: vid, label, stock: Number(stock), sold };
        })
      : [];
    return {
      ...p,
      active:        !!p.active,
      made_to_order: !!p.made_to_order,
      images: imgs,
      image_url: imgs[0] || p.image_url || null,
      variations,
      variations_raw: undefined,
    };
  }));
});

// ── Orders ────────────────────────────────────────────────────────────────────
router.get('/orders', requireAdmin, (req, res) => {
  const { page = 1, search = '', paymentStatus = '', orderStatus = '' } = req.query;
  const limit  = 20;
  const offset = (Number(page) - 1) * limit;

  let where = '1=1';
  const params = [];

  if (search) {
    where += ' AND (o.code LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s);
  }
  if (paymentStatus) { where += ' AND o.payment_status = ?'; params.push(paymentStatus); }
  if (orderStatus)   { where += ' AND o.order_status = ?';   params.push(orderStatus);   }

  const total = db.prepare(
    `SELECT COUNT(*) as n FROM orders o JOIN customers c ON c.id=o.customer_id WHERE ${where}`
  ).get(...params).n;

  const orders = db.prepare(
    `SELECT o.*, c.name as customer_name, c.phone as customer_phone, c.email as customer_email
     FROM orders o JOIN customers c ON c.id=o.customer_id
     WHERE ${where} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  res.json({ orders, total, pages: Math.ceil(total / limit) });
});

// ── Orders Export (CSV) ───────────────────────────────────────────────────────
router.get('/orders/export', requireAdmin, (req, res) => {
  const { search = '', paymentStatus = '', orderStatus = '', dateFrom = '', dateTo = '' } = req.query;

  let where = '1=1';
  const params = [];

  if (search) {
    where += ' AND (o.code LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s);
  }
  if (paymentStatus) { where += ' AND o.payment_status = ?'; params.push(paymentStatus); }
  if (orderStatus)   { where += ' AND o.order_status = ?';   params.push(orderStatus);   }
  if (dateFrom)      { where += ' AND DATE(o.created_at) >= ?'; params.push(dateFrom);   }
  if (dateTo)        { where += ' AND DATE(o.created_at) <= ?'; params.push(dateTo);     }

  const orders = db.prepare(`
    SELECT
      o.code,
      c.name   AS cliente,
      c.phone  AS whatsapp,
      c.email  AS email,
      c.cpf    AS cpf,
      o.total,
      o.payment_status,
      o.order_status,
      o.created_at,
      (SELECT GROUP_CONCAT(oi2.product_name ||
        CASE WHEN oi2.variation_label IS NOT NULL AND oi2.variation_label != '' THEN ' (' || oi2.variation_label || ')' ELSE '' END
        || ' x' || oi2.quantity, ' | ')
       FROM order_items oi2 WHERE oi2.order_id = o.id) AS itens
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    WHERE ${where}
    ORDER BY o.created_at DESC
  `).all(...params);

  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;

  const header = ['Código','Cliente','WhatsApp','E-mail','CPF','Total (R$)','Pagamento','Status','Data','Itens'];
  const rows = orders.map(o => [
    o.code,
    o.cliente,
    o.whatsapp,
    o.email || '',
    o.cpf   || '',
    String(o.total).replace('.', ','),
    PAY_LABEL[o.payment_status]    || o.payment_status,
    STATUS_LABEL[o.order_status]   || o.order_status,
    new Date(o.created_at).toLocaleString('pt-BR'),
    o.itens || '',
  ]);

  const csv = [header, ...rows]
    .map(r => r.map(esc).join(';'))
    .join('\r\n');

  const filename = `pedidos-${new Date().toISOString().slice(0,10)}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\uFEFF' + csv); // BOM UTF-8 para Excel reconhecer acentuação
});

// ── Order detail ──────────────────────────────────────────────────────────────
router.get('/orders/:id', requireAdmin, (req, res) => {
  const o = db.prepare(
    `SELECT o.*, c.name as customer_name, c.phone as customer_phone, c.email as customer_email, c.cpf as customer_cpf
     FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.id=?`
  ).get(req.params.id);
  if (!o) return res.status(404).json({ error: 'Pedido não encontrado' });
  o.items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(o.id);
  res.json(o);
});

// ── Order update ──────────────────────────────────────────────────────────────
router.patch('/orders/:id', requireAdmin, (req, res) => {
  const { payment_status, order_status } = req.body;
  const fields = [];
  const vals   = [];
  if (payment_status) { fields.push('payment_status=?'); vals.push(payment_status); }
  if (order_status)   { fields.push('order_status=?');   vals.push(order_status);   }
  if (!fields.length) return res.status(400).json({ error: 'Nada para atualizar' });
  vals.push(req.params.id);
  db.prepare(`UPDATE orders SET ${fields.join(',')} WHERE id=?`).run(...vals);
  res.json({ ok: true });
});

// ── Create order (admin) ──────────────────────────────────────────────────────
router.post('/orders', requireAdmin, (req, res) => {
  const { customer, items, order_status = 'CONFIRMED', payment_status = 'PENDING' } = req.body;
  if (!customer?.name || !customer?.phone || !Array.isArray(items) || !items.length)
    return res.status(400).json({ error: 'Dados incompletos' });

  try {
    const result = db.transaction(() => {
      let cust = db.prepare('SELECT * FROM customers WHERE phone=?').get(customer.phone);
      if (!cust) {
        const r = db.prepare('INSERT INTO customers (name,phone,email,cpf) VALUES (?,?,?,?)')
          .run(customer.name, customer.phone, customer.email||null, customer.cpf||null);
        cust = db.prepare('SELECT * FROM customers WHERE id=?').get(r.lastInsertRowid);
      } else {
        db.prepare('UPDATE customers SET name=?,email=COALESCE(?,email),cpf=COALESCE(?,cpf) WHERE id=?')
          .run(customer.name, customer.email||null, customer.cpf||null, cust.id);
      }

      let total = 0;
      const orderItems = [];
      for (const item of items) {
        const product = db.prepare('SELECT * FROM products WHERE id=?').get(item.product_id);
        if (!product) throw { status:400, error:`Produto ${item.product_id} não encontrado` };
        const variation = item.variation_id
          ? db.prepare('SELECT * FROM product_variations WHERE id=? AND product_id=?').get(item.variation_id, product.id)
          : null;
        const unit_price = item.unit_price || product.price;
        total += unit_price * item.quantity;
        orderItems.push({
          product_id: product.id, product_name: product.name,
          variation_id: variation?.id||null, variation_label: variation?.label||null,
          quantity: item.quantity, unit_price,
        });
      }

      const code = generateOrderCode();
      const { lastInsertRowid: orderId } = db.prepare(
        'INSERT INTO orders (code,customer_id,total,order_status,payment_status) VALUES (?,?,?,?,?)'
      ).run(code, cust.id, total, order_status, payment_status);

      const insItem = db.prepare(
        'INSERT INTO order_items (order_id,product_id,product_name,variation_id,variation_label,quantity,unit_price) VALUES (?,?,?,?,?,?,?)'
      );
      for (const it of orderItems)
        insItem.run(orderId, it.product_id, it.product_name, it.variation_id, it.variation_label, it.quantity, it.unit_price);

      return { orderId, code };
    })();

    res.status(201).json(result);
  } catch (err) {
    res.status(err.status||500).json({ error: err.error||err.message||'Erro interno' });
  }
});

// ── Customers ─────────────────────────────────────────────────────────────────
router.get('/customers', requireAdmin, (req, res) => {
  const { page = 1, search = '' } = req.query;
  const limit  = 20;
  const offset = (Number(page) - 1) * limit;
  let where = '1=1';
  const params = [];
  if (search) {
    where += ' AND (c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s);
  }
  const total = db.prepare(`SELECT COUNT(*) as n FROM customers c WHERE ${where}`).get(...params).n;
  const customers = db.prepare(`
    SELECT c.*,
      COUNT(DISTINCT o.id) as total_orders,
      COALESCE(SUM(o.total),0) as total_spent,
      MAX(o.created_at) as last_order
    FROM customers c
    LEFT JOIN orders o ON o.customer_id = c.id
    WHERE ${where}
    GROUP BY c.id ORDER BY c.id DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  res.json({ customers, total, pages: Math.ceil(total / limit) });
});

router.post('/customers', requireAdmin, (req, res) => {
  const { name, phone, email, cpf } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'Nome e telefone obrigatórios' });
  const exists = db.prepare('SELECT id FROM customers WHERE phone=?').get(phone);
  if (exists) return res.status(409).json({ error: 'Telefone já cadastrado' });
  const r = db.prepare('INSERT INTO customers (name,phone,email,cpf) VALUES (?,?,?,?)').run(name, phone, email||null, cpf||null);
  res.status(201).json({ id: r.lastInsertRowid });
});

router.patch('/customers/:id', requireAdmin, (req, res) => {
  const { name, phone, email, cpf } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'Nome e telefone obrigatórios' });
  db.prepare('UPDATE customers SET name=?,phone=?,email=?,cpf=? WHERE id=?').run(name, phone, email||null, cpf||null, req.params.id);
  res.json({ ok: true });
});

router.delete('/customers/:id', requireAdmin, (req, res) => {
  const refs = db.prepare('SELECT COUNT(*) as n FROM orders WHERE customer_id=?').get(req.params.id).n;
  if (refs > 0) return res.status(409).json({ error: 'Cliente possui pedidos e não pode ser excluído.' });
  db.prepare('DELETE FROM customers WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── Users ─────────────────────────────────────────────────────────────────────
router.get('/users', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT id,name,email,role,active FROM users ORDER BY id').all());
});

router.post('/users', requireAdmin, async (req, res) => {
  const { name, email, password, role = 'VIEWER' } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  const exists = db.prepare('SELECT id FROM users WHERE email=?').get(email);
  if (exists) return res.status(409).json({ error: 'E-mail já cadastrado' });
  const hash = await bcrypt.hash(password, 10);
  const r = db.prepare('INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)').run(name, email, hash, role);
  res.status(201).json({ id: r.lastInsertRowid });
});

router.patch('/users/:id/role', requireAdmin, (req, res) => {
  const { role } = req.body;
  if (!['ADMIN','VIEWER'].includes(role)) return res.status(400).json({ error: 'Papel inválido' });
  db.prepare('UPDATE users SET role=? WHERE id=?').run(role, req.params.id);
  res.json({ ok: true });
});

router.patch('/users/:id/active', requireAdmin, (req, res) => {
  db.prepare('UPDATE users SET active=? WHERE id=?').run(req.body.active ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

module.exports = router;