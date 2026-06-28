import { useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDropzone } from 'react-dropzone';
import { Upload, FileText, X, CheckCircle, AlertCircle, Loader, Plus, Trash2, Sparkles, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { invoiceAPI, sapAPI } from '../services/api.js';
import { AI_AGENTS } from '../utils/constants.js';

const DEFAULT_LINE_ITEM = { lineItem: '00010', materialNumber: '', description: '', invoiceQuantity: '', invoicePrice: '', uom: 'EA', plant: '1000', storageLocation: '0001' };

export default function InvoiceUpload() {
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [agentProgress, setAgentProgress] = useState({});
  const [createdInvoice, setCreatedInvoice] = useState(null);
  const [poSapStatus, setPoSapStatus] = useState(null); // null | 'loading' | 'found' | 'not_found'
  const [poSapData, setPoSapData] = useState(null);
  const poDebounceRef = useRef(null);
  const [form, setForm] = useState({
    poNumber: '', invoiceNumber: '', invoiceDate: '', vendorCode: '', vendorName: '',
    vendorEmail: '', buyerEmail: '', buyerName: '', totalInvoiceValue: '', currency: 'USD',
    lineItems: [{ ...DEFAULT_LINE_ITEM }]
  });

  const onDrop = useCallback(async (accepted) => {
    if (!accepted[0]) return;
    setFile(accepted[0]);
    setExtracting(true);
    try {
      const fd = new FormData();
      fd.append('invoice', accepted[0]);
      const res = await invoiceAPI.extract(fd);
      const d = res.data.extracted;
      const extracted = {
        invoiceNumber: d.invoiceNumber,
        invoiceDate: d.invoiceDate,
        poNumber: d.poNumber,
        vendorCode: d.vendorCode,
        vendorName: d.vendorName,
        vendorEmail: d.vendorEmail,
        buyerName: d.buyerName,
        buyerEmail: d.buyerEmail,
        currency: d.currency,
        totalInvoiceValue: d.totalInvoiceValue != null ? String(d.totalInvoiceValue) : null,
        lineItems: d.lineItems?.length > 0
          ? d.lineItems.map((item, i) => ({
              lineItem: `000${(i + 1) * 10}`,
              materialNumber: item.materialNumber || '',
              description: item.description || '',
              invoiceQuantity: item.invoiceQuantity != null ? String(item.invoiceQuantity) : '',
              invoicePrice: item.invoicePrice != null ? String(item.invoicePrice) : '',
              uom: item.uom || 'EA',
              plant: '1000',
              storageLocation: '0001'
            }))
          : null
      };
      setForm(prev => ({
        ...prev,
        ...(extracted.invoiceNumber && { invoiceNumber: extracted.invoiceNumber }),
        ...(extracted.invoiceDate && { invoiceDate: extracted.invoiceDate }),
        ...(extracted.poNumber && { poNumber: extracted.poNumber }),
        ...(extracted.vendorCode && { vendorCode: extracted.vendorCode }),
        ...(extracted.vendorName && { vendorName: extracted.vendorName }),
        ...(extracted.vendorEmail && { vendorEmail: extracted.vendorEmail }),
        ...(extracted.buyerName && { buyerName: extracted.buyerName }),
        ...(extracted.buyerEmail && { buyerEmail: extracted.buyerEmail }),
        ...(extracted.currency && { currency: extracted.currency }),
        ...(extracted.totalInvoiceValue && { totalInvoiceValue: extracted.totalInvoiceValue }),
        ...(extracted.lineItems && { lineItems: extracted.lineItems })
      }));
      toast.success('Invoice data extracted! Please review and confirm the fields.');
      if (d.poNumber) validatePOWithSAP(d.poNumber);
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Extraction failed';
      toast.error(msg, { duration: 6000 });
    } finally {
      setExtracting(false);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, accept: { 'application/pdf': ['.pdf'], 'image/*': ['.png', '.jpg', '.jpeg'] },
    maxFiles: 1, maxSize: 10 * 1024 * 1024
  });

  const validatePOWithSAP = useCallback(async (poNumber) => {
    if (!poNumber || poNumber.length < 4) { setPoSapStatus(null); setPoSapData(null); return; }
    setPoSapStatus('loading');
    try {
      const res = await sapAPI.fetchPO(poNumber);
      const sapPO = res.data?.data;
      if (res.data?.isMock) {
        setPoSapStatus('not_found');
        setPoSapData(null);
      } else {
        setPoSapStatus('found');
        setPoSapData(sapPO);
        // Auto-fill vendor from SAP PO if not already filled
        if (sapPO?.Supplier) {
          setForm(prev => ({
            ...prev,
            vendorCode: prev.vendorCode || sapPO.Supplier,
          }));
        }
        // Auto-fill line items from SAP PO items if not already entered
        const sapItems = sapPO?.to_PurchaseOrderItem?.results || [];
        if (sapItems.length > 0) {
          setForm(prev => {
            const hasUserItems = prev.lineItems.some(l => l.materialNumber || l.invoiceQuantity);
            if (hasUserItems) return prev;
            return {
              ...prev,
              lineItems: sapItems.map((item, i) => ({
                lineItem: item.PurchaseOrderItem || `000${(i + 1) * 10}`,
                materialNumber: item.Material || '',
                description: item.PurchaseOrderItemText || '',
                invoiceQuantity: item.OrderQuantity || '',
                invoicePrice: item.NetPriceAmount || '',
                uom: item.PurchaseOrderQuantityUnit || 'EA',
                plant: item.Plant || '1000',
                storageLocation: item.StorageLocation || '0001'
              }))
            };
          });
        }
        toast.success(`PO ${poNumber} found in SAP.`);
      }
    } catch {
      setPoSapStatus('not_found');
      setPoSapData(null);
    }
  }, []);

  const handlePOChange = (val) => {
    setForm(p => ({ ...p, poNumber: val }));
    setPoSapStatus(null);
    clearTimeout(poDebounceRef.current);
    poDebounceRef.current = setTimeout(() => validatePOWithSAP(val), 800);
  };

  const updateLine = (i, field, val) => {
    const lines = [...form.lineItems];
    lines[i] = { ...lines[i], [field]: val };
    setForm(p => ({ ...p, lineItems: lines }));
  };

  const addLine = () => setForm(p => ({ ...p, lineItems: [...p.lineItems, { ...DEFAULT_LINE_ITEM, lineItem: `000${(p.lineItems.length + 1) * 10}` }] }));
  const removeLine = (i) => setForm(p => ({ ...p, lineItems: p.lineItems.filter((_, idx) => idx !== i) }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.poNumber || !form.vendorCode) return toast.error('PO Number and Vendor Code are required.');

    setLoading(true);
    setStep(2);

    try {
      const fd = new FormData();
      if (file) fd.append('invoice', file);
      Object.entries(form).forEach(([k, v]) => {
        if (k === 'lineItems') fd.append(k, JSON.stringify(v));
        else fd.append(k, v);
      });

      const uploadRes = await invoiceAPI.upload(fd);
      const invoice = uploadRes.data.invoice;
      setCreatedInvoice(invoice);

      // Simulate AI agents processing with progress
      setStep(3);
      const agents = ['invoiceReadingAgent', 'poValidationAgent', 'exceptionClassificationAgent', 'decisionRecommendationAgent', 'routingAgent', 'vendorHistoryAgent'];
      for (let i = 0; i < agents.length; i++) {
        setAgentProgress(prev => ({ ...prev, [agents[i]]: 'running' }));
        await new Promise(r => setTimeout(r, 600));
        setAgentProgress(prev => ({ ...prev, [agents[i]]: 'done' }));
      }

      const processRes = await invoiceAPI.process(invoice._id);
      setCreatedInvoice(processRes.data.invoice);
      setStep(4);
      toast.success('Invoice processed successfully!');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Processing failed. Please try again.');
      setStep(1);
    } finally {
      setLoading(false);
    }
  };

  if (step === 4 && createdInvoice) {
    return (
      <div className="animate-fade-in" style={{ maxWidth: 700, margin: '0 auto' }}>
        <div className="glass-card" style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(16,185,129,0.15)', border: '2px solid var(--success)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', animation: 'glow 2s ease infinite' }}>
            <CheckCircle size={36} color="var(--success)" />
          </div>
          <h2 style={{ fontSize: 22, marginBottom: 8 }}>Invoice Processed Successfully!</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 28 }}>
            AI agents have analyzed the invoice and identified{' '}
            <strong style={{ color: createdInvoice.exceptionType === 'none' ? 'var(--success)' : 'var(--warning)' }}>
              {createdInvoice.exceptionType === 'none' ? 'no exceptions' : `a ${createdInvoice.exceptionType?.replace(/_/g, ' ')} exception`}
            </strong>.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 28, textAlign: 'left' }}>
            {[
              ['Invoice Number', createdInvoice.invoiceNumber],
              ['PO Number', createdInvoice.poNumber],
              ['Status', createdInvoice.status?.replace(/_/g, ' ')?.toUpperCase()],
              ['AI Confidence', `${createdInvoice.aiConfidenceScore || 0}%`]
            ].map(([lbl, val]) => (
              <div key={lbl} style={{ padding: '12px 16px', background: 'rgba(255,255,255,0.03)', borderRadius: 10, border: '1px solid var(--border)' }}>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{lbl}</p>
                <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-heading)', fontFamily: 'var(--font-mono)' }}>{val}</p>
              </div>
            ))}
          </div>

          {createdInvoice.recommendedAction && (
            <div style={{ padding: 16, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 10, marginBottom: 24, textAlign: 'left' }}>
              <p style={{ fontSize: 12, color: 'var(--primary-light)', fontWeight: 600, marginBottom: 4 }}>AI Recommendation</p>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>{createdInvoice.recommendedAction}</p>
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button className="btn btn-secondary" onClick={() => navigate('/')}>Back to Dashboard</button>
            <button className="btn btn-primary" onClick={() => navigate(`/invoices/${createdInvoice._id}`)}>View Details & Approve →</button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 3) {
    return (
      <div className="animate-fade-in" style={{ maxWidth: 640, margin: '0 auto' }}>
        <div className="glass-card" style={{ padding: 32 }}>
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 20px', borderRadius: 20, background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)', marginBottom: 16 }}>
              <div className="spinner" style={{ width: 16, height: 16 }} />
              <span style={{ fontSize: 13, color: 'var(--primary-light)', fontWeight: 500 }}>AI Agents Processing</span>
            </div>
            <h3 style={{ fontSize: 20 }}>Analyzing your invoice...</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Multiple AI agents are validating and classifying your invoice</p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {AI_AGENTS.map((agent) => {
              const status = agentProgress[agent.id];
              return (
                <div key={agent.id} style={{
                  display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px',
                  borderRadius: 10, border: '1px solid var(--border)',
                  background: status === 'done' ? 'rgba(16,185,129,0.06)' : status === 'running' ? 'rgba(99,102,241,0.08)' : 'rgba(255,255,255,0.02)',
                  borderColor: status === 'done' ? 'rgba(16,185,129,0.25)' : status === 'running' ? 'rgba(99,102,241,0.3)' : 'var(--border)',
                  transition: 'var(--transition)'
                }}>
                  <span style={{ fontSize: 20 }}>{agent.icon}</span>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-heading)', margin: 0 }}>{agent.name}</p>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0' }}>{agent.description}</p>
                  </div>
                  <div>
                    {status === 'done' && <CheckCircle size={18} color="var(--success)" />}
                    {status === 'running' && <div className="spinner" style={{ width: 18, height: 18 }} />}
                    {!status && <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'rgba(255,255,255,0.1)' }} />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <div>
          <h2 className="page-title">Upload Invoice</h2>
          <p className="page-subtitle">Upload vendor invoice for AI-powered validation and processing</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="grid grid-2" style={{ gap: 24 }}>
          {/* Left Column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* File Upload */}
            <div className="glass-card" style={{ padding: 22 }}>
              <h4 style={{ marginBottom: 14, fontSize: 15 }}>Invoice File</h4>
              <div
                {...getRootProps()}
                style={{
                  border: `2px dashed ${isDragActive ? 'var(--primary)' : 'var(--border)'}`,
                  borderRadius: 12, padding: '28px 20px', textAlign: 'center',
                  cursor: 'pointer', transition: 'var(--transition)',
                  background: isDragActive ? 'rgba(99,102,241,0.05)' : 'rgba(255,255,255,0.02)'
                }}
              >
                <input {...getInputProps()} />
                {file && extracting ? (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 10 }}>
                      <div className="spinner" style={{ width: 24, height: 24 }} />
                      <Sparkles size={20} color="var(--primary-light)" />
                    </div>
                    <p style={{ color: 'var(--primary-light)', fontWeight: 600, fontSize: 14 }}>Reading invoice with AI...</p>
                    <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>{file.name}</p>
                  </div>
                ) : file ? (
                  <div>
                    <FileText size={36} color="var(--success)" style={{ margin: '0 auto 10px' }} />
                    <p style={{ color: 'var(--success)', fontWeight: 600 }}>{file.name}</p>
                    <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>{(file.size / 1024).toFixed(1)} KB — Fields auto-filled below</p>
                    <button type="button" onClick={(e) => { e.stopPropagation(); setFile(null); setForm({ poNumber: '', invoiceNumber: '', invoiceDate: '', vendorCode: '', vendorName: '', vendorEmail: '', buyerEmail: '', buyerName: '', totalInvoiceValue: '', currency: 'USD', lineItems: [{ ...DEFAULT_LINE_ITEM }] }); }}
                      style={{ marginTop: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, color: 'var(--danger)', padding: '4px 12px', cursor: 'pointer', fontSize: 12 }}>
                      Remove
                    </button>
                  </div>
                ) : (
                  <>
                    <Upload size={36} color="var(--text-muted)" style={{ margin: '0 auto 12px' }} />
                    <p style={{ fontWeight: 500, color: 'var(--text-primary)', fontSize: 14 }}>
                      {isDragActive ? 'Drop file here...' : 'Drag & drop or click to upload'}
                    </p>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>PDF, JPG, PNG — max 10MB · AI will auto-fill the fields</p>
                  </>
                )}
              </div>
            </div>

            {/* PO & Invoice Info */}
            <div className="glass-card" style={{ padding: 22 }}>
              <h4 style={{ marginBottom: 14, fontSize: 15 }}>Invoice & PO Details</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    PO Number *
                    {poSapStatus === 'loading' && <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}><div className="spinner" style={{ width: 12, height: 12 }} /> Checking SAP...</span>}
                    {poSapStatus === 'found' && <span style={{ fontSize: 11, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 3 }}><CheckCircle size={12} /> Found in SAP</span>}
                    {poSapStatus === 'not_found' && <span style={{ fontSize: 11, color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: 3 }}><AlertCircle size={12} /> Not found in SAP</span>}
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      className="form-input"
                      placeholder="4500001234"
                      value={form.poNumber}
                      onChange={e => handlePOChange(e.target.value)}
                      required
                      style={{ paddingRight: 36, borderColor: poSapStatus === 'found' ? 'rgba(16,185,129,0.5)' : poSapStatus === 'not_found' ? 'rgba(245,158,11,0.5)' : undefined }}
                    />
                    <Search size={14} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                  </div>
                  {poSapStatus === 'not_found' && (
                    <p style={{ fontSize: 11, color: 'var(--warning)', marginTop: 4 }}>PO not found in SAP system. Please verify the PO number before submitting.</p>
                  )}
                  {poSapData && poSapStatus === 'found' && (
                    <p style={{ fontSize: 11, color: 'var(--success)', marginTop: 4 }}>
                      SAP PO verified — {poSapData.to_PurchaseOrderItem?.results?.length || 0} line item(s) loaded.
                    </p>
                  )}
                </div>
                <div className="form-group">
                  <label className="form-label">Invoice Number</label>
                  <input className="form-input" placeholder="INV-2024-001" value={form.invoiceNumber} onChange={e => setForm(p => ({ ...p, invoiceNumber: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Invoice Date</label>
                  <input className="form-input" type="date" value={form.invoiceDate} onChange={e => setForm(p => ({ ...p, invoiceDate: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Currency</label>
                  <select className="form-select" value={form.currency} onChange={e => setForm(p => ({ ...p, currency: e.target.value }))}>
                    <option>USD</option><option>EUR</option><option>GBP</option><option>INR</option>
                  </select>
                </div>
                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <label className="form-label">Total Invoice Value</label>
                  <input className="form-input" type="number" placeholder="0.00" value={form.totalInvoiceValue} onChange={e => setForm(p => ({ ...p, totalInvoiceValue: e.target.value }))} />
                </div>
              </div>
            </div>
          </div>

          {/* Right Column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Vendor Info */}
            <div className="glass-card" style={{ padding: 22 }}>
              <h4 style={{ marginBottom: 14, fontSize: 15 }}>Vendor Information</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">Vendor Code *</label>
                  <input className="form-input" placeholder="VEND001" value={form.vendorCode} onChange={e => setForm(p => ({ ...p, vendorCode: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Vendor Name</label>
                  <input className="form-input" placeholder="Company Ltd." value={form.vendorName} onChange={e => setForm(p => ({ ...p, vendorName: e.target.value }))} />
                </div>
                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <label className="form-label">Vendor Email</label>
                  <input className="form-input" type="email" placeholder="vendor@company.com" value={form.vendorEmail} onChange={e => setForm(p => ({ ...p, vendorEmail: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Buyer Name</label>
                  <input className="form-input" placeholder="John Smith" value={form.buyerName} onChange={e => setForm(p => ({ ...p, buyerName: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Buyer Email</label>
                  <input className="form-input" type="email" placeholder="buyer@company.com" value={form.buyerEmail} onChange={e => setForm(p => ({ ...p, buyerEmail: e.target.value }))} />
                </div>
              </div>
            </div>

            {/* Line Items */}
            <div className="glass-card" style={{ padding: 22 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <h4 style={{ margin: 0, fontSize: 15 }}>Line Items</h4>
                <button type="button" onClick={addLine} className="btn btn-secondary btn-sm">
                  <Plus size={14} /> Add Line
                </button>
              </div>

              {form.lineItems.map((line, i) => (
                <div key={i} style={{ padding: 14, background: 'rgba(255,255,255,0.02)', borderRadius: 10, border: '1px solid var(--border)', marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--primary-light)' }}>Line {i + 1}</span>
                    {i > 0 && (
                      <button type="button" onClick={() => removeLine(i)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', display: 'flex' }}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                    <div className="form-group">
                      <label className="form-label">Material No.</label>
                      <input className="form-input" placeholder="MAT-001" value={line.materialNumber} onChange={e => updateLine(i, 'materialNumber', e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Inv. Qty *</label>
                      <input className="form-input" type="number" placeholder="0" value={line.invoiceQuantity} onChange={e => updateLine(i, 'invoiceQuantity', e.target.value)} required />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Unit Price *</label>
                      <input className="form-input" type="number" step="0.01" placeholder="0.00" value={line.invoicePrice} onChange={e => updateLine(i, 'invoicePrice', e.target.value)} required />
                    </div>
                    <div className="form-group">
                      <label className="form-label">UOM</label>
                      <select className="form-select" value={line.uom} onChange={e => updateLine(i, 'uom', e.target.value)}>
                        <option>EA</option><option>KG</option><option>MT</option><option>LTR</option><option>PC</option>
                      </select>
                    </div>
                    <div className="form-group" style={{ gridColumn: '2/-1' }}>
                      <label className="form-label">Description</label>
                      <input className="form-input" placeholder="Material description" value={line.description} onChange={e => updateLine(i, 'description', e.target.value)} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Submit */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
          <button type="button" className="btn btn-ghost" onClick={() => navigate('/')}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={loading} style={{ minWidth: 180 }}>
            {loading ? <><div className="spinner" style={{ width: 16, height: 16 }} /> Processing...</> : '🤖 Process with AI Agents'}
          </button>
        </div>
      </form>
    </div>
  );
}
