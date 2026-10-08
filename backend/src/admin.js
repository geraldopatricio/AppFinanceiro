import { Router } from 'express';
import { db } from './db.js';
import { HttpError } from './asaas.js';
import { authenticate } from './middleware.js';
import { notifyUser } from './alerts.js';
import { BANK_COLS } from './bank.js';
import { brl, round2 } from './utils.js';
import { config } from './config.js';
import { syncSubscription } from './billing.js';
import { sendMail } from './mailer.js';
import { createAlert } from './alerts.js';
import { renderEmail } from './emailTemplate.js';

export const adminRouter = Router();
adminRouter.use(authenticate, (req, _res, next) => {
    if (req.user.role !== 'master') throw new HttpError(403, 'Acesso restrito à conta master.');
    next();
});

adminRouter.get('/admin/accounts', (_req, res) => {
    const users = db.prepare(`SELECT id, name, email, document, status, paid_at, created_at, payment_reminder_at, payment_deadline_at, admin_blocked, asaas_subscription_id
      FROM users WHERE role = 'user' ORDER BY created_at DESC`).all();
    const counts = { total: users.length, active: 0, pending: 0, overdue: 0, blocked: 0, cancelled: 0 };
    const now = Date.now();
    const enriched = users.map((user) => {
        const deadlinePassed = user.payment_deadline_at && Date.parse(user.payment_deadline_at) <= now;
        const displayStatus = user.status === 'cancelled' ? 'cancelled'
            : user.admin_blocked || deadlinePassed ? 'blocked'
                : user.status === 'overdue' && user.payment_deadline_at ? 'grace'
                    : user.status;
        if (user.status === 'cancelled') counts.cancelled += 1;
        else if (displayStatus === 'blocked') counts.blocked += 1;
        else if (user.status === 'overdue') counts.overdue += 1;
        else if (user.status === 'pending') counts.pending += 1;
        else if (user.status === 'active') counts.active += 1;
        return { ...user, displayStatus };
    });
    res.json({ counts, users: enriched });
});

adminRouter.post('/admin/accounts/:userId/remind', async (req, res) => {
    let user = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'user'").get(req.params.userId);
    if (!user) throw new HttpError(404, 'Cliente não encontrado.');
    if (!['pending', 'overdue'].includes(user.status) || user.admin_blocked) throw new HttpError(400, 'Lembrete disponível apenas para conta pendente ou em atraso ainda não bloqueada.');
    if (!user.email) throw new HttpError(400, 'Cliente sem e-mail cadastrado.');
    if (user.payment_deadline_at && Date.parse(user.payment_deadline_at) > Date.now()) throw new HttpError(400, 'Já existe um prazo de pagamento ativo para esta conta.');

    const reminderAt = new Date();
    const deadlineAt = new Date(reminderAt.getTime() + 24 * 60 * 60 * 1000);
    const deadline = deadlineAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const html = renderEmail({
        title: 'Pagamento pendente', subtitle: `Olá, ${user.name}`,
        sections: [{ title: 'Regularize sua assinatura', rows: [['Mensalidade', brl(config.subscriptionValue)], ['Prazo para pagamento', deadline]] },
            { text: 'Após este prazo, o acesso à sua conta será bloqueado automaticamente. O acesso será restabelecido após a confirmação do pagamento pelo Asaas.', button: { label: 'Acessar e pagar', url: config.frontendUrl } }],
        badge: { label: 'PAGAMENTO PENDENTE', tone: 'warn' },
    });
    const sent = await sendMail(user.email, 'Aviso: pagamento pendente - bloqueio em 24 horas',
        `Olá, ${user.name}. A mensalidade de ${brl(config.subscriptionValue)} está pendente. Pague em até 24 horas, até ${deadline}, para evitar o bloqueio automático da conta. Acesse: ${config.frontendUrl}`, html);
    if (!sent) throw new HttpError(502, 'Não foi possível enviar o e-mail. Verifique a configuração SMTP.');

    db.prepare('UPDATE users SET payment_reminder_at = ?, payment_deadline_at = ? WHERE id = ?').run(reminderAt.toISOString(), deadlineAt.toISOString(), user.id);
    createAlert(user.id, 'payment_reminder', 'Pagamento pendente', `Sua conta será bloqueada em 24 horas se a mensalidade de ${brl(config.subscriptionValue)} não for paga. Prazo: ${deadline}.`);
    res.json({ ok: true, deadlineAt: deadlineAt.toISOString() });
});

