const express = require('express');
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/products — público
router.get('/', (req, res) => {
  const { category } = req.query;

  let where = 'p.active = 1';
  const params = [];
  if (category) {
    where += ' AND p.category_id = ?';
    params.push(Number(category));
  }

  const products = db.prepare(
    `SELECT p.*, c.name as category_name,
            GROUP_CONCAT(pv.id||':'||pv.label||':'||pv.stock, '|') as variations_raw
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN product_variations pv ON pv.product_id = p.id
     WHERE ${where}
     GROUP BY p.id
     ORDER BY p.id DESC`
  ).all(...params);

  const result = products.map(p => ({
    ...p,
    variations: p.variations_raw
      ? p.variations_raw.split('|').map(v => {
          const [id, label, stock] = v.split(':');
          return { id: Number(id), label, stock: Number(stock) };
        })
      : [],
    variations_raw: undefined,
  }));

  res.json(result);
});

// GET /api/products/:id
router.get('/:id', (req, res) => {
  const product = db.prepare(
    `SELECT p.*, c.name as category_name
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.id = ? AND p.active = 1`
  ).get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Produto não encontrado' });

  product.variations = db.prepare(
    'SELECT * FROM product_variations WHERE product_id = ?'
  ).all(product.id);

  res.json(product);
});

// POST /api/products — admin
router.post('/', requireAuth, (req, res) => {
  const { name, description, price, image_url, stock, category_id, variations } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'Nome e preço são obrigatórios' });

  const r = db.prepare(
    'INSERT INTO products (name, description, price, image_url, stock, category_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(name, description || null, price, image_url || null, stock ?? 0, category_id || null);

  if (Array.isArray(variations) && variations.length > 0) {
    const ins = db.prepare('INSERT INTO product_variations (product_id, label, stock) VALUES (?, ?, ?)');
    variations.forEach(v => ins.run(r.lastInsertRowid, v.label, v.stock ?? 0));
  }

  res.status(201).json({ id: r.lastInsertRowid });
});

// PUT /api/products/:id — admin
router.put('/:id', requireAuth, (req, res) => {
  const { name, description, price, image_url, stock, active, category_id, variations } = req.body;
  const { id } = req.params;

  db.prepare(
    `UPDATE products
     SET name=?, description=?, price=?, image_url=?, stock=?, active=?, category_id=?
     WHERE id=?`
  ).run(name, description || null, price, image_url || null, stock ?? 0,
        active !== false ? 1 : 0, category_id || null, id);

  if (Array.isArray(variations)) {
    const existingVars = db.prepare('SELECT id FROM product_variations WHERE product_id = ?').all(id);
    const incomingIds  = new Set(variations.filter(v => v.id).map(v => Number(v.id)));

    for (const { id: varId } of existingVars) {
      if (!incomingIds.has(varId)) {
        const ref = db.prepare('SELECT COUNT(*) as n FROM order_items WHERE variation_id = ?').get(varId).n;
        if (ref === 0) {
          db.prepare('DELETE FROM product_variations WHERE id = ?').run(varId);
        }
      }
    }

    for (const v of variations) {
      if (v.id) {
        db.prepare('UPDATE product_variations SET label = ?, stock = ? WHERE id = ? AND product_id = ?')
          .run(v.label, v.stock ?? 0, Number(v.id), id);
      } else {
        db.prepare('INSERT INTO product_variations (product_id, label, stock) VALUES (?, ?, ?)')
          .run(id, v.label, v.stock ?? 0);
      }
    }
  }

  res.json({ ok: true });
});

// PATCH /api/products/:id/stock — ajuste rápido de estoque (admin)
router.patch('/:id/stock', requireAuth, (req, res) => {
  const { stock } = req.body;
  if (typeof stock !== 'number' || stock < 0)
    return res.status(400).json({ error: 'Estoque inválido' });

  db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(stock, req.params.id);
  res.json({ ok: true });
});

// DELETE /api/products/:id — admin (soft delete)
router.delete('/:id', requireAuth, (req, res) => {
  db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;