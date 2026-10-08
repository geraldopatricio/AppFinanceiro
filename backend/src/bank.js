import { Router } from 'express';
import { db } from './db.js';
import { HttpError } from './asaas.js';
import { authenticate } from './middleware.js';
import { onlyDigits, text } from './utils.js';

export const BANK_COLS = ['bank_code', 'bank_name', 'bank_agency', 'bank_account', 'bank_account_type', 'bank_holder', 'bank_holder_document', 'pix_key_type', 'pix_key'];

export function parseBank(body = {}) {
    const b = body ?? {};
    const out = {
        bank_code: text(b.bank_code, 10) || null,
        bank_name: text(b.bank_name, 80) || null,
        bank_agency: text(b.bank_agency, 20) || null,
        bank_account: text(b.bank_account, 30) || null,
        bank_account_type: text(b.bank_account_type, 20) || null,
        bank_holder: text(b.bank_holder, 120) || null,
        bank_holder_document: onlyDigits(b.bank_holder_document) || null,
        pix_key_type: text(b.pix_key_type, 20) || null,
        pix_key: text(b.pix_key, 140) || null,
    };
    if (out.bank_account_type && !['corrente', 'poupanca'].includes(out.bank_account_type)) throw new HttpError(400, 'Tipo de conta inválido.');
    if (out.pix_key_type && !['cpf', 'cnpj', 'email', 'phone', 'random'].includes(out.pix_key_type)) throw new HttpError(400, 'Tipo de chave PIX inválido.');
    if (out.pix_key && !out.pix_key_type) throw new HttpError(400, 'Informe o tipo da chave PIX.');
    if (out.bank_holder_document && ![11, 14].includes(out.bank_holder_document.length)) throw new HttpError(400, 'CPF/CNPJ do titular inválido.');
    return out;
}

export function saveBank(userId, bank) {
    db.prepare(`UPDATE users SET ${BANK_COLS.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...BANK_COLS.map((c) => bank[c]), userId);
}

export const bankRouter = Router();
bankRouter.use(authenticate);

bankRouter.get('/account/bank', (req, res) => {
    res.json(Object.fromEntries(BANK_COLS.map((c) => [c, req.user[c] ?? ''])));
});

bankRouter.put('/account/bank', (req, res) => {
    const bank = parseBank(req.body);
    saveBank(req.user.id, bank);
    res.json(bank);
});
