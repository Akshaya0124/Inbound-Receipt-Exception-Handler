import VendorHistory from '../models/VendorHistory.js';

// Invoice Reading Agent - Extracts data from uploaded invoice
export const invoiceReadingAgent = async (invoiceData, fileName) => {
  await simulateProcessing(800);

  const confidence = 85 + Math.floor(Math.random() * 15);
  return {
    agentName: 'Invoice Reading Agent',
    status: 'completed',
    confidence,
    extractedData: {
      invoiceNumber: invoiceData.invoiceNumber || `INV-${Date.now()}`,
      invoiceDate: invoiceData.invoiceDate || new Date().toISOString(),
      poNumber: invoiceData.poNumber,
      vendorCode: invoiceData.vendorCode,
      vendorName: invoiceData.vendorName,
      lineItems: invoiceData.lineItems,
      totalAmount: invoiceData.totalInvoiceValue
    },
    message: `Successfully extracted ${invoiceData.lineItems?.length || 0} line items from invoice with ${confidence}% confidence`,
    processingTime: 800
  };
};

// PO Validation Agent - Validates invoice against SAP PO
export const poValidationAgent = async (invoice, sapPOData) => {
  await simulateProcessing(600);

  const validationResults = [];
  let hasQuantityMismatch = false;
  let hasPriceMismatch = false;

  invoice.lineItems.forEach((item, idx) => {
    const poItem = sapPOData?.to_PurchaseOrderItem?.results?.[idx];
    if (!poItem) {
      validationResults.push({ lineItem: item.lineItem, status: 'not_found', message: 'PO line item not found' });
      return;
    }

    const poQty = parseFloat(poItem.OrderQuantity || poItem.PurchaseOrderQuantity || 0);
    const poPrice = parseFloat(poItem.NetPriceAmount || 0);
    const invQty = parseFloat(item.invoiceQuantity || 0);
    const invPrice = parseFloat(item.invoicePrice || 0);

    const qtyMatch = Math.abs(invQty - poQty) < 0.001;
    const priceMatch = Math.abs(invPrice - poPrice) < 0.01;

    if (!qtyMatch) hasQuantityMismatch = true;
    if (!priceMatch) hasPriceMismatch = true;

    validationResults.push({
      lineItem: item.lineItem,
      poQuantity: poQty,
      invoiceQuantity: invQty,
      poPrice,
      invoicePrice: invPrice,
      quantityMatch: qtyMatch,
      priceMatch,
      status: qtyMatch && priceMatch ? 'matched' : (!qtyMatch && !priceMatch) ? 'both_mismatch' : !qtyMatch ? 'qty_mismatch' : 'price_mismatch',
      variance: {
        quantity: invQty - poQty,
        quantityPct: poQty ? (((invQty - poQty) / poQty) * 100).toFixed(2) : 0,
        price: invPrice - poPrice,
        pricePct: poPrice ? (((invPrice - poPrice) / poPrice) * 100).toFixed(2) : 0
      }
    });
  });

  return {
    agentName: 'PO Validation Agent',
    status: 'completed',
    overallStatus: !hasQuantityMismatch && !hasPriceMismatch ? 'matched' : hasQuantityMismatch ? 'quantity_mismatch' : 'price_mismatch',
    validationResults,
    hasQuantityMismatch,
    hasPriceMismatch,
    message: !hasQuantityMismatch && !hasPriceMismatch
      ? 'All line items validated successfully against SAP PO'
      : `Detected ${hasQuantityMismatch ? 'quantity' : ''}${hasQuantityMismatch && hasPriceMismatch ? ' and ' : ''}${hasPriceMismatch ? 'price' : ''} mismatch`
  };
};

