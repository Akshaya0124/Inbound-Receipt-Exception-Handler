export const INVOICE_STATUS = {
  uploaded: { label: 'Uploaded', color: 'info' },
  processing: { label: 'Processing', color: 'info' },
  validated: { label: 'Validated', color: 'success' },
  exception_raised: { label: 'Exception Raised', color: 'danger' },
  pending_approval: { label: 'Pending Approval', color: 'warning' },
  approved: { label: 'Approved', color: 'success' },
  grn_posted: { label: 'GRN Posted', color: 'success' },
  ir_posted: { label: 'IR Posted', color: 'success' },
  completed: { label: 'Completed', color: 'success' },
  rejected: { label: 'Rejected', color: 'danger' }
};

export const EXCEPTION_TYPES = {
  none: { label: 'No Exception', color: 'success' },
  qty_greater: { label: 'Qty Exceeds PO', color: 'danger' },
  qty_lesser: { label: 'Qty Below PO', color: 'warning' },
  price_higher: { label: 'Price Higher', color: 'warning' },
  price_lower: { label: 'Price Lower', color: 'info' },
  quality_rejection: { label: 'Quality Rejection', color: 'danger' },
  damaged: { label: 'Damaged Goods', color: 'danger' },
  partial_quality: { label: 'Partial Rejection', color: 'warning' }
};

export const RISK_CATEGORIES = {
  low: { label: 'Low Risk', color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
  medium: { label: 'Medium Risk', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  high: { label: 'High Risk', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  critical: { label: 'Critical Risk', color: '#dc2626', bg: 'rgba(220,38,38,0.15)' }
};

export const AI_AGENTS = [
  {
    id: 'invoiceReadingAgent',
    name: 'Invoice Reading Agent',
    icon: '📄',
    description: 'Extracts PO number, line items, quantity, price, vendor details and invoice amount using OCR'
  },
  {
    id: 'poValidationAgent',
    name: 'PO Matching Agent',
    icon: '🔍',
    description: 'Compares extracted invoice data with SAP PO data — validates PO number, line item, quantity and price'
  },
  {
    id: 'exceptionClassificationAgent',
    name: 'Exception Classification Agent',
    icon: '⚠️',
    description: 'Classifies the exception as quantity mismatch, price mismatch, quality rejection, or credit memo case'
  },
  {
    id: 'vendorHistoryAgent',
    name: 'Vendor History Agent',
    icon: '📊',
    description: 'Analyzes vendor past performance, calculates risk score, and surfaces relevant history for decision support'
  },
  {
    id: 'decisionRecommendationAgent',
    name: 'Decision Recommendation Agent',
    icon: '🤖',
    description: 'Recommends next action based on current exception data, SAP PO data, and vendor risk profile'
  },
  {
    id: 'routingAgent',
    name: 'Routing Agent',
    icon: '📧',
    description: 'Routes the exception to buyer, vendor, quality team, warehouse, or finance and queues email notifications'
  },
  {
    id: 'followUpAgent',
    name: 'Follow-up Agent',
    icon: '🔔',
    description: 'Tracks pending approvals, schedules reminder notifications, and monitors resolution timelines'
  }
];

export const APPROVAL_TYPES = {
  grn_approval: 'GRN Approval',
  ir_approval: 'IR Approval',
  credit_memo_approval: 'Credit Memo Approval',
  exception_approval: 'Exception Approval',
  quality_approval: 'Quality Approval'
};

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
