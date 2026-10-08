const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const TONES = {
    ok: ['#dcfce7', '#166534'],
    warn: ['#fef3c7', '#92400e'],
    danger: ['#fee2e2', '#991b1b'],
    info: ['#dbeafe', '#1e40af'],
};

const card = (title, body) => `
  <tr><td style="padding:0 24px 16px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6ebe8;border-radius:12px;background:#ffffff">
      ${title ? `<tr><td style="padding:14px 18px;border-bottom:1px solid #e6ebe8;background:#f6f8f7;border-radius:12px 12px 0 0;font-size:15px;font-weight:700;color:#10231d">${esc(title)}</td></tr>` : ''}
      <tr><td style="padding:16px 18px;font-size:14px;color:#10231d;line-height:1.5">${body}</td></tr>
    </table>
  </td></tr>`;

const rowsHtml = (rows) => rows.map(([label, value]) => `
  <div style="margin-bottom:12px">
    <div style="font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#74817c">${esc(label)}</div>
    <div style="font-size:15px;font-weight:600;color:#10231d;word-break:break-word">${esc(value)}</div>
  </div>`).join('');

const tableHtml = ({ head, rows }) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px">
    <tr>${head.map((h) => `<td style="padding:8px 6px;background:#f6f8f7;font-weight:700;color:#10231d">${esc(h)}</td>`).join('')}</tr>
    ${rows.map((r) => `<tr>${r.map((c) => `<td style="padding:8px 6px;border-bottom:1px solid #e6ebe8">${esc(c)}</td>`).join('')}</tr>`).join('')}
  </table>`;

/**
 * sections: { title?, rows?: [[label,value]], table?: {head,rows}, text?, code?, button?: {label,url} }
 * badge: { label, tone: ok|warn|danger|info }
 */
export function renderEmail({ title, subtitle = 'Sistema financeiro', sections = [], badge, note }) {
    const body = sections.map((s) => {
        let html = '';
        if (s.rows?.length) html += rowsHtml(s.rows);
        if (s.table) html += tableHtml(s.table);
        if (s.text) html += `<p style="margin:0 0 8px;color:#47544f">${esc(s.text).replace(/\n/g, '<br>')}</p>`;
        if (s.code) html += `<div style="margin-top:8px;padding:12px;background:#f6f8f7;border:1px dashed #1f8f68;border-radius:8px;font-family:Consolas,monospace;font-size:12px;word-break:break-all">${esc(s.code)}</div>`;
        if (s.button) html += `<div style="margin-top:14px"><a href="${esc(s.button.url)}" style="display:inline-block;background:#1f8f68;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px">${esc(s.button.label)}</a></div>`;
        return card(s.title, html);
    }).join('');

    let badgeHtml = '';
    if (badge) {
        const [bg, fg] = TONES[badge.tone] || TONES.info;
        badgeHtml = card('Status', `<span style="display:inline-block;padding:5px 14px;border-radius:999px;background:${bg};color:${fg};font-size:12px;font-weight:700;letter-spacing:.03em">${esc(badge.label)}</span>${note ? `<p style="margin:10px 0 0;color:#74817c">${esc(note)}</p>` : ''}`);
    }

    const generated = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    return `<!doctype html><html><body style="margin:0;padding:24px 12px;background:#eef2f0;font-family:'Segoe UI',Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#f6f8f7;border:1px solid #e6ebe8;border-radius:20px;overflow:hidden">
      <tr><td align="center" style="padding:30px 24px;background:#1f8f68;background-image:linear-gradient(135deg,#27a97c,#177a58);color:#ffffff">
        <div style="font-size:24px;font-weight:700">${esc(title)}</div>
        <div style="margin-top:8px;font-size:13px;opacity:.9">${esc(subtitle)}</div>
      </td></tr>
      <tr><td style="height:24px"></td></tr>
      ${body}${badgeHtml}
      <tr><td align="center" style="padding:16px 24px 24px;border-top:1px solid #e6ebe8;font-size:12px;color:#74817c">
        Este é um e-mail automático do App Financeiro.<br><span style="font-size:11px">Gerado em ${esc(generated)}</span>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}
