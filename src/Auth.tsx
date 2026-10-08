import { useEffect, useState, type FormEvent } from 'react';
import { Check, Copy, LogOut } from 'lucide-react';
import { api, setToken, type PixInfo, type User } from './lib/api';
import { PolicyModal } from './Policy';
import { BankFields, Field, readBank } from './ui';

const money = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function AuthScreen({ onAuth }: { onAuth: (user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [showPolicy, setShowPolicy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    setError(''); setBusy(true);
    try {
      const body = mode === 'login'
        ? { email: f.get('email'), password: f.get('password') }
        : { name: f.get('name'), email: f.get('email'), document: f.get('document'), password: f.get('password'), acceptPolicy: accepted, bank: readBank(f) };
      const res = await api<{ token: string; user: User }>(`/auth/${mode}`, { body });
      setToken(res.token);
      onAuth(res.user);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return <div className="auth-shell"><div className="auth-card">
    <span className="eyebrow">APP FINANCEIRO</span>
    <h1>{mode === 'login' ? 'Entrar' : 'Criar conta'}</h1>
    <p className="auth-sub">{mode === 'login' ? 'Acesse sua conta para gerenciar seu negócio.' : 'Cadastre-se e ative com PIX mensal de R$ 22,00.'}</p>
    <form className="form" onSubmit={submit} key={mode}>
      {mode === 'register' && <Field name="name" label="Nome completo / empresa" required/>}
      <Field name="email" label="E-mail" type="email" required/>
      {mode === 'register' && <Field name="document" label="CPF ou CNPJ" required/>}
      <Field name="password" label="Senha" type="password" required minLength={mode === 'register' ? 8 : undefined}/>
      {mode === 'register' && <>
        <details className="bank-box"><summary>Dados bancários e PIX para repasse (opcional agora)</summary><BankFields /></details>
        <label className="check-row"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} /><span>Li e aceito a <button type="button" className="link" onClick={() => setShowPolicy(true)}>política de uso</button>, incluindo a taxa de 3% + taxa Asaas sobre boletos e PIX cobrados.</span></label>
      </>}
      {error && <div className="form-error">{error}</div>}
      <button className="primary full" disabled={busy || (mode === 'register' && !accepted)}>{busy ? 'Aguarde...' : mode === 'login' ? 'Entrar' : 'Criar conta'}</button>
    </form>
    <button className="link center" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>{mode === 'login' ? 'Não tem conta? Cadastre-se' : 'Já tenho conta'}</button>
    {showPolicy && <PolicyModal close={() => setShowPolicy(false)} />}
  </div></div>;
}

export function PaymentScreen({ user, onActive, onLogout }: { user: User; onActive: () => void; onLogout: () => void }) {
  const [pix, setPix] = useState<PixInfo | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setError('');
    api<PixInfo>('/billing/pix').then(res => { if (!alive) return; if (res.status === 'active') onActive(); else setPix(res); }).catch(e => alive && setError((e as Error).message));
    return () => { alive = false; };
  }, [attempt, onActive]);

  useEffect(() => {
    const timer = setInterval(() => { api<{ status: User['status'] }>('/billing/status').then(r => { if (r.status === 'active') onActive(); }).catch(() => undefined); }, 6000);
    return () => clearInterval(timer);
  }, [onActive]);

  const copy = async () => { if (pix?.payload) { await navigator.clipboard.writeText(pix.payload); setCopied(true); setTimeout(() => setCopied(false), 2000); } };

  return <div className="auth-shell"><div className="auth-card">
    <span className="eyebrow">{user.status === 'overdue' ? 'MENSALIDADE EM ATRASO' : user.status === 'blocked' ? 'ACESSO BLOQUEADO' : 'ATIVAÇÃO DA CONTA'}</span>
    <h1>{user.status === 'blocked' ? 'Regularize seu pagamento' : user.status === 'overdue' ? 'Evite o bloqueio da conta' : 'Pague o PIX para ativar'}</h1>
    <p className="auth-sub">Olá, {user.name}. Mensalidade recorrente de {money(pix?.value ?? 22)}. O acesso é liberado automaticamente após a confirmação.</p>
    {user.paymentDeadlineAt && user.status !== 'blocked' && <p className="payment-deadline">Prazo para pagamento: {new Date(user.paymentDeadlineAt).toLocaleString('pt-BR')}.</p>}
    {error && <div className="form-error">{error}</div>}
    {!pix && !error && <p className="auth-sub">Gerando PIX...</p>}
    {pix?.qrImage && <img className="qr" alt="QR Code PIX" src={`data:image/png;base64,${pix.qrImage}`} />}
    {pix?.payload && <><textarea className="pix-code" readOnly value={pix.payload} /><button className="primary full" onClick={() => void copy()}>{copied ? <><Check size={16}/> Copiado</> : <><Copy size={16}/> Copiar PIX copia e cola</>}</button></>}
    {error && <button className="primary full" onClick={() => setAttempt(a => a + 1)}>Tentar novamente</button>}
    <button className="link center" onClick={onLogout}><LogOut size={14}/> Sair</button>
  </div></div>;
}

