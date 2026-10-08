import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export function Field({ name, label, type = 'text', required, defaultValue, minLength, list }: { name: string; label: string; type?: string; required?: boolean; defaultValue?: string | number; minLength?: number; list?: string }) {
  return <label>{label}<input name={name} type={type} required={required} defaultValue={defaultValue} minLength={minLength} list={list} autoComplete={list ? 'off' : undefined} step={type === 'number' ? '0.01' : undefined} /></label>;
}

export type Bank = Record<string, string>;
export const BANK_KEYS = ['bank_code', 'bank_name', 'bank_agency', 'bank_account', 'bank_account_type', 'bank_holder', 'bank_holder_document', 'pix_key_type', 'pix_key'];
export const readBank = (f: FormData): Bank => Object.fromEntries(BANK_KEYS.map(k => [k, String(f.get(k) ?? '')]));

export function BankFields({ values = {} }: { values?: Bank }) {
  const v = (k: string) => values[k] ?? '';
  return <>
    <Field name="bank_holder" label="Titular da conta" defaultValue={v('bank_holder')}/>
    <Field name="bank_holder_document" label="CPF/CNPJ do titular" defaultValue={v('bank_holder_document')}/>
    <Field name="bank_code" label="Código do banco" defaultValue={v('bank_code')}/>
    <Field name="bank_name" label="Banco" defaultValue={v('bank_name')}/>
    <Field name="bank_agency" label="Agência" defaultValue={v('bank_agency')}/>
    <Field name="bank_account" label="Conta (com dígito)" defaultValue={v('bank_account')}/>
    <label>Tipo de conta<select name="bank_account_type" defaultValue={v('bank_account_type')}><option value="">Selecione</option><option value="corrente">Corrente</option><option value="poupanca">Poupança</option></select></label>
    <label>Tipo da chave PIX<select name="pix_key_type" defaultValue={v('pix_key_type')}><option value="">Selecione</option><option value="cpf">CPF</option><option value="cnpj">CNPJ</option><option value="email">E-mail</option><option value="phone">Telefone</option><option value="random">Chave aleatória</option></select></label>
    <Field name="pix_key" label="Chave PIX" defaultValue={v('pix_key')}/>
  </>;
}

export function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  return <div className="overlay" onMouseDown={close}><div className="modal" onMouseDown={e => e.stopPropagation()}><div className="modal-head"><h2>{title}</h2><button className="icon-button" onClick={close}><X size={19}/></button></div>{children}</div></div>;
}
