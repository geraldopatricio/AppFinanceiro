export const todayBR = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export const onlyDigits = (v) => String(v ?? '').replace(/\D/g, '');

export const isEmail = (v) => typeof v === 'string' && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export const isIsoDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));

export const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const text = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
