import { useEffect, useState, type FormEvent } from 'react';
import { Ban, BellRing, Copy, ExternalLink, LogOut } from 'lucide-react';
import { api, type Alert, type Charge, type User } from './lib/api';
import { PolicyText } from './Policy';
import { BankFields, Field, Modal, readBank, type Bank } from './ui';

const money = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const br = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
const statusLabel = { pending: 'Pendente', paid: 'Pago', overdue: 'Vencida', cancelled: 'Cancelada' } as const;
const accountStatus = { pending: 'Aguardando pagamento', active: 'Ativa', overdue: 'Em atraso', blocked: 'Bloqueada', cancelled: 'Cancelada' } as const;

export function AccountModal({ user, close, onLogout, onCancelled }: { user: User; close: () => void; onLogout: () => void; onCancelled: () => void }) {
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState('');
  const [showPolicy, setShowPolicy] = useState(false);
  const [bank, setBank] = useState<Bank | null>(null);
  const [bankMsg, setBankMsg] = useState('');
  useEffect(() => { api<Bank>('/account/bank').then(setBank).catch(() => undefined); }, []);

  const saveBank = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try { await api('/account/bank', { method: 'PUT', body: readBank(new FormData(event.currentTarget)) }); setBankMsg('Dados salvos'); } catch (e) { setBankMsg((e as Error).message); }
  };

  const cancel = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get('password'));
    try { await api('/account/cancel', { body: { password } }); onCancelled(); } catch (e) { setError((e as Error).message); }
  };

  return <Modal title="Minha conta" close={close}>
    <div className="account-info"><strong>{user.name}</strong><span>{user.email}</span><span>Situação: {accountStatus[user.status]}{user.role === 'master' ? ' (master)' : ''}</span></div>
    {bank && <details className="bank-box" open={!bank.pix_key}><summary>Dados bancários e PIX para repasse</summary><form className="form" onSubmit={saveBank}><BankFields values={bank}/>{bankMsg && <div className="form-error">{bankMsg}</div>}<button className="primary full">Salvar dados</button></form></details>}
    {showPolicy ? <PolicyText /> : <button className="secondary full" onClick={() => setShowPolicy(true)}>Ver política de uso e aceite</button>}
    <button className="secondary full" onClick={onLogout}><LogOut size={15}/> Sair</button>
    {user.role !== 'master' && (cancelling
      ? <form className="form" onSubmit={cancel}><p className="form-error">Isto encerra a cobrança recorrente do PIX e bloqueia o acesso à conta.</p><Field name="password" label="Confirme sua senha" type="password" required/>{error && <div className="form-error">{error}</div>}<button className="danger full">Confirmar cancelamento</button></form>
      : <button className="danger-link" onClick={() => setCancelling(true)}>Cancelar minha conta</button>)}
  </Modal>;
}

export function AlertsModal({ alerts, close }: { alerts: Alert[]; close: () => void }) {
  return <Modal title="Alertas" close={close}>
    {!alerts.length && <p className="auth-sub">Nenhum alerta por enquanto.</p>}
    {alerts.map(a => <div className={a.is_read ? 'alert-row' : 'alert-row unread'} key={a.id}><strong>{a.title}</strong><span>{a.message}</span><small>{br(a.created_at)}</small></div>)}
  </Modal>;
}

type PayoutGroup = {
  userId: string; name: string; email: string; bank: Record<string, string>; count: number; gross: number; platformFee: number; asaasFee: number; net: number;
  charges: { id: string; payer_name: string; description: string; billing_type: string; amount: number; net_amount: number; paid_at: string }[];
};

