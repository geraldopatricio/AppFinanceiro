import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { config } from './config.js';
import { db } from './db.js';
import { asaas, HttpError, PAID_STATUSES } from './asaas.js';
import { authenticate, effectiveStatus } from './middleware.js';
import { notifyUser } from './alerts.js';
import { markSalePaid } from './orders.js';
import { todayBR, brl } from './utils.js';

export async function syncChargeStatus(charge, payment) {
    if (PAID_STATUSES.includes(payment.status)) {
        const paidAt = payment.paymentDate || payment.clientPaymentDate || todayBR();
        const result = db.prepare("UPDATE charges SET status = 'paid', paid_at = ? WHERE id = ? AND status IN ('pending', 'overdue')")
            .run(paidAt, charge.id);
        if (result.changes) {
            if (charge.sales_order_id) markSalePaid(charge.user_id, charge.sales_order_id, paidAt.slice(0, 10));
            const owner = getUser(charge.user_id);
            await notifyUser(owner, 'charge_paid', 'Cobrança recebida', `${charge.payer_name} pagou ${brl(charge.amount)} (${charge.billing_type}). Valor líquido após taxas: ${brl(charge.net_amount)}.`);
        }
        return;
    }

    if (payment.status === 'OVERDUE') {
        const result = db.prepare("UPDATE charges SET status = 'overdue' WHERE id = ? AND status = 'pending'").run(charge.id);
        if (result.changes) {
            const owner = getUser(charge.user_id);
            await notifyUser(owner, 'charge_overdue', 'Cobrança vencida', `A cobrança de ${charge.payer_name} (${brl(charge.amount)}) venceu sem pagamento.`);
        }
    } else if (['DELETED', 'REFUNDED'].includes(payment.status)) {
        db.prepare("UPDATE charges SET status = 'cancelled' WHERE id = ? AND status IN ('pending', 'overdue')").run(charge.id);
    }
}

export async function syncPendingCharges() {
    if (!config.asaas.token) return;
    const pending = db.prepare("SELECT * FROM charges WHERE status IN ('pending', 'overdue') AND asaas_payment_id IS NOT NULL ORDER BY created_at LIMIT 100").all();
    for (const charge of pending) {
        try {
            const payment = await asaas.getPayment(charge.asaas_payment_id);
            await syncChargeStatus(charge, payment);
        } catch (error) {
            console.error(`[asaas:sync] cobrança ${charge.id}:`, error.message);
        }
    }
}

const getUser = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);

export async function ensureSubscription(user) {
    const current = getUser(user.id);
    if (current.asaas_subscription_id) return current;
    let customerId = current.asaas_customer_id;
    if (!customerId) {
        const customer = await asaas.createCustomer({ name: current.name, email: current.email, cpfCnpj: current.document, externalReference: current.id });
        customerId = customer.id;
        db.prepare('UPDATE users SET asaas_customer_id = ? WHERE id = ?').run(customerId, current.id);
    }
    const sub = await asaas.createSubscription({
        customer: customerId, billingType: 'PIX', value: config.subscriptionValue, nextDueDate: todayBR(),
        cycle: 'MONTHLY', description: 'Assinatura mensal - App Financeiro', externalReference: current.id,
    });
    db.prepare('UPDATE users SET asaas_subscription_id = ? WHERE id = ?').run(sub.id, current.id);
    return getUser(current.id);
}

export async function activateUser(userId) {
    const user = getUser(userId);
    if (!user || user.status === 'cancelled') return;
    const notify = user.status !== 'active' || user.admin_blocked;
    db.prepare("UPDATE users SET status = 'active', admin_blocked = 0, payment_reminder_at = NULL, payment_deadline_at = NULL, paid_at = datetime('now') WHERE id = ?").run(userId);
    if (notify) await notifyUser(user, 'payment_confirmed', 'Pagamento confirmado', `Recebemos o pagamento de ${brl(config.subscriptionValue)}. Sua conta está ativa.`);
}

async function markOverdue(userId) {
    const user = getUser(userId);
    if (!user || user.role === 'master' || user.status !== 'active') return;
    db.prepare("UPDATE users SET status = 'overdue' WHERE id = ?").run(userId);
    await notifyUser(user, 'payment_overdue', 'Mensalidade em atraso', 'Sua mensalidade está em atraso e o acesso foi bloqueado. Pague o PIX para reativar a conta.');
}

// Consulta o Asaas e reconcilia o status local; devolve a cobrança que ainda precisa ser paga.
export async function syncSubscription(userId) {
    const user = getUser(userId);
    if (!user?.asaas_subscription_id) return { payment: null, user };
    const { data = [] } = await asaas.subscriptionPayments(user.asaas_subscription_id);
    const latest = [...data].sort((a, b) => String(b.dueDate || b.paymentDate || '').localeCompare(String(a.dueDate || a.paymentDate || '')))[0];
    if (latest?.status === 'OVERDUE') await markOverdue(userId);
    else if (latest && PAID_STATUSES.includes(latest.status)) await activateUser(userId);
    return { payment: latest && ['PENDING', 'OVERDUE'].includes(latest.status) ? latest : null, user: getUser(userId) };
}

