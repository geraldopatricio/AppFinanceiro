import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(backendRoot, '.env') });

const env = process.env;
const num = (value, fallback) => (Number.isFinite(Number(value)) && value !== '' && value !== undefined ? Number(value) : fallback);

if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET ausente ou curto demais (mínimo 32 caracteres) no .env do backend');
}

export const config = {
    port: num(env.PORT, 3001),
    frontendUrl: env.FRONTEND_URL || 'http://localhost:5173',
    jwtSecret: env.JWT_SECRET,
    dbPath: path.resolve(backendRoot, env.DB_PATH || './data/app.db'),
    master: { name: env.MASTER_NAME || 'Master', email: (env.MASTER_EMAIL || '').trim().toLowerCase(), password: env.MASTER_PASSWORD || '' },
    testAccount: { enabled: env.TEST_ACCOUNT_ENABLED === 'true', name: env.TEST_ACCOUNT_NAME || 'Conta de Testes', email: (env.TEST_ACCOUNT_EMAIL || '').trim().toLowerCase(), password: env.TEST_ACCOUNT_PASSWORD || '' },
    asaas: {
        token: env.ASAAS_API_TOKEN || '',
        webhookToken: env.ASAAS_WEBHOOK_TOKEN || '',
        baseUrl: env.ASAAS_ENV === 'production' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3',
    },
    subscriptionValue: num(env.SUBSCRIPTION_VALUE, 22),
    platformFeePercent: num(env.PLATFORM_FEE_PERCENT, 3),
    asaasFee: { PIX: num(env.ASAAS_FEE_PIX, 1.99), BOLETO: num(env.ASAAS_FEE_BOLETO, 1.99), CREDIT_CARD: num(env.ASAAS_FEE_CARD, 0.49) },
    asaasCardPercent: num(env.ASAAS_FEE_CARD_PERCENT, 2.99),
    smtp: { host: env.SMTP_SERVER || '', port: num(env.SMTP_PORT, 587), user: env.SMTP_EMAIL || '', pass: env.SMTP_PASSWORD || '' },
};

export const POLICY_VERSION = '2026-10';
