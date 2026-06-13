// src/mailer.js
// Envio de e-mail plugável. Com SMTP configurado, envia de verdade.
// Sem SMTP (dev), apenas registra o link no console e o devolve para teste.

import nodemailer from 'nodemailer';

const FROM = process.env.MAIL_FROM || 'Távola RPG <no-reply@tavola.local>';
let transport = null;
let mode = 'dev';

if (process.env.SMTP_HOST) {
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: (process.env.SMTP_USER && process.env.SMTP_PASS)
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  mode = 'smtp';
}

export function mailerMode() { return mode; }

export async function sendConfirmationEmail(to, name, url) {
  const subject = 'Confirme seu e-mail — Távola RPG';
  const text =
`Olá, ${name}!

Bem-vindo(a) à Távola. Confirme seu e-mail para ativar sua conta:
${url}

Se você não criou esta conta, ignore esta mensagem.
— Távola RPG`;

  const html = `
  <div style="font-family:Georgia,serif;max-width:520px;margin:auto;background:#ede0c4;color:#2b2017;border-radius:8px;overflow:hidden;border:1px solid #c9b486">
    <div style="background:#2a2016;color:#e8c860;padding:18px 24px;font-size:22px;letter-spacing:.06em">🐉 Távola RPG</div>
    <div style="padding:24px">
      <h2 style="color:#6e201d;margin:0 0 12px">Olá, ${escapeHtml(name)}!</h2>
      <p>Bem-vindo(a) à Távola. Clique abaixo para confirmar seu e-mail e ativar sua conta:</p>
      <p style="text-align:center;margin:24px 0">
        <a href="${escapeHtml(url)}" style="background:#8a2e2a;color:#f5e6c8;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold">Confirmar e-mail</a>
      </p>
      <p style="font-size:13px;color:#8a755a">Se o botão não funcionar, copie e cole este link no navegador:<br>${escapeHtml(url)}</p>
      <p style="font-size:13px;color:#8a755a">Se você não criou esta conta, ignore esta mensagem.</p>
    </div>
  </div>`;

  if (mode === 'smtp') {
    await transport.sendMail({ from: FROM, to, subject, text, html });
    return { sent: true };
  }
  console.log(`\n[MAILER · dev] Confirmação de e-mail para ${to}:\n  ${url}\n`);
  return { sent: false, devUrl: url };
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
