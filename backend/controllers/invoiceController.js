import fs from 'fs';
import Invoice from '../models/Invoice.js';
import VendorHistory from '../models/VendorHistory.js';
import Approval from '../models/Approval.js';
import { extractInvoiceData } from '../services/extractionService.js';
import { fetchPOFromSAP } from '../services/sapService.js';
import {
  invoiceReadingAgent,
  poValidationAgent,
  exceptionClassificationAgent,
  decisionRecommendationAgent,
  routingAgent,
  vendorHistoryAgent,
  followUpAgent
} from '../services/aiAgentService.js';
import { sendEmail } from '../services/emailService.js';
import { v4 as uuidv4 } from 'uuid';

export const uploadInvoice = async (req, res) => {
  try {
    const {
      poNumber, invoiceNumber, invoiceDate, vendorCode, vendorName, vendorEmail,
      buyerEmail, buyerName, totalInvoiceValue, lineItems, currency
    } = req.body;

    const parsedLineItems = typeof lineItems === 'string' ? JSON.parse(lineItems) : lineItems;

    const invoice = await Invoice.create({
      invoiceNumber: invoiceNumber || `INV-${uuidv4().substring(0, 8).toUpperCase()}`,
      invoiceDate: invoiceDate || new Date(),
      uploadedBy: req.user._id,
      fileName: req.file?.originalname,
      filePath: req.file?.path,
      fileType: req.file?.mimetype,
      poNumber,
      vendorCode,
      vendorName,
      vendorEmail,
      buyerEmail,
      buyerName,
      totalInvoiceValue: parseFloat(totalInvoiceValue) || 0,
      currency: currency || 'USD',
      lineItems: parsedLineItems,
      status: 'uploaded',
      processingStartedAt: new Date()
    });

    res.status(201).json({
      success: true,
      message: 'Invoice uploaded successfully. Starting AI processing...',
      invoice
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const processInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found.' });

    invoice.status = 'processing';
    await invoice.save();

    // Agent 1: Invoice Reading Agent
    const readingResult = await invoiceReadingAgent(invoice, invoice.fileName);
    invoice.aiAnalysis.invoiceReadingAgent = { status: 'completed', result: readingResult, completedAt: new Date() };

    // Fetch SAP PO Data
    const sapResult = await fetchPOFromSAP(invoice.poNumber);
    const sapPOData = sapResult.data;

    const sapItems = Array.isArray(sapPOData?.to_PurchaseOrderItem?.results)
      ? sapPOData.to_PurchaseOrderItem.results
      : [];

    if (sapItems.length > 0) {
      invoice.plant = invoice.plant || sapItems[0]?.Plant || process.env.SAP_PLANT || '1000';
      invoice.companyCode = invoice.companyCode || sapPOData.CompanyCode || process.env.SAP_COMPANY_CODE || '1000';
      invoice.lineItems = (invoice.lineItems || []).map((item, idx) => {
        const sapItem = sapItems[idx] || sapItems[0];
        return {
          ...item,
          materialNumber: item.materialNumber || sapItem?.Material || '',
          lineItem: item.lineItem || sapItem?.PurchaseOrderItem || `000${(idx + 1) * 10}`,
          description: item.description || sapItem?.PurchaseOrderItemText || '',
          storageLocation: item.storageLocation || sapItem?.StorageLocation || '0001',
          plant: item.plant || sapItem?.Plant || invoice.plant || '1000',
          uom: item.uom || sapItem?.PurchaseOrderQuantityUnit || 'EA',
          poQuantity: item.poQuantity ?? parseFloat(sapItem?.OrderQuantity || 0),
          poPrice: item.poPrice ?? parseFloat(sapItem?.NetPriceAmount || 0)
        };
      });
    }

    // Agent 2: PO Validation Agent (PO Matching)
    const validationResult = await poValidationAgent(invoice, sapPOData);
    invoice.aiAnalysis.poValidationAgent = { status: 'completed', result: validationResult, completedAt: new Date() };
    invoice.validationStatus = validationResult.overallStatus;

    // Update line items with PO data from SAP
    validationResult.validationResults.forEach((vr, idx) => {
      if (invoice.lineItems[idx]) {
        invoice.lineItems[idx].validationStatus = vr.status;
        invoice.lineItems[idx].poQuantity = vr.poQuantity;
        invoice.lineItems[idx].poPrice = vr.poPrice;
      }
    });

    // Agent 3: Exception Classification Agent
    const exceptionResult = await exceptionClassificationAgent(validationResult);
    invoice.aiAnalysis.exceptionClassificationAgent = { status: 'completed', result: exceptionResult, completedAt: new Date() };
    invoice.exceptionType = exceptionResult.exceptionType;
    invoice.exceptionDetails = exceptionResult.description;

    // Agent 4: Vendor History Agent (runs before Decision so it can inform the recommendation)
    const vendorResult = await vendorHistoryAgent(invoice.vendorCode);
    invoice.aiAnalysis.vendorHistoryAgent = { status: 'completed', result: { ...vendorResult, vendorHistory: undefined }, completedAt: new Date() };

    // Agent 5: Decision Recommendation Agent
    const decisionResult = await decisionRecommendationAgent(invoice, exceptionResult, vendorResult.vendorHistory);
    invoice.aiAnalysis.decisionRecommendationAgent = { status: 'completed', result: decisionResult, completedAt: new Date() };
    invoice.recommendedAction = decisionResult.recommendation;
    invoice.aiConfidenceScore = decisionResult.confidenceScore;

    // Agent 6: Routing Agent
    const routingResult = await routingAgent(invoice, exceptionResult, decisionResult);
    invoice.aiAnalysis.routingAgent = { status: 'completed', result: routingResult, completedAt: new Date() };

    // Agent 7: Follow-up Agent
    const followUpResult = await followUpAgent(invoice, exceptionResult);
    invoice.aiAnalysis.followUpAgent = { status: 'completed', result: followUpResult, completedAt: new Date() };

    // ---- Scenario-specific status transitions ----

    if (exceptionResult.exceptionType === 'none') {
      // Scenario 1: Full match — move to quality stock, create GRN approval
      invoice.status = 'validated';
      invoice.stockStatus = 'quality_stock';
      invoice.qualityInspectionStatus = 'pending';

      await Approval.create({
        invoice: invoice._id,
        approvalType: 'grn_approval',
        requiredRole: 'warehouse',
        requestedBy: req.user._id,
        status: 'pending',
        context: {
          poNumber: invoice.poNumber, invoiceNumber: invoice.invoiceNumber,
          vendorName: invoice.vendorName, exceptionType: 'none',
          quantity: invoice.lineItems[0]?.invoiceQuantity, amount: invoice.totalInvoiceValue,
          recommendedAction: decisionResult.recommendation
        },
        dueDate: new Date(Date.now() + 48 * 60 * 60 * 1000),
        priority: 'medium'
      });

    } else if (exceptionResult.exceptionType === 'qty_greater') {
      // Scenario 2A: Invoice qty > PO qty — REJECT immediately, no approval needed
      invoice.status = 'rejected';
      invoice.validationStatus = 'rejected';

      const emailData = {
        poNumber: invoice.poNumber, invoiceNumber: invoice.invoiceNumber,
        vendorName: invoice.vendorName,
        poQuantity: invoice.lineItems[0]?.poQuantity,
        invoiceQuantity: invoice.lineItems[0]?.invoiceQuantity
      };

      if (invoice.buyerEmail) {
        await sendEmail(invoice.buyerEmail, 'invoiceRejected', emailData);
        invoice.emailsSent.push({ to: invoice.buyerEmail, subject: 'Invoice Rejected — Quantity Exceeds PO', type: 'rejection', sentAt: new Date() });
      }
      if (invoice.vendorEmail) {
        await sendEmail(invoice.vendorEmail, 'invoiceRejected', emailData);
        invoice.emailsSent.push({ to: invoice.vendorEmail, subject: 'Invoice Rejected — Quantity Exceeds PO', type: 'rejection', sentAt: new Date() });
      }

    } else if (exceptionResult.exceptionType === 'qty_lesser') {
      // Scenario 2B: Invoice qty < PO qty — send short-qty notification, create approval for received qty
      invoice.status = 'exception_raised';
      invoice.stockStatus = 'quality_stock';
      invoice.qualityInspectionStatus = 'pending';

      const firstItem = invoice.lineItems[0];
      const shortQty = (firstItem?.poQuantity || 0) - (firstItem?.invoiceQuantity || 0);

      const emailData = {
        poNumber: invoice.poNumber, invoiceNumber: invoice.invoiceNumber,
        vendorName: invoice.vendorName,
        poQuantity: firstItem?.poQuantity,
        invoiceQuantity: firstItem?.invoiceQuantity,
        shortQty,
        uom: firstItem?.uom || 'EA'
      };

      if (invoice.buyerEmail) {
        await sendEmail(invoice.buyerEmail, 'shortQtyNotification', emailData);
        invoice.emailsSent.push({ to: invoice.buyerEmail, subject: 'Short Quantity Received — Action Required', type: 'shortQty', sentAt: new Date() });
      }
      if (invoice.vendorEmail) {
        await sendEmail(invoice.vendorEmail, 'shortQtyNotification', emailData);
        invoice.emailsSent.push({ to: invoice.vendorEmail, subject: 'Short Quantity — Partial Delivery Acknowledged', type: 'shortQty', sentAt: new Date() });
      }

      await Approval.create({
        invoice: invoice._id,
        approvalType: 'exception_approval',
        requiredRole: 'buyer',
        requestedBy: req.user._id,
        status: 'pending',
        context: {
          poNumber: invoice.poNumber, invoiceNumber: invoice.invoiceNumber,
          vendorName: invoice.vendorName, exceptionType: 'qty_lesser',
          quantity: firstItem?.invoiceQuantity, amount: invoice.totalInvoiceValue,
          recommendedAction: decisionResult.recommendation
        },
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        priority: 'high'
      });

    } else if (exceptionResult.exceptionType === 'price_higher' || exceptionResult.exceptionType === 'price_lower') {
      // Price mismatch — escalate to buyer for approval
      invoice.status = 'exception_raised';

      await Approval.create({
        invoice: invoice._id,
        approvalType: 'exception_approval',
        requiredRole: 'buyer',
        requestedBy: req.user._id,
        status: 'pending',
        context: {
          poNumber: invoice.poNumber, invoiceNumber: invoice.invoiceNumber,
          vendorName: invoice.vendorName, exceptionType: exceptionResult.exceptionType,
          quantity: invoice.lineItems[0]?.invoiceQuantity, amount: invoice.totalInvoiceValue,
          recommendedAction: decisionResult.recommendation
        },
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        priority: 'urgent'
      });

    } else {
      // Other exceptions
      invoice.status = 'exception_raised';

      await Approval.create({
        invoice: invoice._id,
        approvalType: 'exception_approval',
        requiredRole: routingResult.workflowAssignment,
        requestedBy: req.user._id,
        status: 'pending',
        context: {
          poNumber: invoice.poNumber, invoiceNumber: invoice.invoiceNumber,
          vendorName: invoice.vendorName, exceptionType: exceptionResult.exceptionType,
          quantity: invoice.lineItems[0]?.invoiceQuantity, amount: invoice.totalInvoiceValue,
          recommendedAction: decisionResult.recommendation
        },
        dueDate: new Date(Date.now() + 48 * 60 * 60 * 1000),
        priority: exceptionResult.severity === 'critical' ? 'urgent' : exceptionResult.severity === 'high' ? 'high' : 'medium'
      });
    }

    await invoice.save();

    res.json({
      success: true,
      message: 'Invoice processed successfully.',
      invoice,
      aiResults: {
        reading: readingResult,
        validation: validationResult,
        exception: exceptionResult,
        vendorHistory: vendorResult,
        decision: decisionResult,
        routing: routingResult,
        followUp: followUpResult
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getInvoices = async (req, res) => {
  try {
    const { status, page = 1, limit = 10, search, vendorCode, dateFrom, dateTo } = req.query;
    const query = {};

    if (status) query.status = status;
    if (vendorCode) query.vendorCode = vendorCode;
    if (search) {
      query.$or = [
        { invoiceNumber: { $regex: search, $options: 'i' } },
        { poNumber: { $regex: search, $options: 'i' } },
        { vendorName: { $regex: search, $options: 'i' } }
      ];
    }
    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo) query.createdAt.$lte = new Date(dateTo);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [invoices, total] = await Promise.all([
      Invoice.find(query).populate('uploadedBy', 'name email').sort('-createdAt').skip(skip).limit(parseInt(limit)),
      Invoice.countDocuments(query)
    ]);

    res.json({
      success: true,
      invoices,
      pagination: { total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)), limit: parseInt(limit) }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getInvoiceById = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id).populate('uploadedBy currentOwner', 'name email role');
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found.' });
    res.json({ success: true, invoice });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found.' });
    res.json({ success: true, invoice });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const extractInvoice = async (req, res) => {
  const filePath = req.file?.path;
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }
    const extracted = await extractInvoiceData(filePath, req.file.mimetype);
    try { fs.unlinkSync(filePath); } catch {}
    res.json({ success: true, extracted });
  } catch (error) {
    try { if (filePath) fs.unlinkSync(filePath); } catch {}
    res.status(500).json({ success: false, message: `Extraction failed: ${error.message}` });
  }
};

export const updateQualityStatus = async (req, res) => {
  try {
    const { acceptedQuantity, rejectedQuantity, rejectionReason, lineItemIndex } = req.body;
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found.' });

    const idx = lineItemIndex !== undefined ? lineItemIndex : 0;
    if (invoice.lineItems[idx]) {
      invoice.lineItems[idx].acceptedQuantity = parseFloat(acceptedQuantity);
      invoice.lineItems[idx].rejectedQuantity = parseFloat(rejectedQuantity);
      invoice.lineItems[idx].qualityRejectionReason = rejectionReason;
    }

    const totalRejected = invoice.lineItems.reduce((sum, item) => sum + (item.rejectedQuantity || 0), 0);

    if (totalRejected > 0) {
      invoice.qualityInspectionStatus = 'partial_rejection';
      invoice.exceptionType = 'partial_quality';
      invoice.validationStatus = 'partial_rejection';
    } else {
      invoice.qualityInspectionStatus = 'completed';
    }

    // Create quality approval if not already approved
    if (totalRejected > 0) {
      const existingQualityApproval = await Approval.findOne({ invoice: invoice._id, approvalType: 'quality_approval', status: 'pending' });
      if (!existingQualityApproval) {
        await Approval.create({
          invoice: invoice._id,
          approvalType: 'quality_approval',
          requiredRole: 'quality',
          requestedBy: req.user._id,
          status: 'pending',
          context: {
            poNumber: invoice.poNumber, invoiceNumber: invoice.invoiceNumber,
            vendorName: invoice.vendorName, exceptionType: 'partial_quality',
            quantity: parseFloat(rejectedQuantity),
            amount: invoice.totalInvoiceValue,
            recommendedAction: `Quality rejection: ${rejectedQuantity} units rejected. Reason: ${rejectionReason}. Credit memo required.`
          },
          dueDate: new Date(Date.now() + 48 * 60 * 60 * 1000),
          priority: 'high'
        });
      }
    }

    await invoice.save();
    res.json({ success: true, invoice });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
