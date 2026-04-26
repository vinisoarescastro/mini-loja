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
  const { name, description, price, image_url, stock, variations } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'Nome e preço são obrigatórios' });

  const r = db.prepare(
    'INSERT INTO products (name, description, price, image_url, stock) VALUES (?, ?, ?, ?, ?)'
  ).run(name, description || null, price, image_url || null, stock ?? 0);

  if (Array.isArray(variations) && variations.length > 0) {
    const ins = db.prepare('INSERT INTO product_variations (product_id, label, stock) VALUES (?, ?, ?)');
    variations.forEach(v => ins.run(r.lastInsertRowid, v.label, v.stock ?? 0));
  }

  res.status(201).json({ id: r.lastInsertRowid });
});

// PUT /api/products/:id — admin
router.put('/:id', requireAuth, (req, res) => {
  const { name, description, price, image_url, stock, active, variations } = req.body;
  const { id } = req.params;

  db.prepare(
    `UPDATE products SET name=?, description=?, price=?, image_url=?, stock=?, active=? WHERE id=?`
  ).run(name, description || null, price, image_url || null, stock ?? 0, active !== false ? 1 : 0, id);

  if (Array.isArray(variations)) {
    const existingVars = db.prepare('SELECT id FROM product_variations WHERE product_id = ?').all(id);
    const incomingIds  = new Set(variations.filter(v => v.id).map(v => Number(v.id)));

    // Remove variações excluídas pelo usuário, mas só se não houver pedidos referenciando
    for (const { id: varId } of existingVars) {
      if (!incomingIds.has(varId)) {
        const ref = db.prepare('SELECT COUNT(*) as n FROM order_items WHERE variation_id = ?').get(varId).n;
        if (ref === 0) {
          db.prepare('DELETE FROM product_variations WHERE id = ?').run(varId);
        }
        // Se referenciada por pedidos, mantém no banco (histórico)
      }
    }

    // Atualiza existentes / insere novas
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
// Útil para entrada de mercadoria sem reabrir o formulário completo
router.patch('/:id/stock', requireAuth, (req, res) => {
  const { stock } = req.body;
  if (typeof stock !== 'number' || stock < 0)
    return res.status(400).json({ error: 'Estoque inválido' });

  db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(stock, req.params.id);
  res.json({ ok: true });
});

// DELETE /api/products/:id — admin (soft)
router.delete('/:id', requireAuth, (req, res) => {
  db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;