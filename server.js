require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',             require('./routes/auth'));
app.use('/api/categories',       require('./routes/categories'));
app.use('/api/products',         require('./routes/products'));
app.use('/api/checkout',         require('./routes/checkout'));
app.use('/api/admin',            require('./routes/admin/index'));

const { trackRouter, webhookRouter } = require('./routes/trackAndWebhook');
app.use('/api/track',            trackRouter);
app.use('/api/payments/webhook', webhookRouter);

// ── SPA fallback: redireciona /admin/* para admin/index.html ─────────────────
app.get('/admin', (req, res) => res.redirect('/admin/index.html'));

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n MiniLoja rodando em http://localhost:${PORT}`);
  console.log(` Admin: http://localhost:${PORT}/admin/login.html`);
  console.log(`\n Login padrão: admin@miniloja.com / admin123`);
  console.log(` (rode "npm run seed" antes se for a primeira vez)\n`);
});