/**
 * Banco SQLite usando o módulo nativo do Node.js 22+.
 * Sem dependências externas, sem compilação — funciona direto no Node 22+.
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data.db');
const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// ── Polyfill: db.transaction() ───────────────────────────────────────────────
db.transaction = (fn) => {
  return (...args) => {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
};

// ── Schema principal ─────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL UNIQUE,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    email      TEXT    NOT NULL UNIQUE,
    password   TEXT    NOT NULL,
    role       TEXT    NOT NULL DEFAULT 'VIEWER',
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS products (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    name              TEXT    NOT NULL,
    description       TEXT,
    price             REAL    NOT NULL,
    image_url         TEXT,
    stock             INTEGER NOT NULL DEFAULT 0,
    active            INTEGER NOT NULL DEFAULT 1,
    made_to_order     INTEGER NOT NULL DEFAULT 0,
    category_id       INTEGER REFERENCES categories(id),
    preorder_deadline TEXT,
    card_footer       TEXT,
    card_footer_bg    TEXT    NOT NULL DEFAULT '#1e293b',
    card_footer_color TEXT    NOT NULL DEFAULT '#ffffff',
    created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS product_variations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    label      TEXT    NOT NULL,
    stock      INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS product_images (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    url        TEXT    NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS customers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    phone      TEXT NOT NULL UNIQUE,
    email      TEXT,
    cpf        TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    code           TEXT    NOT NULL UNIQUE,
    customer_id    INTEGER NOT NULL REFERENCES customers(id),
    total          REAL    NOT NULL,
    order_status   TEXT    NOT NULL DEFAULT 'PENDING',
    payment_status TEXT    NOT NULL DEFAULT 'PENDING',
    created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id        INTEGER NOT NULL REFERENCES orders(id),
    product_id      INTEGER REFERENCES products(id),
    variation_id    INTEGER REFERENCES product_variations(id),
    product_name    TEXT    NOT NULL,
    variation_label TEXT,
    quantity        INTEGER NOT NULL DEFAULT 1,
    unit_price      REAL    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS payments (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id         INTEGER NOT NULL REFERENCES orders(id),
    mp_preference_id TEXT,
    mp_payment_id    TEXT,
    payment_url      TEXT,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS search_attempts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ip         TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

// ── Migrações para bancos já existentes ──────────────────────────────────────
// Cada item é tentado individualmente; erros de "já existe" são silenciados.
const migrations = [
  'ALTER TABLE products  ADD COLUMN category_id        INTEGER REFERENCES categories(id)',
  'ALTER TABLE products  ADD COLUMN made_to_order      INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE products  ADD COLUMN preorder_deadline  TEXT',
  'ALTER TABLE customers ADD COLUMN cpf                TEXT',
  `CREATE TABLE IF NOT EXISTS product_images (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
     url        TEXT    NOT NULL,
     sort_order INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS search_attempts (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     ip         TEXT    NOT NULL,
     created_at TEXT    NOT NULL DEFAULT (datetime('now'))
   )`,
  // ── Rodapé do card ─────────────────────────────────────────────────────────
  "ALTER TABLE products ADD COLUMN card_footer       TEXT",
  "ALTER TABLE products ADD COLUMN card_footer_bg    TEXT NOT NULL DEFAULT '#1e293b'",
  "ALTER TABLE products ADD COLUMN card_footer_color TEXT NOT NULL DEFAULT '#ffffff'",
];

for (const sql of migrations) {
  try { db.exec(sql); } catch (_) { /* coluna/tabela já existe — ok */ }
}

module.exports = db;