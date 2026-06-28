export default function Badge({ children, variant = 'primary', dot = false, size = 'md' }) {
  const cls = `badge badge-${variant}`;
  return (
    <span className={cls} style={size === 'sm' ? { fontSize: 11, padding: '2px 8px' } : {}}>
      {dot && <span className={`pulse-dot ${variant === 'success' ? 'green' : variant === 'warning' ? 'yellow' : variant === 'danger' ? 'red' : 'blue'}`} style={{ width: 6, height: 6, flexShrink: 0 }} />}
      {children}
    </span>
  );
}
