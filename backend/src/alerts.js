import { db, uid } from './db.js';
import { sendMail } from './mailer.js';
import { renderEmail } from './emailTemplate.js';
import { todayBR, brl } from './utils.js';
import { enforcePaymentDeadlines, syncPendingCharges, syncPendingSubscriptions } from './billing.js';

const BADGES = {
    due_today: { label: 'VENCE HOJE', tone: 'warn' }, overdue: { label: 'VENCIDO', tone: 'danger' },
    payment_confirmed: { label: 'CONFIRMADO', tone: 'ok' }, charge_paid: { label: 'PAGO', tone: 'ok' },
    payment_overdue: { label: 'EM ATRASO', tone: 'danger' }, charge_overdue: { label: 'VENCIDA', tone: 'danger' },
    account_cancelled: { label: 'CANCELADA', tone: 'danger' }, account_blocked: { label: 'BLOQUEADA', tone: 'danger' },
    payment_reminder: { label: 'PAGAMENTO PENDENTE', tone: 'warn' }, payout: { label: 'REPASSADO', tone: 'ok' }, welcome: { label: 'AGUARDANDO PAGAMENTO', tone: 'warn' },
};

// Linhas "- Rótulo: valor" viram campos do cartão; o restante vira texto.
function messageSections(message) {
    const rows = [], text = [];
    for (const line of message.split('\n')) {
        const m = line.match(/^- ([^:]+): (.*)$/);
        if (m) rows.push([m[1], m[2]]); else if (line.trim()) text.push(line);
    }
    return [{ title: 'Detalhes', text: text.join('\n') || undefined, rows }];
}

export function createAlert(userId, kind, title, message, dedupeKey = null) {
    const result = db.prepare('INSERT OR IGNORE INTO alerts (id, user_id, kind, title, message, dedupe_key) VALUES (?, ?, ?, ?, ?, ?)')
        .run(uid(), userId, kind, title, message, dedupeKey);
    return result.changes > 0;
}

// Cria o alerta na plataforma e envia o mesmo aviso por e-mail.
export async function notifyUser(user, kind, title, message, dedupeKey = null) {
    const created = createAlert(user.id, kind, title, message, dedupeKey);
    if (created) {
        const html = renderEmail({ title, subtitle: `Olá, ${user.name}`, sections: messageSections(message), badge: BADGES[kind] });
        await sendMail(user.email, title, `Olá, ${user.name}.\n\n${message}\n\nApp Financeiro`, html);
    }
    return created;
}

const fmtDate = (iso) => iso.split('-').reverse().join('/');

export async function checkDueDates() {
    const today = todayBR();
    const sources = [
        { table: 'sales_orders', party: 'customer_name', label: 'Recebimento', verb: 'a receber' },
        { table: 'purchase_orders', party: 'supplier_name', label: 'Pagamento', verb: 'a pagar' },
    ];
    for (const s of sources) {
        const rows = db.prepare(`
      SELECT o.id, o.user_id, o.${s.party} AS party, o.description, o.amount, o.due_date
      FROM ${s.table} o JOIN users u ON u.id = o.user_id
      WHERE o.status = 'pending' AND o.due_date IS NOT NULL AND o.due_date <= ? AND u.status = 'active'`).all(today);
        for (const o of rows) {
            const user = db.prepare('SELECT * FROM users WHERE id = ?').get(o.user_id);
            const days = Math.round((Date.parse(`${o.due_date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
            const partyLabel = s.party === 'customer_name' ? 'Cliente' : 'Fornecedor';
            const details = `- Pedido: ${o.description}\n- ${partyLabel}: ${o.party}\n- Valor: ${brl(o.amount)} (${s.verb})\n- Vencimento: ${fmtDate(o.due_date)}`;
            if (days < 0) await notifyUser(user, 'overdue', `${s.label} vencido`, `Pedido vencido:\n${details}`, `overdue:${o.id}`);
            else await notifyUser(user, 'due_today', `${s.label} vence hoje`, `Pedido vencendo hoje:\n${details}`, `due:${o.id}`);
        }
    }
}

export function startAlertJob() {
    const run = () => {
        checkDueDates().catch((e) => console.error('[alerts] falha:', e.message));
        syncPendingCharges().catch((e) => console.error('[asaas:sync] falha:', e.message));
        syncPendingSubscriptions().catch((e) => console.error('[asaas:subscription-sync] falha:', e.message));
        enforcePaymentDeadlines().catch((e) => console.error('[billing:deadline] falha:', e.message));
    };
    setTimeout(run, 5000);
    setInterval(run, 60 * 60 * 1000);
    setInterval(() => enforcePaymentDeadlines().catch((e) => console.error('[billing:deadline] falha:', e.message)), 60 * 1000);
}
