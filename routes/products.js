const express = require('express');
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/products — público
router.get('/', (req, res) => {
  const products = db.prepare(
    `SELECT p.*, GROUP_CONCAT(pv.id||':'||pv.label||':'||pv.stock, '|') as variations_raw
     FROM products p
     LEFT JOIN product_variations pv ON pv.product_id = p.id
     WHERE p.active = 1
     GROUP BY p.id
     ORDER BY p.id DESC`
  ).all();

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
  const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Produto não encontrado' });

  product.variations = db.prepare(
    'SELECT * FROM product_variations WHERE product_id = ?'
  ).all(product.id);

  res.json(product);
});

// POST /api/products — admin
router.post('/', requireAuth, (req, res) => {
  const { name, description, price, image_url, variations } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'Nome e preço são obrigatórios' });

  const r = db.prepare(
    'INSERT INTO products (name, description, price, image_url) VALUES (?, ?, ?, ?)'
  ).run(name, description || null, price, image_url || null);

  if (Array.isArray(variations)) {
    const ins = db.prepare('INSERT INTO product_variations (product_id, label, stock) VALUES (?, ?, ?)');
    variations.forEach(v => ins.run(r.lastInsertRowid, v.label, v.stock ?? 0));
  }

  res.status(201).json({ id: r.lastInsertRowid });
});

// PUT /api/products/:id — admin
router.put('/:id', requireAuth, (req, res) => {
  const { name, description, price, image_url, active, variations } = req.body;
  const { id } = req.params;

  db.prepare(
    `UPDATE products SET name=?, description=?, price=?, image_url=?, active=? WHERE id=?`
  ).run(name, description || null, price, image_url || null, active !== false ? 1 : 0, id);

  if (Array.isArray(variations)) {
    db.prepare('DELETE FROM product_variations WHERE product_id = ?').run(id);
    const ins = db.prepare('INSERT INTO product_variations (product_id, label, stock) VALUES (?, ?, ?)');
    variations.forEach(v => ins.run(id, v.label, v.stock ?? 0));
  }

  res.json({ ok: true });
});

// DELETE /api/products/:id — admin (soft)
router.delete('/:id', requireAuth, (req, res) => {
  db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
