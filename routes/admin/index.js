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

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get('/dashboard', (req, res) => {
  const totalOrders   = db.prepare('SELECT COUNT(*) as n FROM orders').get().n;
  const pendingOrders = db.prepare("SELECT COUNT(*) as n FROM orders WHERE order_status='PENDING'").get().n;
  const totalGross    = db.prepare('SELECT COALESCE(SUM(total),0) as s FROM orders').get().s;
  const totalApproved = db.prepare("SELECT COALESCE(SUM(total),0) as s FROM orders WHERE payment_status='APPROVED'").get().s;
  const totalPending  = db.prepare("SELECT COALESCE(SUM(total),0) as s FROM orders WHERE payment_status='PENDING'").get().s;

  const topProducts = db.prepare(`
    SELECT oi.product_name AS name, SUM(oi.quantity) AS qty, SUM(oi.quantity*oi.unit_price) AS revenue
    FROM order_items oi JOIN orders o ON o.id=oi.order_id
    GROUP BY oi.product_name ORDER BY qty DESC LIMIT 10
  `).all();

  const recentOrders = db.prepare(`
    SELECT o.*, c.name as customer_name, c.phone as customer_phone
    FROM orders o JOIN customers c ON c.id=o.customer_id
    ORDER BY o.created_at DESC LIMIT 10
  `).all();

  res.json({ totalOrders, pendingOrders, totalGross, totalApproved, totalPending, topProducts, productBreakdown: topProducts, recentOrders });
});

// ── Products (admin — todos, com imagens) ─────────────────────────────────────
router.get('/products', (req, res) => {
  const rows = db.prepare(`
    SELECT p.*,
      COALESCE((SELECT SUM(oi.quantity) FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.product_id=p.id),0) AS total_ordered,
      GROUP_CONCAT(pv.id||':'||pv.label||':'||pv.stock,'|') AS variations_raw
    FROM products p
    LEFT JOIN product_variations pv ON pv.product_id=p.id
    GROUP BY p.id ORDER BY p.id DESC
  `).all();

  const ids    = rows.map(p=>p.id);
  const imgMap = fetchImagesMap(ids);

  res.json(rows.map(p => {
    const imgs = imgMap[p.id] || (p.image_url ? [p.image_url] : []);
    return {
      ...p,
      active:        !!p.active,
      made_to_order: !!p.made_to_order,
      images: imgs,
      image_url: imgs[0] || p.image_url || null,
      variations: p.variations_raw
        ? p.variations_raw.split('|').map(v => { const [id,label,stock]=v.split(':'); return {id:Number(id),label,stock:Number(stock)}; })
        : [],
      variations_raw: undefined,
    };
  }));
});

// ── Orders ────────────────────────────────────────────────────────────────────
router.get('/orders', (req, res) => {
  const { paymentStatus, orderStatus, search } = req.query;
  const limit = 20, page = Math.max(1, parseInt(req.query.page,10)||1), offset = (page-1)*limit;
  let where = '1=1'; const params = [];
  if (paymentStatus) { where += ' AND o.payment_status=?'; params.push(paymentStatus); }
  if (orderStatus)   { where += ' AND o.order_status=?';   params.push(orderStatus); }
  if (search) { where += ' AND (o.code LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)'; params.push(`%${search}%`,`%${search}%`,`%${search}%`); }
  const total  = db.prepare(`SELECT COUNT(*) as n FROM orders o JOIN customers c ON c.id=o.customer_id WHERE ${where}`).get(...params).n;
  const orders = db.prepare(`SELECT o.*, c.name as customer_name, c.phone as customer_phone FROM orders o JOIN customers c ON c.id=o.customer_id WHERE ${where} ORDER BY o.created_at DESC LIMIT ${limit} OFFSET ${offset}`).all(...params);
  res.json({ orders, total, pages: Math.ceil(total/limit) });
});

