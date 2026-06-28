import VendorHistory from '../models/VendorHistory.js';
import Invoice from '../models/Invoice.js';

export const getVendors = async (req, res) => {
  try {
    const { search, riskCategory, page = 1, limit = 20 } = req.query;
    const query = { isActive: true };
    if (riskCategory) query.riskCategory = riskCategory;
    if (search) {
      query.$or = [
        { vendorName: { $regex: search, $options: 'i' } },
        { vendorCode: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [vendors, total] = await Promise.all([
      VendorHistory.find(query).sort('-metrics.totalInvoicesProcessed').skip(skip).limit(parseInt(limit)),
      VendorHistory.countDocuments(query)
    ]);

    res.json({ success: true, vendors, pagination: { total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getVendorById = async (req, res) => {
  try {
    const vendor = await VendorHistory.findOne({ vendorCode: req.params.vendorCode });
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found.' });

    const recentInvoices = await Invoice.find({ vendorCode: req.params.vendorCode })
      .select('invoiceNumber poNumber status exceptionType totalInvoiceValue createdAt')
      .sort('-createdAt').limit(10);

    res.json({ success: true, vendor, recentInvoices });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getVendorAnalytics = async (req, res) => {
  try {
    const [byRisk, topVendors] = await Promise.all([
      VendorHistory.aggregate([
        { $group: { _id: '$riskCategory', count: { $sum: 1 }, avgScore: { $avg: '$riskScore' } } }
      ]),
      VendorHistory.find().sort('-metrics.totalInvoicesProcessed').limit(5)
        .select('vendorCode vendorName metrics riskScore riskCategory')
    ]);

    res.json({ success: true, byRisk, topVendors });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const seedVendors = async (req, res) => {
  try {
    const sampleVendors = [
      { vendorCode: 'VEND001', vendorName: 'TechParts Global Inc.', vendorEmail: 'orders@techparts.com', metrics: { totalInvoicesProcessed: 145, totalInvoicesMatched: 128, quantityMismatchCases: 8, priceMismatchCases: 5, qualityRejectionCases: 4, damagedGoodsCases: 2, avgExceptionResolutionTime: 18, firstTimeRightPercentage: 88, onTimeDeliveryPercentage: 92, totalValueProcessed: 285000 } },
      { vendorCode: 'VEND002', vendorName: 'Precision Materials Ltd.', vendorEmail: 'supply@precision.com', metrics: { totalInvoicesProcessed: 89, totalInvoicesMatched: 71, quantityMismatchCases: 12, priceMismatchCases: 6, qualityRejectionCases: 8, damagedGoodsCases: 5, avgExceptionResolutionTime: 42, firstTimeRightPercentage: 79, onTimeDeliveryPercentage: 81, totalValueProcessed: 165000 } },
      { vendorCode: 'VEND003', vendorName: 'FastShip Logistics Co.', vendorEmail: 'invoices@fastship.com', metrics: { totalInvoicesProcessed: 210, totalInvoicesMatched: 197, quantityMismatchCases: 3, priceMismatchCases: 2, qualityRejectionCases: 1, damagedGoodsCases: 0, avgExceptionResolutionTime: 8, firstTimeRightPercentage: 94, onTimeDeliveryPercentage: 97, totalValueProcessed: 580000 } },
      { vendorCode: 'VEND004', vendorName: 'Budget Components Corp.', vendorEmail: 'ap@budgetcomp.com', metrics: { totalInvoicesProcessed: 67, totalInvoicesMatched: 38, quantityMismatchCases: 18, priceMismatchCases: 11, qualityRejectionCases: 15, damagedGoodsCases: 8, avgExceptionResolutionTime: 72, firstTimeRightPercentage: 56, onTimeDeliveryPercentage: 63, totalValueProcessed: 95000 } }
    ];

    for (const v of sampleVendors) {
      await VendorHistory.findOneAndUpdate({ vendorCode: v.vendorCode }, v, { upsert: true, new: true }).then(doc => {
        doc.calculateRiskScore();
        doc.save();
      });
    }

    res.json({ success: true, message: 'Sample vendor data seeded successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
