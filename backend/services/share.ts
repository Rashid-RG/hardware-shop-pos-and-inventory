import nodemailer from 'nodemailer';
import { SalesTransaction, InvoiceCopyType } from '../../src/types';

export const sendInvoiceEmail = async (
  to: string,
  subject: string,
  customMessage: string,
  pdfBuffer: Buffer,
  pdfFileName: string,
  activeShopName: string,
  tx: SalesTransaction,
  copyType: InvoiceCopyType
) => {
  const smtpHost = String(process.env.EMAIL_SMTP_HOST || '').trim();
  const smtpPort = Number(process.env.EMAIL_SMTP_PORT || 587);
  const smtpSecure = String(process.env.EMAIL_SMTP_SECURE || 'false').trim().toLowerCase() === 'true';
  const smtpUser = String(process.env.EMAIL_SMTP_USER || '').trim();
  const smtpPass = String(process.env.EMAIL_SMTP_PASS || '').trim();
  const fromEmail = String(process.env.EMAIL_FROM || smtpUser).trim();

  if (!smtpHost || !smtpPort || !smtpUser || !smtpPass || !fromEmail) {
    throw new Error('SMTP configuration is missing. Set EMAIL_SMTP_HOST, EMAIL_SMTP_PORT, EMAIL_SMTP_USER, EMAIL_SMTP_PASS, EMAIL_FROM.');
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  const htmlBody = `
    <div style="font-family:Segoe UI,Tahoma,sans-serif;color:#0f172a;">
      <h2 style="margin:0 0 8px;">${activeShopName}</h2>
      <p style="margin:0 0 10px;">Invoice <strong>${tx.invoiceNumber}</strong> (${copyType})</p>
      <p style="margin:0 0 6px;">Customer: ${tx.customerName}</p>
      <p style="margin:0 0 6px;">Date: ${new Date(tx.date).toLocaleString()}</p>
      <p style="margin:0 0 10px;">Total: Rs.${Number(tx.total).toFixed(2)}</p>
      <p style="margin:10px 0 0;">${customMessage || 'Please find the invoice attached.'}</p>
    </div>
  `;

  await transporter.sendMail({
    from: fromEmail,
    to,
    subject,
    html: htmlBody,
    attachments: [
      {
        filename: pdfFileName,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  });
};

export const sendInvoiceWhatsApp = async (
  to: string,
  pdfBuffer: Buffer,
  pdfFileName: string,
  caption: string
) => {
  const apiUrl = String(process.env.WHATSAPP_API_URL || '').trim();
  const mediaUploadUrl = String(process.env.WHATSAPP_MEDIA_UPLOAD_URL || '').trim();
  const token = String(process.env.WHATSAPP_TOKEN || '').trim();

  if (!apiUrl || !mediaUploadUrl || !token) {
    throw new Error('WhatsApp API configuration is missing. Set WHATSAPP_API_URL, WHATSAPP_MEDIA_UPLOAD_URL, and WHATSAPP_TOKEN.');
  }

  // Upload PDF to Meta API
  const formData = new FormData();
  formData.append('messaging_product', 'whatsapp');
  formData.append('type', 'application/pdf');
  formData.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), pdfFileName);

  const uploadResponse = await fetch(mediaUploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  const uploadPayload = await uploadResponse.json().catch(() => ({}));
  if (!uploadResponse.ok || !uploadPayload?.id) {
    throw new Error(uploadPayload?.error?.message || 'Failed to upload invoice PDF to WhatsApp media API');
  }

  // Send PDF document message
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'document',
      document: {
        id: uploadPayload.id,
        filename: pdfFileName,
        caption,
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || 'Failed to send WhatsApp message');
  }

  return payload;
};
