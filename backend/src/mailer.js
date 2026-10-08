import nodemailer from 'nodemailer';
import { config } from './config.js';

const { host, port, user, pass } = config.smtp;
const transporter = host && user && pass
    ? nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } })
    : null;

// Falhas de e-mail nunca devem derrubar a requisição.
export async function sendMail(to, subject, text, html) {
    if (!to) return false;
    if (!transporter) {
        console.log(`[mail:desativado] para=${to} assunto="${subject}"`);
        return false;
    }
    try {
        await transporter.sendMail({ from: `App Financeiro <${user}>`, to, subject, text, html });
        return true;
    } catch (error) {
        console.error('[mail] falha ao enviar:', error.message);
        return false;
    }
}
