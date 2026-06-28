import { useState, useEffect } from 'react';
import { Database, CheckCircle, Clock, Filter, Search, RefreshCw, ExternalLink } from 'lucide-react';
import { invoiceAPI } from '../services/api.js';
import Badge from '../components/UI/Badge.jsx';
import { PageLoader } from '../components/UI/LoadingSpinner.jsx';
import { format } from 'date-fns';

export default function SAPDocuments() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({});

  const load = async () => {
    setLoading(true);
    try {
      const params = { page, limit: 12 };
      if (filter !== 'all') params.status = filter;
      if (search) params.search = search;
      const res = await invoiceAPI.getAll(params);
      setInvoices(res.data.invoices || []);
      setPagination(res.data.pagination || {});
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [filter, search, page]);

  const docStats = [
    { label: 'GRNs Posted', value: invoices.filter(i => i.grnDocumentNumber).length, icon: Database, color: 'var(--success)' },
    { label: 'IRs Posted', value: invoices.filter(i => i.irDocumentNumber).length, icon: CheckCircle, color: 'var(--primary)' },
    { label: 'Pending GRN', value: invoices.filter(i => i.status === 'approved').length, icon: Clock, color: 'var(--warning)' },
    { label: 'Completed', value: invoices.filter(i => ['ir_posted', 'completed'].includes(i.status)).length, icon: CheckCircle, color: 'var(--accent)' }
  ];

  const statusFilters = [
    { val: 'all', label: 'All Documents' },
    { val: 'grn_posted', label: 'GRN Posted' },
    { val: 'ir_posted', label: 'IR Posted' },
    { val: 'approved', label: 'Awaiting GRN' },
    { val: 'completed', label: 'Completed' }
  ];

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <div>
          <h2 className="page-title">SAP Documents</h2>
          <p className="page-subtitle">GRN, IR, and credit memo document status</p>
        </div>
        <button onClick={load} className="btn btn-ghost btn-sm">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-4" style={{ marginBottom: 24 }}>
        {docStats.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="glass-card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: `${color}20`, border: `1px solid ${color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon size={18} color={color} />
            </div>
            <div>
              <p style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-heading)', lineHeight: 1 }}>{value}</p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 320 }}>
          <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            className="form-input"
            placeholder="Search by invoice, PO, or vendor..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            style={{ paddingLeft: 34 }}
          />
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {statusFilters.map(({ val, label }) => (
            <button
              key={val}
              onClick={() => { setFilter(val); setPage(1); }}
              style={{
                padding: '7px 14px', borderRadius: 8, border: '1px solid',
                cursor: 'pointer', fontSize: 12, fontWeight: 500,
                transition: 'var(--transition)', fontFamily: 'var(--font-sans)',
                background: filter === val ? 'var(--gradient-primary)' : 'transparent',
                color: filter === val ? '#fff' : 'var(--text-muted)',
                borderColor: filter === val ? 'transparent' : 'var(--border)'
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Documents Table */}
      <div className="glass-card" style={{ overflow: 'hidden' }}>
        {loading ? <PageLoader message="Loading SAP documents..." /> : invoices.length === 0 ? (
          <div className="empty-state" style={{ padding: 60 }}>
            <Database size={48} />
            <p style={{ fontSize: 15, fontWeight: 500 }}>No documents found</p>
            <p style={{ fontSize: 13 }}>Upload and process invoices to see SAP document numbers here.</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>PO Number</th>
                  <th>Vendor</th>
                  <th>GRN Number</th>
                  <th>GRN Date</th>
                  <th>IR Number</th>
                  <th>IR Date</th>
                  <th>Credit Memo</th>
                  <th>Status</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => (
                  <tr key={inv._id}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--primary-light)' }}>
                      {inv.invoiceNumber}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{inv.poNumber}</td>
                    <td style={{ fontSize: 13, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {inv.vendorName || '—'}
                    </td>
                    <td>
                      {inv.grnDocumentNumber ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <CheckCircle size={12} color="var(--success)" />
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--success)' }}>
                            {inv.grnDocumentNumber}
                          </span>
                        </div>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {inv.grnPostingDate ? format(new Date(inv.grnPostingDate), 'dd MMM yyyy') : '—'}
                    </td>
                    <td>
                      {inv.irDocumentNumber ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <CheckCircle size={12} color="var(--primary)" />
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--primary-light)' }}>
                            {inv.irDocumentNumber}
                          </span>
                        </div>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {inv.irPostingDate ? format(new Date(inv.irPostingDate), 'dd MMM yyyy') : '—'}
                    </td>
                    <td>
                      {inv.creditMemoNumber ? (
                        <Badge variant="warning" size="sm">{inv.creditMemoNumber}</Badge>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                    <td>
                      <Badge
                        variant={['ir_posted', 'completed'].includes(inv.status) ? 'success' : ['grn_posted'].includes(inv.status) ? 'info' : inv.status === 'approved' ? 'warning' : inv.status === 'rejected' ? 'danger' : 'muted'}
                        size="sm"
                      >
                        {inv.status?.replace(/_/g, ' ')}
                      </Badge>
                    </td>
                    <td style={{ fontSize: 13, fontWeight: 500 }}>
                      {inv.totalInvoiceValue ? `$${parseFloat(inv.totalInvoiceValue).toLocaleString()}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {pagination.pages > 1 && (
          <div style={{ padding: '14px 22px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'between', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)', flex: 1 }}>
              Showing {invoices.length} of {pagination.total} documents
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="btn btn-ghost btn-sm">← Prev</button>
              {Array.from({ length: Math.min(5, pagination.pages) }, (_, i) => i + 1).map(p => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  style={{
                    padding: '6px 12px', borderRadius: 6, border: '1px solid',
                    cursor: 'pointer', fontSize: 13, fontWeight: 500,
                    background: page === p ? 'var(--gradient-primary)' : 'transparent',
                    color: page === p ? '#fff' : 'var(--text-muted)',
                    borderColor: page === p ? 'transparent' : 'var(--border)'
                  }}
                >{p}</button>
              ))}
              <button onClick={() => setPage(p => Math.min(pagination.pages, p + 1))} disabled={page === pagination.pages} className="btn btn-ghost btn-sm">Next →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