export function PayoutsModal({ close, notify }: { close: () => void; notify: (msg: string) => void }) {
  const [groups, setGroups] = useState<PayoutGroup[] | null>(null);
  const [error, setError] = useState('');
  const load = () => api<PayoutGroup[]>('/admin/payouts').then(setGroups).catch(e => setError((e as Error).message));
  useEffect(() => { void load(); }, []);

  const settle = async (g: PayoutGroup) => {
    if (!confirm(`Confirmar repasse de ${money(g.net)} para ${g.name}?`)) return;
    try { await api(`/admin/payouts/${g.userId}/settle`, { body: {} }); notify('Repasse registrado'); await load(); } catch (e) { setError((e as Error).message); }
  };
  const copy = async (value: string) => { await navigator.clipboard.writeText(value); notify('Copiado'); };

  return <Modal title="Repasses pendentes" close={close}>
    {error && <div className="form-error">{error}</div>}
    {groups && !groups.length && <p className="auth-sub">Nenhum repasse pendente.</p>}
    {groups?.map(g => <div className="payout-card" key={g.userId}>
      <div className="payout-head"><div><strong>{g.name}</strong><span>{g.email}</span></div><b>{money(g.net)}</b></div>
      <small>{g.count} cobrança(s) · bruto {money(g.gross)} · taxa 3% {money(g.platformFee)} · taxa Asaas {money(g.asaasFee)}</small>
      <div className="payout-bank">
        {g.bank.pix_key ? <span>PIX ({g.bank.pix_key_type}): <b>{g.bank.pix_key}</b> <button type="button" className="link" onClick={() => void copy(g.bank.pix_key)}>copiar</button></span> : <span className="st-overdue">Sem chave PIX cadastrada</span>}
        {(g.bank.bank_account || g.bank.bank_agency) && <span>{g.bank.bank_name} ({g.bank.bank_code}) · ag. {g.bank.bank_agency} · conta {g.bank.bank_account} ({g.bank.bank_account_type}) · {g.bank.bank_holder} {g.bank.bank_holder_document}</span>}
      </div>
      <details><summary>Ver cobranças</summary>{g.charges.map(c => <div className="payout-line" key={c.id}><span>{c.payer_name} · {c.billing_type} · {c.description}</span><b>{money(c.net_amount)}</b></div>)}</details>
      <button className="primary full" onClick={() => void settle(g)}>Marcar repasse como pago</button>
    </div>)}
  </Modal>;
}

type PlatformAccount = {
  id: string; name: string; email: string; status: string; displayStatus: string; paid_at: string | null; created_at: string;
  payment_reminder_at: string | null; payment_deadline_at: string | null; admin_blocked: number;
};
type AccountsData = { counts: { total: number; active: number; pending: number; overdue: number; blocked: number; cancelled: number }; users: PlatformAccount[] };

export function AccountsModal({ close, notify }: { close: () => void; notify: (msg: string) => void }) {
  const [data, setData] = useState<AccountsData | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [busyId, setBusyId] = useState('');
  const load = () => api<AccountsData>('/admin/accounts').then(setData).catch(e => setError((e as Error).message));
  useEffect(() => { void load(); }, []);

  const remind = async (account: PlatformAccount) => {
    setBusyId(account.id); setError('');
    try { await api(`/admin/accounts/${account.id}/remind`, { body: {} }); notify(`Lembrete enviado para ${account.email}`); await load(); }
    catch (e) { setError((e as Error).message); } finally { setBusyId(''); }
  };
  const block = async (account: PlatformAccount) => {
    if (!confirm(`Bloquear o acesso de ${account.name}?`)) return;
    setBusyId(account.id); setError('');
    try { await api(`/admin/accounts/${account.id}/block`, { body: {} }); notify('Conta bloqueada'); await load(); }
    catch (e) { setError((e as Error).message); } finally { setBusyId(''); }
  };
  const when = (value: string | null) => value ? new Date(value).toLocaleString('pt-BR') : 'Nunca';
  const labels: Record<string, string> = { active: 'Pago / ativa', pending: 'Pendente', overdue: 'Em atraso', grace: 'Prazo de 24h', blocked: 'Bloqueada', cancelled: 'Cancelada' };
  const visible = data?.users.filter(u => filter === 'all' || (filter === 'paid' ? u.status === 'active' : filter === 'pending' ? ['pending', 'overdue'].includes(u.status) : u.displayStatus === filter)) ?? [];

  return <Modal title="Clientes da plataforma" close={close}>
    {error && <div className="form-error">{error}</div>}
    {data && <>
      <div className="account-counts"><div><b>{data.counts.total}</b><span>Contas</span></div><div><b>{data.counts.active}</b><span>Pagas / ativas</span></div><div><b>{data.counts.pending}</b><span>Pendentes</span></div><div><b>{data.counts.overdue}</b><span>Em atraso</span></div><div><b>{data.counts.blocked}</b><span>Bloqueadas</span></div><div><b>{data.counts.cancelled}</b><span>Canceladas</span></div></div>
      <div className="filter-pills account-filters"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Todas</button><button className={filter === 'paid' ? 'active' : ''} onClick={() => setFilter('paid')}>Pagas</button><button className={filter === 'pending' ? 'active' : ''} onClick={() => setFilter('pending')}>Pendentes</button><button className={filter === 'blocked' ? 'active' : ''} onClick={() => setFilter('blocked')}>Bloqueadas</button><button className={filter === 'cancelled' ? 'active' : ''} onClick={() => setFilter('cancelled')}>Canceladas</button></div>
      {!visible.length && <p className="auth-sub">Nenhuma conta nesta situação.</p>}
      {visible.map(account => <div className="platform-account" key={account.id}>
        <div className="payout-head"><div><strong>{account.name}</strong><span>{account.email}</span></div><span className={`account-badge badge-${account.displayStatus}`}>{labels[account.displayStatus] ?? account.displayStatus}</span></div>
        <div className="account-dates"><span>Cadastro: {when(account.created_at)}</span><span>Último pagamento confirmado: {when(account.paid_at)}</span>{account.payment_deadline_at && <span>Prazo de pagamento: {when(account.payment_deadline_at)}</span>}</div>
        {['pending', 'overdue'].includes(account.status) && !account.admin_blocked && <div className="account-actions">{(!account.payment_deadline_at || Date.parse(account.payment_deadline_at) <= Date.now()) ? <button className="secondary" disabled={busyId === account.id} onClick={() => void remind(account)}><BellRing size={15}/>{busyId === account.id ? 'Aguarde...' : 'Enviar lembrete 24h'}</button> : <span className="auth-sub">Prazo de pagamento em andamento.</span>}<button className="danger" disabled={busyId === account.id} onClick={() => void block(account)}><Ban size={15}/>Bloquear agora</button></div>}
      </div>)}
    </>}
  </Modal>;
}

