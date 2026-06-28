import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: false,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    tls: { rejectUnauthorized: false }
  });
};

const emailTemplates = {
  invoiceRejected: (data) => ({
    subject: `Invoice Rejected - PO ${data.poNumber} | Quantity Mismatch`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8f9fa; padding: 20px;">
        <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 22px;">Invoice Exception Notice</h1>
          <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0;">Inbound Receipt Exception Handler</p>
        </div>
        <div style="background: white; padding: 24px; border-radius: 0 0 12px 12px;">
          <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
            <h2 style="color: #dc2626; margin: 0 0 8px;">⚠️ Invoice Rejected</h2>
            <p style="color: #7f1d1d; margin: 0;">Invoice quantity exceeds the Purchase Order quantity.</p>
          </div>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
            <tr style="background: #f1f5f9;">
              <td style="padding: 10px; font-weight: bold; border: 1px solid #e2e8f0;">PO Number</td>
              <td style="padding: 10px; border: 1px solid #e2e8f0;">${data.poNumber}</td>
            </tr>
            <tr>
              <td style="padding: 10px; font-weight: bold; border: 1px solid #e2e8f0;">Invoice Number</td>
              <td style="padding: 10px; border: 1px solid #e2e8f0;">${data.invoiceNumber}</td>
            </tr>
            <tr style="background: #f1f5f9;">
              <td style="padding: 10px; font-weight: bold; border: 1px solid #e2e8f0;">Vendor</td>
              <td style="padding: 10px; border: 1px solid #e2e8f0;">${data.vendorName}</td>
            </tr>
            <tr>
              <td style="padding: 10px; font-weight: bold; border: 1px solid #e2e8f0;">PO Quantity</td>
              <td style="padding: 10px; border: 1px solid #e2e8f0; color: #16a34a;">${data.poQuantity}</td>
            </tr>
            <tr style="background: #f1f5f9;">
              <td style="padding: 10px; font-weight: bold; border: 1px solid #e2e8f0;">Invoice Quantity</td>
              <td style="padding: 10px; border: 1px solid #e2e8f0; color: #dc2626;">${data.invoiceQuantity}</td>
            </tr>
          </table>
          <p style="color: #64748b; font-size: 13px;">Valid quantity (${data.poQuantity} units) has been moved to quality inspection. Please resubmit a corrected invoice.</p>
          <div style="background: #f8fafc; padding: 12px; border-radius: 6px; margin-top: 16px;">
            <p style="margin: 0; color: #475569; font-size: 12px;">This is an automated notification from the Invoice Receipt Exception Handler system.</p>
          </div>
        </div>
      </div>`
  }),

  approvalRequired: (data) => ({
    subject: `Approval Required - Invoice ${data.invoiceNumber} | PO ${data.poNumber}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 22px;">Approval Required</h1>
        </div>
        <div style="background: white; padding: 24px; border-radius: 0 0 12px 12px;">
          <p>Dear ${data.approverName},</p>
          <p>Your approval is required for the following invoice:</p>
          <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
            <tr style="background: #f1f5f9;"><td style="padding: 10px; border: 1px solid #e2e8f0; font-weight: bold;">Invoice</td><td style="padding: 10px; border: 1px solid #e2e8f0;">${data.invoiceNumber}</td></tr>
            <tr><td style="padding: 10px; border: 1px solid #e2e8f0; font-weight: bold;">PO Number</td><td style="padding: 10px; border: 1px solid #e2e8f0;">${data.poNumber}</td></tr>
            <tr style="background: #f1f5f9;"><td style="padding: 10px; border: 1px solid #e2e8f0; font-weight: bold;">Action Required</td><td style="padding: 10px; border: 1px solid #e2e8f0;">${data.actionRequired}</td></tr>
          </table>
          <div style="text-align: center; margin: 24px 0;">
            <a href="${data.approvalLink}" style="background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: bold;">Review & Approve</a>
          </div>
        </div>
      </div>`
  }),

  shortQtyNotification: (data) => ({
    subject: `Short Quantity Received - PO ${data.poNumber} | Partial Delivery`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8f9fa; padding: 20px;">
        <div style="background: linear-gradient(135deg, #f59e0b, #d97706); padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 22px;">Partial Delivery Notice</h1>
          <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0;">Inbound Receipt Exception Handler</p>
        </div>
        <div style="background: white; padding: 24px; border-radius: 0 0 12px 12px;">
          <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
            <h2 style="color: #b45309; margin: 0 0 8px;">⚠️ Invoice Quantity Below PO Quantity</h2>
            <p style="color: #92400e; margin: 0;">The received quantity is less than the Purchase Order quantity.</p>
          </div>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
            <tr style="background: #f1f5f9;"><td style="padding: 10px; font-weight: bold; border: 1px solid #e2e8f0;">PO Number</td><td style="padding: 10px; border: 1px solid #e2e8f0;">${data.poNumber}</td></tr>
            <tr><td style="padding: 10px; font-weight: bold; border: 1px solid #e2e8f0;">Invoice Number</td><td style="padding: 10px; border: 1px solid #e2e8f0;">${data.invoiceNumber}</td></tr>
            <tr style="background: #f1f5f9;"><td style="padding: 10px; font-weight: bold; border: 1px solid #e2e8f0;">Vendor</td><td style="padding: 10px; border: 1px solid #e2e8f0;">${data.vendorName}</td></tr>
            <tr><td style="padding: 10px; font-weight: bold; border: 1px solid #e2e8f0;">PO Quantity</td><td style="padding: 10px; border: 1px solid #e2e8f0; color: #16a34a;">${data.poQuantity} ${data.uom || ''}</td></tr>
            <tr style="background: #f1f5f9;"><td style="padding: 10px; font-weight: bold; border: 1px solid #e2e8f0;">Received Quantity</td><td style="padding: 10px; border: 1px solid #e2e8f0; color: #d97706;">${data.invoiceQuantity} ${data.uom || ''}</td></tr>
            <tr><td style="padding: 10px; font-weight: bold; border: 1px solid #e2e8f0;">Short Quantity</td><td style="padding: 10px; border: 1px solid #e2e8f0; color: #dc2626;">${data.shortQty} ${data.uom || ''}</td></tr>
          </table>
          <p style="color: #64748b; font-size: 13px;">The received quantity (${data.invoiceQuantity} units) has been moved to quality inspection. The remaining PO quantity (${data.shortQty} units) remains open. Approval is required to proceed with GRN posting for the received quantity.</p>
          <div style="background: #f8fafc; padding: 12px; border-radius: 6px; margin-top: 16px;">
            <p style="margin: 0; color: #475569; font-size: 12px;">This is an automated notification from the Invoice Receipt Exception Handler system.</p>
          </div>
        </div>
      </div>`
  }),

  creditMemoRequest: (data) => ({
    subject: `Credit Memo Request - PO ${data.poNumber} | Quality Rejection`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8f9fa; padding: 20px;">
        <div style="background: linear-gradient(135deg, #ef4444, #dc2626); padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 22px;">Credit Memo Request</h1>
          <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0;">Quality Rejection — Buyer Approval Required</p>
        </div>
        <div style="background: white; padding: 24px; border-radius: 0 0 12px 12px;">
          <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
            <h2 style="color: #dc2626; margin: 0 0 8px;">🔴 Partial Quality Rejection</h2>
            <p style="color: #7f1d1d; margin: 0;">A credit memo request has been created for rejected goods.</p>
          </div>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
            <tr style="background: #f1f5f9;"><td style="padding: 10px; font-weight: bold; border: 1px solid #e2e8f0;">PO Number</td><td style="padding: 10px; border: 1px solid #e2e8f0;">${data.poNumber}</td></tr>
            <tr><td style="padding: 10px; font-weight: bold; border: 1px solid #e2e8f0;">GRN Number</td><td style="padding: 10px; border: 1px solid #e2e8f0;">${data.grnNumber}</td></tr>
            <tr style="background: #f1f5f9;"><td style="padding: 10px; font-weight: bold; border: 1px solid #e2e8f0;">Total Received</td><td style="padding: 10px; border: 1px solid #e2e8f0;">${data.totalQty}</td></tr>
            <tr><td style="padding: 10px; font-weight: bold; border: 1px solid #e2e8f0;">Accepted Quantity</td><td style="padding: 10px; border: 1px solid #e2e8f0; color: #16a34a;">${data.acceptedQty}</td></tr>
            <tr style="background: #fef2f2;"><td style="padding: 10px; font-weight: bold; border: 1px solid #fecaca;">Rejected Quantity</td><td style="padding: 10px; border: 1px solid #fecaca; color: #dc2626;">${data.rejectedQty}</td></tr>
            <tr><td style="padding: 10px; font-weight: bold; border: 1px solid #e2e8f0;">Rejection Reason</td><td style="padding: 10px; border: 1px solid #e2e8f0;">${data.rejectionReason}</td></tr>
            <tr style="background: #f1f5f9;"><td style="padding: 10px; font-weight: bold; border: 1px solid #e2e8f0;">Credit Memo Ref</td><td style="padding: 10px; border: 1px solid #e2e8f0; font-family: monospace;">${data.creditMemoNumber}</td></tr>
          </table>
          <p style="color: #64748b; font-size: 13px;">Please review and approve the credit memo request. Once approved, it will be forwarded to the vendor for credit note issuance.</p>
          <div style="background: #f8fafc; padding: 12px; border-radius: 6px; margin-top: 16px;">
            <p style="margin: 0; color: #475569; font-size: 12px;">This is an automated notification from the Invoice Receipt Exception Handler system.</p>
          </div>
        </div>
      </div>`
  }),

  approvalReminder: (data) => ({
    subject: `Reminder: Pending Approval - Invoice ${data.invoiceNumber} | Due in ${data.dueIn}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8f9fa; padding: 20px;">
        <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 22px;">⏰ Approval Reminder</h1>
          <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0;">Action required — pending since ${data.since}</p>
        </div>
        <div style="background: white; padding: 24px; border-radius: 0 0 12px 12px;">
          <p>Dear ${data.approverName || 'Approver'},</p>
          <p>This is a reminder that the following approval is still pending and requires your immediate attention:</p>
          <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
            <tr style="background: #f1f5f9;"><td style="padding: 10px; border: 1px solid #e2e8f0; font-weight: bold;">Invoice</td><td style="padding: 10px; border: 1px solid #e2e8f0;">${data.invoiceNumber}</td></tr>
            <tr><td style="padding: 10px; border: 1px solid #e2e8f0; font-weight: bold;">PO Number</td><td style="padding: 10px; border: 1px solid #e2e8f0;">${data.poNumber}</td></tr>
            <tr style="background: #f1f5f9;"><td style="padding: 10px; border: 1px solid #e2e8f0; font-weight: bold;">Vendor</td><td style="padding: 10px; border: 1px solid #e2e8f0;">${data.vendorName}</td></tr>
            <tr><td style="padding: 10px; border: 1px solid #e2e8f0; font-weight: bold;">Action Required</td><td style="padding: 10px; border: 1px solid #e2e8f0; color: #dc2626;">${data.actionRequired}</td></tr>
            <tr style="background: #fef2f2;"><td style="padding: 10px; border: 1px solid #fecaca; font-weight: bold;">Due</td><td style="padding: 10px; border: 1px solid #fecaca; color: #dc2626; font-weight: bold;">${data.dueIn}</td></tr>
          </table>
          <p style="color: #64748b; font-size: 13px;">Please log in to the Invoice Receipt Exception Handler to complete this approval.</p>
        </div>
      </div>`
  }),

  grnIRPosted: (data) => ({
    subject: `GRN & IR Posted Successfully - PO ${data.poNumber}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #10b981, #059669); padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 22px;">✅ Documents Posted Successfully</h1>
        </div>
        <div style="background: white; padding: 24px; border-radius: 0 0 12px 12px;">
          <p>The following SAP documents have been posted:</p>
          <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
            <tr style="background: #f0fdf4;"><td style="padding: 10px; border: 1px solid #bbf7d0; font-weight: bold;">GRN Number</td><td style="padding: 10px; border: 1px solid #bbf7d0;">${data.grnNumber}</td></tr>
            <tr><td style="padding: 10px; border: 1px solid #e2e8f0; font-weight: bold;">IR Number</td><td style="padding: 10px; border: 1px solid #e2e8f0;">${data.irNumber}</td></tr>
            <tr style="background: #f0fdf4;"><td style="padding: 10px; border: 1px solid #bbf7d0; font-weight: bold;">PO Number</td><td style="padding: 10px; border: 1px solid #bbf7d0;">${data.poNumber}</td></tr>
            <tr><td style="padding: 10px; border: 1px solid #e2e8f0; font-weight: bold;">Quantity</td><td style="padding: 10px; border: 1px solid #e2e8f0;">${data.quantity} ${data.uom}</td></tr>
          </table>
        </div>
      </div>`
  })
};

export const sendEmail = async (to, templateName, data) => {
  try {
    const transporter = createTransporter();
    const template = emailTemplates[templateName]?.(data);
    if (!template) throw new Error(`Email template '${templateName}' not found`);

    await transporter.sendMail({
      from: process.env.EMAIL_FROM || 'Invoice Handler <noreply@invoicehandler.com>',
      to,
      subject: template.subject,
      html: template.html
    });

    console.log(`✅ Email sent to ${to}: ${template.subject}`);
    return { success: true };
  } catch (error) {
    console.error(`❌ Email send failed: ${error.message}`);
    return { success: false, error: error.message };
  }
};

export default { sendEmail };
