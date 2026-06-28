import mongoose from 'mongoose';

const approvalSchema = new mongoose.Schema({
  invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true },
  approvalType: {
    type: String,
    enum: ['grn_approval', 'ir_approval', 'credit_memo_approval', 'exception_approval', 'quality_approval'],
    required: true
  },
  requiredRole: { type: String, required: true },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'escalated', 'cancelled'],
    default: 'pending'
  },

  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvalDate: { type: Date },
  rejectionReason: { type: String },
  approvalComments: { type: String },

  // Approval context
  context: {
    poNumber: { type: String },
    invoiceNumber: { type: String },
    vendorName: { type: String },
    exceptionType: { type: String },
    quantity: { type: Number },
    amount: { type: Number },
    recommendedAction: { type: String }
  },

  dueDate: { type: Date },
  priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
  escalationLevel: { type: Number, default: 0 },
  remindersSent: { type: Number, default: 0 },
  lastReminderAt: { type: Date }
}, { timestamps: true });

approvalSchema.index({ invoice: 1, approvalType: 1 });
approvalSchema.index({ status: 1, assignedTo: 1 });

export default mongoose.model('Approval', approvalSchema);
