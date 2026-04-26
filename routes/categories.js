const express = require('express');
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/categories — público (usado na loja e no admin)
router.get('/', (req, res) => {
  const categories = db.prepare(
    `SELECT c.*, COUNT(p.id) as product_count
     FROM categories c
     LEFT JOIN products p ON p.category_id = c.id AND p.active = 1
     GROUP BY c.id
     ORDER BY c.name`
  ).all();
  res.json(categories);
});

// POST /api/categories — admin
router.post('/', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nome é obrigatório' });
  try {
    const r = db.prepare('INSERT INTO categories (name) VALUES (?)').run(name.trim());
    res.status(201).json({ id: r.lastInsertRowid, name: name.trim() });
  } catch (e) {
    if (e.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Já existe uma categoria com esse nome' });
    throw e;
  }
});

// PUT /api/categories/:id — admin
router.put('/:id', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nome é obrigatório' });
  try {
    db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name.trim(), req.params.id);
    res.json({ ok: true });
  } catch (e) {
    if (e.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Já existe uma categoria com esse nome' });
    throw e;
  }
});

// DELETE /api/categories/:id — admin
// Desvincula produtos antes de remover a categoria (não apaga os produtos).
router.delete('/:id', requireAuth, (req, res) => {
  db.transaction(() => {
    db.prepare('UPDATE products SET category_id = NULL WHERE category_id = ?').run(req.params.id);
    db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  })();
  res.json({ ok: true });
});

module.exports = router;