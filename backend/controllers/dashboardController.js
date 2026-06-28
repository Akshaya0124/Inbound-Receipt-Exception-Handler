import Invoice from '../models/Invoice.js';
import Approval from '../models/Approval.js';
import GRNDocument from '../models/GRNDocument.js';
import VendorHistory from '../models/VendorHistory.js';

export const getDashboardStats = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const [
      totalInvoices,
      matchedInvoices,
      pendingExceptions,
      pendingApprovals,
      grnPostedCount,
      irPostedCount,
      rejectedCount,
      qualityRejectedCount,
      creditMemoPending,
      criticalVendors,
      recentInvoices
    ] = await Promise.all([
      Invoice.countDocuments(),
      Invoice.countDocuments({ validationStatus: 'matched' }),
      Invoice.countDocuments({ status: { $in: ['exception_raised', 'pending_approval'] } }),
      Approval.countDocuments({ status: 'pending' }),
      Invoice.countDocuments({ status: { $in: ['grn_posted', 'ir_posted', 'completed'] } }),
      Invoice.countDocuments({ status: { $in: ['ir_posted', 'completed'] } }),
      Invoice.countDocuments({ status: 'rejected' }),
      Invoice.countDocuments({ exceptionType: { $in: ['quality_rejection', 'partial_quality'] } }),
      Invoice.countDocuments({ creditMemoStatus: { $in: ['pending_buyer', 'buyer_approved'] } }),
      VendorHistory.countDocuments({ riskCategory: { $in: ['high', 'critical'] } }),
      Invoice.find()
        .populate('uploadedBy', 'name')
        .sort('-createdAt')
        .limit(8)
        .select('invoiceNumber poNumber vendorName status exceptionType validationStatus totalInvoiceValue createdAt aiConfidenceScore')
    ]);

    // Monthly trend (last 6 months)
    const monthlyTrend = await Invoice.aggregate([
      { $match: { createdAt: { $gte: sixMonthsAgo } } },
      {
        $group: {
          _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
          total: { $sum: 1 },
          matched: { $sum: { $cond: [{ $eq: ['$validationStatus', 'matched'] }, 1, 0] } },
          exceptions: { $sum: { $cond: [{ $ne: ['$exceptionType', 'none'] }, 1, 0] } }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    // Exception breakdown by type
    const exceptionBreakdown = await Invoice.aggregate([
      { $match: { exceptionType: { $ne: 'none' } } },
      { $group: { _id: '$exceptionType', count: { $sum: 1 } } }
    ]);

    // Status breakdown
    const statusBreakdown = await Invoice.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    // Vendor-wise exception summary (top 5 vendors with most exceptions)
    const vendorExceptionSummary = await Invoice.aggregate([
      { $match: { exceptionType: { $ne: 'none' }, vendorName: { $ne: null } } },
      {
        $group: {
          _id: '$vendorCode',
          vendorName: { $first: '$vendorName' },
          totalExceptions: { $sum: 1 },
          qtyMismatch: { $sum: { $cond: [{ $in: ['$exceptionType', ['qty_greater', 'qty_lesser']] }, 1, 0] } },
          priceMismatch: { $sum: { $cond: [{ $in: ['$exceptionType', ['price_higher', 'price_lower']] }, 1, 0] } },
          qualityRejection: { $sum: { $cond: [{ $in: ['$exceptionType', ['quality_rejection', 'partial_quality', 'damaged']] }, 1, 0] } },
          totalValue: { $sum: '$totalInvoiceValue' }
        }
      },
      { $sort: { totalExceptions: -1 } },
      { $limit: 5 }
    ]);

    const resolutionRate = totalInvoices > 0
      ? Math.round(((grnPostedCount) / totalInvoices) * 100)
      : 0;

    res.json({
      success: true,
      stats: {
        totalInvoices,
        matchedInvoices,
        pendingExceptions,
        pendingApprovals,
        grnPostedCount,
        irPostedCount,
        rejectedCount,
        qualityRejectedCount,
        creditMemoPending,
        criticalVendors,
        resolutionRate,
        // Legacy fields for backward compat
        grnPostedToday: grnPostedCount,
        completedToday: irPostedCount
      },
      charts: { monthlyTrend, exceptionBreakdown, statusBreakdown },
      vendorExceptionSummary,
      recentInvoices
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getActivityFeed = async (req, res) => {
  try {
    const invoices = await Invoice.find()
      .populate('uploadedBy', 'name')
      .sort('-updatedAt')
      .limit(15)
      .select('invoiceNumber poNumber vendorName status exceptionType updatedAt uploadedBy');

    const activities = invoices.map(inv => ({
      id: inv._id,
      type: inv.status,
      message: getActivityMessage(inv),
      invoiceNumber: inv.invoiceNumber,
      poNumber: inv.poNumber,
      vendor: inv.vendorName,
      user: inv.uploadedBy?.name,
      timestamp: inv.updatedAt
    }));

    res.json({ success: true, activities });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getActivityMessage = (inv) => {
  const messages = {
    uploaded: `Invoice ${inv.invoiceNumber} uploaded for PO ${inv.poNumber}`,
    processing: `AI agents processing invoice ${inv.invoiceNumber}`,
    validated: `Invoice ${inv.invoiceNumber} validated — no exceptions`,
    exception_raised: `Exception raised on PO ${inv.poNumber} — ${inv.exceptionType?.replace(/_/g, ' ')}`,
    pending_approval: `Approval pending for invoice ${inv.invoiceNumber}`,
    approved: `Invoice ${inv.invoiceNumber} approved`,
    grn_posted: `GRN posted for PO ${inv.poNumber}`,
    ir_posted: `IR posted — invoice ${inv.invoiceNumber} fully processed`,
    completed: `Invoice ${inv.invoiceNumber} completed`,
    rejected: `Invoice ${inv.invoiceNumber} rejected — ${inv.exceptionType?.replace(/_/g, ' ')}`
  };
  return messages[inv.status] || `Invoice ${inv.invoiceNumber} updated`;
};
