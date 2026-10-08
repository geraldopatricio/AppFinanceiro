import { Router } from 'express';
import { db, uid } from './db.js';
import { HttpError } from './asaas.js';
import { authenticate, requireActive } from './middleware.js';
import { isIsoDate, text, todayBR } from './utils.js';
import { markSalePaid } from './orders.js';

// Colunas gravaveis por tabela: [tipo, obrigatório]
const person = { name: ['text', true], document: ['text'], phone: ['text'], email: ['text'], notes: ['text'] };
const tables = {
    customers: { cols: person, order: 'created_at DESC' },
    suppliers: { cols: person, order: 'created_at DESC' },
    sales_orders: {
        cols: { customer_id: ['id'], customer_name: ['text', true], description: ['text', true], amount: ['money', true], due_date: ['date'] },
        order: 'created_at DESC',
    },
    purchase_orders: {
        cols: { supplier_id: ['id'], supplier_name: ['text', true], description: ['text', true], amount: ['money', true], due_date: ['date'] },
        order: 'created_at DESC',
    },
    financial_transactions: {
        cols: {
            type: ['enum', true, ['income', 'expense']], description: ['text', true], amount: ['money', true, true], category: ['text'],
            transaction_date: ['date'], sales_order_id: ['id'], purchase_order_id: ['id'],
        },
        order: 'transaction_date DESC, created_at DESC',
    },
};

function parse(col, [type, required, extra], value) {
    const empty = value === undefined || value === null || value === '';
    if (empty) {
        if (required) throw new HttpError(400, `Campo obrigatório: ${col}`);
        return null;
    }
    switch (type) {
        case 'text': return text(String(value), 500);
        case 'id': return text(String(value), 64);
        case 'money': {
            const n = Number(value);
            if (!Number.isFinite(n) || n < 0 || n > 1e12 || (extra === true && n === 0)) throw new HttpError(400, `Valor inválido: ${col}`);
            return Math.round(n * 100) / 100;
        }
        case 'date':
            if (!isIsoDate(value)) throw new HttpError(400, `Data inválida: ${col}`);
            return value;
        case 'enum':
            if (!extra.includes(value)) throw new HttpError(400, `Valor inválido: ${col}`);
            return value;
    }
}

const REFS = { customer_id: 'customers', supplier_id: 'suppliers', sales_order_id: 'sales_orders', purchase_order_id: 'purchase_orders' };

export const dataRouter = Router();
dataRouter.use(authenticate, requireActive);

const resolve = (req) => {
    const spec = Object.hasOwn(tables, req.params.table) ? tables[req.params.table] : null;
    if (!spec) throw new HttpError(404, 'Recurso não encontrado.');
    return spec;
};

dataRouter.get('/data/:table', (req, res) => {
    const spec = resolve(req);
    res.json(db.prepare(`SELECT * FROM ${req.params.table} WHERE user_id = ? ORDER BY ${spec.order} LIMIT 1000`).all(req.user.id));
});

dataRouter.post('/data/:table', (req, res) => {
    const spec = resolve(req);
    const values = { id: uid(), user_id: req.user.id };
    for (const [col, def] of Object.entries(spec.cols)) {
        const v = parse(col, def, req.body?.[col]);
        if (v !== null) values[col] = v;
    }
    const keys = Object.keys(values);
    for (const [col, table] of Object.entries(REFS)) {
        if (values[col] && !db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND user_id = ?`).get(values[col], req.user.id)) throw new HttpError(400, `Referência inválida: ${col}`);
    }
    db.prepare(`INSERT INTO ${req.params.table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...Object.values(values));
    res.status(201).json(db.prepare(`SELECT * FROM ${req.params.table} WHERE id = ?`).get(values.id));
});

dataRouter.post('/orders/sales/:id/pay', (req, res) => {
    const paidDate = req.body?.paidDate ?? todayBR();
    if (!isIsoDate(paidDate)) throw new HttpError(400, 'Data de pagamento inválida.');
    res.json(markSalePaid(req.user.id, req.params.id, paidDate));
});

dataRouter.delete('/data/:table/:id', (req, res) => {
    resolve(req);
    db.prepare(`DELETE FROM ${req.params.table} WHERE id = ? AND user_id = ?`).run(req.params.id, req.user.id);
    res.json({ ok: true });
});
