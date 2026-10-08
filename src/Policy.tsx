import { Modal } from './ui';

export function PolicyText() {
  return <div className="policy">
    <h3>1. Assinatura da plataforma</h3>
    <p>O acesso é mensal, com cobrança recorrente de R$ 22,00 via PIX. A conta só é ativada após a confirmação do primeiro pagamento e é bloqueada em caso de atraso, sendo reativada com a quitação.</p>
    <h3>2. Cobrança online de boletos e PIX</h3>
    <p>A plataforma permite enviar boletos e PIX aos seus clientes. Os pagamentos são processados pelo Asaas e o repasse é feito pela plataforma ao usuário cadastrado, após a compensação.</p>
    <h3>3. Taxas</h3>
    <p>Sobre o valor total de cada boleto ou PIX cobrado do seu cliente incide uma taxa de <b>3%</b> da plataforma <b>mais a taxa cobrada pela API do Asaas</b> por transação. Essas taxas são descontadas do valor repassado.</p>
    <h3>4. Responsabilidades</h3>
    <p>Você é responsável pela veracidade dos dados informados, pela legitimidade das cobranças emitidas e pela relação comercial com seus clientes, incluindo contestações e estornos.</p>
    <h3>5. Cancelamento</h3>
    <p>Você pode cancelar a conta a qualquer momento. O cancelamento encerra a cobrança recorrente do PIX e bloqueia imediatamente o acesso. Valores já pagos não são reembolsados.</p>
    <h3>6. Dados e privacidade</h3>
    <p>Os dados cadastrados (clientes, vendas, lançamentos e cobranças) são armazenados para a operação do serviço e usados para enviar alertas e e-mails de vencimentos, confirmações e pagamentos, conforme a LGPD.</p>
  </div>;
}

export function PolicyModal({ close }: { close: () => void }) {
  return <Modal title="Política de uso e aceite" close={close}><PolicyText /><button className="primary full" onClick={close}>Fechar</button></Modal>;
}
