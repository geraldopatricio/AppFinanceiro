import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, POLICY_VERSION } from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export const uid = () => crypto.randomUUID();

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  document TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','master')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','overdue','cancelled')),
  asaas_customer_id TEXT,
  asaas_subscription_id TEXT,
  policy_version TEXT,
  policy_accepted_at TEXT,
  paid_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, document TEXT, phone TEXT, email TEXT, notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, document TEXT, phone TEXT, email TEXT, notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sales_orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_id TEXT,
  customer_name TEXT NOT NULL,
  description TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount >= 0),
  due_date TEXT,
  paid_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','received','cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  supplier_id TEXT,
  supplier_name TEXT NOT NULL,
  description TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount >= 0),
  due_date TEXT,
  paid_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS financial_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('income','expense')),
  description TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  category TEXT NOT NULL DEFAULT 'other',
  transaction_date TEXT NOT NULL DEFAULT (date('now')),
  sales_order_id TEXT,
  purchase_order_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS charges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sales_order_id TEXT,
  payer_name TEXT NOT NULL,
  payer_email TEXT,
  payer_document TEXT NOT NULL,
  description TEXT NOT NULL,
  billing_type TEXT NOT NULL CHECK (billing_type IN ('PIX','BOLETO','CREDIT_CARD')),
  amount REAL NOT NULL,
  platform_fee REAL NOT NULL,
  asaas_fee REAL NOT NULL,
  net_amount REAL NOT NULL,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','overdue','cancelled')),
  asaas_payment_id TEXT UNIQUE,
  invoice_url TEXT,
  bank_slip_url TEXT,
  pix_payload TEXT,
  pix_qr_image TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  dedupe_key TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_sales_user ON sales_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_user ON purchase_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_user ON financial_transactions(user_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_charges_user ON charges(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id, created_at DESC);
`);

// Tabelas antigas têm CHECK sem CREDIT_CARD; recria preservando os dados.
const chargesSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='charges'").get()?.sql ?? '';
if (!chargesSql.includes('CREDIT_CARD')) {
    db.exec(`
    DROP INDEX IF EXISTS idx_charges_user;
    ALTER TABLE charges RENAME TO charges_old;
    ${chargesSql.replace("('PIX','BOLETO')", "('PIX','BOLETO','CREDIT_CARD')")};
    INSERT INTO charges SELECT * FROM charges_old;
    DROP TABLE charges_old;
    CREATE INDEX IF NOT EXISTS idx_charges_user ON charges(user_id, created_at DESC);
  `);
}

const chargeCols = db.prepare('PRAGMA table_info(charges)').all().map((c) => c.name);
if (!chargeCols.includes('payout_status')) db.exec("ALTER TABLE charges ADD COLUMN payout_status TEXT NOT NULL DEFAULT 'pending'");
if (!chargeCols.includes('payout_at')) db.exec('ALTER TABLE charges ADD COLUMN payout_at TEXT');

// Dados bancários/PIX do cliente para repasse.
const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
for (const col of ['bank_code', 'bank_name', 'bank_agency', 'bank_account', 'bank_account_type', 'bank_holder', 'bank_holder_document', 'pix_key_type', 'pix_key']) {
    if (!userCols.includes(col)) db.exec(`ALTER TABLE users ADD COLUMN ${col} TEXT`);
}
for (const col of ['payment_reminder_at', 'payment_deadline_at']) {
  if (!userCols.includes(col)) db.exec(`ALTER TABLE users ADD COLUMN ${col} TEXT`);
}
if (!userCols.includes('admin_blocked')) db.exec('ALTER TABLE users ADD COLUMN admin_blocked INTEGER NOT NULL DEFAULT 0');

export function seedMaster() {
    const { email, password, name } = config.master;
    if (!email || !password) return;
    const hash = bcrypt.hashSync(password, 12);
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
        db.prepare("UPDATE users SET role='master', status='active', password_hash=?, name=? WHERE id=?").run(hash, name, existing.id);
    } else {
        db.prepare(`INSERT INTO users (id, name, email, password_hash, role, status, policy_version, policy_accepted_at, paid_at)
                VALUES (?, ?, ?, ?, 'master', 'active', ?, datetime('now'), datetime('now'))`).run(uid(), name, email, hash, POLICY_VERSION);
    }
}

  export function seedTestAccount() {
    const { enabled, name, email, password } = config.testAccount;
    if (!enabled) return;
    if (process.env.NODE_ENV === 'production') throw new Error('A conta de testes não pode ser habilitada em produção.');
    if (!email || Buffer.byteLength(password, 'utf8') < 8 || Buffer.byteLength(password, 'utf8') > 72) {
      throw new Error('Configure TEST_ACCOUNT_EMAIL e uma TEST_ACCOUNT_PASSWORD entre 8 e 72 bytes.');
    }
    if (email === config.master.email) throw new Error('A conta de testes deve usar um e-mail diferente da conta master.');

    const existing = db.prepare('SELECT id, role FROM users WHERE email = ?').get(email);
    if (existing?.role === 'master') throw new Error('O e-mail da conta de testes já pertence à conta master.');

    const hash = bcrypt.hashSync(password, 12);
    if (existing) {
      db.prepare(`UPDATE users SET name=?, password_hash=?, role='user', status='active', admin_blocked=0,
            policy_version=?, policy_accepted_at=datetime('now'), paid_at=datetime('now') WHERE id=?`)
        .run(name, hash, POLICY_VERSION, existing.id);
    } else {
      db.prepare(`INSERT INTO users (id, name, email, password_hash, role, status, policy_version, policy_accepted_at, paid_at)
            VALUES (?, ?, ?, ?, 'user', 'active', ?, datetime('now'), datetime('now'))`)
        .run(uid(), name, email, hash, POLICY_VERSION);
    }
  }
