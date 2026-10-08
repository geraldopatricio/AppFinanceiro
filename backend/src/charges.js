import { Router } from 'express';
import { config } from './config.js';
import { db, uid } from './db.js';
import { asaas, HttpError } from './asaas.js';
import { authenticate, requireActive } from './middleware.js';
import { sendMail } from './mailer.js';
import { createAlert } from './alerts.js';
import { renderEmail } from './emailTemplate.js';
import { brl, isEmail, isIsoDate, onlyDigits, round2, text, todayBR } from './utils.js';

const fmtDate = (iso) => iso.split('-').reverse().join('/');

export const chargesRouter = Router();
chargesRouter.use(authenticate, requireActive);

chargesRouter.get('/charges', (req, res) => {
    res.json(db.prepare('SELECT * FROM charges WHERE user_id = ? ORDER BY created_at DESC LIMIT 500').all(req.user.id));
});

chargesRouter.post('/charges', async (req, res) => {
    const b = req.body ?? {};
    const billingType = b.billingType;
    const payerName = text(b.payerName, 120);
    const payerEmail = text(b.payerEmail, 254).toLowerCase();
    const payerDocument = onlyDigits(b.payerDocument);
    const amount = round2(b.amount);
    const dueDate = b.dueDate;
    const description = text(b.description, 200) || 'Cobrança';
    const salesOrderId = b.salesOrderId ? String(b.salesOrderId) : null;

    if (!['PIX', 'BOLETO', 'CREDIT_CARD'].includes(billingType)) throw new HttpError(400, 'Tipo de cobrança inválido.');
    if (payerName.length < 2) throw new HttpError(400, 'Informe o nome do pagador.');
    if (![11, 14].includes(payerDocument.length)) throw new HttpError(400, 'Informe o CPF/CNPJ do pagador.');
    if (payerEmail && !isEmail(payerEmail)) throw new HttpError(400, 'E-mail do pagador inválido.');
    if (!Number.isFinite(amount) || amount < 5 || amount > 1e7) throw new HttpError(400, 'O valor mínimo da cobrança é R$ 5,00.');
    if (!isIsoDate(dueDate) || dueDate < todayBR()) throw new HttpError(400, 'Informe um vencimento válido.');
    if (salesOrderId && !db.prepare('SELECT 1 FROM sales_orders WHERE id = ? AND user_id = ?').get(salesOrderId, req.user.id)) {
        throw new HttpError(400, 'Pedido de venda não encontrado.');
    }

    const platformFee = round2(amount * config.platformFeePercent / 100);
    const asaasFee = round2(config.asaasFee[billingType] + (billingType === 'CREDIT_CARD' ? amount * config.asaasCardPercent / 100 : 0));
    const id = uid();

    const customer = await asaas.createCustomer({ name: payerName, cpfCnpj: payerDocument, email: payerEmail || undefined, externalReference: id });
    const payment = await asaas.createPayment({
        customer: customer.id, billingType, value: amount, dueDate, description, externalReference: `charge:${id}`,
    });
    let qr = {};
    if (billingType === 'PIX') qr = await asaas.pixQrCode(payment.id);

    db.prepare(`INSERT INTO charges (id, user_id, sales_order_id, payer_name, payer_email, payer_document, description, billing_type,
      amount, platform_fee, asaas_fee, net_amount, due_date, asaas_payment_id, invoice_url, bank_slip_url, pix_payload, pix_qr_image)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, req.user.id, salesOrderId, payerName, payerEmail || null, payerDocument, description, billingType,
        amount, platformFee, asaasFee, round2(amount - platformFee - asaasFee), dueDate, payment.id,
        payment.invoiceUrl || null, payment.bankSlipUrl || null, qr.payload || null, qr.encodedImage || null);

    if (payerEmail) {
        const how = billingType === 'PIX' ? `PIX copia e cola:\n${qr.payload}` : billingType === 'BOLETO' ? `Boleto: ${payment.bankSlipUrl || payment.invoiceUrl}` : `Pague com cartão de crédito: ${payment.invoiceUrl}`;
        const payTitle = { PIX: 'Pagar com PIX', BOLETO: 'Pagamento via boleto', CREDIT_CARD: 'Pagar com cartão de crédito' }[billingType];
        const paySection = billingType === 'PIX'
            ? { title: payTitle, text: 'Copie o código abaixo e pague no app do seu banco:', code: qr.payload, button: { label: 'Abrir fatura', url: payment.invoiceUrl } }
            : { title: payTitle, button: { label: billingType === 'BOLETO' ? 'Ver boleto' : 'Pagar agora', url: billingType === 'BOLETO' ? (payment.bankSlipUrl || payment.invoiceUrl) : payment.invoiceUrl } };
        const html = renderEmail({
            title: 'Nova cobrança', subtitle: `Enviada por ${req.user.name}`,
            sections: [{ title: 'Informações da cobrança', rows: [['Pagador', payerName], ['Referente a', description], ['Valor', brl(amount)], ['Vencimento', fmtDate(dueDate)]] }, paySection],
            badge: { label: 'PENDENTE', tone: 'warn' }, note: 'Esta cobrança aguarda o seu pagamento.',
        });
        await sendMail(payerEmail, `Cobrança de ${req.user.name} - ${brl(amount)}`,
            `Olá, ${payerName}.\n\n${req.user.name} enviou uma cobrança de ${brl(amount)} com vencimento em ${fmtDate(dueDate)}.\nReferente a: ${description}\n\n${how}\n\nFatura: ${payment.invoiceUrl}`, html);
    }
    createAlert(req.user.id, 'charge_sent', 'Cobrança enviada', `${billingType === 'PIX' ? 'PIX' : billingType === 'BOLETO' ? 'Boleto' : 'Cartão'} de ${brl(amount)} gerado para ${payerName}.`);

    res.status(201).json(db.prepare('SELECT * FROM charges WHERE id = ?').get(id));
});

chargesRouter.post('/charges/:id/cancel', async (req, res) => {
    const charge = db.prepare('SELECT * FROM charges WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!charge) throw new HttpError(404, 'Cobrança não encontrada.');
    if (charge.status === 'paid' || charge.status === 'cancelled') throw new HttpError(400, 'Esta cobrança não pode ser cancelada.');
    await asaas.cancelPayment(charge.asaas_payment_id);
    db.prepare("UPDATE charges SET status = 'cancelled' WHERE id = ?").run(charge.id);
    res.json({ ok: true });
});

chargesRouter.post('/orders/:id/remind', async (req, res) => {
    const order = db.prepare('SELECT * FROM sales_orders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!order) throw new HttpError(404, 'Pedido não encontrado.');
    const customer = db.prepare('SELECT email FROM customers WHERE user_id = ? AND lower(name) = lower(?) AND email IS NOT NULL').get(req.user.id, order.customer_name);
    if (!customer?.email) throw new HttpError(400, 'Cliente sem e-mail cadastrado. Cadastre o e-mail em Pessoas.');
    const due = order.due_date ? fmtDate(order.due_date) : 'a combinar';
    const overdue = order.due_date && order.due_date < todayBR();
    const html = renderEmail({
        title: 'Lembrete de pagamento', subtitle: `Enviado por ${req.user.name}`,
        sections: [{ title: 'Informações do pedido', rows: [['Cliente', order.customer_name], ['Pedido', order.description], ['Valor', brl(order.amount)], ['Vencimento', due]] }],
        badge: overdue ? { label: 'VENCIDO', tone: 'danger' } : { label: 'PENDENTE', tone: 'warn' },
        note: 'Em caso de dúvidas, entre em contato com quem enviou este lembrete.',
    });
    const sent = await sendMail(customer.email, `Cobrança de ${req.user.name} - ${brl(order.amount)}`,
        `Olá, ${order.customer_name}.\n\n${req.user.name} lembra do pagamento pendente:\n- Pedido: ${order.description}\n- Valor: ${brl(order.amount)}\n- Vencimento: ${due}`, html);
    if (!sent) throw new HttpError(502, 'Falha ao enviar o e-mail. Verifique as configurações de SMTP no backend.');
    res.json({ ok: true });
});

export const alertsRouter = Router();
alertsRouter.use(authenticate);

alertsRouter.get('/alerts', (req, res) => {
    res.json(db.prepare('SELECT id, kind, title, message, is_read, created_at FROM alerts WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').all(req.user.id));
});

alertsRouter.post('/alerts/read-all', (req, res) => {
    db.prepare('UPDATE alerts SET is_read = 1 WHERE user_id = ?').run(req.user.id);
    res.json({ ok: true });
});
