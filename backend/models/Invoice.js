import mongoose from 'mongoose';

const lineItemSchema = new mongoose.Schema({
  lineItem: { type: String },
  materialNumber: { type: String },
  description: { type: String },
  poQuantity: { type: Number },
  invoiceQuantity: { type: Number },
  poPrice: { type: Number },
  invoicePrice: { type: Number },
  uom: { type: String, default: 'EA' },
  plant: { type: String },
  storageLocation: { type: String },
  validationStatus: {
    type: String,
    enum: ['matched', 'qty_mismatch', 'price_mismatch', 'both_mismatch', 'pending'],
    default: 'pending'
  },
  acceptedQuantity: { type: Number },
  rejectedQuantity: { type: Number },
  qualityRejectionReason: { type: String }
}, { _id: false });

const invoiceSchema = new mongoose.Schema({
  invoiceNumber: { type: String, required: true, unique: true },
  invoiceDate: { type: Date, required: true },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  fileName: { type: String },
  filePath: { type: String },
  fileType: { type: String },

  // SAP PO Data
  poNumber: { type: String, required: true },
  vendorCode: { type: String },
  vendorName: { type: String },
  vendorEmail: { type: String },
  buyerEmail: { type: String },
  buyerName: { type: String },
  plant: { type: String },
  companyCode: { type: String },
  currency: { type: String, default: 'INR' },
  totalPoValue: { type: Number },
  totalInvoiceValue: { type: Number },

  // Line Items
  lineItems: [lineItemSchema],

  // Validation
  validationStatus: {
    type: String,
    enum: ['pending', 'matched', 'quantity_mismatch', 'price_mismatch', 'partial_rejection', 'rejected', 'processing'],
    default: 'pending'
  },
  exceptionType: {
    type: String,
    enum: ['none', 'qty_greater', 'qty_lesser', 'price_higher', 'price_lower', 'quality_rejection', 'damaged', 'partial_quality'],
    default: 'none'
  },
  exceptionDetails: { type: String },

  // AI Agent Results
  aiAnalysis: {
    invoiceReadingAgent: { status: String, result: mongoose.Schema.Types.Mixed, completedAt: Date },
    poValidationAgent: { status: String, result: mongoose.Schema.Types.Mixed, completedAt: Date },
    exceptionClassificationAgent: { status: String, result: mongoose.Schema.Types.Mixed, completedAt: Date },
    vendorHistoryAgent: { status: String, result: mongoose.Schema.Types.Mixed, completedAt: Date },
    decisionRecommendationAgent: { status: String, result: mongoose.Schema.Types.Mixed, completedAt: Date },
    routingAgent: { status: String, result: mongoose.Schema.Types.Mixed, completedAt: Date },
    followUpAgent: { status: String, result: mongoose.Schema.Types.Mixed, completedAt: Date }
  },
  recommendedAction: { type: String },
  aiConfidenceScore: { type: Number, min: 0, max: 100 },

  // Workflow Status
  status: {
    type: String,
    enum: ['uploaded', 'processing', 'validated', 'exception_raised', 'pending_approval', 'approved', 'grn_posted', 'ir_posted', 'completed', 'rejected'],
    default: 'uploaded'
  },
  currentOwner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  currentOwnerRole: { type: String },

  // SAP Documents
  grnDocumentNumber: { type: String },
  grnPostingDate: { type: Date },
  irDocumentNumber: { type: String },
  irPostingDate: { type: Date },
  creditMemoNumber: { type: String },
  creditMemoStatus: {
    type: String,
    enum: ['none', 'pending_buyer', 'buyer_approved', 'sent_to_vendor', 'vendor_accepted', 'completed'],
    default: 'none'
  },

  // Quality
  qualityInspectionStatus: {
    type: String,
    enum: ['not_required', 'pending', 'in_progress', 'completed', 'partial_rejection'],
    default: 'not_required'
  },
  stockStatus: {
    type: String,
    enum: ['none', 'quality_stock', 'unrestricted', 'blocked', 'partial'],
    default: 'none'
  },

  // Email notifications
  emailsSent: [{
    to: String,
    subject: String,
    type: String,
    sentAt: { type: Date, default: Date.now }
  }],

  notes: { type: String },
  processingStartedAt: { type: Date },
  completedAt: { type: Date }
}, { timestamps: true });

invoiceSchema.index({ poNumber: 1, status: 1 });
invoiceSchema.index({ validationStatus: 1 });
invoiceSchema.index({ vendorCode: 1 });
invoiceSchema.index({ uploadedBy: 1 });

export default mongoose.model('Invoice', invoiceSchema);
