import { useState, useEffect } from 'react';
import { Search, RefreshCw, TrendingUp, AlertTriangle, Shield, Package } from 'lucide-react';
import { vendorAPI } from '../services/api.js';
import Badge from '../components/UI/Badge.jsx';
import { PageLoader } from '../components/UI/LoadingSpinner.jsx';
import { VendorRadarChart } from '../components/Charts/VendorChart.jsx';
import { RISK_CATEGORIES } from '../utils/constants.js';
import { format } from 'date-fns';
import toast from 'react-hot-toast';

const RiskGauge = ({ score }) => {
  const color = score < 25 ? 'var(--success)' : score < 50 ? 'var(--warning)' : score < 75 ? 'var(--danger)' : '#dc2626';
  const r = 54, circ = 2 * Math.PI * r;
  const fill = ((100 - score) / 100) * circ;
  return (
    <div style={{ position: 'relative', width: 130, height: 130 }}>
      <svg viewBox="0 0 120 120" style={{ transform: 'rotate(-90deg)', width: '100%', height: '100%' }}>
        <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="10" />
        <circle cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="10"
          strokeDasharray={circ} strokeDashoffset={fill} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 1s ease' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 24, fontWeight: 800, color, lineHeight: 1 }}>{score}</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>Risk Score</span>
      </div>
    </div>
  );
};

const MetricRow = ({ label, value, total, color }) => {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-heading)' }}>{value}</span>
      </div>
      <div style={{ height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.05)' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color || 'var(--gradient-primary)', borderRadius: 3, transition: 'width 0.8s ease' }} />
      </div>
    </div>
  );
};

