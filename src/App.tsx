import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, getToken, setToken, type Alert, type Charge, type User } from './lib/api';
import { AuthScreen, PaymentScreen } from './Auth';
import { AccountsModal, AccountModal, AlertsModal, ChargeModal, ChargeRow, PayoutsModal, type ChargeSource } from './Extras';
import { Field, Modal } from './ui';
import { ArrowDownLeft, ArrowUpRight, BarChart3, Bell, Check, ChevronRight, CircleDollarSign, FileText, Landmark, LayoutDashboard, Mail, Plus, Receipt, ShoppingBag, Store, Target, Trash2, TrendingUp, Trophy, User as UserIcon, Users, UsersRound, Wallet } from 'lucide-react';

type Tab = 'home' | 'transactions' | 'orders' | 'people';
type Person = { id: string; name: string; document: string | null; phone: string | null; email: string | null; is_active: boolean; };
type Order = { id: string; customer_name?: string; supplier_name?: string; description: string; amount: number; due_date: string | null; status: string; created_at: string; };
type Transaction = { id: string; type: 'income' | 'expense'; description: string; amount: number; category: string; transaction_date: string; };

const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const date = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(!getToken());

  const refreshUser = useCallback(async () => {
    if (!getToken()) { setUser(null); setReady(true); return; }
    try { setUser((await api<{ user: User }>('/auth/me')).user); } catch { setToken(null); setUser(null); }
    setReady(true);
  }, []);
  const logout = useCallback(() => { setToken(null); setUser(null); }, []);

  useEffect(() => { void refreshUser(); }, [refreshUser]);
  useEffect(() => {
    const expired = () => logout();
    const refresh = () => void refreshUser();
    window.addEventListener('auth:expired', expired);
    window.addEventListener('auth:refresh', refresh);
    return () => { window.removeEventListener('auth:expired', expired); window.removeEventListener('auth:refresh', refresh); };
  }, [logout, refreshUser]);

  if (!ready) return null;
  if (!user) return <AuthScreen onAuth={setUser} />;
  if (user.role !== 'master' && user.status !== 'active') return <PaymentScreen user={user} onActive={refreshUser} onLogout={logout} />;
  return <Main user={user} onLogout={logout} />;
}

