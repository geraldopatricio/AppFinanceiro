const TOKEN_KEY = 'af_token';

export type User = { id: string; name: string; email: string; role: 'user' | 'master'; status: 'pending' | 'active' | 'overdue' | 'blocked' | 'cancelled'; paymentDeadlineAt?: string | null; policyAcceptedAt: string | null };
export type PixInfo = { status: User['status']; value?: number; dueDate?: string; payload?: string; qrImage?: string };
export type Charge = {
  id: string; sales_order_id: string | null; payer_name: string; payer_email: string | null; description: string; billing_type: 'PIX' | 'BOLETO' | 'CREDIT_CARD';
  amount: number; platform_fee: number; asaas_fee: number; net_amount: number; due_date: string; status: 'pending' | 'paid' | 'overdue' | 'cancelled';
  invoice_url: string | null; bank_slip_url: string | null; pix_payload: string | null;
};
export type Alert = { id: string; kind: string; title: string; message: string; is_read: number; created_at: string };

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (token: string | null) => (token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY));

export async function api<T = unknown>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: options.method ?? (options.body ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Não foi possível conectar ao servidor.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token && !path.startsWith('/auth/login')) window.dispatchEvent(new Event('auth:expired'));
    if (res.status === 402 || (res.status === 403 && token)) window.dispatchEvent(new Event('auth:refresh'));
    throw new ApiError(res.status, data.error ?? 'Erro inesperado.');
  }
  return data as T;
}
