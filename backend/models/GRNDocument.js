import mongoose from 'mongoose';

const grnDocumentSchema = new mongoose.Schema({
  invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true },
  grnNumber: { type: String, required: true, unique: true },
  poNumber: { type: String, required: true },
  vendorCode: { type: String },
  vendorName: { type: String },
  postingDate: { type: Date, required: true },
  documentDate: { type: Date, required: true },
  plant: { type: String },
  storageLocation: { type: String },
  quantity: { type: Number, required: true },
  uom: { type: String, default: 'EA' },
  materialNumber: { type: String },
  materialDescription: { type: String },
  poLineItem: { type: String },
  movementType: { type: String, default: '101' },
  stockType: { type: String, enum: ['quality', 'unrestricted', 'blocked'], default: 'quality' },
  postedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  sapStatus: { type: String, enum: ['mock', 'posted', 'reversed', 'failed'], default: 'mock' },
  sapResponse: { type: mongoose.Schema.Types.Mixed },
  irDocument: {
    irNumber: { type: String },
    irPostingDate: { type: Date },
    amount: { type: Number },
    currency: { type: String, default: 'USD' },
    taxAmount: { type: Number },
    sapStatus: { type: String, enum: ['mock', 'posted', 'reversed', 'failed'], default: 'mock' }
  }
}, { timestamps: true });

export default mongoose.model('GRNDocument', grnDocumentSchema);
