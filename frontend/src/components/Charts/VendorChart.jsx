import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, LineChart, Line
} from 'recharts';

const CHART_COLORS = {
  primary: '#6366f1', success: '#10b981', warning: '#f59e0b', danger: '#ef4444', accent: '#06b6d4'
};

export function VendorRadarChart({ metrics }) {
  const data = [
    { subject: 'On-Time Delivery', value: metrics?.onTimeDeliveryPercentage || 0 },
    { subject: 'First-Time Right', value: metrics?.firstTimeRightPercentage || 0 },
    { subject: 'Quality Score', value: Math.max(0, 100 - ((metrics?.qualityRejectionCases || 0) / Math.max(metrics?.totalInvoicesProcessed || 1, 1) * 100)) },
    { subject: 'Price Accuracy', value: Math.max(0, 100 - ((metrics?.priceMismatchCases || 0) / Math.max(metrics?.totalInvoicesProcessed || 1, 1) * 100)) },
    { subject: 'Qty Accuracy', value: Math.max(0, 100 - ((metrics?.quantityMismatchCases || 0) / Math.max(metrics?.totalInvoicesProcessed || 1, 1) * 100)) },
  ];

  return (
    <ResponsiveContainer width="100%" height={220}>
      <RadarChart data={data} cx="50%" cy="50%" outerRadius={80}>
        <PolarGrid stroke="rgba(99,102,241,0.15)" />
        <PolarAngleAxis dataKey="subject" tick={{ fill: '#64748b', fontSize: 11 }} />
        <Radar name="Performance" dataKey="value" stroke="#6366f1" fill="#6366f1" fillOpacity={0.2} strokeWidth={2} />
      </RadarChart>
    </ResponsiveContainer>
  );
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '10px 14px', fontSize: 12
    }}>
      <p style={{ color: 'var(--text-muted)', marginBottom: 6 }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color, margin: '2px 0' }}>
          {p.name}: <strong>{p.value}</strong>
        </p>
      ))}
    </div>
  );
};

export function MonthlyTrendChart({ data }) {
  const formatted = data?.map(d => ({
    month: `${d._id?.month || ''}/${(d._id?.year || '').toString().slice(-2)}`,
    total: d.total,
    matched: d.matched,
    exceptions: d.exceptions
  })) || [];

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={formatted} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="totalGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="matchedGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(99,102,241,0.08)" vertical={false} />
        <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip content={<CustomTooltip />} />
        <Area type="monotone" dataKey="total" name="Total" stroke="#6366f1" fill="url(#totalGrad)" strokeWidth={2} />
        <Area type="monotone" dataKey="matched" name="Matched" stroke="#10b981" fill="url(#matchedGrad)" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function ExceptionPieChart({ data }) {
  const labels = {
    qty_greater: 'Qty Exceeds PO', qty_lesser: 'Qty Below PO',
    price_higher: 'Price Higher', price_lower: 'Price Lower',
    quality_rejection: 'Quality Rejection', damaged: 'Damaged',
    partial_quality: 'Partial Rejection', none: 'No Exception'
  };
  const pieColors = ['#6366f1', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#06b6d4'];

  if (!data?.length) return (
    <div className="empty-state" style={{ height: 220 }}>
      <p>No exception data</p>
    </div>
  );

  const total = data.reduce((s, d) => s + d.count, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0' }}>
      {data.map((item, i) => {
        const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: pieColors[i % pieColors.length], flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {labels[item._id] || item._id}
                </span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-heading)', marginLeft: 8 }}>{item.count}</span>
              </div>
              <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.05)' }}>
                <div style={{ height: '100%', borderRadius: 2, background: pieColors[i % pieColors.length], width: `${pct}%`, transition: 'width 0.8s ease' }} />
              </div>
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 30, textAlign: 'right' }}>{pct}%</span>
          </div>
        );
      })}
    </div>
  );
}
