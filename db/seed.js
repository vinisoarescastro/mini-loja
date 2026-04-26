require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./database');

console.log('🌱 Populando banco de dados...');

// Admin padrão
const existing = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@miniloja.com');
if (!existing) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare(`INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)`).run(
    'Administrador', 'admin@miniloja.com', hash, 'ADMIN'
  );
  console.log('✅ Admin criado: admin@miniloja.com / admin123');
}

// Produtos iniciais
const prodCount = db.prepare('SELECT COUNT(*) as n FROM products').get().n;
if (prodCount === 0) {
  const insertProduct = db.prepare(
    `INSERT INTO products (name, description, price, image_url) VALUES (?, ?, ?, ?)`
  );
  const insertVariation = db.prepare(
    `INSERT INTO product_variations (product_id, label, stock) VALUES (?, ?, ?)`
  );

  const p1 = insertProduct.run('Camiseta Básica', 'Algodão 100%, conforto diário.', 59.9,
    'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400');
  ['P', 'M', 'G', 'GG'].forEach(s => insertVariation.run(p1.lastInsertRowid, s, 10));

  const p2 = insertProduct.run('Calça Jogger', 'Moletom leve, cintura elástica.', 129.9,
    'https://images.unsplash.com/photo-1542272604-787c3835535d?w=400');
  ['P', 'M', 'G'].forEach(s => insertVariation.run(p2.lastInsertRowid, s, 5));

  const p3 = insertProduct.run('Boné Snapback', 'Aba reta, ajuste traseiro.', 79.9,
    'https://images.unsplash.com/photo-1588850561407-ed78c282e89b?w=400');
  ['Único'].forEach(s => insertVariation.run(p3.lastInsertRowid, s, 20));

  console.log('✅ 3 produtos criados');
}

console.log('✅ Seed concluído!');
process.exit(0);