export type ChargeSource = { salesOrderId?: string; name: string; amount: number; description: string; dueDate: string | null; document?: string | null; email?: string | null };

export function ChargeModal({ source, close, onCreated }: { source: ChargeSource; close: () => void; onCreated: () => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const today = new Date().toLocaleDateString('sv-SE');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    setBusy(true); setError('');
    try {
      await api('/charges', { body: {
        salesOrderId: source.salesOrderId, billingType: f.get('billingType'), payerName: f.get('payerName'), payerDocument: f.get('payerDocument'),
        payerEmail: f.get('payerEmail'), amount: Number(f.get('amount')), dueDate: f.get('dueDate'), description: f.get('description'),
      } });
      onCreated();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return <Modal title="Enviar cobrança" close={close}>
    <form className="form" onSubmit={submit}>
      <label>Forma de cobrança<select name="billingType"><option value="PIX">PIX</option><option value="BOLETO">Boleto</option><option value="CREDIT_CARD">Cartão de crédito</option></select></label>
      <Field name="payerName" label="Nome do pagador" required defaultValue={source.name}/>
      <Field name="payerDocument" label="CPF ou CNPJ do pagador" required defaultValue={source.document ?? ''}/>
      <Field name="payerEmail" label="E-mail do pagador (recebe o link)" type="email" defaultValue={source.email ?? ''}/>
      <Field name="description" label="Descrição" required defaultValue={source.description}/>
      <Field name="amount" label="Valor (R$)" type="number" required defaultValue={source.amount}/>
      <Field name="dueDate" label="Vencimento" type="date" required defaultValue={source.dueDate && source.dueDate >= today ? source.dueDate : today}/>
      <p className="auth-sub">Taxa de 3% + taxa do Asaas sobre o valor cobrado, descontadas do repasse.</p>
      {error && <div className="form-error">{error}</div>}
      <button className="primary full" disabled={busy}>{busy ? 'Gerando...' : 'Gerar e enviar'}</button>
    </form>
  </Modal>;
}

export function ChargeRow({ charge, onCancel, notify }: { charge: Charge; onCancel: (id: string) => void; notify: (msg: string) => void }) {
  const link = charge.bank_slip_url || charge.invoice_url;
  const copy = async () => { if (charge.pix_payload) { await navigator.clipboard.writeText(charge.pix_payload); notify('PIX copiado'); } };
  return <div className="order-row charge-row">
    <div className="movement-info"><strong>{charge.payer_name} · {{ PIX: 'PIX', BOLETO: 'Boleto', CREDIT_CARD: 'Cartão' }[charge.billing_type]}</strong><span>{charge.description} · vence {br(charge.due_date)} · líquido {money(charge.net_amount)}</span></div>
    <div className="order-price"><b>{money(charge.amount)}</b><small className={`st-${charge.status}`}>{statusLabel[charge.status]}</small></div>
    {charge.status === 'pending' || charge.status === 'overdue' ? <div className="row-actions">
      {charge.pix_payload && <button className="delete" title="Copiar PIX" onClick={() => void copy()}><Copy size={15}/></button>}
      {link && <a className="delete" title="Abrir" href={link} target="_blank" rel="noreferrer"><ExternalLink size={15}/></a>}
      <button className="delete" title="Cancelar cobrança" onClick={() => onCancel(charge.id)}><Ban size={15}/></button>
    </div> : null}
  </div>;
}
