import nodemailer, { Transporter } from 'nodemailer';

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export class EmailService {
  private static transporter: Transporter | null = null;

  private static getTransporter(): Transporter | null {
    if (this.transporter) return this.transporter;

    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const secure = process.env.SMTP_SECURE === 'true' || port === 465;

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass },
      });
      return this.transporter;
    }
    return null;
  }

  public static async sendEmail(options: SendEmailOptions): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const from = process.env.SMTP_FROM || process.env.EMAIL_FROM || '"SyncPay BD" <noreply@syncpaybd.site>';

    // 1. If Resend API Key is provided, use Resend HTTP API
    const resendApiKey = process.env.RESEND_API_KEY;
    if (resendApiKey) {
      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from,
            to: [options.to],
            subject: options.subject,
            html: options.html,
            text: options.text,
          }),
        });
        const data = await response.json() as any;
        if (response.ok) {
          console.log(`[EmailService] Resend email sent to ${options.to}: ID ${data.id}`);
          return { success: true, messageId: data.id };
        } else {
          console.warn(`[EmailService] Resend API error:`, data);
        }
      } catch (err: any) {
        console.warn(`[EmailService] Resend fetch error:`, err?.message);
      }
    }

    // 2. If SMTP is configured, use nodemailer
    const transporter = this.getTransporter();
    if (transporter) {
      try {
        const info = await transporter.sendMail({
          from,
          to: options.to,
          subject: options.subject,
          html: options.html,
          text: options.text || options.html.replace(/<[^>]*>?/gm, ''),
        });
        console.log(`[EmailService] SMTP email sent to ${options.to}: ID ${info.messageId}`);
        return { success: true, messageId: info.messageId };
      } catch (err: any) {
        console.warn(`[EmailService] SMTP send error:`, err?.message);
        return { success: false, error: err?.message };
      }
    }

    // 3. Fallback / Dev Log: Log to console so emails can be inspected even without SMTP configured
    console.log(`\n================== [OUTGOING EMAIL DISPATCH] ==================`);
    console.log(`To:      ${options.to}`);
    console.log(`Subject: ${options.subject}`);
    console.log(`Notice:  Configure SMTP_HOST, SMTP_USER, SMTP_PASS or RESEND_API_KEY in .env for live mail delivery.`);
    console.log(`===============================================================\n`);

    return { success: true, messageId: 'simulated_dev_id' };
  }

  public static async sendMerchantWelcomeEmail(params: {
    to: string;
    businessName: string;
    merchantName: string;
    apiKey: string;
    loginUrl?: string;
  }) {
    const loginUrl = params.loginUrl || 'https://syncpaybd.site/dashboard';
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Welcome to SyncPay BD</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
        .card { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.06); }
        .header { background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%); padding: 32px 24px; text-align: center; color: #ffffff; }
        .header h1 { margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.5px; }
        .content { padding: 32px 28px; }
        .badge { display: inline-block; background: #e0f2fe; color: #0284c7; font-weight: 700; font-size: 12px; padding: 4px 10px; border-radius: 9999px; margin-bottom: 16px; }
        .box { background: #f1f5f9; border-radius: 8px; border: 1px dashed #cbd5e1; padding: 16px; margin: 20px 0; font-family: monospace; font-size: 13px; word-break: break-all; color: #0f172a; }
        .btn { display: inline-block; background: #0284c7; color: #ffffff !important; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 700; font-size: 14px; margin-top: 12px; }
        .footer { background: #f8fafc; padding: 20px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <h1>SyncPay BD</h1>
          <p style="margin: 6px 0 0 0; opacity: 0.9; font-size: 14px;">Next-Gen Mobile Financial Services Gateway</p>
        </div>
        <div class="content">
          <span class="badge">Account Verified</span>
          <h2 style="margin-top: 0; font-size: 20px;">Welcome, ${params.businessName}! 🎉</h2>
          <p>Your merchant account has been registered successfully on SyncPay BD. You can now access your merchant dashboard, connect your Android forwarder app, and automate bKash, Nagad, Rocket, and Upay payments.</p>
          
          <h3 style="font-size: 15px; margin-bottom: 6px;">Your Live API Secret Key:</h3>
          <div class="box">${params.apiKey}</div>
          <p style="font-size: 12px; color: #64748b; margin-top: -12px;">Keep this key confidential. You will need it to integrate your WooCommerce or custom website.</p>

          <div style="text-align: center; margin: 28px 0;">
            <a href="${loginUrl}" class="btn">Go to Merchant Dashboard →</a>
          </div>

          <p style="font-size: 13px; color: #475569;">If you did not create this account, please contact our support team immediately.</p>
        </div>
        <div class="footer">
          © ${new Date().getFullYear()} SyncPay BD. All rights reserved. Automated Payment Engine.
        </div>
      </div>
    </body>
    </html>
    `;

    return this.sendEmail({
      to: params.to,
      subject: `Welcome to SyncPay BD - ${params.businessName} Account Active`,
      html,
    });
  }

  public static async sendPlanApprovalEmail(params: {
    to: string;
    businessName: string;
    plan: string;
    status: string;
    paymentNote?: string;
  }) {
    const isFree = params.plan === 'FREE';
    const isReqPay = params.status === 'PAYMENT_REQUIRED';

    const title = isFree 
      ? 'Free Plan Approved! 🎉' 
      : (isReqPay ? 'Action Required: Payment Verification' : `Plan Updated to ${params.plan}`);

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>${title}</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
        .card { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.06); }
        .header { background: ${isReqPay ? 'linear-gradient(135deg, #d97706 0%, #b45309 100%)' : 'linear-gradient(135deg, #059669 0%, #047857 100%)'}; padding: 32px 24px; text-align: center; color: #ffffff; }
        .header h1 { margin: 0; font-size: 24px; font-weight: 800; }
        .content { padding: 32px 28px; }
        .notice-box { background: ${isReqPay ? '#fffbeb' : '#f0fdf4'}; border: 1px solid ${isReqPay ? '#fcd34d' : '#86efac'}; border-radius: 8px; padding: 18px; margin: 20px 0; }
        .btn { display: inline-block; background: ${isReqPay ? '#d97706' : '#059669'}; color: #ffffff !important; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 700; font-size: 14px; margin-top: 12px; }
        .footer { background: #f8fafc; padding: 20px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <h1>SyncPay BD</h1>
          <p style="margin: 6px 0 0 0; opacity: 0.9; font-size: 14px;">Administrative Account Notification</p>
        </div>
        <div class="content">
          <h2 style="margin-top: 0; font-size: 20px;">Dear ${params.businessName},</h2>
          
          <div class="notice-box">
            <h3 style="margin: 0 0 8px 0; color: ${isReqPay ? '#92400e' : '#166534'};">${title}</h3>
            <p style="margin: 0; font-size: 14px; color: ${isReqPay ? '#78350f' : '#14532d'};">
              ${isFree 
                ? 'Your account has been granted lifetime access to the SyncPay BD Free Tier by the administrator. You can now use payment automation with zero platform commission.' 
                : (isReqPay 
                    ? 'The administrator has requested payment to activate/renew your subscription features.' 
                    : `Your subscription tier has been set to ${params.plan}.`)}
            </p>
            ${params.paymentNote ? `<div style="margin-top:12px; padding-top:12px; border-top:1px dashed #cbd5e1; font-weight:600; font-size:13px;">Admin Instructions: ${params.paymentNote}</div>` : ''}
          </div>

          <div style="text-align: center; margin: 28px 0;">
            <a href="https://syncpaybd.site/dashboard" class="btn">Open Merchant Dashboard →</a>
          </div>
        </div>
        <div class="footer">
          © ${new Date().getFullYear()} SyncPay BD. Automated Payment Gateway Engine.
        </div>
      </div>
    </body>
    </html>
    `;

    return this.sendEmail({
      to: params.to,
      subject: `[SyncPay BD] ${title} - ${params.businessName}`,
      html,
    });
  }
}
