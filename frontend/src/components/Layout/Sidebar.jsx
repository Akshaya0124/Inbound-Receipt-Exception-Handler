import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import {
  LayoutDashboard, FileText, CheckSquare, Users, Database,
  LogOut, ChevronRight, Activity, Bell, Settings, Zap
} from 'lucide-react';

const navItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { path: '/invoices', label: 'Invoice Processing', icon: FileText, badge: null },
  { path: '/approvals', label: 'Approvals', icon: CheckSquare },
  { path: '/vendors', label: 'Vendor History', icon: Users },
  { path: '/sap-documents', label: 'SAP Documents', icon: Database }
];

export default function Sidebar() {
  const { user, logout } = useAuth();
  const location = useLocation();

  return (
    <aside style={{
      position: 'fixed', left: 0, top: 0, bottom: 0,
      width: 'var(--sidebar-width)', background: 'var(--bg-sidebar)',
      borderRight: '1px solid var(--border)', display: 'flex',
      flexDirection: 'column', zIndex: 100, transition: 'var(--transition-slow)'
    }}>
      {/* Logo */}
      <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'var(--gradient-primary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: 'var(--shadow-glow)'
          }}>
            <Zap size={18} color="#fff" />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-heading)', lineHeight: 1.2 }}>
              Receipt Exception
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.5px' }}>
              HANDLER v1.0
            </div>
          </div>
        </div>
      </div>

      {/* AI Status Banner */}
      <div style={{
        margin: '12px 14px', padding: '8px 12px', borderRadius: 8,
        background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)',
        display: 'flex', alignItems: 'center', gap: 8
      }}>
        <div className="pulse-dot green" />
        <span style={{ fontSize: 12, color: 'var(--primary-light)', fontWeight: 500 }}>
          7 AI Agents Active
        </span>
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, padding: '8px 12px', overflowY: 'auto' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '1.5px', padding: '8px 8px 6px', textTransform: 'uppercase' }}>
          Main Menu
        </div>
        {navItems.map(({ path, label, icon: Icon }) => {
          const isActive = path === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(path);
          return (
            <NavLink
              key={path}
              to={path}
              style={({ isActive: a }) => ({
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                borderRadius: 8, marginBottom: 2, textDecoration: 'none',
                transition: 'var(--transition)', position: 'relative',
                background: isActive ? 'rgba(99,102,241,0.15)' : 'transparent',
                color: isActive ? 'var(--primary-light)' : 'var(--text-secondary)',
                borderLeft: isActive ? '2px solid var(--primary)' : '2px solid transparent'
              })}
            >
              <Icon size={17} />
              <span style={{ fontSize: 13.5, fontWeight: isActive ? 600 : 400 }}>{label}</span>
              {isActive && (
                <ChevronRight size={14} style={{ marginLeft: 'auto', opacity: 0.7 }} />
              )}
            </NavLink>
          );
        })}

        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '1.5px', padding: '16px 8px 6px', textTransform: 'uppercase' }}>
          System
        </div>
        <button
          style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
            borderRadius: 8, width: '100%', background: 'transparent',
            border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
            fontSize: 13.5, transition: 'var(--transition)'
          }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--text-secondary)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
        >
          <Bell size={17} />
          <span>Notifications</span>
        </button>
        <button
          style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
            borderRadius: 8, width: '100%', background: 'transparent',
            border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
            fontSize: 13.5, transition: 'var(--transition)'
          }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--text-secondary)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
        >
          <Settings size={17} />
          <span>Settings</span>
        </button>
      </nav>

      {/* User Profile */}
      <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
          borderRadius: 10, background: 'rgba(99,102,241,0.06)',
          border: '1px solid var(--border)'
        }}>
          <div style={{
            width: 34, height: 34, borderRadius: '50%',
            background: 'var(--gradient-primary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 700, color: '#fff', flexShrink: 0
          }}>
            {user?.name?.charAt(0)?.toUpperCase() || 'U'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-heading)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.name || 'User'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'capitalize' }}>
              {user?.role || 'user'}
            </div>
          </div>
          <button
            onClick={logout}
            title="Logout"
            style={{
              background: 'transparent', border: 'none', color: 'var(--text-muted)',
              cursor: 'pointer', padding: 6, borderRadius: 6, display: 'flex',
              alignItems: 'center', transition: 'var(--transition)'
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--danger)'; e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent'; }}
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>
    </aside>
  );
}
