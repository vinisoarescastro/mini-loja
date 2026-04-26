# MiniLoja — E-commerce Simples

![MiniLoja](public/img/logo/logoipsum-3.png)

Loja virtual completa com Node.js + Express + SQLite. **Sem Docker. Sem TypeScript. Sem frameworks de frontend.**

## Stack

| Camada    | Tecnologia            |
|-----------|-----------------------|
| Backend   | Node.js + Express     |
| Banco     | SQLite (node:sqlite nativo) — Node.js 22+, sem dependências externas |
| Auth      | JWT em cookie httpOnly |
| Pagamento | Mercado Pago SDK v2   |
| Frontend  | HTML + CSS + JS puro  |

---

## Instalação

```bash
# 1. Instale as dependências
cd mini-loja
npm install

# 2. Configure o ambiente
cp .env.example .env
# Edite o .env com suas informações

# 3. Popule o banco com admin e produtos iniciais
npm run seed

# 4. Inicie o servidor
npm start
# ou, com reload automático:
npm run dev
```

Acesse:
- **Loja:** http://localhost:3000
- **Admin:** http://localhost:3000/admin/login.html
  - Login: `admin@miniloja.com` | Senha: `admin123`

---

## Variáveis de Ambiente (`.env`)

```env
PORT=3000
JWT_SECRET=uma_chave_longa_e_aleatoria

# Mercado Pago (https://www.mercadopago.com.br/developers)
MP_ACCESS_TOKEN=APP_USR-xxx
MP_PUBLIC_KEY=APP_USR-xxx
MP_WEBHOOK_SECRET=sua_chave_secreta

# URL pública da aplicação (use ngrok em dev)
APP_URL=http://localhost:3000
```

---

## Testando Pagamento com ngrok

```bash
# Em um terminal:
npm run dev

# Em outro terminal:
npx ngrok http 3000

# Copie a URL gerada (ex: https://abc123.ngrok.io)
# Coloque no .env: APP_URL=https://abc123.ngrok.io
# Configure o webhook no painel do Mercado Pago:
#   https://abc123.ngrok.io/api/payments/webhook
```

---

## Estrutura de Arquivos

```
mini-loja/
├── server.js              ← Ponto de entrada
├── db/
│   ├── database.js        ← SQLite + schema automático
│   └── seed.js            ← Dados iniciais
├── routes/
│   ├── auth.js            ← Login / logout / me
│   ├── products.js        ← CRUD de produtos
│   ├── checkout.js        ← Criação de pedidos + MP
│   ├── trackAndWebhook.js ← Rastreamento + webhook MP
│   └── admin/
│       └── index.js       ← Dashboard, pedidos, clientes, usuários
├── middleware/
│   └── auth.js            ← JWT verificação
├── lib/
│   ├── mercadopago.js     ← Integração MP
│   └── utils.js           ← Helpers
└── public/
    ├── index.html         ← Loja
    ├── checkout.html
    ├── success.html
    ├── track.html
    ├── css/style.css
    ├── img/
    │   └── logo/
    │       └── logoipsum-3.png  ← Logo da aplicação
    ├── js/cart.js
    └── admin/
        ├── login.html
        ├── index.html     ← Dashboard
        ├── orders.html
        ├── products.html
        ├── customers.html
        ├── users.html
        ├── admin.css
        └── js/
            ├── admin.js   ← Shared helpers
            └── sidebar.js
```

---

## Deploy

### Opção 1 — VPS / Servidor próprio
```bash
# Instale Node.js 18+
npm install --production
npm start

# Use PM2 para manter rodando:
npm install -g pm2
pm2 start server.js --name mini-loja
pm2 save
```

### Opção 2 — Railway / Render / Fly.io
- Adicione as variáveis de ambiente no painel
- O arquivo `data.db` do SQLite persiste no disco — configure um volume se necessário