adminRouter.post('/admin/accounts/:userId/block', async (req, res) => {
    let user = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'user'").get(req.params.userId);
    if (!user) throw new HttpError(404, 'Cliente não encontrado.');
    if (user.status === 'cancelled') throw new HttpError(400, 'Conta cancelada.');
    if (user.admin_blocked) throw new HttpError(400, 'A conta já está bloqueada.');
    if (user.status === 'active' && !user.admin_blocked) throw new HttpError(400, 'A conta está ativa e sem atraso registrado.');
    if (user.asaas_subscription_id && config.asaas.token) {
        await syncSubscription(user.id);
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
        if (user.status === 'active' && !user.admin_blocked) throw new HttpError(409, 'O Asaas confirmou o pagamento. A conta foi reativada.');
    }
    db.prepare('UPDATE users SET admin_blocked = 1 WHERE id = ?').run(user.id);
    await notifyUser(user, 'account_blocked', 'Conta bloqueada', 'A conta foi bloqueada pela administração por falta de confirmação do pagamento. O acesso será reativado após a confirmação da mensalidade.');
    res.json({ ok: true });
});

// Cobranças pagas ainda não repassadas, agrupadas por cliente da plataforma.
adminRouter.get('/admin/payouts', (_req, res) => {
    const charges = db.prepare(`
    SELECT c.id, c.user_id, c.payer_name, c.description, c.billing_type, c.amount, c.platform_fee, c.asaas_fee, c.net_amount, c.paid_at
    FROM charges c JOIN users u ON u.id = c.user_id
    WHERE c.status = 'paid' AND c.payout_status = 'pending' AND u.role != 'master'
    ORDER BY c.paid_at`).all();

    const groups = new Map();
    for (const c of charges) {
        if (!groups.has(c.user_id)) {
            const u = db.prepare(`SELECT id, name, email, ${BANK_COLS.join(', ')} FROM users WHERE id = ?`).get(c.user_id);
            groups.set(c.user_id, {
                userId: u.id, name: u.name, email: u.email, bank: Object.fromEntries(BANK_COLS.map((k) => [k, u[k] ?? ''])),
                count: 0, gross: 0, platformFee: 0, asaasFee: 0, net: 0, charges: [],
            });
        }
        const g = groups.get(c.user_id);
        g.count += 1; g.gross += c.amount; g.platformFee += c.platform_fee; g.asaasFee += c.asaas_fee; g.net += c.net_amount;
        g.charges.push(c);
    }
    res.json([...groups.values()].map((g) => ({ ...g, gross: round2(g.gross), platformFee: round2(g.platformFee), asaasFee: round2(g.asaasFee), net: round2(g.net) })));
});

adminRouter.post('/admin/payouts/:userId/settle', async (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.userId);
    if (!user) throw new HttpError(404, 'Cliente não encontrado.');
    const rows = db.prepare("SELECT id, net_amount FROM charges WHERE user_id = ? AND status = 'paid' AND payout_status = 'pending'").all(user.id);
    if (!rows.length) throw new HttpError(400, 'Não há repasses pendentes para este cliente.');

    const mark = db.prepare("UPDATE charges SET payout_status = 'paid', payout_at = datetime('now') WHERE id = ?");
    db.transaction(() => rows.forEach((r) => mark.run(r.id)))();
    const net = round2(rows.reduce((s, r) => s + r.net_amount, 0));

    await notifyUser(user, 'payout', 'Repasse realizado', `Realizamos o repasse das suas cobranças recebidas.\n- Valor repassado: ${brl(net)}\n- Cobranças: ${rows.length}`);
    res.json({ ok: true, count: rows.length, net });
});
