import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText, AlertTriangle, CheckSquare, Database, TrendingUp,
  Activity, Users, RefreshCw, CreditCard, Shield, CheckCircle, Package
} from 'lucide-react';
import { dashboardAPI } from '../services/api.js';
import StatsCard from '../components/UI/StatsCard.jsx';
import Badge from '../components/UI/Badge.jsx';
import { MonthlyTrendChart, ExceptionPieChart } from '../components/Charts/VendorChart.jsx';
import { INVOICE_STATUS, EXCEPTION_TYPES } from '../utils/constants.js';
import { format } from 'date-fns';

export default function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const [statsRes, actRes] = await Promise.all([
        dashboardAPI.getStats(),
        dashboardAPI.getActivity()
      ]);
      setStats(statsRes.data);
      setActivity(actRes.data.activities || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, []);

  const s = stats?.stats || {};

  const kpiCards = [
    { label: 'Total Invoices', value: s.totalInvoices, icon: FileText, color: 'primary', trendLabel: 'All time' },
    { label: 'Matched Invoices', value: s.matchedInvoices, icon: CheckCircle, color: 'success', trendLabel: 'No exceptions' },
    { label: 'Pending Exceptions', value: s.pendingExceptions, icon: AlertTriangle, color: 'danger', trendLabel: 'Need attention' },
    { label: 'Pending Approvals', value: s.pendingApprovals, icon: CheckSquare, color: 'warning', trendLabel: 'Awaiting action' },
    { label: 'GRNs Posted', value: s.grnPostedCount, icon: Database, color: 'success', trendLabel: 'All time' },
    { label: 'IRs Posted', value: s.irPostedCount, icon: TrendingUp, color: 'success', trendLabel: 'Completed' },
    { label: 'Credit Memo Pending', value: s.creditMemoPending, icon: CreditCard, color: 'warning', trendLabel: 'Buyer action needed' },
    { label: 'Quality Rejected', value: s.qualityRejectedCount, icon: Package, color: 'danger', trendLabel: 'Quality issues' },
    { label: 'Total Rejected', value: s.rejectedCount, icon: AlertTriangle, color: 'danger', trendLabel: 'Qty > PO' },
    { label: 'At-Risk Vendors', value: s.criticalVendors, icon: Users, color: 'danger', trendLabel: 'High/Critical' },
    { label: 'Resolution Rate', value: `${s.resolutionRate || 0}%`, icon: Activity, color: 'info', trendLabel: 'GRN/Total' },
    { label: 'Vendor Risk Count', value: s.criticalVendors, icon: Shield, color: 'warning', trendLabel: 'Review needed' }
  ];

  const getStatusBadge = (status) => {
    const info = INVOICE_STATUS[status] || { label: status, color: 'muted' };
    return <Badge variant={info.color} size="sm">{info.label}</Badge>;
  };

  const getExceptionBadge = (type) => {
    if (!type || type === 'none') return <Badge variant="success" size="sm">None</Badge>;
    const info = EXCEPTION_TYPES[type] || { label: type, color: 'muted' };
    return <Badge variant={info.color} size="sm">{info.label}</Badge>;
  };

  const vendorExceptions = stats?.vendorExceptionSummary || [];

  return (
    <div className="animate-fade-in">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h2 className="page-title">Operations Dashboard</h2>
          <p className="page-subtitle">Real-time invoice processing and exception overview</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => load(true)} className="btn btn-ghost btn-sm" disabled={refreshing}>
            <RefreshCw size={14} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
          <button onClick={() => navigate('/invoices')} className="btn btn-primary btn-sm">
            + Upload Invoice
          </button>
        </div>
      </div>

      {/* KPI Grid — 4 columns, 3 rows */}
      <div className="grid grid-4" style={{ marginBottom: 24 }}>
        {kpiCards.map((card) => (
          <StatsCard key={card.label} loading={loading} {...card} />
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-2" style={{ marginBottom: 24 }}>
        <div className="glass-card" style={{ padding: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <h4 style={{ margin: 0, fontSize: 15 }}>Invoice Processing Trend</h4>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0' }}>Last 6 months</p>
            </div>
            <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-secondary)' }}>
                <span style={{ width: 10, height: 2, background: '#6366f1', borderRadius: 1, display: 'inline-block' }} />Total
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-secondary)' }}>
                <span style={{ width: 10, height: 2, background: '#10b981', borderRadius: 1, display: 'inline-block' }} />Matched
              </span>
            </div>
          </div>
          <MonthlyTrendChart data={stats?.charts?.monthlyTrend || []} />
        </div>

        <div className="glass-card" style={{ padding: 22 }}>
          <div style={{ marginBottom: 16 }}>
            <h4 style={{ margin: 0, fontSize: 15 }}>Exception Breakdown</h4>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0' }}>By exception type</p>
          </div>
          <ExceptionPieChart data={stats?.charts?.exceptionBreakdown || []} />
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-2" style={{ marginBottom: 24 }}>
        {/* Recent Invoices */}
        <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h4 style={{ margin: 0, fontSize: 15 }}>Recent Invoices</h4>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0' }}>Latest uploads</p>
            </div>
            <button onClick={() => navigate('/invoices')} className="btn btn-ghost btn-sm">View all →</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            {loading ? (
              <div className="empty-state" style={{ padding: 40 }}><div className="spinner" /></div>
            ) : !stats?.recentInvoices?.length ? (
              <div className="empty-state">
                <FileText size={32} />
                <p>No invoices yet. Upload your first invoice.</p>
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Invoice #</th>
                    <th>PO Number</th>
                    <th>Vendor</th>
                    <th>Exception</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(stats?.recentInvoices || []).map(inv => (
                    <tr key={inv._id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/invoices/${inv._id}`)}>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--primary-light)' }}>{inv.invoiceNumber}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{inv.poNumber}</td>
                      <td style={{ fontSize: 13 }}>{inv.vendorName || '—'}</td>
                      <td>{getExceptionBadge(inv.exceptionType)}</td>
                      <td>{getStatusBadge(inv.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Activity Feed */}
        <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid var(--border)' }}>
            <h4 style={{ margin: 0, fontSize: 15 }}>Activity Feed</h4>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0' }}>Recent system events</p>
          </div>
          <div style={{ overflowY: 'auto', maxHeight: 360 }}>
            {activity.length === 0 ? (
              <div className="empty-state" style={{ padding: 40 }}>
                <Activity size={32} />
                <p>No recent activity</p>
              </div>
            ) : (
              activity.map((act, i) => {
                const colors = {
                  ir_posted: 'success', grn_posted: 'success', validated: 'success', approved: 'success', completed: 'success',
                  exception_raised: 'danger', rejected: 'danger', pending_approval: 'warning', processing: 'info', uploaded: 'info'
                };
                const color = colors[act.type] || 'muted';
                const dotColors = { success: 'var(--success)', danger: 'var(--danger)', warning: 'var(--warning)', info: 'var(--info)', muted: 'var(--text-muted)' };
                return (
                  <div key={i} style={{ padding: '12px 22px', borderBottom: i < activity.length - 1 ? '1px solid rgba(99,102,241,0.05)' : 'none', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', marginTop: 5, flexShrink: 0, background: dotColors[color] || 'var(--text-muted)' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{act.message}</p>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        {act.user && <span style={{ marginRight: 8 }}>{act.user}</span>}
                        <span>{act.timestamp ? format(new Date(act.timestamp), 'MMM d, h:mm a') : ''}</span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Vendor Exception Summary */}
      {vendorExceptions.length > 0 && (
        <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h4 style={{ margin: 0, fontSize: 15 }}>Vendor Exception Summary</h4>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0' }}>Top vendors with exceptions — click to view history</p>
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Total Exceptions</th>
                  <th>Qty Mismatch</th>
                  <th>Price Mismatch</th>
                  <th>Quality Rejection</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {vendorExceptions.map((vendor, i) => (
                  <tr key={i}>
                    <td>
                      <div>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-heading)' }}>{vendor.vendorName || vendor._id}</p>
                        <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{vendor._id}</p>
                      </div>
                    </td>
                    <td>
                      <Badge variant={vendor.totalExceptions > 5 ? 'danger' : vendor.totalExceptions > 2 ? 'warning' : 'info'}>
                        {vendor.totalExceptions}
                      </Badge>
                    </td>
                    <td style={{ fontSize: 13 }}>{vendor.qtyMismatch}</td>
                    <td style={{ fontSize: 13 }}>{vendor.priceMismatch}</td>
                    <td style={{ fontSize: 13, color: vendor.qualityRejection > 0 ? 'var(--danger)' : 'inherit' }}>{vendor.qualityRejection}</td>
                    <td>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => navigate(`/vendors?code=${vendor._id}`)}
                      >
                        View History →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
