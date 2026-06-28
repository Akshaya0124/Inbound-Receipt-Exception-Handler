import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { Eye, EyeOff, Zap, Shield, Activity, Database } from 'lucide-react';

const DEMO_USERS = [
  { email: 'admin@company.com', password: 'admin123', role: 'Admin', color: '#6366f1' },
  { email: 'buyer@company.com', password: 'buyer123', role: 'Buyer', color: '#10b981' },
  { email: 'warehouse@company.com', password: 'wh123', role: 'Warehouse', color: '#f59e0b' }
];

export default function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'buyer', department: '' });
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    if (mode === 'login') {
      await login(form.email, form.password);
    } else {
      await register(form);
    }
    setLoading(false);
  };

  const setDemo = (user) => setForm(prev => ({ ...prev, email: user.email, password: user.password }));

  const features = [
    { icon: Zap, text: '7 AI Agents' },
    { icon: Shield, text: 'JWT Secured' },
    { icon: Database, text: 'SAP OData' },
    { icon: Activity, text: 'Real-time' }
  ];

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--gradient-bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
    }}>
      {/* Background decoration */}
      <div style={{
        position: 'fixed', top: '20%', left: '10%', width: 400, height: 400,
        borderRadius: '50%', background: 'rgba(99,102,241,0.05)',
        filter: 'blur(60px)', pointerEvents: 'none'
      }} />
      <div style={{
        position: 'fixed', bottom: '20%', right: '10%', width: 300, height: 300,
        borderRadius: '50%', background: 'rgba(139,92,246,0.05)',
        filter: 'blur(60px)', pointerEvents: 'none'
      }} />

      <div style={{ display: 'flex', gap: 40, width: '100%', maxWidth: 1000, alignItems: 'center' }}>
        {/* Left Panel */}
        <div className="animate-slide-in" style={{ flex: 1, display: 'none', minWidth: 0 }}>
        </div>

        {/* Left Branding */}
        <div className="animate-slide-in" style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
            <div style={{
              width: 48, height: 48, borderRadius: 14, background: 'var(--gradient-primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: 'var(--shadow-glow)'
            }}>
              <Zap size={24} color="#fff" />
            </div>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-heading)', margin: 0 }}>
                Receipt Exception
              </h1>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>Handler Platform v1.0</p>
            </div>
          </div>

          <h2 style={{ fontSize: 32, fontWeight: 800, marginBottom: 12, lineHeight: 1.2 }}>
            Intelligent Invoice<br />
            <span className="gradient-text">Exception Management</span>
          </h2>
          <p style={{ fontSize: 15, color: 'var(--text-secondary)', marginBottom: 28, lineHeight: 1.7 }}>
            Automate vendor invoice validation, exception routing, and SAP document posting with AI-powered agents.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 28 }}>
            {features.map(({ icon: Icon, text }) => (
              <div key={text} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                borderRadius: 10, background: 'rgba(99,102,241,0.07)', border: '1px solid var(--border)'
              }}>
                <Icon size={16} color="var(--primary-light)" />
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{text}</span>
              </div>
            ))}
          </div>

          {/* Stats */}
          <div style={{ display: 'flex', gap: 24 }}>
            {[['60%', 'Faster Resolution'], ['85%', 'First-Time Right'], ['100%', 'Audit Trail']].map(([val, lbl]) => (
              <div key={lbl}>
                <div className="gradient-text" style={{ fontSize: 22, fontWeight: 800 }}>{val}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{lbl}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Login Form */}
        <div className="glass-card animate-fade-in" style={{ width: '100%', maxWidth: 420, padding: 32, flexShrink: 0 }}>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 0, marginBottom: 28, background: 'var(--bg-input)', borderRadius: 10, padding: 4 }}>
            {['login', 'register'].map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{
                  flex: 1, padding: '8px 0', border: 'none', cursor: 'pointer',
                  borderRadius: 8, fontWeight: 500, fontSize: 14, transition: 'var(--transition)',
                  background: mode === m ? 'var(--gradient-primary)' : 'transparent',
                  color: mode === m ? '#fff' : 'var(--text-muted)'
                }}
              >
                {m === 'login' ? 'Sign In' : 'Register'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {mode === 'register' && (
              <>
                <div className="form-group">
                  <label className="form-label">Full Name</label>
                  <input className="form-input" placeholder="John Doe" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Role</label>
                  <select className="form-select" value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}>
                    <option value="admin">Admin</option>
                    <option value="buyer">Buyer</option>
                    <option value="warehouse">Warehouse User</option>
                    <option value="quality">Quality Inspector</option>
                    <option value="finance">Finance</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Department</label>
                  <input className="form-input" placeholder="Procurement" value={form.department} onChange={e => setForm(p => ({ ...p, department: e.target.value }))} />
                </div>
              </>
            )}

            <div className="form-group">
              <label className="form-label">Email Address</label>
              <input className="form-input" type="email" placeholder="you@company.com" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} required />
            </div>

            <div className="form-group">
              <label className="form-label">Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  className="form-input"
                  type={showPwd ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={form.password}
                  onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                  style={{ paddingRight: 40 }}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(p => !p)}
                  style={{
                    position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
                    display: 'flex', alignItems: 'center'
                  }}
                >
                  {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button type="submit" className="btn btn-primary" style={{ marginTop: 4, padding: '12px', fontSize: 15, fontWeight: 600 }} disabled={loading}>
              {loading ? <><div className="spinner" style={{ width: 18, height: 18 }} /> Processing...</> : mode === 'login' ? 'Sign In to Dashboard' : 'Create Account'}
            </button>
          </form>

          {mode === 'login' && (
            <div style={{ marginTop: 20 }}>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginBottom: 10 }}>
                Demo credentials — click to fill:
              </p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {DEMO_USERS.map(u => (
                  <button
                    key={u.email}
                    onClick={() => setDemo(u)}
                    style={{
                      padding: '5px 10px', borderRadius: 6, border: `1px solid ${u.color}40`,
                      background: `${u.color}15`, color: u.color, fontSize: 12,
                      cursor: 'pointer', fontWeight: 500, transition: 'var(--transition)'
                    }}
                  >
                    {u.role}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
