import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { processFileContent } = require('./ocr/document-ocr-service.js');

// Normalize varied date strings to YYYY-MM-DD
function normalizeDate(str) {
  if (!str) return null;
  const s = str.trim();

  // Already ISO: 2026-06-28
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const MONTHS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };

  // DD/MM/YYYY or DD-MM-YYYY
  let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }

  // DD-Mon-YYYY or DD Mon YYYY  (e.g. 28-Jun-2026, 2-Mar-26)
  m = s.match(/^(\d{1,2})[\s\-.]([A-Za-z]{3})[\s\-.](\d{2,4})$/);
  if (m) {
    const [, d, mon, yr] = m;
    const mo = MONTHS[mon.toLowerCase()];
    if (mo) {
      const y = yr.length === 2 ? (parseInt(yr) < 50 ? '20' : '19') + yr : yr;
      return `${y}-${String(mo).padStart(2,'0')}-${d.padStart(2,'0')}`;
    }
  }

  // DD Month YYYY (full month name)
  m = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (m) {
    const [, d, mon, y] = m;
    const mo = MONTHS[mon.toLowerCase().slice(0,3)];
    if (mo) return `${y}-${String(mo).padStart(2,'0')}-${d.padStart(2,'0')}`;
  }

  return null;
}

// Map the OCR pipeline's invoice output to the controller's expected shape
function mapToInvoiceFormat(parsed) {
  const seller = parsed.seller || {};
  const buyer = parsed.buyer || {};
  const details = parsed.invoice_details || {};
  const totals = parsed.totals || {};
  const items = (parsed.items || []).map(it => ({
    materialNumber: it.hsn_code || null,
    description:    it.description || '',
    invoiceQuantity: it.quantity || 0,
    invoicePrice:   it.unit_price || 0,
    uom:            it.unit || 'EA',
  }));

  return {
    invoiceNumber:     parsed.invoice_number || null,
    invoiceDate:       normalizeDate(details.invoice_date),
    poNumber:          parsed.purchase_order || null,
    vendorCode:        details.supplier_id || null,
    vendorName:        seller.name || null,
    vendorEmail:       null,
    buyerName:         buyer.name || null,
    buyerEmail:        null,
    currency:          totals.currency || 'INR',
    totalInvoiceValue: totals.grand_total || null,
    lineItems:         items,
  };
}

export const extractInvoiceData = async (filePath, mimeType) => {
  console.log(`[Extraction] Reading file: ${filePath}`);
  const fileBuffer = fs.readFileSync(filePath);

  const parsed = await processFileContent(fileBuffer, 'INVOICE');
  console.log(`[Extraction] OCR complete, invoice_number=${parsed.invoice_number}`);

  return mapToInvoiceFormat(parsed);
};
