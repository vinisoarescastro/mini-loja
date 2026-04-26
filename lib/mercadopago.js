const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const crypto = require('crypto');

function getClient() {
  return new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
}

async function createPaymentPreference({ order, items, customer, appUrl }) {
  const client = getClient();
  const preference = new Preference(client);

  const result = await preference.create({
    body: {
      external_reference: order.code,
      items: items.map(i => ({
        id: String(i.product_id),
        title: i.variation_label ? `${i.product_name} (${i.variation_label})` : i.product_name,
        quantity: i.quantity,
        unit_price: i.unit_price,
        currency_id: 'BRL',
      })),
      payer: {
        name: customer.name,
        phone: { number: customer.phone },
        email: customer.email || undefined,
      },
      back_urls: {
        success: `${appUrl}/payment-result.html`,
        failure: `${appUrl}/payment-result.html`,
        pending: `${appUrl}/payment-result.html`,
      },
      auto_return: 'approved',
      notification_url: `${appUrl}/api/payments/webhook`,
    },
  });

  return { preferenceId: result.id, paymentUrl: result.init_point };
}

function verifyWebhookSignature(req) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return true; // desativado em dev

  const xSignature = req.headers['x-signature'];
  const xRequestId = req.headers['x-request-id'];
  const dataId = req.query['data.id'] || req.body?.data?.id;

  if (!xSignature) return false;

  const parts = xSignature.split(',');
  let ts, v1;
  for (const p of parts) {
    const [k, v] = p.split('=');
    if (k.trim() === 'ts') ts = v.trim();
    if (k.trim() === 'v1') v1 = v.trim();
  }
  if (!ts || !v1) return false;

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const hash = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  return hash === v1;
}

async function getPayment(paymentId) {
  const client = getClient();
  const payment = new Payment(client);
  return payment.get({ id: paymentId });
}

module.exports = { createPaymentPreference, verifyWebhookSignature, getPayment };
