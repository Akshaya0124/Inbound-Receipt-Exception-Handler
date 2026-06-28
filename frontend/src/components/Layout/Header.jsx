import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bell, Search, Plus, ChevronRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';

const pageTitles = {
  '/': { title: 'Dashboard', subtitle: 'Overview of invoice processing and exceptions' },
  '/invoices': { title: 'Invoice Processing', subtitle: 'Upload and process vendor invoices' },
  '/approvals': { title: 'Approval Workflow', subtitle: 'Review and approve pending requests' },
  '/vendors': { title: 'Vendor History', subtitle: 'Vendor performance analytics and risk assessment' },
  '/sap-documents': { title: 'SAP Documents', subtitle: 'GRN, IR and credit memo document status' }
};

export default function Header() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [time, setTime] = useState(new Date());
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const path = location.pathname;
  const matchedKey = Object.keys(pageTitles).find(k => k !== '/' && path.startsWith(k)) || '/';
  const { title, subtitle } = pageTitles[matchedKey] || pageTitles['/'];

  return (
    <header style={{
      position: 'fixed', top: 0, left: 'var(--sidebar-width)', right: 0,
      height: 'var(--header-height)', background: 'var(--bg-header)',
      backdropFilter: 'blur(20px)', borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', padding: '0 28px',
      justifyContent: 'space-between', zIndex: 90, transition: 'var(--transition-slow)'
    }}>
      {/* Left - Breadcrumb + Title */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 1 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Invoice Handler</span>
          <ChevronRight size={12} color="var(--text-muted)" />
          <span style={{ fontSize: 11, color: 'var(--primary-light)', fontWeight: 500 }}>{title}</span>
        </div>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-heading)', lineHeight: 1.2 }}>{title}</h1>
      </div>

      {/* Right - Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Live Clock */}
        <div style={{
          padding: '5px 12px', borderRadius: 20,
          background: 'rgba(99,102,241,0.08)',
          border: '1px solid rgba(99,102,241,0.15)',
          fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)'
        }}>
          {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </div>

        {/* SAP Status */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 12px', borderRadius: 20,
          background: 'rgba(16,185,129,0.08)',
          border: '1px solid rgba(16,185,129,0.2)',
          fontSize: 12, color: 'var(--success)'
        }}>
          <div className="pulse-dot green" style={{ width: 6, height: 6 }} />
          SAP Connected
        </div>

        {/* New Invoice Button */}
        <button
          onClick={() => navigate('/invoices')}
          className="btn btn-primary btn-sm"
        >
          <Plus size={14} />
          New Invoice
        </button>

        {/* Notifications */}
        <button style={{
          background: 'rgba(99,102,241,0.08)', border: '1px solid var(--border)',
          borderRadius: 8, color: 'var(--text-secondary)', padding: '7px 9px',
          cursor: 'pointer', position: 'relative', display: 'flex', alignItems: 'center',
          transition: 'var(--transition)'
        }}
          onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border-hover)'}
          onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
        >
          <Bell size={16} />
          <span style={{
            position: 'absolute', top: 4, right: 4, width: 8, height: 8,
            borderRadius: '50%', background: 'var(--danger)',
            border: '1.5px solid var(--bg-header)'
          }} />
        </button>

        {/* User Avatar */}
        <div style={{
          width: 34, height: 34, borderRadius: '50%',
          background: 'var(--gradient-primary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer',
          boxShadow: 'var(--shadow-glow)'
        }}>
          {user?.name?.charAt(0)?.toUpperCase() || 'U'}
        </div>
      </div>
    </header>
  );
}
