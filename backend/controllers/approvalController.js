import Approval from '../models/Approval.js';
import Invoice from '../models/Invoice.js';
import GRNDocument from '../models/GRNDocument.js';
import { postGRNToSAP, postIRToSAP } from '../services/sapService.js';

export const getApprovals = async (req, res) => {
  try {
    const { status, role } = req.query;
    const query = {};
    if (status) query.status = status;
    else query.status = 'pending';

    const approvals = await Approval.find(query)
      .populate('invoice', 'invoiceNumber poNumber vendorName totalInvoiceValue status exceptionType')
      .populate('requestedBy', 'name email')
      .populate('approvedBy', 'name email')
      .sort({ 'priority': -1, 'createdAt': -1 });

    res.json({ success: true, count: approvals.length, approvals });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getApprovalById = async (req, res) => {
  try {
    const approval = await Approval.findById(req.params.id)
      .populate('invoice')
      .populate('requestedBy assignedTo approvedBy', 'name email role');
    if (!approval) return res.status(404).json({ success: false, message: 'Approval not found.' });
    res.json({ success: true, approval });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const approveRequest = async (req, res) => {
  try {
    const { comments } = req.body;
    const approval = await Approval.findById(req.params.id);
    if (!approval) return res.status(404).json({ success: false, message: 'Approval not found.' });
    if (approval.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Approval is already ${approval.status}.` });
    }

    approval.status = 'approved';
    approval.approvedBy = req.user._id;
    approval.approvalDate = new Date();
    approval.approvalComments = comments;
    await approval.save();

    const invoice = await Invoice.findById(approval.invoice);
    let grnNumber = null;
    let irNumber = null;
    let sapMode = null;

    if (invoice) {
      if (approval.approvalType === 'grn_approval' || approval.approvalType === 'exception_approval') {
        invoice.status = 'approved';
        invoice.currentOwner = req.user._id;
        invoice.currentOwnerRole = req.user.role;
        await invoice.save();

        // Post GRN to SAP
        try {
          const grnQuantity = invoice.lineItems?.[0]?.acceptedQuantity || invoice.lineItems?.[0]?.invoiceQuantity || 1;
          const grnResult = await postGRNToSAP({
            poNumber: invoice.poNumber,
            materialNumber: invoice.lineItems?.[0]?.materialNumber || 'MAT-001',
            plant: invoice.plant || invoice.lineItems?.[0]?.plant || '1000',
            storageLocation: invoice.lineItems?.[0]?.storageLocation || '0001',
            quantity: grnQuantity,
            uom: invoice.lineItems?.[0]?.uom || 'EA',
            lineItem: invoice.lineItems?.[0]?.lineItem || '00010',
            invoiceDate: invoice.invoiceDate
          });

          grnNumber = grnResult.documentNumber;
          sapMode = grnResult.isMock ? 'mock' : 'live';

          const grnPostingDate = invoice.invoiceDate ? new Date(invoice.invoiceDate) : new Date();

          await GRNDocument.create({
            invoice: invoice._id,
            grnNumber,
            poNumber: invoice.poNumber,
            vendorCode: invoice.vendorCode,
            vendorName: invoice.vendorName,
            postingDate: grnPostingDate,
            documentDate: grnPostingDate,
            plant: invoice.plant || '1000',
            storageLocation: invoice.lineItems?.[0]?.storageLocation || '0001',
            quantity: grnQuantity,
            uom: invoice.lineItems?.[0]?.uom || 'EA',
            materialNumber: invoice.lineItems?.[0]?.materialNumber || 'MAT-001',
            poLineItem: invoice.lineItems?.[0]?.lineItem || '00010',
            postedBy: req.user._id,
            sapStatus: grnResult.isMock ? 'mock' : 'posted',
            sapResponse: grnResult
          });

          invoice.grnDocumentNumber = grnNumber;
          invoice.grnPostingDate = new Date();
          invoice.status = 'grn_posted';
          await invoice.save();

          // Post IR to SAP
          const irResult = await postIRToSAP({
            grnNumber,
            poNumber: invoice.poNumber,
            amount: invoice.totalInvoiceValue,
            currency: invoice.currency || 'INR',
            companyCode: invoice.companyCode || '1000',
            lineItem: invoice.lineItems?.[0]?.lineItem || '00010',
            plant: invoice.plant || invoice.lineItems?.[0]?.plant || '1000',
            quantity: invoice.lineItems?.[0]?.acceptedQuantity || invoice.lineItems?.[0]?.invoiceQuantity || 1,
            invoiceDate: invoice.invoiceDate
          });

          irNumber = irResult.documentNumber;

          const grnDoc = await GRNDocument.findOne({ invoice: invoice._id });
          if (grnDoc) {
            grnDoc.irDocument = {
              irNumber,
              irPostingDate: grnPostingDate,
              amount: invoice.totalInvoiceValue,
              currency: invoice.currency || 'USD',
              sapStatus: irResult.isMock ? 'mock' : 'posted'
            };
            await grnDoc.save();
          }

          invoice.irDocumentNumber = irNumber;
          invoice.irPostingDate = grnPostingDate;
          invoice.status = 'ir_posted';
          invoice.completedAt = new Date();
          await invoice.save();

        } catch (sapError) {
          console.error('SAP posting failed during approval:', sapError.message);
        }

      } else if (approval.approvalType === 'credit_memo_approval') {
        invoice.creditMemoStatus = 'buyer_approved';
        await invoice.save();
      }
    }

    await approval.populate('invoice requestedBy approvedBy', 'invoiceNumber poNumber vendorName name email');
    res.json({
      success: true,
      message: 'Request approved successfully.',
      approval,
      grnNumber,
      irNumber,
      sapMode
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const rejectRequest = async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ success: false, message: 'Rejection reason is required.' });

    const approval = await Approval.findById(req.params.id);
    if (!approval) return res.status(404).json({ success: false, message: 'Approval not found.' });

    approval.status = 'rejected';
    approval.approvedBy = req.user._id;
    approval.approvalDate = new Date();
    approval.rejectionReason = reason;
    await approval.save();

    const invoice = await Invoice.findById(approval.invoice);
    if (invoice) {
      invoice.status = 'rejected';
      await invoice.save();
    }

    res.json({ success: true, message: 'Request rejected.', approval });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getApprovalStats = async (req, res) => {
  try {
    const [pending, approved, rejected, urgent] = await Promise.all([
      Approval.countDocuments({ status: 'pending' }),
      Approval.countDocuments({ status: 'approved' }),
      Approval.countDocuments({ status: 'rejected' }),
      Approval.countDocuments({ status: 'pending', priority: 'urgent' })
    ]);
    res.json({ success: true, stats: { pending, approved, rejected, urgent, total: pending + approved + rejected } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
