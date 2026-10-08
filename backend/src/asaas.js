import { config } from './config.js';

export class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

async function request(method, path, body) {
    if (!config.asaas.token) throw new HttpError(503, 'Integração com o Asaas não configurada (ASAAS_API_TOKEN).');
    let res;
    try {
        res = await fetch(`${config.asaas.baseUrl}${path}`, {
            method,
            headers: { 'Content-Type': 'application/json', access_token: config.asaas.token, 'User-Agent': 'app-financeiro' },
            body: body ? JSON.stringify(body) : undefined,
        });
    } catch {
        throw new HttpError(502, 'Não foi possível contatar o Asaas.');
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        console.error('[asaas]', method, path, res.status, JSON.stringify(json));
        throw new HttpError(502, json?.errors?.[0]?.description || 'Erro ao comunicar com o Asaas.');
    }
    return json;
}

export const asaas = {
    createCustomer: (data) => request('POST', '/customers', data),
    createSubscription: (data) => request('POST', '/subscriptions', data),
    cancelSubscription: (id) => request('DELETE', `/subscriptions/${encodeURIComponent(id)}`),
    subscriptionPayments: (id) => request('GET', `/subscriptions/${encodeURIComponent(id)}/payments`),
    createPayment: (data) => request('POST', '/payments', data),
    getPayment: (id) => request('GET', `/payments/${encodeURIComponent(id)}`),
    cancelPayment: (id) => request('DELETE', `/payments/${encodeURIComponent(id)}`),
    pixQrCode: (id) => request('GET', `/payments/${encodeURIComponent(id)}/pixQrCode`),
};

export const PAID_STATUSES = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'];