export async function syncPendingSubscriptions() {
    if (!config.asaas.token) return;
    const users = db.prepare("SELECT id FROM users WHERE role = 'user' AND status IN ('pending', 'overdue') AND asaas_subscription_id IS NOT NULL LIMIT 100").all();
    for (const user of users) {
        try { await syncSubscription(user.id); }
        catch (error) { console.error(`[asaas:subscription-sync] conta ${user.id}:`, error.message); }
    }
}

export async function enforcePaymentDeadlines() {
    const expired = db.prepare("SELECT * FROM users WHERE role = 'user' AND status IN ('pending', 'overdue') AND admin_blocked = 0 AND payment_deadline_at IS NOT NULL AND julianday(payment_deadline_at) <= julianday('now')").all();
    for (const user of expired) {
        const result = db.prepare("UPDATE users SET admin_blocked = 1 WHERE id = ? AND admin_blocked = 0 AND status IN ('pending', 'overdue') AND julianday(payment_deadline_at) <= julianday('now')").run(user.id);
        if (result.changes) {
            await notifyUser(user, 'account_blocked', 'Conta bloqueada', 'O prazo de 24 horas para pagamento expirou. O acesso foi bloqueado até a confirmação da mensalidade.');
            console.log(`[billing] conta ${user.id} bloqueada por prazo de pagamento expirado`);
        }
    }
}

export async function getSubscriptionPix(userId) {
    let user = getUser(userId);
    if (user.role === 'master') return { status: 'active' };
    user = await ensureSubscription(user);
    const { payment, user: fresh } = await syncSubscription(userId);
    if (effectiveStatus(fresh) === 'active' || !payment) return { status: effectiveStatus(fresh) };
    const qr = await asaas.pixQrCode(payment.id);
    return {
        status: effectiveStatus(fresh), value: payment.value, dueDate: payment.dueDate,
        payload: qr.payload, qrImage: qr.encodedImage, expirationDate: qr.expirationDate,
    };
}

export async function cancelAccount(userId) {
    const user = getUser(userId);
    if (user.asaas_subscription_id) await asaas.cancelSubscription(user.asaas_subscription_id);
    db.prepare("UPDATE users SET status = 'cancelled', cancelled_at = datetime('now') WHERE id = ?").run(userId);
    await notifyUser(user, 'account_cancelled', 'Conta cancelada', 'Sua conta foi cancelada, a cobrança recorrente foi encerrada e o acesso foi bloqueado.');
}

export const billingRouter = Router();
billingRouter.use(authenticate);

billingRouter.get('/billing/pix', async (req, res) => {
    res.json(await getSubscriptionPix(req.user.id));
});

billingRouter.get('/billing/status', async (req, res) => {
    if (req.user.role !== 'master' && req.user.asaas_subscription_id && req.user.status !== 'active') await syncSubscription(req.user.id);
    const status = effectiveStatus(getUser(req.user.id));
    res.json({ status });
});

billingRouter.post('/account/cancel', async (req, res) => {
    if (req.user.role === 'master') throw new HttpError(403, 'A conta master não pode ser cancelada.');
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!bcrypt.compareSync(password, req.user.password_hash)) throw new HttpError(401, 'Senha incorreta.');
    await cancelAccount(req.user.id);
    res.json({ ok: true });
});

const safeEqual = (a, b) => {
    const ba = Buffer.from(a), bb = Buffer.from(b);
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};

export const webhookRouter = Router();

webhookRouter.post('/webhooks/asaas', async (req, res) => {
    const expected = config.asaas.webhookToken;
    const received = String(req.headers['asaas-access-token'] || '');
    if (!expected || !safeEqual(expected, received)) throw new HttpError(401, 'Webhook não autorizado.');

    const { event, payment } = req.body ?? {};
    if (!event || !payment?.id) return res.json({ ok: true });

    if (payment.subscription) {
        const user = db.prepare('SELECT id FROM users WHERE asaas_subscription_id = ?').get(payment.subscription);
        if (user) {
            if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') await activateUser(user.id);
            if (event === 'PAYMENT_OVERDUE') await markOverdue(user.id);
        }
        return res.json({ ok: true });
    }

    const charge = db.prepare('SELECT * FROM charges WHERE asaas_payment_id = ?').get(payment.id);
    if (charge) await syncChargeStatus(charge, { ...payment, status: event === 'PAYMENT_RECEIVED' ? 'RECEIVED' : event === 'PAYMENT_CONFIRMED' ? 'CONFIRMED' : event === 'PAYMENT_OVERDUE' ? 'OVERDUE' : event === 'PAYMENT_DELETED' ? 'DELETED' : payment.status });
    res.json({ ok: true });
});
