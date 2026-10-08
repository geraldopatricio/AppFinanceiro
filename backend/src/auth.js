import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { db, uid } from './db.js';
import { POLICY_VERSION } from './config.js';
import { HttpError } from './asaas.js';
import { signToken, publicUser, authenticate } from './middleware.js';
import { ensureSubscription } from './billing.js';
import { notifyUser } from './alerts.js';
import { parseBank, saveBank } from './bank.js';
import { isEmail, onlyDigits, text } from './utils.js';

export const authRouter = Router();

authRouter.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 50, standardHeaders: true, legacyHeaders: false }));

authRouter.post('/register', async (req, res) => {
    const body = req.body ?? {};
    const name = text(body.name, 120);
    const email = text(body.email, 254).toLowerCase();
    const document = onlyDigits(body.document);
    const password = typeof body.password === 'string' ? body.password : '';

    if (name.length < 2) throw new HttpError(400, 'Informe o nome.');
    if (!isEmail(email)) throw new HttpError(400, 'E-mail inválido.');
    if (![11, 14].includes(document.length)) throw new HttpError(400, 'Informe um CPF ou CNPJ válido.');
    if (password.length < 8 || password.length > 72) throw new HttpError(400, 'A senha deve ter entre 8 e 72 caracteres.');
    if (body.acceptPolicy !== true) throw new HttpError(400, 'É necessário aceitar a política de uso.');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'Já existe uma conta com este e-mail.');
    const bank = parseBank(body.bank);

    const id = uid();
    db.prepare(`INSERT INTO users (id, name, email, document, password_hash, policy_version, policy_accepted_at)
              VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`).run(id, name, email, document, bcrypt.hashSync(password, 12), POLICY_VERSION);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    saveBank(id, bank);

    await notifyUser(user, 'welcome', 'Cadastro realizado', 'Conclua o pagamento do PIX mensal na tela de pagamento para ativar sua conta.', 'welcome');

    // Se o Asaas falhar aqui, a assinatura é criada ao abrir a tela de pagamento.
    try { await ensureSubscription(user); } catch (e) { console.error('[register] assinatura:', e.message); }

    res.status(201).json({ token: signToken(user), user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
});

authRouter.post('/login', (req, res) => {
    const email = text(req.body?.email, 254).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) throw new HttpError(401, 'E-mail ou senha incorretos.');
    if (user.status === 'cancelled') throw new HttpError(403, 'Conta cancelada. Acesso bloqueado.');
    res.json({ token: signToken(user), user: publicUser(user) });
});

authRouter.get('/me', authenticate, (req, res) => {
    res.json({ user: publicUser(req.user) });
});
