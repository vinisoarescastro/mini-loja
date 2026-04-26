const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const multer   = require('multer');
const db       = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ── Multer ────────────────────────────────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads', 'products');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename:    (_req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    if (/^image\//.test(file.mimetype)) return cb(null, true);
    cb(new Error('Apenas imagens são permitidas'));
  },
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseJSON(str, fallback) {
  try { return str ? JSON.parse(str) : fallback; } catch { return fallback; }
}

function deleteFile(url) {
  try {
    if (!url || !url.startsWith('/uploads/')) return;
    const p = path.join(__dirname, '..', 'public', url);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (_) {}
}

function getImages(productId) {
  return db.prepare(
    'SELECT id, url FROM product_images WHERE product_id = ? ORDER BY sort_order'
  ).all(productId);
}

// ── GET /api/products — público ───────────────────────────────────────────────
router.get('/', (req, res) => {
  const { category } = req.query;
  let where = 'p.active = 1';
  const params = [];
  if (category) { where += ' AND p.category_id = ?'; params.push(Number(category)); }

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

  res.json(products.map(p => {
    const imgs = getImages(p.id).map(i => i.url);
    return {
      ...p,
      image_url:      imgs[0] || p.image_url || null,
      images:         imgs,
      variations:     p.variations_raw
        ? p.variations_raw.split('|').map(v => {
            const [id, label, stock] = v.split(':');
            return { id: Number(id), label, stock: Number(stock) };
          })
        : [],
      variations_raw: undefined,
    };
  }));
});

// ── GET /api/products/:id ─────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const product = db.prepare(
    `SELECT p.*, c.name as category_name
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.id = ? AND p.active = 1`
  ).get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Produto não encontrado' });

  const imgs = getImages(product.id).map(i => i.url);
  product.image_url  = imgs[0] || product.image_url || null;
  product.images     = imgs;
  product.variations = db.prepare(
    'SELECT * FROM product_variations WHERE product_id = ?'
  ).all(product.id);

  res.json(product);
});

// ── POST /api/products — admin ────────────────────────────────────────────────
router.post('/', requireAuth, upload.array('images', 5), (req, res) => {
  const { name, description, price, stock, category_id } = req.body;
  const variations = parseJSON(req.body.variations, []);

  if (!name?.trim() || !price)
    return res.status(400).json({ error: 'Nome e preço são obrigatórios' });
  if (!req.files?.length)
    return res.status(400).json({ error: 'Pelo menos 1 imagem é obrigatória' });

  const r = db.prepare(
    'INSERT INTO products (name, description, price, image_url, stock, category_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    name.trim(),
    description?.trim() || null,
    parseFloat(price),
    null,
    parseInt(stock, 10) || 0,
    category_id ? Number(category_id) : null
  );

  const pid = r.lastInsertRowid;
  const insImg = db.prepare(
    'INSERT INTO product_images (product_id, url, sort_order) VALUES (?, ?, ?)'
  );

  const urls = req.files.map((f, i) => {
    const url = `/uploads/products/${f.filename}`;
    insImg.run(pid, url, i);
    return url;
  });

  // Mantém image_url sincronizado para compatibilidade
  db.prepare('UPDATE products SET image_url = ? WHERE id = ?').run(urls[0], pid);

  if (variations.length) {
    const insVar = db.prepare(
      'INSERT INTO product_variations (product_id, label, stock) VALUES (?, ?, ?)'
    );
    variations.forEach(v => insVar.run(pid, v.label, v.stock ?? 0));
  }

  res.status(201).json({ id: pid });
});

// ── PUT /api/products/:id — admin ─────────────────────────────────────────────
router.put('/:id', requireAuth, upload.array('images', 5), (req, res) => {
  const { id } = req.params;
  const { name, description, price, stock, active, category_id } = req.body;
  const variations = parseJSON(req.body.variations, []);
  // URLs das imagens existentes que o usuário quer manter
  const keepUrls   = parseJSON(req.body.keepImages, []);

  if (!name?.trim() || !price)
    return res.status(400).json({ error: 'Nome e preço são obrigatórios' });

  // Imagens atualmente no banco
  const existing = getImages(id);

  // Remove do disco + banco as que o usuário descartou
  for (const img of existing) {
    if (!keepUrls.includes(img.url)) {
      deleteFile(img.url);
      db.prepare('DELETE FROM product_images WHERE id = ?').run(img.id);
    }
  }

  // Novas imagens enviadas
  const newUrls = (req.files || []).map(f => `/uploads/products/${f.filename}`);

  // Valida mínimo de 1 imagem
  if (keepUrls.length + newUrls.length === 0) {
    (req.files || []).forEach(f => { try { fs.unlinkSync(f.path); } catch (_) {} });
    return res.status(400).json({ error: 'Pelo menos 1 imagem é obrigatória' });
  }

  // Reordena mantidas (0..n)
  keepUrls.forEach((url, i) => {
    db.prepare('UPDATE product_images SET sort_order = ? WHERE product_id = ? AND url = ?')
      .run(i, id, url);
  });

  // Insere novas após as mantidas
  const insImg = db.prepare(
    'INSERT INTO product_images (product_id, url, sort_order) VALUES (?, ?, ?)'
  );
  newUrls.forEach((url, i) => insImg.run(id, url, keepUrls.length + i));

  const firstImg = keepUrls[0] || newUrls[0] || null;

  db.prepare(
    `UPDATE products
     SET name=?, description=?, price=?, image_url=?, stock=?, active=?, category_id=?
     WHERE id=?`
  ).run(
    name.trim(),
    description?.trim() || null,
    parseFloat(price),
    firstImg,
    parseInt(stock, 10) || 0,
    active === 'false' || active === false ? 0 : 1,
    category_id ? Number(category_id) : null,
    id
  );

  // Variações
  if (Array.isArray(variations)) {
    const existingVars = db.prepare('SELECT id FROM product_variations WHERE product_id = ?').all(id);
    const incomingIds  = new Set(variations.filter(v => v.id).map(v => Number(v.id)));

    for (const { id: varId } of existingVars) {
      if (!incomingIds.has(varId)) {
        const refs = db.prepare('SELECT COUNT(*) as n FROM order_items WHERE variation_id = ?').get(varId).n;
        if (refs === 0) db.prepare('DELETE FROM product_variations WHERE id = ?').run(varId);
      }
    }
    for (const v of variations) {
      if (v.id) {
        db.prepare('UPDATE product_variations SET label=?, stock=? WHERE id=? AND product_id=?')
          .run(v.label, v.stock ?? 0, Number(v.id), id);
      } else {
        db.prepare('INSERT INTO product_variations (product_id, label, stock) VALUES (?, ?, ?)')
          .run(id, v.label, v.stock ?? 0);
      }
    }
  }

  res.json({ ok: true });
});

// ── PATCH /api/products/:id/stock ─────────────────────────────────────────────
router.patch('/:id/stock', requireAuth, (req, res) => {
  const { stock } = req.body;
  if (typeof stock !== 'number' || stock < 0)
    return res.status(400).json({ error: 'Estoque inválido' });
  db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(stock, req.params.id);
  res.json({ ok: true });
});

// ── DELETE /api/products/:id — soft delete ────────────────────────────────────
router.delete('/:id', requireAuth, (req, res) => {
  db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;