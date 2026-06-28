import { TrendingUp, TrendingDown } from 'lucide-react';

export default function StatsCard({ icon: Icon, label, value, trend, trendLabel, color = 'primary', loading = false }) {
  const colors = {
    primary: { bg: 'rgba(99,102,241,0.1)', border: 'rgba(99,102,241,0.2)', color: '#818cf8' },
    success: { bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.2)', color: '#10b981' },
    warning: { bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.2)', color: '#f59e0b' },
    danger: { bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.2)', color: '#ef4444' },
    info: { bg: 'rgba(59,130,246,0.1)', border: 'rgba(59,130,246,0.2)', color: '#3b82f6' }
  };
  const c = colors[color] || colors.primary;

  return (
    <div className="glass-card" style={{
      padding: '20px 22px', position: 'relative', overflow: 'hidden',
      cursor: 'default', transition: 'var(--transition)'
    }}>
      {/* Gradient orb background */}
      <div style={{
        position: 'absolute', top: -20, right: -20, width: 100, height: 100,
        borderRadius: '50%', background: c.bg, filter: 'blur(20px)', pointerEvents: 'none'
      }} />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', position: 'relative' }}>
        <div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {label}
          </p>
          {loading ? (
            <div style={{ height: 32, width: 80, borderRadius: 6, background: 'rgba(255,255,255,0.05)', animation: 'pulse 1.5s ease infinite' }} />
          ) : (
            <div style={{ fontSize: 30, fontWeight: 800, color: 'var(--text-heading)', lineHeight: 1, letterSpacing: '-1px' }}>
              {value ?? '—'}
            </div>
          )}
          {trendLabel && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6 }}>
              {trend > 0 ? (
                <TrendingUp size={13} color="var(--success)" />
              ) : trend < 0 ? (
                <TrendingDown size={13} color="var(--danger)" />
              ) : null}
              <span style={{ fontSize: 12, color: trend > 0 ? 'var(--success)' : trend < 0 ? 'var(--danger)' : 'var(--text-muted)' }}>
                {trendLabel}
              </span>
            </div>
          )}
        </div>

        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: c.bg, border: `1px solid ${c.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0
        }}>
          {Icon && <Icon size={20} color={c.color} />}
        </div>
      </div>
    </div>
  );
}
