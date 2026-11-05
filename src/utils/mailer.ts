import nodemailer from 'nodemailer';
import { env } from '../config/env';

const transport = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    })
  : null;

/** Returns true if actually sent. Without SMTP (dev) the message is logged. */
export async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  if (!transport) {
    console.log(`\n[mail:dev] To: ${to}\nSubject: ${subject}\n${text}\n`);
    return false;
  }
  try {
    await transport.sendMail({ from: env.MAIL_FROM, to, subject, text });
    return true;
  } catch (err) {
    console.error('Mail delivery failed:', err);
    return false;
  }
}