function Main({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('home');
  const [peopleTab, setPeopleTab] = useState<'customers' | 'suppliers'>('customers');
  const [customers, setCustomers] = useState<Person[]>([]);
  const [suppliers, setSuppliers] = useState<Person[]>([]);
  const [sales, setSales] = useState<Order[]>([]);
  const [purchases, setPurchases] = useState<Order[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [modal, setModal] = useState<'person' | 'order' | 'transaction' | 'account' | 'alerts' | 'charge' | 'pay' | 'payouts' | 'accounts' | null>(null);
  const [payOrder, setPayOrder] = useState<Order | null>(null);
  const [chargeSource, setChargeSource] = useState<ChargeSource | null>(null);
  const [orderType, setOrderType] = useState<'sale' | 'purchase'>('sale');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const [c, s, so, po, t, ch, al] = await Promise.all([
        api<Person[]>('/data/customers'), api<Person[]>('/data/suppliers'), api<Order[]>('/data/sales_orders'), api<Order[]>('/data/purchase_orders'),
        api<Transaction[]>('/data/financial_transactions'), api<Charge[]>('/charges'), api<Alert[]>('/alerts'),
      ]);
      setCustomers(c); setSuppliers(s); setSales(so); setPurchases(po); setTransactions(t); setCharges(ch); setAlerts(al);
    } catch (e) { setNotice((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const timer = setInterval(() => void load(), 30000); return () => clearInterval(timer); }, [load]);
  useEffect(() => { if (notice) { const timer = setTimeout(() => setNotice(''), 2800); return () => clearTimeout(timer); } }, [notice]);

  const totals = useMemo(() => {
    const income = transactions.filter((t: Transaction) => t.type === 'income').reduce((sum: number, t: Transaction) => sum + Number(t.amount), 0);
    const expense = transactions.filter((t: Transaction) => t.type === 'expense').reduce((sum: number, t: Transaction) => sum + Number(t.amount), 0);
    const receivable = sales.filter((o: Order) => o.status === 'pending').reduce((sum: number, o: Order) => sum + Number(o.amount), 0);
    return { income, expense, balance: income - expense, receivable };
  }, [transactions, sales]);
  const xp = Math.min(100, customers.length * 12 + suppliers.length * 10 + sales.length * 15 + transactions.length * 5);
  const level = Math.floor(xp / 25) + 1;
  const unread = alerts.filter(a => !a.is_read).length;
  const dueOrders = useMemo(() => { const today = new Date().toLocaleDateString('sv-SE'); return sales.filter(o => o.status === 'pending' && o.due_date && o.due_date <= today); }, [sales]);
  const remind = async (id: string) => { try { await api(`/orders/${id}/remind`, { body: {} }); setNotice('Cobrança enviada por e-mail'); } catch (e) { setNotice((e as Error).message); } };

  const run = async (action: () => Promise<unknown>, message: string) => {
    try { await action(); setModal(null); setNotice(message); } catch (e) { setNotice((e as Error).message); }
    void load();
  };

  const remove = async (table: string, id: string) => {
    if (!window.confirm('Tem certeza que deseja excluir este registro? Esta ação não pode ser desfeita.')) return;
    await run(() => api(`/data/${table}/${id}`, { method: 'DELETE' }), 'Registro removido');
  };
  const savePerson = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    void run(() => api(`/data/${peopleTab}`, { body: { name: f.get('name'), document: f.get('document'), phone: f.get('phone'), email: f.get('email') } }), 'Cadastro realizado');
  };
  const saveOrder = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    const isSale = orderType === 'sale'; const description = String(f.get('description')); const amount = Number(f.get('amount'));
    void run(async () => {
      const order = await api<Order>(isSale ? '/data/sales_orders' : '/data/purchase_orders', { body: { [isSale ? 'customer_name' : 'supplier_name']: f.get('name'), description, amount, due_date: f.get('dueDate') } });
      if (!isSale) await api('/data/financial_transactions', { body: { type: 'expense', description: `Pedido de compra: ${description}`, amount, category: 'purchase_order', transaction_date: new Date().toLocaleDateString('sv-SE'), purchase_order_id: order.id } });
    }, isSale ? 'Pedido criado' : 'Pedido criado e movimento lançado');
  };
  const saveTransaction = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    void run(() => api('/data/financial_transactions', { body: { type: f.get('type'), description: f.get('description'), amount: Number(f.get('amount')), category: f.get('category'), transaction_date: f.get('transactionDate') } }), 'Movimento adicionado');
  };
  const cancelCharge = (id: string) => run(() => api(`/charges/${id}/cancel`, { method: 'POST', body: {} }), 'Cobrança cancelada');
  const openPay = (order: Order) => { setPayOrder(order); setModal('pay'); };
  const savePay = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    void run(() => api(`/orders/sales/${payOrder?.id}/pay`, { body: { paidDate: f.get('paidDate') } }), 'Pedido quitado e receita lançada');
  };
  const openCharge = (order: Order) => { const c = customers.find(p => p.name.trim().toLowerCase() === (order.customer_name ?? '').trim().toLowerCase()); setChargeSource({ salesOrderId: order.id, name: order.customer_name ?? '', amount: Number(order.amount), description: order.description, dueDate: order.due_date, document: c?.document, email: c?.email }); setModal('charge'); };
  const openAlerts = () => { setModal('alerts'); if (unread) void api('/alerts/read-all', { body: {} }).then(() => setAlerts(list => list.map(a => ({ ...a, is_read: 1 })))).catch(() => undefined); };

  return <div className="app-shell">
    <header className="topbar"><div><span className="eyebrow">VISÃO GERAL</span><h1>Olá, {user.name.split(' ')[0]} <span className="wave">✦</span></h1></div><div className="top-actions">{user.role === 'master' && <><button className="icon-button" title="Clientes da plataforma" onClick={() => setModal('accounts')}><UsersRound size={20}/></button><button className="icon-button" title="Repasses" onClick={() => setModal('payouts')}><Landmark size={20}/></button></>}<button className="icon-button" onClick={openAlerts}><Bell size={20}/>{unread > 0 && <i />}</button><button className="icon-button" onClick={() => setModal('account')}><UserIcon size={20}/></button></div></header>
    {notice && <div className="toast"><Check size={16}/>{notice}</div>}
    <main>
      {tab === 'home' && <Dashboard totals={totals} level={level} xp={xp} sales={sales} transactions={transactions} dueOrders={dueOrders} onRemind={(id) => void remind(id)} onPay={openPay} onAction={(action) => { if (action === 'transaction') setModal('transaction'); if (action === 'sale' || action === 'purchase') { setOrderType(action); setModal('order'); } }} />}
      {tab === 'transactions' && <Transactions items={transactions} onAdd={() => setModal('transaction')} onDelete={(id) => void remove('financial_transactions', id)} />}
      {tab === 'orders' && <Orders sales={sales} purchases={purchases} charges={charges} onAdd={(type) => { setOrderType(type); setModal('order'); }} onCharge={openCharge} onPay={openPay} onCancelCharge={(id) => void cancelCharge(id)} notify={setNotice} />}
      {tab === 'people' && <People people={peopleTab === 'customers' ? customers : suppliers} kind={peopleTab} setKind={setPeopleTab} onAdd={() => setModal('person')} onDelete={(id) => void remove(peopleTab, id)} />}
    </main>
    <nav className="bottom-nav"><NavItem icon={<LayoutDashboard/>} label="Início" active={tab === 'home'} onClick={() => setTab('home')}/><NavItem icon={<Wallet/>} label="Finanças" active={tab === 'transactions'} onClick={() => setTab('transactions')}/><button className="quick-add" onClick={() => setModal('transaction')}><Plus size={25}/></button><NavItem icon={<FileText/>} label="Pedidos" active={tab === 'orders'} onClick={() => setTab('orders')}/><NavItem icon={<Users/>} label="Pessoas" active={tab === 'people'} onClick={() => setTab('people')}/></nav>
    {modal === 'person' && <Modal title={`Novo ${peopleTab === 'customers' ? 'cliente' : 'fornecedor'}`} close={() => setModal(null)}><form onSubmit={savePerson} className="form"><Field name="name" label="Nome completo / empresa" required/><Field name="document" label="CPF ou CNPJ"/><Field name="phone" label="Telefone" type="tel"/><Field name="email" label="E-mail" type="email"/><button className="primary full">Salvar cadastro</button></form></Modal>}
    {modal === 'order' && <Modal title={orderType === 'sale' ? 'Novo pedido de venda' : 'Novo pedido de compra'} close={() => setModal(null)}><form onSubmit={saveOrder} className="form"><Field name="name" label={orderType === 'sale' ? 'Cliente' : 'Fornecedor'} required list="party-options"/><datalist id="party-options">{(orderType === 'sale' ? customers : suppliers).map(p => <option key={p.id} value={p.name}/>)}</datalist><Field name="description" label="Descrição do pedido" required/><Field name="amount" label="Valor (R$)" type="number" required/><Field name="dueDate" label="Vencimento" type="date"/><button className="primary full">Criar pedido</button></form></Modal>}
    {modal === 'transaction' && <Modal title="Novo movimento" close={() => setModal(null)}><form onSubmit={saveTransaction} className="form"><label>Tipo<select name="type"><option value="income">Entrada</option><option value="expense">Saída</option></select></label><Field name="description" label="Descrição" required/><Field name="amount" label="Valor (R$)" type="number" required/><label>Categoria<select name="category"><option value="other">Outros</option><option value="sales">Vendas</option><option value="supplies">Fornecedores</option><option value="fixed_cost">Custo fixo</option></select></label><Field name="transactionDate" label="Data" type="date" required/><button className="primary full">Lançar movimento</button></form></Modal>}
    {modal === 'charge' && chargeSource && <ChargeModal source={chargeSource} close={() => setModal(null)} onCreated={() => { setModal(null); setNotice('Cobrança gerada'); void load(); }} />}
    {modal === 'pay' && payOrder && <Modal title="Informar pagamento" close={() => setModal(null)}><form onSubmit={savePay} className="form"><p className="auth-sub">{payOrder.customer_name} · {payOrder.description} · {money(Number(payOrder.amount))}</p><Field name="paidDate" label="Data do pagamento" type="date" required defaultValue={new Date().toLocaleDateString('sv-SE')}/><button className="primary full">Marcar como pago e lançar receita</button></form></Modal>}
    {modal === 'payouts' && <PayoutsModal close={() => setModal(null)} notify={setNotice} />}
    {modal === 'accounts' && <AccountsModal close={() => setModal(null)} notify={setNotice} />}
    {modal === 'alerts' && <AlertsModal alerts={alerts} close={() => setModal(null)} />}
    {modal === 'account' && <AccountModal user={user} close={() => setModal(null)} onLogout={onLogout} onCancelled={onLogout} />}
  </div>;
}

