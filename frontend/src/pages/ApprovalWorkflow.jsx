import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, XCircle, Clock, AlertTriangle, RefreshCw, Eye, FileCheck, FileText } from 'lucide-react';
import { approvalAPI } from '../services/api.js';
import Badge from '../components/UI/Badge.jsx';
import Modal from '../components/UI/Modal.jsx';
import { PageLoader } from '../components/UI/LoadingSpinner.jsx';
import { APPROVAL_TYPES } from '../utils/constants.js';
import { format } from 'date-fns';
import toast from 'react-hot-toast';

const PRIORITY_COLORS = {
  urgent: 'danger', high: 'warning', medium: 'info', low: 'muted'
};

export default function ApprovalWorkflow() {
  const navigate = useNavigate();
  const [approvals, setApprovals] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('pending');
  const [selectedApproval, setSelectedApproval] = useState(null);
  const [actionModal, setActionModal] = useState({ open: false, type: '', approval: null });
  const [actionComment, setActionComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sapResult, setSapResult] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [aRes, sRes] = await Promise.all([
        approvalAPI.getAll({ status: filter }),
        approvalAPI.getStats()
      ]);
      setApprovals(aRes.data.approvals || []);
      setStats(sRes.data.stats);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [filter]);

  const handleAction = async () => {
    if (!actionModal.approval) return;
    if (actionModal.type === 'reject' && !actionComment.trim()) {
      return toast.error('Please provide a rejection reason.');
    }
    setSubmitting(true);
    try {
      if (actionModal.type === 'approve') {
        const res = await approvalAPI.approve(actionModal.approval._id, actionComment);
        const { grnNumber, irNumber, sapMode } = res.data;
        setActionModal({ open: false, type: '', approval: null });
        setActionComment('');
        if (grnNumber || irNumber) {
          setSapResult({ grnNumber, irNumber, sapMode });
        } else {
          toast.success('Request approved successfully!');
        }
      } else {
        await approvalAPI.reject(actionModal.approval._id, actionComment);
        toast.success('Request rejected.');
        setActionModal({ open: false, type: '', approval: null });
        setActionComment('');
      }
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Action failed.');
    } finally { setSubmitting(false); }
  };

  const statCards = [
    { label: 'Pending', value: stats?.pending, color: 'var(--warning)', icon: Clock },
    { label: 'Approved', value: stats?.approved, color: 'var(--success)', icon: CheckCircle },
    { label: 'Rejected', value: stats?.rejected, color: 'var(--danger)', icon: XCircle },
    { label: 'Urgent', value: stats?.urgent, color: 'var(--danger)', icon: AlertTriangle }
  ];

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <div>
          <h2 className="page-title">Approval Workflow</h2>
          <p className="page-subtitle">Review and action pending approval requests</p>
        </div>
        <button onClick={load} className="btn btn-ghost btn-sm">
          <RefreshCw size={14} />Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-4" style={{ marginBottom: 24 }}>
        {statCards.map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="glass-card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: `${color}20`, border: `1px solid ${color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon size={18} color={color} />
            </div>
            <div>
              <p style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-heading)', lineHeight: 1 }}>{value ?? '—'}</p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {['pending', 'approved', 'rejected'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '7px 18px', borderRadius: 8, border: '1px solid',
              cursor: 'pointer', fontSize: 13, fontWeight: 500,
              transition: 'var(--transition)', fontFamily: 'var(--font-sans)',
              background: filter === f ? 'var(--gradient-primary)' : 'transparent',
              color: filter === f ? '#fff' : 'var(--text-muted)',
              borderColor: filter === f ? 'transparent' : 'var(--border)'
            }}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Approvals Grid */}
      {loading ? <PageLoader message="Loading approvals..." /> : approvals.length === 0 ? (
        <div className="empty-state glass-card" style={{ padding: 60 }}>
          <CheckCircle size={48} />
          <p style={{ fontSize: 16, fontWeight: 500 }}>No {filter} approvals</p>
          <p style={{ fontSize: 14 }}>All caught up!</p>
        </div>
      ) : (
        <div className="grid grid-2" style={{ gap: 16 }}>
          {approvals.map(approval => {
            const ctx = approval.context || {};
            return (
              <div key={approval._id} className="glass-card" style={{ padding: 22, transition: 'var(--transition)' }}>
                {/* Card Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-heading)', marginBottom: 4 }}>
                      {APPROVAL_TYPES[approval.approvalType] || approval.approvalType}
                    </p>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {format(new Date(approval.createdAt), 'dd MMM yyyy, HH:mm')}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexDirection: 'column', alignItems: 'flex-end' }}>
                    <Badge variant={approval.status === 'pending' ? 'warning' : approval.status === 'approved' ? 'success' : 'danger'} dot={approval.status === 'pending'}>
                      {approval.status}
                    </Badge>
                    {approval.priority && (
                      <Badge variant={PRIORITY_COLORS[approval.priority] || 'muted'} size="sm">
                        {approval.priority.toUpperCase()}
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Context */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
                  {[
                    ['Invoice', ctx.invoiceNumber],
                    ['PO Number', ctx.poNumber],
                    ['Vendor', ctx.vendorName],
                    ['Exception', ctx.exceptionType?.replace(/_/g, ' ')],
                    ['Quantity', ctx.quantity ? `${ctx.quantity} units` : null],
                    ['Amount', ctx.amount ? `$${parseFloat(ctx.amount).toLocaleString()}` : null]
                  ].filter(([, v]) => v).map(([lbl, val]) => (
                    <div key={lbl} style={{ padding: '8px 10px', background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>{lbl}</p>
                      <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', fontFamily: ['Invoice', 'PO Number'].includes(lbl) ? 'var(--font-mono)' : 'inherit' }}>{val}</p>
                    </div>
                  ))}
                </div>

                {/* Recommendation */}
                {ctx.recommendedAction && (
                  <div style={{ padding: '8px 12px', background: 'rgba(99,102,241,0.06)', borderRadius: 8, border: '1px solid rgba(99,102,241,0.15)', marginBottom: 14 }}>
                    <p style={{ fontSize: 11, color: 'var(--primary-light)', fontWeight: 600, marginBottom: 3 }}>AI Recommendation</p>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>{ctx.recommendedAction}</p>
                  </div>
                )}

                {/* Rejection reason */}
                {approval.rejectionReason && (
                  <div style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.06)', borderRadius: 8, marginBottom: 14 }}>
                    <p style={{ fontSize: 12, color: 'var(--danger)', margin: 0 }}>Rejection: {approval.rejectionReason}</p>
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {approval.status === 'pending' && (
                    <>
                      <button
                        onClick={() => setActionModal({ open: true, type: 'approve', approval })}
                        className="btn btn-success btn-sm"
                        style={{ flex: 1 }}
                      >
                        <CheckCircle size={13} /> Approve
                      </button>
                      <button
                        onClick={() => setActionModal({ open: true, type: 'reject', approval })}
                        className="btn btn-danger btn-sm"
                        style={{ flex: 1 }}
                      >
                        <XCircle size={13} /> Reject
                      </button>
                    </>
                  )}
                  {approval.invoice?._id && (
                    <button
                      onClick={() => navigate(`/invoices/${approval.invoice._id}`)}
                      className="btn btn-ghost btn-sm"
                    >
                      <Eye size={13} /> View Invoice
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Action Modal */}
      <Modal
        open={actionModal.open}
        onClose={() => { setActionModal({ open: false, type: '', approval: null }); setActionComment(''); }}
        title={actionModal.type === 'approve' ? '✓ Confirm Approval' : '✗ Confirm Rejection'}
        size="sm"
        footer={
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setActionModal({ open: false, type: '', approval: null })}>
              Cancel
            </button>
            <button
              onClick={handleAction}
              disabled={submitting}
              className={`btn ${actionModal.type === 'approve' ? 'btn-success' : 'btn-danger'}`}
            >
              {submitting ? <div className="spinner" style={{ width: 16, height: 16 }} /> : null}
              {submitting && actionModal.type === 'approve' ? 'Posting to SAP...' : actionModal.type === 'approve' ? 'Confirm Approval' : 'Confirm Rejection'}
            </button>
          </div>
        }
      >
        <p style={{ marginBottom: 16, color: 'var(--text-secondary)', fontSize: 14 }}>
          {actionModal.type === 'approve'
            ? 'Approving will automatically post GRN and IR to SAP.'
            : 'Please provide a reason for rejection (required).'}
        </p>
        <div className="form-group">
          <label className="form-label">
            {actionModal.type === 'approve' ? 'Comments (Optional)' : 'Rejection Reason *'}
          </label>
          <textarea
            className="form-textarea"
            placeholder={actionModal.type === 'approve' ? 'Add comments...' : 'State reason for rejection...'}
            value={actionComment}
            onChange={e => setActionComment(e.target.value)}
            required={actionModal.type === 'reject'}
          />
        </div>
      </Modal>

      {/* SAP Document Numbers Result Modal */}
      <Modal
        open={!!sapResult}
        onClose={() => setSapResult(null)}
        title="SAP Documents Posted"
        size="sm"
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-success" onClick={() => setSapResult(null)}>
              Done
            </button>
          </div>
        }
      >
        <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <CheckCircle size={26} color="var(--success)" />
          </div>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 20 }}>
            GRN and IR have been posted to SAP successfully.
            {sapResult?.sapMode === 'mock' && (
              <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>(Demo mode — SAP not connected)</span>
            )}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ padding: '14px 18px', background: 'rgba(34,197,94,0.06)', borderRadius: 10, border: '1px solid rgba(34,197,94,0.2)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(34,197,94,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <FileCheck size={18} color="var(--success)" />
              </div>
              <div style={{ textAlign: 'left' }}>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>GRN Document Number</p>
                <p style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--success)', letterSpacing: '0.5px' }}>
                  {sapResult?.grnNumber || '—'}
                </p>
              </div>
            </div>
            <div style={{ padding: '14px 18px', background: 'rgba(99,102,241,0.06)', borderRadius: 10, border: '1px solid rgba(99,102,241,0.2)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(99,102,241,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <FileText size={18} color="var(--primary-light)" />
              </div>
              <div style={{ textAlign: 'left' }}>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>IR Document Number</p>
                <p style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--primary-light)', letterSpacing: '0.5px' }}>
                  {sapResult?.irNumber || '—'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
