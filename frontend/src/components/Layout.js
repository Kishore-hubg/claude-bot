import React, { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { notificationAPI } from '../services/api';

const NAV_ITEMS = [
  { path: '/dashboard', icon: '🏠', label: 'Dashboard' },
  { path: '/chat', icon: '💬', label: 'New Request' },
  { path: '/requests', icon: '📋', label: 'All Requests' },
  { path: '/notifications', icon: '🔔', label: 'Notifications' },
];

const ADMIN_NAV = [
  { path: '/admin/users', icon: '👥', label: 'Users' },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [unreadCount, setUnreadCount] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    const fetchUnread = async () => {
      try {
        const { data } = await notificationAPI.getAll({ unreadOnly: true, limit: 1 });
        setUnreadCount(data.unreadCount || 0);
      } catch { /* silently fail */ }
    };
    fetchUnread();
    // Poll every 30 seconds for new notifications
    const interval = setInterval(fetchUnread, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = () => { logout(); navigate('/login'); };

  const navItems = user?.role === 'admin' ? [...NAV_ITEMS, ...ADMIN_NAV] : NAV_ITEMS;

  return (
    <div style={styles.shell}>
      {/* Sidebar */}
      <aside style={{ ...styles.sidebar, width: sidebarOpen ? 220 : 64, transition: 'width 0.2s' }}>
        {/* Logo */}
        <div style={styles.logo} onClick={() => setSidebarOpen(!sidebarOpen)}>
          <div style={styles.logoIcon}>🤖</div>
          {sidebarOpen && <span style={styles.logoText}>Claude Bot</span>}
        </div>

        {/* Navigation */}
        <nav style={styles.nav}>
          {navItems.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              style={({ isActive }) => ({
                ...styles.navItem,
                ...(isActive ? styles.navItemActive : {})
              })}
            >
              <span style={styles.navIcon}>{item.icon}</span>
              {sidebarOpen && (
                <span style={styles.navLabel}>
                  {item.label}
                  {item.path === '/notifications' && unreadCount > 0 && (
                    <span style={styles.badge}>{unreadCount > 9 ? '9+' : unreadCount}</span>
                  )}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* User profile at bottom */}
        <div style={styles.userSection}>
          <div style={styles.userInfo}>
            <div style={styles.userAvatar}>{user?.name?.[0]?.toUpperCase()}</div>
            {sidebarOpen && (
              <div style={styles.userText}>
                <div style={styles.userName}>{user?.name}</div>
                <div style={styles.userRole}>{user?.role?.replace('_', ' ')}</div>
              </div>
            )}
          </div>
          {sidebarOpen && (
            <button style={styles.logoutBtn} onClick={handleLogout} title="Logout">⏻</button>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main style={styles.main}>
        {/* Top header bar */}
        <div style={styles.topbar}>
          <div style={styles.topbarTitle}>
            {/* Breadcrumb handled by each page */}
          </div>
          <div style={styles.topbarRight}>
            <span style={styles.orgBadge}>InfoVision</span>
            <NavLink to="/notifications" style={styles.notifBtn}>
              🔔 {unreadCount > 0 && <span style={styles.notifBadge}>{unreadCount}</span>}
            </NavLink>
          </div>
        </div>

        {/* Page content injected here */}
        <div style={styles.content}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}

const styles = {
  shell: { display: 'flex', minHeight: '100vh', background: '#f8fafc', fontFamily: 'system-ui, -apple-system, sans-serif' },
  sidebar: {
    background: 'linear-gradient(180deg, #0d2137 0%, #1e3a5f 100%)',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    position: 'sticky', top: 0, height: '100vh', flexShrink: 0
  },
  logo: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '20px 16px',
    cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.1)'
  },
  logoIcon: {
    width: 36, height: 36, borderRadius: 10,
    background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0
  },
  logoText: { color: '#fff', fontWeight: 800, fontSize: 15, whiteSpace: 'nowrap' },
  nav: { flex: 1, padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 2 },
  navItem: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 10px',
    borderRadius: 8, textDecoration: 'none', color: 'rgba(255,255,255,0.65)',
    fontSize: 13, fontWeight: 500, transition: 'all 0.15s'
  },
  navItemActive: { background: 'rgba(255,255,255,0.12)', color: '#fff', fontWeight: 700 },
  navIcon: { fontSize: 18, width: 24, textAlign: 'center', flexShrink: 0 },
  navLabel: { whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 },
  badge: {
    background: '#ef4444', color: '#fff', borderRadius: 10,
    fontSize: 10, padding: '1px 6px', fontWeight: 700
  },
  userSection: {
    borderTop: '1px solid rgba(255,255,255,0.1)', padding: '14px 10px',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8
  },
  userInfo: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
  userAvatar: {
    width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#fff', fontWeight: 700, fontSize: 13, flexShrink: 0
  },
  userText: { minWidth: 0 },
  userName: { color: '#fff', fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  userRole: { color: 'rgba(255,255,255,0.5)', fontSize: 10, textTransform: 'capitalize' },
  logoutBtn: {
    background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff',
    borderRadius: 6, padding: '5px 8px', cursor: 'pointer', fontSize: 14, flexShrink: 0
  },
  main: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 },
  topbar: {
    background: '#fff', borderBottom: '1px solid #e5e7eb',
    padding: '0 24px', height: 56, display: 'flex',
    alignItems: 'center', justifyContent: 'space-between', flexShrink: 0
  },
  topbarTitle: { fontSize: 14, color: '#6b7280' },
  topbarRight: { display: 'flex', alignItems: 'center', gap: 14 },
  orgBadge: {
    background: '#ede9fe', color: '#7c3aed', borderRadius: 6,
    padding: '4px 10px', fontSize: 12, fontWeight: 700
  },
  notifBtn: { position: 'relative', textDecoration: 'none', fontSize: 20 },
  notifBadge: {
    position: 'absolute', top: -4, right: -6, background: '#ef4444',
    color: '#fff', borderRadius: '50%', width: 14, height: 14,
    fontSize: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700
  },
  content: { flex: 1, overflowY: 'auto' }
};