function Dashboard({ totals, level, xp, sales, transactions, dueOrders, onRemind, onPay, onAction }: { totals: { income: number; expense: number; balance: number; receivable: number }; level: number; xp: number; sales: Order[]; transactions: Transaction[]; dueOrders: Order[]; onRemind: (id: string) => void; onPay: (order: Order) => void; onAction: (action: 'transaction' | 'sale' | 'purchase') => void }) { return <>
  <section className="hero-card"><div><span className="eyebrow light">SALDO ATUAL</span><strong>{money(totals.balance)}</strong><span className="positive"><TrendingUp size={15}/> 12,8% este mês</span></div><div className="hero-orb"><CircleDollarSign size={42}/></div></section>
  <div className="stats-grid"><Stat icon={<ArrowDownLeft/>} label="Entradas" value={money(totals.income)} color="green"/><Stat icon={<ArrowUpRight/>} label="Saídas" value={money(totals.expense)} color="orange"/><Stat icon={<Target/>} label="A receber" value={money(totals.receivable)} color="blue"/></div>
  {dueOrders.length > 0 && <><section className="section-head"><div><span className="eyebrow">ATENÇÃO</span><h2>Pedidos vencidos</h2></div></section>{dueOrders.map(o => <div className="order-row" key={o.id}><div className="order-icon sale"><FileText size={18}/></div><div className="movement-info"><strong>{o.description}</strong><span>{o.customer_name} · vence {date(o.due_date!)}</span></div><div className="order-price"><b>{money(Number(o.amount))}</b></div><button className="delete" title="Marcar como pago" onClick={() => onPay(o)}><Check size={16}/></button><button className="delete" title="Enviar cobrança por e-mail" onClick={() => onRemind(o.id)}><Mail size={16}/></button></div>)}</>}
  <section className="section-head"><div><span className="eyebrow">SEU PROGRESSO</span><h2>Missão financeira</h2></div><span className="level">Nível {level}</span></section><div className="progress-card"><div className="trophy"><Trophy size={21}/></div><div className="progress-copy"><strong>Construa seu império</strong><span>{xp}% concluído para o próximo nível</span><div className="progress"><i style={{ width: `${xp}%` }}/></div></div><ChevronRight size={18} className="muted"/></div>
  <section className="section-head"><div><span className="eyebrow">ATALHOS</span><h2>Ações rápidas</h2></div></section><div className="actions"><Action icon={<ArrowDownLeft/>} label="Entrada" color="green" onClick={() => onAction('transaction')}/><Action icon={<ArrowUpRight/>} label="Saída" color="orange" onClick={() => onAction('transaction')}/><Action icon={<ShoppingBag/>} label="Venda" color="blue" onClick={() => onAction('sale')}/><Action icon={<Store/>} label="Compra" color="yellow" onClick={() => onAction('purchase')}/></div>
  <section className="section-head recent"><div><span className="eyebrow">ATIVIDADE RECENTE</span><h2>Últimos movimentos</h2></div></section>{transactions.slice(0, 4).map(t => <TransactionRow key={t.id} item={t}/>)}{!transactions.length && !sales.length && <Empty text="Comece lançando sua primeira entrada ou pedido."/>}
</> }
function Transactions({ items, onAdd, onDelete }: { items: Transaction[]; onAdd: () => void; onDelete: (id: string) => void }) { return <Page title="Finanças" subtitle="Acompanhe cada movimento do seu negócio" button="Novo movimento" onAdd={onAdd}><div className="filter-pills"><span className="active">Todos</span><span>Entradas</span><span>Saídas</span></div>{items.map(t => <TransactionRow key={t.id} item={t} deletable onDelete={onDelete}/>)}{!items.length && <Empty text="Nenhum movimento registrado ainda."/>}</Page> }
function Orders({ sales, purchases, charges, onAdd, onCharge, onPay, onCancelCharge, notify }: { sales: Order[]; purchases: Order[]; charges: Charge[]; onAdd: (type: 'sale' | 'purchase') => void; onCharge: (order: Order) => void; onPay: (order: Order) => void; onCancelCharge: (id: string) => void; notify: (msg: string) => void }) { return <Page title="Pedidos" subtitle="Vendas e compras em um só lugar"><div className="order-tabs"><button className="active">Vendas <b>{sales.length}</b></button><button onClick={() => onAdd('purchase')}>+ Compra</button></div><button className="primary full add-order" onClick={() => onAdd('sale')}><Plus size={17}/> Novo pedido de venda</button>{sales.map(o => <OrderRow key={o.id} order={o} type="sale" onCharge={() => onCharge(o)} onPay={() => onPay(o)}/>)}{purchases.map(o => <OrderRow key={o.id} order={o} type="purchase"/>)}{!sales.length && !purchases.length && <Empty text="Seus pedidos aparecerão aqui."/>}{charges.length > 0 && <><section className="section-head recent"><div><span className="eyebrow">BOLETOS E PIX</span><h2>Cobranças enviadas</h2></div></section>{charges.map(c => <ChargeRow key={c.id} charge={c} onCancel={onCancelCharge} notify={notify}/>)}</>}</Page> }
function People({ people, kind, setKind, onAdd, onDelete }: { people: Person[]; kind: 'customers' | 'suppliers'; setKind: (kind: 'customers' | 'suppliers') => void; onAdd: () => void; onDelete: (id: string) => void }) { return <Page title="Pessoas" subtitle="Relacionamentos que fazem seu negócio crescer" button={`Novo ${kind === 'customers' ? 'cliente' : 'fornecedor'}`} onAdd={onAdd}><div className="order-tabs"><button className={kind === 'customers' ? 'active' : ''} onClick={() => setKind('customers')}>Clientes</button><button className={kind === 'suppliers' ? 'active' : ''} onClick={() => setKind('suppliers')}>Fornecedores</button></div>{people.map(p => <div className="person-row" key={p.id}><div className="avatar">{p.name.slice(0, 1).toUpperCase()}</div><div className="person-info"><strong>{p.name}</strong><span>{p.phone || p.email || 'Sem contato informado'}</span></div><button className="delete" onClick={() => onDelete(p.id)}><Trash2 size={16}/></button></div>)}{!people.length && <Empty text={`Nenhum ${kind === 'customers' ? 'cliente' : 'fornecedor'} cadastrado.`}/>}</Page> }
function Page({ title, subtitle, button, onAdd, children }: { title: string; subtitle: string; button?: string; onAdd?: () => void; children: React.ReactNode }) { return <><section className="page-title"><div><span className="eyebrow">GESTÃO</span><h2>{title}</h2><p>{subtitle}</p></div>{button && <button className="small-add" onClick={onAdd}><Plus size={16}/>{button}</button>}</section>{children}</> }
function Stat({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) { return <div className={`stat ${color}`}><div className="stat-icon">{icon}</div><span>{label}</span><strong>{value}</strong></div> }
function Action({ icon, label, color, onClick }: { icon: React.ReactNode; label: string; color: string; onClick: () => void }) { return <button className="action" onClick={onClick}><div className={`action-icon ${color}`}>{icon}</div><span>{label}</span></button> }
function TransactionRow({ item, deletable, onDelete }: { item: Transaction; deletable?: boolean; onDelete?: (id: string) => void }) { return <div className="transaction-row"><div className={`movement-icon ${item.type}`}>{item.type === 'income' ? <ArrowDownLeft size={18}/> : <ArrowUpRight size={18}/>}</div><div className="movement-info"><strong>{item.description}</strong><span>{item.category} · {date(item.transaction_date)}</span></div><b className={item.type === 'income' ? 'amount-in' : 'amount-out'}>{item.type === 'income' ? '+' : '-'} {money(Number(item.amount))}</b>{deletable && onDelete && <button className="delete" onClick={() => onDelete(item.id)}><Trash2 size={15}/></button>}</div> }
function OrderRow({ order, type, onCharge, onPay }: { order: Order; type: 'sale' | 'purchase'; onCharge?: () => void; onPay?: () => void }) { return <div className="order-row"><div className={`order-icon ${type}`}><FileText size={18}/></div><div className="movement-info"><strong>{order.description}</strong><span>{type === 'sale' ? order.customer_name : order.supplier_name} · {order.due_date ? `vence ${date(order.due_date)}` : 'sem vencimento'}</span></div><div className="order-price"><b>{money(Number(order.amount))}</b><small>{order.status === 'pending' ? 'Pendente' : 'Pago'}</small></div>{onPay && order.status === 'pending' && <button className="delete" title="Marcar como pago" onClick={onPay}><Check size={16}/></button>}{onCharge && order.status === 'pending' && <button className="delete" title="Enviar boleto/PIX" onClick={onCharge}><Receipt size={16}/></button>}</div> }
function Empty({ text }: { text: string }) { return <div className="empty"><BarChart3 size={22}/><span>{text}</span></div> }
function NavItem({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) { return <button className={active ? 'nav-item active' : 'nav-item'} onClick={onClick}>{icon}<span>{label}</span></button> }
