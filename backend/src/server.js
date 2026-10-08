import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { seedMaster } from './db.js';
import { HttpError } from './asaas.js';
import { authRouter } from './auth.js';
import { billingRouter, webhookRouter } from './billing.js';
import { dataRouter } from './data.js';
import { chargesRouter, alertsRouter } from './charges.js';
import { startAlertJob } from './alerts.js';
import { bankRouter } from './bank.js';
import { adminRouter } from './admin.js';

seedMaster();

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: config.frontendUrl }));
app.use(express.json({ limit: '100kb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRouter);
app.use('/api', webhookRouter, billingRouter, bankRouter, adminRouter, dataRouter, chargesRouter, alertsRouter);

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Rota não encontrada.')));
app.use((err, _req, res, _next) => {
    const status = err.status || 500;
    if (!(err instanceof HttpError)) console.error(err);
    res.status(status).json({ error: status >= 500 && !(err instanceof HttpError) ? 'Erro interno do servidor.' : err.message });
});

app.listen(config.port, () => console.log(`Backend em http://localhost:${config.port}`));
startAlertJob();
