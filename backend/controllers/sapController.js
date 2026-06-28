import Invoice from '../models/Invoice.js';
import GRNDocument from '../models/GRNDocument.js';
import VendorHistory from '../models/VendorHistory.js';
import { fetchPOFromSAP, postGRNToSAP, postIRToSAP, postCreditMemoToSAP } from '../services/sapService.js';
import { sendEmail } from '../services/emailService.js';
import { v4 as uuidv4 } from 'uuid';

export const fetchPODetails = async (req, res) => {
  try {
    const { poNumber } = req.params;
    const result = await fetchPOFromSAP(poNumber);
    res.json({ success: true, data: result.data, isMock: result.isMock || false });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const postGRN = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.invoiceId);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found.' });

    if (!['approved', 'validated'].includes(invoice.status)) {
      return res.status(400).json({ success: false, message: 'Invoice must be approved before posting GRN.' });
    }

    const { quantity, uom, lineItem } = req.body;
    const grnQuantity = quantity || invoice.lineItems[0]?.acceptedQuantity || invoice.lineItems[0]?.invoiceQuantity;

    const sapResult = await postGRNToSAP({
      poNumber: invoice.poNumber,
      materialNumber: invoice.lineItems[0]?.materialNumber || 'MAT-001',
      plant: invoice.plant || '1000',
      storageLocation: invoice.lineItems[0]?.storageLocation || '0001',
      quantity: grnQuantity,
      uom: uom || invoice.lineItems[0]?.uom || 'EA',
      lineItem: lineItem || invoice.lineItems[0]?.lineItem || '00010',
      invoiceDate: invoice.invoiceDate
    });

    const grnPostingDate = invoice.invoiceDate ? new Date(invoice.invoiceDate) : new Date();
    const grnDoc = await GRNDocument.create({
      invoice: invoice._id,
      grnNumber: sapResult.documentNumber,
      poNumber: invoice.poNumber,
      vendorCode: invoice.vendorCode,
      vendorName: invoice.vendorName,
      postingDate: grnPostingDate,
      documentDate: grnPostingDate,
      plant: invoice.plant || '1000',
      storageLocation: invoice.lineItems[0]?.storageLocation || '0001',
      quantity: grnQuantity,
      uom: uom || 'EA',
      materialNumber: invoice.lineItems[0]?.materialNumber || 'MAT-001',
      poLineItem: lineItem || '00010',
      postedBy: req.user._id,
      sapStatus: sapResult.isMock ? 'mock' : 'posted',
      sapResponse: sapResult
    });

    invoice.grnDocumentNumber = sapResult.documentNumber;
    invoice.grnPostingDate = new Date();
    invoice.status = 'grn_posted';
    invoice.stockStatus = 'quality_stock';
    await invoice.save();

    res.json({
      success: true,
      message: `GRN ${sapResult.documentNumber} posted successfully${sapResult.isMock ? ' (Demo Mode)' : ''}.`,
      grnDocument: grnDoc,
      grnNumber: sapResult.documentNumber
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const postIR = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.invoiceId);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found.' });

    if (invoice.status !== 'grn_posted') {
      return res.status(400).json({ success: false, message: 'GRN must be posted before posting IR.' });
    }

    const sapResult = await postIRToSAP({
      grnNumber: invoice.grnDocumentNumber,
      poNumber: invoice.poNumber,
      amount: invoice.totalInvoiceValue,
      currency: invoice.currency || 'INR',
      companyCode: invoice.companyCode || '1000',
      lineItem: invoice.lineItems[0]?.lineItem || '00010',
      plant: invoice.plant || invoice.lineItems[0]?.plant || '1000',
      quantity: invoice.lineItems[0]?.acceptedQuantity || invoice.lineItems[0]?.invoiceQuantity || 1,
      invoiceDate: invoice.invoiceDate
    });

    const irPostingDate = invoice.invoiceDate ? new Date(invoice.invoiceDate) : new Date();
    const grnDoc = await GRNDocument.findOne({ invoice: invoice._id });
    if (grnDoc) {
      grnDoc.irDocument = {
        irNumber: sapResult.documentNumber,
        irPostingDate: irPostingDate,
        amount: invoice.totalInvoiceValue,
        currency: invoice.currency || 'USD',
        sapStatus: sapResult.isMock ? 'mock' : 'posted'
      };
      await grnDoc.save();
    }

    invoice.irDocumentNumber = sapResult.documentNumber;
    invoice.irPostingDate = irPostingDate;
    invoice.status = 'ir_posted';
    invoice.completedAt = new Date();
    await invoice.save();

    // Update vendor history
    await updateVendorMetrics(invoice);

    // Send success notification
    if (invoice.buyerEmail) {
      await sendEmail(invoice.buyerEmail, 'grnIRPosted', {
        grnNumber: invoice.grnDocumentNumber,
        irNumber: sapResult.documentNumber,
        poNumber: invoice.poNumber,
        quantity: invoice.lineItems[0]?.invoiceQuantity,
        uom: invoice.lineItems[0]?.uom || 'EA'
      });
    }

    res.json({
      success: true,
      message: `IR ${sapResult.documentNumber} posted successfully${sapResult.isMock ? ' (Demo Mode)' : ''}.`,
      irNumber: sapResult.documentNumber,
      grnNumber: invoice.grnDocumentNumber
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const postCreditMemo = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.invoiceId);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found.' });

    const { rejectedQuantity, rejectionReason } = req.body;
    const sapResult = await postCreditMemoToSAP({
      poNumber: invoice.poNumber,
      grnNumber: invoice.grnDocumentNumber,
      quantity: rejectedQuantity,
      reason: rejectionReason,
      amount: invoice.totalInvoiceValue,
      currency: invoice.currency || 'INR',
      companyCode: invoice.companyCode || '1000',
      lineItem: invoice.lineItems[0]?.lineItem || '00010',
      plant: invoice.plant || invoice.lineItems[0]?.plant || '1000',
      invoiceDate: invoice.invoiceDate
    });

    invoice.creditMemoNumber = sapResult.documentNumber;
    invoice.creditMemoStatus = 'pending_buyer';
    await invoice.save();

    res.json({
      success: true,
      message: `Credit memo request ${sapResult.documentNumber} created. Awaiting buyer approval.`,
      creditMemoNumber: sapResult.documentNumber
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateVendorMetrics = async (invoice) => {
  try {
    let vendor = await VendorHistory.findOne({ vendorCode: invoice.vendorCode });
    if (!vendor) {
      vendor = new VendorHistory({ vendorCode: invoice.vendorCode, vendorName: invoice.vendorName, vendorEmail: invoice.vendorEmail });
    }

    vendor.metrics.totalInvoicesProcessed += 1;
    if (invoice.validationStatus === 'matched') vendor.metrics.totalInvoicesMatched += 1;
    if (invoice.exceptionType === 'qty_greater' || invoice.exceptionType === 'qty_lesser') vendor.metrics.quantityMismatchCases += 1;
    if (invoice.exceptionType === 'price_higher' || invoice.exceptionType === 'price_lower') vendor.metrics.priceMismatchCases += 1;
    if (invoice.exceptionType === 'quality_rejection') vendor.metrics.qualityRejectionCases += 1;
    if (invoice.exceptionType === 'partial_quality') vendor.metrics.partialRejectionCases += 1;

    const total = vendor.metrics.totalInvoicesProcessed;
    vendor.metrics.firstTimeRightPercentage = Math.round((vendor.metrics.totalInvoicesMatched / total) * 100);
    vendor.metrics.totalValueProcessed += invoice.totalInvoiceValue || 0;
    vendor.lastTransactionDate = new Date();

    vendor.calculateRiskScore();
    await vendor.save();
  } catch (err) {
    console.error('Vendor metrics update failed:', err.message);
  }
};