router.get('/orders/:id', (req, res) => {
  const order = db.prepare(`SELECT o.*, c.name as customer_name, c.phone as customer_phone, c.email as customer_email, p.payment_url, p.mp_payment_id FROM orders o JOIN customers c ON c.id=o.customer_id LEFT JOIN payments p ON p.order_id=o.id WHERE o.id=?`).get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });
  order.items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(order.id);
  res.json(order);
});

router.patch('/orders/:id', (req, res) => {
  const { orderStatus, paymentStatus } = req.body;
  const fields = [], params = [];
  if (orderStatus)   { fields.push('order_status=?');   params.push(orderStatus); }
  if (paymentStatus) { fields.push('payment_status=?'); params.push(paymentStatus); }
  if (!fields.length) return res.status(400).json({ error: 'Nada a atualizar' });
  params.push(parseInt(req.params.id,10));
  db.prepare(`UPDATE orders SET ${fields.join(',')} WHERE id=?`).run(...params);
  res.json({ ok: true });
});

router.post('/orders', (req, res) => {
  const { customer, items, order_status='CONFIRMED', payment_status='APPROVED' } = req.body;
  if (!customer || !Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Dados incompletos' });
  try {
    const { orderId, code } = db.transaction(() => {
      let cust;
      if (customer.id) {
        cust = db.prepare('SELECT * FROM customers WHERE id=?').get(customer.id);
        if (!cust) throw { status:400, error:'Cliente não encontrado' };
      } else {
        if (!customer.phone) throw { status:400, error:'Telefone obrigatório' };
        cust = db.prepare('SELECT * FROM customers WHERE phone=?').get(customer.phone);
        if (!cust) {
          const r = db.prepare('INSERT INTO customers (name,phone,email,cpf) VALUES (?,?,?,?)').run(customer.name||'Sem nome',customer.phone,customer.email||null,customer.cpf||null);
          cust = db.prepare('SELECT * FROM customers WHERE id=?').get(r.lastInsertRowid);
        }
      }
      let total = 0; const orderItems = [];
      for (const item of items) {
        const qty = Math.max(1,parseInt(item.quantity)||1);
        const product = db.prepare('SELECT * FROM products WHERE id=?').get(item.product_id);
        if (!product) throw { status:400, error:`Produto ${item.product_id} não encontrado` };
        const variation = item.variation_id ? db.prepare('SELECT * FROM product_variations WHERE id=?').get(item.variation_id) : null;
        const unitPrice = parseFloat(item.unit_price)||product.price;
        total += unitPrice*qty;
        orderItems.push({ product_id:product.id, variation_id:variation?.id??null, product_name:product.name, variation_label:variation?.label??null, quantity:qty, unit_price:unitPrice });
      }
      const code = generateOrderCode();
      const { lastInsertRowid: orderId } = db.prepare('INSERT INTO orders (code,customer_id,total,order_status,payment_status) VALUES (?,?,?,?,?)').run(code,cust.id,total,order_status,payment_status);
      const ins = db.prepare('INSERT INTO order_items (order_id,product_id,variation_id,product_name,variation_label,quantity,unit_price) VALUES (?,?,?,?,?,?,?)');
      orderItems.forEach(i => ins.run(orderId,i.product_id,i.variation_id,i.product_name,i.variation_label,i.quantity,i.unit_price));
      return { orderId, code };
    })();
    res.status(201).json({ id: orderId, code });
  } catch(err) {
    if (err.status) return res.status(err.status).json({ error: err.error });
    console.error(err); res.status(500).json({ error:'Erro interno' });
  }
});

// ── Customers ─────────────────────────────────────────────────────────────────
router.get('/customers', (req, res) => {
  const { search } = req.query;
  const limit=20, page=Math.max(1,parseInt(req.query.page,10)||1), offset=(page-1)*limit;
  let where='1=1'; const params=[];
  if (search) { where+=' AND (c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)'; params.push(`%${search}%`,`%${search}%`,`%${search}%`); }
  const total = db.prepare(`SELECT COUNT(*) as n FROM customers c WHERE ${where}`).get(...params).n;
  const customers = db.prepare(`SELECT c.*, COUNT(o.id) as total_orders, COALESCE(SUM(o.total),0) as total_spent, MAX(o.created_at) as last_order FROM customers c LEFT JOIN orders o ON o.customer_id=c.id WHERE ${where} GROUP BY c.id ORDER BY c.created_at DESC LIMIT ${limit} OFFSET ${offset}`).all(...params);
  res.json({ customers, total, pages:Math.ceil(total/limit) });
});

router.post('/customers', (req, res) => {
  const { name, phone, email, cpf } = req.body;
  if (!name || !phone) return res.status(400).json({ error:'Nome e telefone obrigatórios' });
  if (db.prepare('SELECT id FROM customers WHERE phone=?').get(phone)) return res.status(409).json({ error:'Telefone já cadastrado' });
  const r = db.prepare('INSERT INTO customers (name,phone,email,cpf) VALUES (?,?,?,?)').run(name,phone,email||null,cpf||null);
  res.status(201).json({ id:r.lastInsertRowid });
});

router.patch('/customers/:id', (req, res) => {
  const { name, phone, email, cpf } = req.body;
  const id = parseInt(req.params.id,10);
  const current = db.prepare('SELECT * FROM customers WHERE id=?').get(id);
  if (!current) return res.status(404).json({ error:'Cliente não encontrado' });
  if (phone && phone !== current.phone && db.prepare('SELECT id FROM customers WHERE phone=? AND id!=?').get(phone,id)) return res.status(409).json({ error:'Telefone já cadastrado em outro cliente' });
  db.prepare('UPDATE customers SET name=?,phone=?,email=?,cpf=? WHERE id=?').run(name||current.name,phone||current.phone,email??current.email,cpf??current.cpf,id);
  res.json({ ok:true });
});

router.delete('/customers/:id', (req, res) => {
  const id = parseInt(req.params.id,10);
  const orders = db.prepare('SELECT COUNT(*) as n FROM orders WHERE customer_id=?').get(id).n;
  if (orders>0) return res.status(409).json({ error:`Este cliente possui ${orders} pedido(s) e não pode ser excluído.` });
  db.prepare('DELETE FROM customers WHERE id=?').run(id);
  res.json({ ok:true });
});

// ── Users ─────────────────────────────────────────────────────────────────────
router.get('/users', requireAdmin, (req,res) => res.json(db.prepare('SELECT id,name,email,role,active,created_at FROM users ORDER BY id').all()));

router.post('/users', requireAdmin, (req,res) => {
  const { name, email, password, role } = req.body;
  if (!name||!email||!password) return res.status(400).json({ error:'Dados incompletos' });
  const r = db.prepare('INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)').run(name,email,bcrypt.hashSync(password,10),role==='ADMIN'?'ADMIN':'VIEWER');
  res.status(201).json({ id:r.lastInsertRowid });
});

router.patch('/users/:id', requireAdmin, (req,res) => {
  const { role, active } = req.body;
  if (Number(req.params.id)===req.user.id) return res.status(400).json({ error:'Você não pode editar sua própria conta' });
  const fields=[],params=[];
  if (role!==undefined)   { fields.push('role=?');   params.push(role==='ADMIN'?'ADMIN':'VIEWER'); }
  if (active!==undefined) { fields.push('active=?'); params.push(active?1:0); }
  if (!fields.length) return res.status(400).json({ error:'Nada a atualizar' });
  params.push(parseInt(req.params.id,10));
  db.prepare(`UPDATE users SET ${fields.join(',')} WHERE id=?`).run(...params);
  res.json({ ok:true });
});

router.delete('/users/:id', requireAdmin, (req,res) => {
  if (Number(req.params.id)===req.user.id) return res.status(400).json({ error:'Você não pode excluir sua própria conta' });
  db.prepare('UPDATE users SET active=0 WHERE id=?').run(parseInt(req.params.id,10));
  res.json({ ok:true });
});

module.exports = router;