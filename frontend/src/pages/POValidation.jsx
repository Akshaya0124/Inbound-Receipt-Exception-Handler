import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { invoiceAPI, sapAPI } from '../services/api.js';
import {
  CheckCircle, XCircle, AlertTriangle, ChevronDown, ChevronUp,
  Package, FileCheck, CreditCard, Mail, Clock, ArrowRight
} from 'lucide-react';
import Badge from '../components/UI/Badge.jsx';
import { PageLoader } from '../components/UI/LoadingSpinner.jsx';
import { INVOICE_STATUS, EXCEPTION_TYPES, AI_AGENTS } from '../utils/constants.js';
import { format } from 'date-fns';
import toast from 'react-hot-toast';

export default function POValidation() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedAgent, setExpandedAgent] = useState(null);
  const [postingGRN, setPostingGRN] = useState(false);
  const [postingIR, setPostingIR] = useState(false);
  const [postingCreditMemo, setPostingCreditMemo] = useState(false);
  const [qualityForm, setQualityForm] = useState({ acceptedQuantity: '', rejectedQuantity: '', rejectionReason: '' });
  const [submittingQuality, setSubmittingQuality] = useState(false);

  useEffect(() => {
    invoiceAPI.getById(id)
      .then(r => {
        setInvoice(r.data.invoice);
        // Pre-fill quality form from existing data
        const item = r.data.invoice?.lineItems?.[0];
        if (item?.acceptedQuantity || item?.rejectedQuantity) {
          setQualityForm({
            acceptedQuantity: item.acceptedQuantity ?? '',
            rejectedQuantity: item.rejectedQuantity ?? '',
            rejectionReason: item.qualityRejectionReason ?? ''
          });
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  const postGRN = async () => {
    setPostingGRN(true);
    try {
      const grnQty = invoice.lineItems[0]?.acceptedQuantity || invoice.lineItems[0]?.invoiceQuantity;
      const res = await sapAPI.postGRN(id, { quantity: grnQty });
      toast.success(`GRN ${res.data.grnNumber} posted successfully!`);
      setInvoice(prev => ({ ...prev, status: 'grn_posted', grnDocumentNumber: res.data.grnNumber }));
    } catch (e) {
      toast.error(e.response?.data?.message || 'GRN posting failed.');
    } finally {
      setPostingGRN(false);
    }
  };

  const postIR = async () => {
    setPostingIR(true);
    try {
      const res = await sapAPI.postIR(id);
      toast.success(`IR ${res.data.irNumber} posted successfully!`);
      setInvoice(prev => ({ ...prev, status: 'ir_posted', irDocumentNumber: res.data.irNumber }));
    } catch (e) {
      toast.error(e.response?.data?.message || 'IR posting failed.');
    } finally {
      setPostingIR(false);
    }
  };

  const postCreditMemo = async () => {
    const totalRejected = invoice.lineItems.reduce((s, i) => s + (i.rejectedQuantity || 0), 0);
    const reason = invoice.lineItems[0]?.qualityRejectionReason || 'Quality rejection';
    setPostingCreditMemo(true);
    try {
      const res = await sapAPI.postCreditMemo(id, { rejectedQuantity: totalRejected, rejectionReason: reason });
      toast.success(`Credit Memo ${res.data.creditMemoNumber} created!`);
      setInvoice(prev => ({ ...prev, creditMemoNumber: res.data.creditMemoNumber, creditMemoStatus: 'pending_buyer' }));
    } catch (e) {
      toast.error(e.response?.data?.message || 'Credit memo creation failed.');
    } finally {
      setPostingCreditMemo(false);
    }
  };

  const submitQuality = async () => {
    if (!qualityForm.acceptedQuantity && qualityForm.acceptedQuantity !== 0) {
      toast.error('Please enter accepted quantity.');
      return;
    }
    if (!qualityForm.rejectedQuantity && qualityForm.rejectedQuantity !== 0) {
      toast.error('Please enter rejected quantity.');
      return;
    }
    if (parseFloat(qualityForm.rejectedQuantity) > 0 && !qualityForm.rejectionReason) {
      toast.error('Rejection reason is required when quantity is rejected.');
      return;
    }
    setSubmittingQuality(true);
    try {
      const res = await invoiceAPI.updateQuality(id, {
        acceptedQuantity: parseFloat(qualityForm.acceptedQuantity),
        rejectedQuantity: parseFloat(qualityForm.rejectedQuantity),
        rejectionReason: qualityForm.rejectionReason,
        lineItemIndex: 0
      });
      toast.success('Quality inspection submitted successfully!');
      setInvoice(res.data.invoice);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Quality submission failed.');
    } finally {
      setSubmittingQuality(false);
    }
  };

  if (loading) return <PageLoader message="Loading invoice details..." />;
  if (!invoice) return <div className="empty-state"><p>Invoice not found.</p></div>;

  const statusInfo = INVOICE_STATUS[invoice.status] || { label: invoice.status, color: 'muted' };
  const exceptionInfo = EXCEPTION_TYPES[invoice.exceptionType] || { label: invoice.exceptionType, color: 'muted' };
  const aiAnalysis = invoice.aiAnalysis || {};
  const firstItem = invoice.lineItems?.[0];
  const totalInvoiceQty = invoice.lineItems?.reduce((s, i) => s + (i.invoiceQuantity || 0), 0) || 0;
  const totalAccepted = invoice.lineItems?.reduce((s, i) => s + (i.acceptedQuantity || 0), 0) || 0;
  const totalRejected = invoice.lineItems?.reduce((s, i) => s + (i.rejectedQuantity || 0), 0) || 0;
  const qualityPending = invoice.qualityInspectionStatus === 'pending' || invoice.qualityInspectionStatus === 'in_progress';
  const qualityDone = invoice.qualityInspectionStatus === 'completed' || invoice.qualityInspectionStatus === 'partial_rejection';

  const matchIcon = (ok) =>
    ok ? <CheckCircle size={16} color="var(--success)" /> : <XCircle size={16} color="var(--danger)" />;

  // Scenario banner helpers
  const ScenarioBanner = () => {
    if (invoice.status === 'rejected' && invoice.exceptionType === 'qty_greater') {
      return (
        <div style={{ padding: 16, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, marginBottom: 20, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <XCircle size={20} color="var(--danger)" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--danger)', margin: '0 0 4px' }}>Scenario 2A — Invoice Rejected: Quantity Exceeds PO</p>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
              Invoice quantity ({firstItem?.invoiceQuantity}) is greater than PO quantity ({firstItem?.poQuantity}). Invoice has been automatically rejected.
              Email notifications have been sent to the buyer and vendor. No GRN or IR will be posted.
            </p>
          </div>
        </div>
      );
    }
    if (invoice.exceptionType === 'qty_lesser') {
      return (
        <div style={{ padding: 16, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 10, marginBottom: 20, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <AlertTriangle size={20} color="var(--warning)" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <p style={{ fontSize: 14, fontWeight: 700, color: '#d97706', margin: '0 0 4px' }}>Scenario 2B — Partial Delivery: Quantity Below PO</p>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
              Received {firstItem?.invoiceQuantity} of {firstItem?.poQuantity} ordered. Short quantity: {(firstItem?.poQuantity || 0) - (firstItem?.invoiceQuantity || 0)} units.
              Emails sent to buyer and vendor. Buyer approval required before GRN posting.
            </p>
          </div>
        </div>
      );
    }
    if (invoice.exceptionType === 'partial_quality') {
      return (
        <div style={{ padding: 16, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 10, marginBottom: 20, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <Package size={20} color="var(--danger)" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--danger)', margin: '0 0 4px' }}>Scenario 3 — Partial Quality Rejection</p>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
              Accepted: {totalAccepted} units | Rejected: {totalRejected} units. GRN posts for accepted quantity.
              IR posts as per invoice quantity. Credit memo required for {totalRejected} rejected units.
            </p>
          </div>
        </div>
      );
    }
    if (invoice.exceptionType === 'none' && ['validated', 'approved', 'grn_posted', 'ir_posted', 'completed'].includes(invoice.status)) {
      return (
        <div style={{ padding: 16, background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 10, marginBottom: 20, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <CheckCircle size={20} color="var(--success)" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--success)', margin: '0 0 4px' }}>Scenario 1 — Fully Matched</p>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
              PO number, line item, quantity and price all match. Stock moved to quality inspection.
              {invoice.status === 'validated' ? ' Awaiting warehouse approval before GRN posting.' : ''}
            </p>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="animate-fade-in">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h2 className="page-title">Invoice Details</h2>
          <p className="page-subtitle">{invoice.invoiceNumber} — PO {invoice.poNumber}</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Badge variant={statusInfo.color} dot>{statusInfo.label}</Badge>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/invoices')}>← Back</button>
        </div>
      </div>

      {/* Scenario Banner */}
      <ScenarioBanner />

      {/* Overview + AI Summary */}
      <div className="grid grid-2" style={{ gap: 20, marginBottom: 20 }}>
        <div className="glass-card" style={{ padding: 22 }}>
          <h4 style={{ marginBottom: 16, fontSize: 15 }}>Invoice Overview</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {[
              ['Invoice Number', invoice.invoiceNumber],
              ['PO Number', invoice.poNumber],
              ['Vendor', invoice.vendorName],
              ['Vendor Code', invoice.vendorCode],
              ['Invoice Date', invoice.invoiceDate ? format(new Date(invoice.invoiceDate), 'dd MMM yyyy') : '—'],
              ['Total Value', invoice.totalInvoiceValue ? `${invoice.currency} ${parseFloat(invoice.totalInvoiceValue).toLocaleString()}` : '—'],
              ['Buyer', invoice.buyerName],
              ['Uploaded', format(new Date(invoice.createdAt), 'dd MMM yyyy, HH:mm')]
            ].map(([lbl, val]) => (
              <div key={lbl}>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>{lbl}</p>
                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-heading)', fontFamily: ['Invoice Number', 'PO Number', 'Vendor Code'].includes(lbl) ? 'var(--font-mono)' : 'inherit' }}>{val || '—'}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-card" style={{ padding: 22 }}>
          <h4 style={{ marginBottom: 16, fontSize: 15 }}>AI Analysis Summary</h4>
          <div style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Exception Type</p>
            <Badge variant={exceptionInfo.color}>{exceptionInfo.label}</Badge>
          </div>
          {invoice.recommendedAction && (
            <div style={{ padding: 14, background: 'rgba(99,102,241,0.07)', borderRadius: 10, border: '1px solid rgba(99,102,241,0.2)', marginBottom: 14 }}>
              <p style={{ fontSize: 11, color: 'var(--primary-light)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>AI Recommendation</p>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>{invoice.recommendedAction}</p>
            </div>
          )}
          {invoice.aiConfidenceScore && (
            <div style={{ marginBottom: 14 }}>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Confidence Score</p>
              <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${invoice.aiConfidenceScore}%`, background: 'var(--gradient-primary)', borderRadius: 4 }} />
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{invoice.aiConfidenceScore}%</p>
            </div>
          )}
          {/* Stock Status */}
          {invoice.stockStatus && invoice.stockStatus !== 'none' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'rgba(245,158,11,0.08)', borderRadius: 8, border: '1px solid rgba(245,158,11,0.2)', marginBottom: 10 }}>
              <Package size={14} color="var(--warning)" />
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Stock Status:</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#d97706' }}>{invoice.stockStatus.replace(/_/g, ' ').toUpperCase()}</span>
            </div>
          )}
          {/* SAP Document Numbers */}
          {(invoice.grnDocumentNumber || invoice.irDocumentNumber || invoice.creditMemoNumber) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {invoice.grnDocumentNumber && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'rgba(16,185,129,0.08)', borderRadius: 8, border: '1px solid rgba(16,185,129,0.2)' }}>
                  <CheckCircle size={14} color="var(--success)" />
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>GRN:</span>
                  <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--success)' }}>{invoice.grnDocumentNumber}</span>
                </div>
              )}
              {invoice.irDocumentNumber && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'rgba(16,185,129,0.08)', borderRadius: 8, border: '1px solid rgba(16,185,129,0.2)' }}>
                  <FileCheck size={14} color="var(--success)" />
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>IR:</span>
                  <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--success)' }}>{invoice.irDocumentNumber}</span>
                </div>
              )}
              {invoice.creditMemoNumber && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'rgba(239,68,68,0.08)', borderRadius: 8, border: '1px solid rgba(239,68,68,0.2)' }}>
                  <CreditCard size={14} color="var(--danger)" />
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Credit Memo:</span>
                  <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--danger)' }}>{invoice.creditMemoNumber}</span>
                  <Badge variant="warning" size="sm">{invoice.creditMemoStatus?.replace(/_/g, ' ')}</Badge>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* PO vs Invoice Comparison Table */}
      <div className="glass-card" style={{ padding: 22, marginBottom: 20, overflow: 'hidden' }}>
        <h4 style={{ marginBottom: 16, fontSize: 15 }}>PO vs Invoice Comparison</h4>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Line</th>
                <th>Material</th>
                <th>Description</th>
                <th>PO Qty</th>
                <th>Invoice Qty</th>
                <th>Qty</th>
                <th>PO Price</th>
                <th>Invoice Price</th>
                <th>Price</th>
                <th>Accepted</th>
                <th>Rejected</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lineItems?.map((item, i) => {
                const qtyMatch = Math.abs((item.poQuantity || 0) - (item.invoiceQuantity || 0)) < 0.001;
                const priceMatch = Math.abs((item.poPrice || 0) - (item.invoicePrice || 0)) < 0.01;
                return (
                  <tr key={i}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{item.lineItem || `00${(i + 1) * 10}`}</td>
                    <td style={{ fontSize: 12 }}>{item.materialNumber || '—'}</td>
                    <td style={{ fontSize: 12, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.description || '—'}</td>
                    <td style={{ fontWeight: 600 }}>{item.poQuantity ?? '—'} {item.uom}</td>
                    <td style={{ fontWeight: 600, color: !qtyMatch ? 'var(--danger)' : 'var(--text-heading)' }}>{item.invoiceQuantity} {item.uom}</td>
                    <td>{matchIcon(qtyMatch)}</td>
                    <td style={{ fontWeight: 600 }}>{item.poPrice ? `$${parseFloat(item.poPrice).toFixed(2)}` : '—'}</td>
                    <td style={{ fontWeight: 600, color: !priceMatch ? 'var(--danger)' : 'var(--text-heading)' }}>{item.invoicePrice ? `$${parseFloat(item.invoicePrice).toFixed(2)}` : '—'}</td>
                    <td>{matchIcon(priceMatch)}</td>
                    <td style={{ color: 'var(--success)', fontWeight: 600 }}>{item.acceptedQuantity ?? '—'}</td>
                    <td style={{ color: item.rejectedQuantity > 0 ? 'var(--danger)' : 'var(--text-muted)', fontWeight: 600 }}>{item.rejectedQuantity ?? '—'}</td>
                    <td>
                      <Badge variant={item.validationStatus === 'matched' ? 'success' : item.validationStatus === 'pending' ? 'muted' : 'danger'} size="sm">
                        {item.validationStatus?.replace(/_/g, ' ') || 'pending'}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Quality Inspection Form — shows when stock is in quality and inspection is pending */}
      {qualityPending && invoice.stockStatus === 'quality_stock' && invoice.status !== 'rejected' && (
        <div className="glass-card" style={{ padding: 22, marginBottom: 20, border: '1px solid rgba(245,158,11,0.3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
            <Package size={18} color="var(--warning)" />
            <h4 style={{ margin: 0, fontSize: 15 }}>Quality Inspection</h4>
            <Badge variant="warning" size="sm">Action Required</Badge>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 18 }}>
            Stock has been moved to quality inspection ({totalInvoiceQty} {firstItem?.uom || 'units'} total).
            Enter the accepted and rejected quantities after inspection.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 16, marginBottom: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Accepted Quantity *
              </label>
              <input
                type="number"
                min="0"
                max={totalInvoiceQty}
                className="form-control"
                value={qualityForm.acceptedQuantity}
                onChange={e => setQualityForm(prev => ({
                  ...prev,
                  acceptedQuantity: e.target.value,
                  rejectedQuantity: Math.max(0, totalInvoiceQty - parseFloat(e.target.value || 0)).toString()
                }))}
                placeholder="e.g. 8"
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Rejected Quantity *
              </label>
              <input
                type="number"
                min="0"
                max={totalInvoiceQty}
                className="form-control"
                value={qualityForm.rejectedQuantity}
                onChange={e => setQualityForm(prev => ({ ...prev, rejectedQuantity: e.target.value }))}
                placeholder="e.g. 2"
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Rejection Reason {parseFloat(qualityForm.rejectedQuantity) > 0 ? '*' : ''}
              </label>
              <input
                type="text"
                className="form-control"
                value={qualityForm.rejectionReason}
                onChange={e => setQualityForm(prev => ({ ...prev, rejectionReason: e.target.value }))}
                placeholder="e.g. Damaged packaging, quality failure"
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button onClick={submitQuality} disabled={submittingQuality} className="btn btn-warning">
              {submittingQuality
                ? <><div className="spinner" style={{ width: 16, height: 16 }} /> Submitting...</>
                : '✓ Submit Quality Decision'}
            </button>
            {qualityForm.rejectedQuantity > 0 && (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
                ⚠️ {qualityForm.rejectedQuantity} units rejected — credit memo will be required after GRN/IR posting
              </p>
            )}
          </div>
        </div>
      )}

      {/* Quality Result Summary — shows after quality inspection done */}
      {qualityDone && (totalAccepted > 0 || totalRejected > 0) && (
        <div className="glass-card" style={{ padding: 22, marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <Package size={18} color={totalRejected > 0 ? 'var(--warning)' : 'var(--success)'} />
            <h4 style={{ margin: 0, fontSize: 15 }}>Quality Inspection Result</h4>
            <Badge variant={totalRejected > 0 ? 'warning' : 'success'} size="sm">
              {totalRejected > 0 ? 'Partial Rejection' : 'Fully Accepted'}
            </Badge>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            {[
              { label: 'Total Received', value: totalInvoiceQty, color: 'var(--text-heading)' },
              { label: 'Accepted Qty', value: totalAccepted, color: 'var(--success)' },
              { label: 'Rejected Qty', value: totalRejected, color: totalRejected > 0 ? 'var(--danger)' : 'var(--text-muted)' }
            ].map(({ label, value, color }) => (
              <div key={label} style={{ textAlign: 'center', padding: 16, background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
                <p style={{ fontSize: 24, fontWeight: 700, color, margin: '0 0 4px' }}>{value}</p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>{label}</p>
              </div>
            ))}
          </div>
          {invoice.lineItems[0]?.qualityRejectionReason && (
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 12, padding: '10px 14px', background: 'rgba(239,68,68,0.06)', borderRadius: 8 }}>
              Rejection reason: {invoice.lineItems[0].qualityRejectionReason}
            </p>
          )}
        </div>
      )}

      {/* Emails Sent */}
      {invoice.emailsSent?.length > 0 && (
        <div className="glass-card" style={{ padding: 22, marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <Mail size={16} color="var(--primary-light)" />
            <h4 style={{ margin: 0, fontSize: 15 }}>Email Notifications Sent</h4>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {invoice.emailsSent.map((email, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'rgba(99,102,241,0.06)', borderRadius: 8 }}>
                <CheckCircle size={12} color="var(--success)" />
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1 }}>{email.to}</span>
                <Badge variant="info" size="sm">{email.type}</Badge>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{email.sentAt ? format(new Date(email.sentAt), 'dd MMM, HH:mm') : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI Agents Results */}
      <div className="glass-card" style={{ padding: 22, marginBottom: 20 }}>
        <h4 style={{ marginBottom: 14, fontSize: 15 }}>AI Agent Results</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {AI_AGENTS.map(agent => {
            const result = aiAnalysis[agent.id];
            const expanded = expandedAgent === agent.id;
            return (
              <div key={agent.id} style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                <button
                  onClick={() => setExpandedAgent(expanded ? null : agent.id)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
                    background: result?.status === 'completed' ? 'rgba(16,185,129,0.04)' : 'rgba(255,255,255,0.02)',
                    border: 'none', cursor: 'pointer', textAlign: 'left'
                  }}
                >
                  <span style={{ fontSize: 18 }}>{agent.icon}</span>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-heading)' }}>{agent.name}</span>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0' }}>{agent.description}</p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {result ? (
                      <Badge variant="success" size="sm">Completed</Badge>
                    ) : (
                      <Badge variant="muted" size="sm">Pending</Badge>
                    )}
                    {expanded ? <ChevronUp size={14} color="var(--text-muted)" /> : <ChevronDown size={14} color="var(--text-muted)" />}
                  </div>
                </button>
                {expanded && result && (
                  <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', background: 'rgba(0,0,0,0.1)' }}>
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
                      {result.result?.message || 'Analysis completed.'}
                    </p>
                    {result.result?.nextSteps && (
                      <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                        {result.result.nextSteps.map((step, j) => (
                          <li key={j} style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>{step}</li>
                        ))}
                      </ul>
                    )}
                    {result.result?.pendingActions && (
                      <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                        {result.result.pendingActions.map((action, j) => (
                          <li key={j} style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
                            {action.action} — {action.assignedTo} ({action.priority} priority, due in {action.dueIn})
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* SAP Posting Actions */}
      <div className="glass-card" style={{ padding: 22 }}>
        <h4 style={{ marginBottom: 14, fontSize: 15 }}>SAP Posting Actions</h4>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          {/* GRN Button */}
          <button
            onClick={postGRN}
            disabled={postingGRN || !['approved', 'validated'].includes(invoice.status) || qualityPending}
            className="btn btn-success"
          >
            {postingGRN
              ? <><div className="spinner" style={{ width: 16, height: 16 }} /> Posting GRN...</>
              : '✓ Post GRN in SAP'}
          </button>

          {/* IR Button */}
          <button
            onClick={postIR}
            disabled={postingIR || invoice.status !== 'grn_posted'}
            className="btn btn-primary"
          >
            {postingIR
              ? <><div className="spinner" style={{ width: 16, height: 16 }} /> Posting IR...</>
              : '✓ Post IR in SAP'}
          </button>

          {/* Credit Memo Button — only for partial rejection, after GRN posted */}
          {(invoice.exceptionType === 'partial_quality') && invoice.grnDocumentNumber && !invoice.creditMemoNumber && (
            <button
              onClick={postCreditMemo}
              disabled={postingCreditMemo}
              className="btn btn-danger"
            >
              {postingCreditMemo
                ? <><div className="spinner" style={{ width: 16, height: 16 }} /> Creating...</>
                : <><CreditCard size={14} /> Create Credit Memo</>}
            </button>
          )}

          {/* Approvals Link */}
          <button className="btn btn-ghost" onClick={() => navigate('/approvals')}>
            <Clock size={14} /> View Approvals <ArrowRight size={14} />
          </button>
        </div>

        {/* Status Messages */}
        {invoice.status === 'rejected' && (
          <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>
            ❌ Invoice rejected. No SAP posting will be done. Buyer and vendor have been notified.
          </p>
        )}
        {qualityPending && invoice.status !== 'rejected' && (
          <p style={{ fontSize: 12, color: 'var(--warning)', marginTop: 6 }}>
            ⚠️ Complete the quality inspection above before posting GRN.
          </p>
        )}
        {!['approved', 'validated', 'grn_posted', 'rejected'].includes(invoice.status) && !qualityPending && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
            ℹ️ Invoice must be approved before SAP posting. Go to Approvals to complete the workflow.
          </p>
        )}
        {invoice.creditMemoStatus === 'pending_buyer' && (
          <p style={{ fontSize: 12, color: 'var(--warning)', marginTop: 6 }}>
            📋 Credit memo is pending buyer approval. Buyer has been notified.
          </p>
        )}
        {invoice.creditMemoStatus === 'buyer_approved' && (
          <p style={{ fontSize: 12, color: 'var(--success)', marginTop: 6 }}>
            ✅ Credit memo approved by buyer. Vendor will be notified for credit note.
          </p>
        )}
      </div>
    </div>
  );
}
