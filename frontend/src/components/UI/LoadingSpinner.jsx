export default function LoadingSpinner({ size = 24, message = '' }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: 20 }}>
      <div className="spinner" style={{ width: size, height: size, borderWidth: size > 30 ? 3 : 2 }} />
      {message && <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>{message}</p>}
    </div>
  );
}

export function PageLoader({ message = 'Loading...' }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: 300, flexDirection: 'column', gap: 16
    }}>
      <div className="spinner" style={{ width: 40, height: 40, borderWidth: 3 }} />
      <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>{message}</p>
    </div>
  );
}