export default function VendorHistory() {
  const [vendors, setVendors] = useState([]);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await vendorAPI.getAll({ search });
      setVendors(res.data.vendors || []);
      if (res.data.vendors?.length > 0 && !selected) {
        const vRes = await vendorAPI.getById(res.data.vendors[0].vendorCode);
        setSelected(vRes.data);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const loadVendor = async (code) => {
    try {
      const res = await vendorAPI.getById(code);
      setSelected(res.data);
    } catch (e) { console.error(e); }
  };

  const seedData = async () => {
    setSeeding(true);
    try {
      await vendorAPI.seed();
      toast.success('Sample vendor data loaded!');
      load();
    } catch (e) { toast.error('Seeding failed.'); }
    finally { setSeeding(false); }
  };

  useEffect(() => { load(); }, [search]);

  const vendor = selected?.vendor;
  const recentInvoices = selected?.recentInvoices || [];
  const metrics = vendor?.metrics || {};
  const riskInfo = RISK_CATEGORIES[vendor?.riskCategory] || RISK_CATEGORIES.low;

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <div>
          <h2 className="page-title">Vendor History</h2>
          <p className="page-subtitle">Performance analytics and risk assessment</p>
        </div>
        <button onClick={seedData} disabled={seeding} className="btn btn-secondary btn-sm">
          {seeding ? <div className="spinner" style={{ width: 14, height: 14 }} /> : <Package size={14} />}
          Load Sample Data
        </button>
      </div>

      <div style={{ display: 'flex', gap: 20, minHeight: 0 }}>
        {/* Vendor List Panel */}
        <div style={{ width: 280, flexShrink: 0 }}>
          <div className="glass-card" style={{ padding: 0, overflow: 'hidden', height: '100%' }}>
            <div style={{ padding: '16px 16px 10px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ position: 'relative' }}>
                <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  className="form-input"
                  placeholder="Search vendors..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  style={{ paddingLeft: 34, fontSize: 13 }}
                />
              </div>
            </div>
            <div style={{ overflowY: 'auto', maxHeight: 600 }}>
              {loading ? <PageLoader /> : vendors.length === 0 ? (
                <div className="empty-state" style={{ padding: 30 }}>
                  <p style={{ fontSize: 13 }}>No vendors found</p>
                  <button onClick={seedData} className="btn btn-secondary btn-sm" style={{ marginTop: 8 }}>Load Sample Data</button>
                </div>
              ) : vendors.map(v => {
                const rc = RISK_CATEGORIES[v.riskCategory] || RISK_CATEGORIES.low;
                const isActive = selected?.vendor?.vendorCode === v.vendorCode;
                return (
                  <div
                    key={v.vendorCode}
                    onClick={() => loadVendor(v.vendorCode)}
                    style={{
                      padding: '12px 16px', borderBottom: '1px solid rgba(99,102,241,0.05)',
                      cursor: 'pointer', transition: 'var(--transition)',
                      background: isActive ? 'rgba(99,102,241,0.1)' : 'transparent',
                      borderLeft: isActive ? '2px solid var(--primary)' : '2px solid transparent'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: rc.bg, border: `1px solid ${rc.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: rc.color, flexShrink: 0 }}>
                        {v.vendorName?.charAt(0)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-heading)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>{v.vendorName}</p>
                        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>{v.vendorCode}</p>
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: rc.color }}>{v.riskScore}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Vendor Detail Panel */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {!vendor ? (
            <div className="glass-card empty-state" style={{ height: 400 }}>
              <Shield size={48} />
              <p>Select a vendor to view performance details</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {/* Vendor Header */}
              <div className="glass-card" style={{ padding: 22 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                  <div style={{ width: 54, height: 54, borderRadius: 14, background: riskInfo.bg, border: `1px solid ${riskInfo.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 800, color: riskInfo.color }}>
                    {vendor.vendorName?.charAt(0)}
                  </div>
                  <div style={{ flex: 1 }}>
                    <h3 style={{ margin: 0, marginBottom: 4 }}>{vendor.vendorName}</h3>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{vendor.vendorCode}</span>
                      {vendor.vendorEmail && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>• {vendor.vendorEmail}</span>}
                      <span style={{ padding: '2px 8px', borderRadius: 20, background: riskInfo.bg, color: riskInfo.color, fontSize: 11, fontWeight: 600, border: `1px solid ${riskInfo.color}30` }}>
                        {riskInfo.label}
                      </span>
                    </div>
                  </div>
                  <RiskGauge score={vendor.riskScore || 0} />
                </div>
              </div>

              {/* Metrics + Radar */}
              <div className="grid grid-2">
                <div className="glass-card" style={{ padding: 22 }}>
                  <h4 style={{ marginBottom: 16, fontSize: 15 }}>Performance Metrics</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                    {[
                      { label: 'Total Invoices', value: metrics.totalInvoicesProcessed, icon: '📄', color: 'var(--primary-light)' },
                      { label: 'First-Time Right', value: `${metrics.firstTimeRightPercentage || 0}%`, icon: '✅', color: 'var(--success)' },
                      { label: 'On-Time Delivery', value: `${metrics.onTimeDeliveryPercentage || 0}%`, icon: '🚚', color: 'var(--info)' },
                      { label: 'Avg Resolution', value: `${metrics.avgExceptionResolutionTime || 0}h`, icon: '⏱️', color: 'var(--warning)' }
                    ].map(({ label, value, icon, color }) => (
                      <div key={label} style={{ padding: '10px 12px', background: 'rgba(255,255,255,0.02)', borderRadius: 10, border: '1px solid var(--border)' }}>
                        <p style={{ fontSize: 18 }}>{icon}</p>
                        <p style={{ fontSize: 20, fontWeight: 800, color, margin: '2px 0' }}>{value || 0}</p>
                        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>{label}</p>
                      </div>
                    ))}
                  </div>

                  <MetricRow label="Qty Mismatch Cases" value={metrics.quantityMismatchCases || 0} total={metrics.totalInvoicesProcessed} color="var(--danger)" />
                  <MetricRow label="Price Mismatch Cases" value={metrics.priceMismatchCases || 0} total={metrics.totalInvoicesProcessed} color="var(--warning)" />
                  <MetricRow label="Quality Rejections" value={metrics.qualityRejectionCases || 0} total={metrics.totalInvoicesProcessed} color="var(--warning)" />
                  <MetricRow label="Damaged Goods" value={metrics.damagedGoodsCases || 0} total={metrics.totalInvoicesProcessed} color="var(--danger)" />
                </div>

                <div className="glass-card" style={{ padding: 22 }}>
                  <h4 style={{ marginBottom: 4, fontSize: 15 }}>Performance Radar</h4>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>Multi-dimensional vendor assessment</p>
                  <VendorRadarChart metrics={metrics} />
                  <div style={{ marginTop: 16, padding: '10px 14px', background: 'rgba(255,255,255,0.02)', borderRadius: 10, border: '1px solid var(--border)' }}>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      Total Value Processed: <strong style={{ color: 'var(--text-heading)' }}>${(metrics.totalValueProcessed || 0).toLocaleString()}</strong>
                    </p>
                    {vendor.lastTransactionDate && (
                      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                        Last Transaction: <strong style={{ color: 'var(--text-heading)' }}>{format(new Date(vendor.lastTransactionDate), 'dd MMM yyyy')}</strong>
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Recent Transactions */}
              {recentInvoices.length > 0 && (
                <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
                  <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--border)' }}>
                    <h4 style={{ margin: 0, fontSize: 15 }}>Recent Transactions</h4>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Invoice #</th>
                          <th>PO Number</th>
                          <th>Exception</th>
                          <th>Status</th>
                          <th>Value</th>
                          <th>Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recentInvoices.map(inv => (
                          <tr key={inv._id}>
                            <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{inv.invoiceNumber}</td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{inv.poNumber}</td>
                            <td>
                              <Badge variant={inv.exceptionType === 'none' ? 'success' : 'warning'} size="sm">
                                {inv.exceptionType === 'none' ? 'None' : inv.exceptionType?.replace(/_/g, ' ')}
                              </Badge>
                            </td>
                            <td>
                              <Badge variant={inv.status === 'ir_posted' || inv.status === 'completed' ? 'success' : inv.status === 'rejected' ? 'danger' : 'info'} size="sm">
                                {inv.status?.replace(/_/g, ' ')}
                              </Badge>
                            </td>
                            <td style={{ fontSize: 13 }}>{inv.totalInvoiceValue ? `$${parseFloat(inv.totalInvoiceValue).toLocaleString()}` : '—'}</td>
                            <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{format(new Date(inv.createdAt), 'dd MMM yyyy')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