// Exception Classification Agent - Categorizes the exception type
export const exceptionClassificationAgent = async (validationResult) => {
  await simulateProcessing(400);

  let exceptionType = 'none';
  let severity = 'none';
  let description = '';

  if (validationResult.overallStatus === 'matched') {
    exceptionType = 'none';
    severity = 'none';
    description = 'No exceptions detected. Invoice matches PO data exactly.';
  } else if (validationResult.hasQuantityMismatch && !validationResult.hasPriceMismatch) {
    const qtyVariance = validationResult.validationResults[0]?.variance?.quantity || 0;
    exceptionType = qtyVariance > 0 ? 'qty_greater' : 'qty_lesser';
    severity = Math.abs(qtyVariance) > 10 ? 'high' : 'medium';
    description = `Invoice quantity ${qtyVariance > 0 ? 'exceeds' : 'is less than'} PO quantity by ${Math.abs(qtyVariance)} units`;
  } else if (!validationResult.hasQuantityMismatch && validationResult.hasPriceMismatch) {
    const priceVariance = validationResult.validationResults[0]?.variance?.price || 0;
    exceptionType = priceVariance > 0 ? 'price_higher' : 'price_lower';
    severity = Math.abs(priceVariance) > 5 ? 'high' : 'medium';
    description = `Invoice price ${priceVariance > 0 ? 'exceeds' : 'is below'} PO price by $${Math.abs(priceVariance).toFixed(2)}`;
  } else if (validationResult.hasQuantityMismatch && validationResult.hasPriceMismatch) {
    exceptionType = 'qty_greater';
    severity = 'critical';
    description = 'Both quantity and price mismatches detected. Requires immediate attention.';
  }

  return {
    agentName: 'Exception Classification Agent',
    status: 'completed',
    exceptionType,
    severity,
    description,
    requiresApproval: exceptionType !== 'none',
    escalationRequired: severity === 'critical'
  };
};

// Decision Recommendation Agent - Recommends next action
export const decisionRecommendationAgent = async (invoice, exceptionResult, vendorHistory) => {
  await simulateProcessing(500);

  const riskScore = vendorHistory?.riskScore || 0;
  const ftr = vendorHistory?.metrics?.firstTimeRightPercentage || 100;
  let recommendation = '';
  let nextSteps = [];
  let autoApprovalEligible = false;

  if (exceptionResult.exceptionType === 'none') {
    recommendation = 'Invoice matches PO perfectly. Proceed with GRN and IR posting after approval.';
    nextSteps = ['Move stock to quality inspection', 'Obtain warehouse user approval', 'Post GRN in SAP', 'Post IR in SAP'];
    autoApprovalEligible = riskScore < 20 && ftr > 90;
  } else if (exceptionResult.exceptionType === 'qty_greater') {
    recommendation = 'Reject invoice. Invoice quantity exceeds PO quantity. Accept only PO quantity and notify vendor.';
    nextSteps = ['Reject invoice for excess quantity', 'Send rejection notice to vendor and buyer', 'Accept valid PO quantity', 'Post GRN for accepted quantity only', 'Post IR for accepted quantity'];
    autoApprovalEligible = false;
  } else if (exceptionResult.exceptionType === 'qty_lesser') {
    recommendation = 'Accept partial delivery. Process GRN for received quantity. Remaining PO quantity remains open.';
    nextSteps = ['Accept partial delivery', 'Post GRN for received quantity', 'Mark PO as partially delivered', 'Follow up for remaining quantity'];
    autoApprovalEligible = riskScore < 30;
  } else if (exceptionResult.exceptionType === 'price_higher') {
    recommendation = 'Price discrepancy detected. Escalate to buyer for approval before processing.';
    nextSteps = ['Notify buyer of price discrepancy', 'Await buyer approval', 'If approved, process at invoice price', 'If rejected, negotiate with vendor'];
    autoApprovalEligible = false;
  }

  return {
    agentName: 'Decision Recommendation Agent',
    status: 'completed',
    recommendation,
    nextSteps,
    autoApprovalEligible,
    confidenceScore: 75 + Math.floor(Math.random() * 20),
    vendorRiskFactor: riskScore > 50 ? 'HIGH_RISK_VENDOR' : riskScore > 25 ? 'MODERATE_RISK' : 'LOW_RISK',
    message: recommendation
  };
};

// Routing Agent - Determines notification targets
export const routingAgent = async (invoice, exceptionResult, decisionResult) => {
  await simulateProcessing(300);

  const notifications = [];

  if (exceptionResult.exceptionType === 'qty_greater') {
    notifications.push({ to: invoice.buyerEmail, role: 'buyer', reason: 'Invoice quantity exceeds PO - approval required', priority: 'high' });
    notifications.push({ to: invoice.vendorEmail, role: 'vendor', reason: 'Invoice rejected due to quantity excess', priority: 'high' });
  }

  if (exceptionResult.exceptionType === 'price_higher') {
    notifications.push({ to: invoice.buyerEmail, role: 'buyer', reason: 'Price discrepancy requires approval', priority: 'urgent' });
  }

  if (exceptionResult.exceptionType === 'none') {
    notifications.push({ to: 'warehouse@company.com', role: 'warehouse', reason: 'Invoice ready for GRN approval', priority: 'medium' });
  }

  return {
    agentName: 'Routing Agent',
    status: 'completed',
    notifications,
    workflowAssignment: exceptionResult.exceptionType === 'none' ? 'warehouse' : 'buyer',
    message: `Routing complete. ${notifications.length} notifications queued.`
  };
};

