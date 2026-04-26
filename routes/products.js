const express = require('express');
const fs      = require('fs');
const path    = require('path');
const db      = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const MAX_IMAGES = 5;

// ── Helpers ──────────────────────────────────────────────────────────────────
function saveBase64Image(base64Data) {
  if (!base64Data || !base64Data.startsWith('data:')) return null;
  const m = base64Data.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  const ext = m[1].split('/')[1].replace('jpeg','jpg').split('+')[0];
  const buf = Buffer.from(m[2], 'base64');
  const name = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const dir  = path.join(__dirname, '..', 'public', 'uploads', 'products');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), buf);
  return `/uploads/products/${name}`;
}

function parseVariations(raw) {
  if (!raw) return [];
  return raw.split('|').map(v => {
    const [id, label, stock] = v.split(':');
    return { id: Number(id), label, stock: Number(stock) };
  });
}

// Fetch images for a set of product IDs
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

// Rebuild images for a product: delete old + insert new
function saveProductImages(productId, urls) {
  db.prepare('DELETE FROM product_images WHERE product_id = ?').run(productId);
  if (!Array.isArray(urls) || urls.length === 0) return;
  const ins = db.prepare('INSERT INTO product_images (product_id, url, sort_order) VALUES (?,?,?)');
  urls.slice(0, MAX_IMAGES).forEach((url, i) => ins.run(productId, url, i));
}

// ── GET /api/products — público ───────────────────────────────────────────────
router.get('/', (req, res) => {
  const rows = db.prepare(
    `SELECT p.*, GROUP_CONCAT(pv.id||':'||pv.label||':'||pv.stock, '|') as variations_raw
     FROM products p
     LEFT JOIN product_variations pv ON pv.product_id = p.id
     WHERE p.active = 1 GROUP BY p.id ORDER BY p.id DESC`
  ).all();

  const ids = rows.map(p => p.id);
  const imgMap = fetchImagesMap(ids);

  res.json(rows.map(p => {
    const imgs = imgMap[p.id] || (p.image_url ? [p.image_url] : []);
    return {
      ...p,
      made_to_order: !!p.made_to_order,
      images: imgs,
      image_url: imgs[0] || p.image_url || null,
      variations: parseVariations(p.variations_raw),
      variations_raw: undefined,
    };
  }));
});

// ── GET /api/products/:id ─────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Produto não encontrado' });

  const imgs = db.prepare('SELECT url FROM product_images WHERE product_id = ? ORDER BY sort_order').all(product.id).map(r=>r.url);
  product.images    = imgs.length ? imgs : (product.image_url ? [product.image_url] : []);
  product.image_url = product.images[0] || null;
  product.made_to_order = !!product.made_to_order;
  product.variations = db.prepare('SELECT * FROM product_variations WHERE product_id = ?').all(product.id);
  res.json(product);
});

// ── POST /api/products — admin ────────────────────────────────────────────────
router.post('/', requireAuth, (req, res) => {
  const { name, description, price, image_url, image_base64, images_base64,
          stock, made_to_order, notes, variations } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'Nome e preço são obrigatórios' });

  // Resolve image URLs: multi has priority, then single
  let finalImages = [];
  if (Array.isArray(images_base64) && images_base64.length) {
    finalImages = images_base64.slice(0, MAX_IMAGES)
      .map(b => (typeof b === 'string' && b.startsWith('data:')) ? saveBase64Image(b) : (typeof b === 'string' ? b : null))
      .filter(Boolean);
  } else if (image_base64) {
    const u = saveBase64Image(image_base64);
    if (u) finalImages = [u];
  } else if (image_url) {
    finalImages = [image_url];
  }

  const primaryUrl = finalImages[0] || null;

  const r = db.prepare(
    `INSERT INTO products (name, description, price, image_url, stock, made_to_order, notes)
     VALUES (?,?,?,?,?,?,?)`
  ).run(name, description||null, price, primaryUrl, stock??0, made_to_order?1:0, notes||null);

  const pid = r.lastInsertRowid;
  saveProductImages(pid, finalImages);

  if (Array.isArray(variations) && variations.length) {
    const ins = db.prepare('INSERT INTO product_variations (product_id, label, stock) VALUES (?,?,?)');
    variations.forEach(v => ins.run(pid, v.label, v.stock??0));
  }

  res.status(201).json({ id: pid });
});

// ── PUT /api/products/:id — admin ─────────────────────────────────────────────
router.put('/:id', requireAuth, (req, res) => {
  const { name, description, price, image_url, image_base64, images_base64,
          stock, active, made_to_order, notes, variations } = req.body;
  const { id } = req.params;
  const current = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!current) return res.status(404).json({ error: 'Produto não encontrado' });

  // Resolve images
  let finalImages = null; // null = don't change existing images
  if (Array.isArray(images_base64) && images_base64.length) {
    finalImages = images_base64.slice(0, MAX_IMAGES).map(b =>
      (typeof b === 'string' && b.startsWith('data:')) ? saveBase64Image(b) : (typeof b === 'string' ? b : null)
    ).filter(Boolean);
  } else if (image_base64 && image_base64.startsWith('data:')) {
    const u = saveBase64Image(image_base64);
    if (u) finalImages = [u];
  } else if (image_url !== undefined) {
    // Explicit URL sent (could be empty string to clear)
    finalImages = image_url ? [image_url] : [];
  }

  const primaryUrl = finalImages !== null
    ? (finalImages[0] || null)
    : current.image_url;

  db.prepare(
    `UPDATE products SET name=?,description=?,price=?,image_url=?,stock=?,active=?,made_to_order=?,notes=? WHERE id=?`
  ).run(name, description||null, price, primaryUrl, stock??0, active!==false?1:0, made_to_order?1:0, notes||null, id);

  if (finalImages !== null) saveProductImages(id, finalImages);

  if (Array.isArray(variations)) {
    const existingVars = db.prepare('SELECT id FROM product_variations WHERE product_id = ?').all(id);
    const incomingIds  = new Set(variations.filter(v=>v.id).map(v=>Number(v.id)));
    for (const { id: varId } of existingVars) {
      if (!incomingIds.has(varId)) {
        const ref = db.prepare('SELECT COUNT(*) as n FROM order_items WHERE variation_id = ?').get(varId).n;
        if (ref === 0) db.prepare('DELETE FROM product_variations WHERE id = ?').run(varId);
      }
    }
    for (const v of variations) {
      if (v.id) {
        db.prepare('UPDATE product_variations SET label=?,stock=? WHERE id=? AND product_id=?')
          .run(v.label, v.stock??0, Number(v.id), id);
      } else {
        db.prepare('INSERT INTO product_variations (product_id,label,stock) VALUES (?,?,?)')
          .run(id, v.label, v.stock??0);
      }
    }
  }

  res.json({ ok: true });
});

router.patch('/:id/stock', requireAuth, (req, res) => {
  const { stock } = req.body;
  if (typeof stock !== 'number' || stock < 0) return res.status(400).json({ error: 'Estoque inválido' });
  db.prepare('UPDATE products SET stock=? WHERE id=?').run(stock, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', requireAuth, (req, res) => {
  db.prepare('UPDATE products SET active=0 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;