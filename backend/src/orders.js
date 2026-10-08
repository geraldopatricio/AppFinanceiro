import { db, uid } from './db.js';
import { HttpError } from './asaas.js';

// Quita a venda e lança a receita; não duplica lançamento já vinculado ao pedido.
export function markSalePaid(userId, orderId, paidDate) {
    const order = db.prepare('SELECT * FROM sales_orders WHERE id = ? AND user_id = ?').get(orderId, userId);
    if (!order) throw new HttpError(404, 'Pedido não encontrado.');
    if (order.status === 'cancelled') throw new HttpError(400, 'Pedido cancelado não pode ser quitado.');
    if (order.status === 'received') return order;

    db.transaction(() => {
        db.prepare("UPDATE sales_orders SET status = 'received', paid_at = ? WHERE id = ?").run(paidDate, order.id);
        const linked = db.prepare('SELECT 1 FROM financial_transactions WHERE sales_order_id = ? AND user_id = ?').get(order.id, userId);
        if (!linked) {
            db.prepare(`INSERT INTO financial_transactions (id, user_id, type, description, amount, category, transaction_date, sales_order_id)
                  VALUES (?, ?, 'income', ?, ?, 'sales_order', ?, ?)`).run(uid(), userId, `Pedido de venda pago: ${order.description}`, order.amount, paidDate, order.id);
        }
    })();
    return db.prepare('SELECT * FROM sales_orders WHERE id = ?').get(order.id);
}
