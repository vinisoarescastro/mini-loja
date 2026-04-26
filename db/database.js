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

// ── Schema ───────────────────────────────────────────────────────────────────
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
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    description TEXT,
    price       REAL    NOT NULL,
    image_url   TEXT,
    stock       INTEGER NOT NULL DEFAULT 0,
    active      INTEGER NOT NULL DEFAULT 1,
    category_id INTEGER REFERENCES categories(id),
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS product_variations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    label      TEXT    NOT NULL,
    stock      INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS customers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    phone      TEXT NOT NULL UNIQUE,
    email      TEXT,
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
`);

// ── Migrações para bancos existentes ─────────────────────────────────────────
// Adiciona category_id em products caso o banco já existia sem ela.
try {
  db.exec('ALTER TABLE products ADD COLUMN category_id INTEGER REFERENCES categories(id)');
  console.log('[db] Coluna category_id adicionada à tabela products.');
} catch (_) { /* já existe — ok */ }

module.exports = db;