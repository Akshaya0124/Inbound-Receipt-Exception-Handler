import mongoose from 'mongoose';

const vendorHistorySchema = new mongoose.Schema({
  vendorCode: { type: String, required: true, unique: true },
  vendorName: { type: String, required: true },
  vendorEmail: { type: String },
  vendorPhone: { type: String },
  vendorAddress: { type: String },
  country: { type: String },
  paymentTerms: { type: String },
  currency: { type: String, default: 'USD' },

  // Performance Metrics
  metrics: {
    totalInvoicesProcessed: { type: Number, default: 0 },
    totalInvoicesMatched: { type: Number, default: 0 },
    quantityMismatchCases: { type: Number, default: 0 },
    priceMismatchCases: { type: Number, default: 0 },
    qualityRejectionCases: { type: Number, default: 0 },
    damagedGoodsCases: { type: Number, default: 0 },
    partialRejectionCases: { type: Number, default: 0 },
    avgExceptionResolutionTime: { type: Number, default: 0 },
    firstTimeRightPercentage: { type: Number, default: 0 },
    onTimeDeliveryPercentage: { type: Number, default: 0 },
    totalValueProcessed: { type: Number, default: 0 },
    creditMemosRaised: { type: Number, default: 0 },
    creditMemoValue: { type: Number, default: 0 }
  },

  // Risk Score (0-100, higher = more risky)
  riskScore: { type: Number, default: 0, min: 0, max: 100 },
  riskCategory: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'low'
  },

  // Monthly performance trend
  monthlyTrend: [{
    month: { type: String },
    year: { type: Number },
    totalInvoices: { type: Number, default: 0 },
    exceptions: { type: Number, default: 0 },
    firstTimeRight: { type: Number, default: 0 }
  }],

  isActive: { type: Boolean, default: true },
  lastTransactionDate: { type: Date },
  notes: { type: String }
}, { timestamps: true });

vendorHistorySchema.methods.calculateRiskScore = function () {
  const m = this.metrics;
  if (m.totalInvoicesProcessed === 0) return 0;

  const exceptionRate = ((m.quantityMismatchCases + m.priceMismatchCases + m.qualityRejectionCases + m.damagedGoodsCases) / m.totalInvoicesProcessed) * 100;
  const ftrScore = 100 - m.firstTimeRightPercentage;
  const resolutionPenalty = Math.min(m.avgExceptionResolutionTime / 72 * 20, 20);

  const score = Math.min(Math.round((exceptionRate * 0.5) + (ftrScore * 0.3) + resolutionPenalty), 100);
  this.riskScore = score;
  this.riskCategory = score < 25 ? 'low' : score < 50 ? 'medium' : score < 75 ? 'high' : 'critical';
  return score;
};

export default mongoose.model('VendorHistory', vendorHistorySchema);
