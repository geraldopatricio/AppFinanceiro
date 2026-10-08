import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { db } from './db.js';
import { HttpError } from './asaas.js';

export const signToken = (user) => jwt.sign({ sub: user.id }, config.jwtSecret, { expiresIn: '7d' });

export const publicUser = (u) => ({
    id: u.id, name: u.name, email: u.email, role: u.role, status: effectiveStatus(u),
    paymentDeadlineAt: u.payment_deadline_at, policyAcceptedAt: u.policy_accepted_at, createdAt: u.created_at,
});

export function effectiveStatus(user) {
    if (user.status === 'cancelled') return 'cancelled';
    if (user.admin_blocked) return 'blocked';
    if (user.status === 'overdue' && user.payment_deadline_at && Date.parse(user.payment_deadline_at) > Date.now()) return 'active';
    if (user.status === 'overdue' && user.payment_deadline_at && Date.parse(user.payment_deadline_at) <= Date.now()) return 'blocked';
    return user.status;
}

// Recarrega o usuário a cada requisição para que cancelamento/bloqueio valham imediatamente.
export function authenticate(req, _res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    let payload;
    try {
        payload = jwt.verify(token, config.jwtSecret);
    } catch {
        throw new HttpError(401, 'Sessão inválida ou expirada.');
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
    if (!user) throw new HttpError(401, 'Sessão inválida ou expirada.');
    if (user.status === 'cancelled') throw new HttpError(403, 'Conta cancelada. Acesso bloqueado.');
    req.user = user;
    next();
}

export function requireActive(req, _res, next) {
    if (req.user.role !== 'master' && effectiveStatus(req.user) !== 'active') {
        throw new HttpError(402, 'Assinatura inativa. Conclua o pagamento para acessar a plataforma.');
    }
    next();
}