// Follow-up Agent - Tracks pending approvals and schedules reminders
export const followUpAgent = async (invoice, exceptionResult) => {
  await simulateProcessing(350);

  const pendingActions = [];
  let reminderScheduled = false;

  if (exceptionResult.exceptionType === 'none') {
    pendingActions.push({ action: 'GRN Approval', assignedTo: 'warehouse', dueIn: '48 hours', priority: 'medium' });
    pendingActions.push({ action: 'Quality Inspection', assignedTo: 'quality', dueIn: '24 hours', priority: 'medium' });
  } else if (exceptionResult.exceptionType === 'qty_greater') {
    pendingActions.push({ action: 'Vendor Resubmission', assignedTo: 'vendor', dueIn: '72 hours', priority: 'high' });
  } else if (exceptionResult.exceptionType === 'qty_lesser') {
    pendingActions.push({ action: 'Partial Delivery Approval', assignedTo: 'buyer', dueIn: '24 hours', priority: 'high' });
    pendingActions.push({ action: 'Remaining Quantity Follow-up', assignedTo: 'vendor', dueIn: '5 days', priority: 'medium' });
    reminderScheduled = true;
  } else if (exceptionResult.exceptionType === 'price_higher' || exceptionResult.exceptionType === 'price_lower') {
    pendingActions.push({ action: 'Price Discrepancy Approval', assignedTo: 'buyer', dueIn: '24 hours', priority: 'urgent' });
    reminderScheduled = true;
  } else if (exceptionResult.exceptionType === 'partial_quality') {
    pendingActions.push({ action: 'Credit Memo Approval', assignedTo: 'buyer', dueIn: '48 hours', priority: 'high' });
    pendingActions.push({ action: 'Vendor Credit Note', assignedTo: 'finance', dueIn: '5 days', priority: 'medium' });
    reminderScheduled = true;
  }

  return {
    agentName: 'Follow-up Agent',
    status: 'completed',
    pendingActions,
    reminderScheduled,
    nextReminderIn: reminderScheduled ? '24 hours' : null,
    message: `${pendingActions.length} follow-up action(s) tracked. ${reminderScheduled ? 'Reminder scheduled in 24 hours.' : 'No reminders needed.'}`
  };
};

// Vendor History Agent - Analyzes vendor performance
export const vendorHistoryAgent = async (vendorCode) => {
  await simulateProcessing(400);

  let vendorHistory = await VendorHistory.findOne({ vendorCode });

  if (!vendorHistory) {
    vendorHistory = await VendorHistory.create({
      vendorCode,
      vendorName: `Vendor ${vendorCode}`,
      metrics: {
        totalInvoicesProcessed: Math.floor(Math.random() * 100) + 20,
        quantityMismatchCases: Math.floor(Math.random() * 10),
        priceMismatchCases: Math.floor(Math.random() * 8),
        qualityRejectionCases: Math.floor(Math.random() * 5),
        damagedGoodsCases: Math.floor(Math.random() * 3),
        avgExceptionResolutionTime: 24 + Math.floor(Math.random() * 48),
        firstTimeRightPercentage: 70 + Math.floor(Math.random() * 25),
        onTimeDeliveryPercentage: 75 + Math.floor(Math.random() * 20),
        totalValueProcessed: 50000 + Math.floor(Math.random() * 200000)
      }
    });
    vendorHistory.calculateRiskScore();
    await vendorHistory.save();
  }

  return {
    agentName: 'Vendor History Agent',
    status: 'completed',
    vendorHistory,
    riskAssessment: vendorHistory.riskCategory,
    message: `Vendor ${vendorCode} risk score: ${vendorHistory.riskScore}/100 (${vendorHistory.riskCategory.toUpperCase()} RISK)`
  };
};

const simulateProcessing = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export default {
  invoiceReadingAgent,
  poValidationAgent,
  exceptionClassificationAgent,
  decisionRecommendationAgent,
  routingAgent,
  vendorHistoryAgent,
  followUpAgent
};
