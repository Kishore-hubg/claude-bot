import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { requestAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';

const STATUS_COLORS = {
  submitted: '#6366f1', pending_approval: '#f59e0b', approved: '#10b981',
  rejected: '#ef4444', in_progress: '#3b82f6', deployed: '#8b5cf6', closed: '#6b7280'
};

const TYPE_COLORS = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#16a34a', '#0891b2'];

const QUICK_ACTIONS = [
  { icon: '🔑', label: 'Request Access', type: 'access', color: '#dbeafe', border: '#93c5fd' },
  { icon: '🎓', label: 'Add Skill', type: 'skills', color: '#ede9fe', border: '#c4b5fd' },
  { icon: '🔌', label: 'New Connector', type: 'connectors', color: '#fce7f3', border: '#f9a8d4' },
  { icon: '🧩', label: 'Deploy Plugin', type: 'plugins', color: '#ffedd5', border: '#fdba74' },
  { icon: '⚡', label: 'API Access', type: 'apis', color: '#dcfce7', border: '#86efac' },
  { icon: '🎫', label: 'Support Ticket', type: 'support_qa', color: '#e0f2fe', border: '#7dd3fc' },
];

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await requestAPI.getStats();
        setStats(data.stats);
      } catch { /* non-admin users won't have stats access */ }
      finally { setLoading(false); }
    };
    load();
  }, []);

  const statusChartData = stats?.byStatus
    ? Object.entries(stats.byStatus).map(([name, value]) => ({
        name: name.replace('_', ' '), value, fill: STATUS_COLORS[name] || '#6b7280'
      }))
    : [];

  const typeChartData = stats?.byType
    ? Object.entries(stats.byType).map(([name, value]) => ({ name, value }))
    : [];

  return (
    <div style={styles.page}>
      {/* Welcome Header */}
      <div style={styles.welcomeCard}>
        <div>
          <h1 style={styles.welcomeTitle}>Welcome back, {user?.name?.split(' ')[0]}! 👋</h1>
          <p style={styles.welcomeSub}>
            {user?.role?.replace('_', ' ').toUpperCase()} · {user?.department || 'InfoVision'}
          </p>
        </div>
        <button style={styles.newRequestBtn} onClick={() => navigate('/chat')}>
          + New Request
        </button>
      </div>

      {/* Quick Action Cards */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Quick Actions</h2>
        <div style={styles.quickGrid}>
          {QUICK_ACTIONS.map(a => (
            <div
              key={a.type}
              style={{ ...styles.quickCard, background: a.color, borderColor: a.border }}
              onClick={() => navigate('/chat', { state: { preload: a.type } })}
            >
              <span style={styles.quickIcon}>{a.icon}</span>
              <span style={styles.quickLabel}>{a.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Stats Section — only shown to approver/admin roles */}
      {stats && (
        <>
          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>Request Overview</h2>
            <div style={styles.statCards}>
              {Object.entries(stats.byStatus || {}).map(([status, count]) => (
                <div key={status} style={{ ...styles.statCard, borderLeft: `4px solid ${STATUS_COLORS[status] || '#999'}` }}>
                  <div style={styles.statCount}>{count}</div>
                  <div style={styles.statLabel}>{status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</div>
                </div>
              ))}
            </div>
          </section>

          <div style={styles.chartsRow}>
            <div style={styles.chartCard}>
              <h3 style={styles.chartTitle}>Requests by Status</h3>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={statusChartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                    {statusChartData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Legend />
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div style={styles.chartCard}>
              <h3 style={styles.chartTitle}>Requests by Type</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={typeChartData} margin={{ left: -10 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {typeChartData.map((_, i) => (
                      <Cell key={i} fill={TYPE_COLORS[i % TYPE_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}

      {/* KPI Cards */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Success Metrics</h2>
        <div style={styles.kpiGrid}>
          {[
            { icon: '⚡', label: 'Processing Time Reduction', value: '70%', sub: 'vs baseline' },
            { icon: '🤖', label: 'Automation Rate', value: '95%', sub: 'target' },
            { icon: '👥', label: 'User Adoption', value: '90%', sub: 'within 6 months' },
            { icon: '⭐', label: 'Satisfaction Score', value: '4.5/5', sub: 'target' },
          ].map(k => (
            <div key={k.label} style={styles.kpiCard}>
              <div style={styles.kpiIcon}>{k.icon}</div>
              <div style={styles.kpiValue}>{k.value}</div>
              <div style={styles.kpiLabel}>{k.label}</div>
              <div style={styles.kpiSub}>{k.sub}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

const styles = {
  page: { padding: 24, maxWidth: 1200, margin: '0 auto' },
  welcomeCard: {
    background: 'linear-gradient(135deg, #1e3a5f, #2563eb)', borderRadius: 16,
    padding: '24px 28px', color: '#fff', display: 'flex', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 28
  },
  welcomeTitle: { fontSize: 24, fontWeight: 700, margin: '0 0 4px' },
  welcomeSub: { fontSize: 13, opacity: 0.8, margin: 0 },
  newRequestBtn: {
    background: '#fff', color: '#2563eb', border: 'none', borderRadius: 8,
    padding: '10px 18px', fontWeight: 700, fontSize: 14, cursor: 'pointer'
  },
  section: { marginBottom: 28 },
  sectionTitle: { fontSize: 17, fontWeight: 700, color: '#111', marginBottom: 14 },
  quickGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 },
  quickCard: {
    border: '1px solid', borderRadius: 12, padding: '18px 14px', cursor: 'pointer',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
    transition: 'transform 0.15s', userSelect: 'none'
  },
  quickIcon: { fontSize: 28 },
  quickLabel: { fontSize: 13, fontWeight: 600, color: '#1f2937', textAlign: 'center' },
  statCards: { display: 'flex', flexWrap: 'wrap', gap: 12 },
  statCard: {
    background: '#fff', borderRadius: 10, padding: '14px 18px', minWidth: 120,
    boxShadow: '0 1px 4px rgba(0,0,0,0.07)'
  },
  statCount: { fontSize: 28, fontWeight: 800, color: '#111' },
  statLabel: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  chartsRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 28 },
  chartCard: { background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.07)' },
  chartTitle: { fontSize: 15, fontWeight: 700, color: '#111', marginBottom: 12 },
  kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 },
  kpiCard: {
    background: '#fff', borderRadius: 12, padding: '20px', textAlign: 'center',
    boxShadow: '0 1px 4px rgba(0,0,0,0.07)'
  },
  kpiIcon: { fontSize: 28, marginBottom: 8 },
  kpiValue: { fontSize: 28, fontWeight: 800, color: '#2563eb' },
  kpiLabel: { fontSize: 13, fontWeight: 600, color: '#374151', margin: '4px 0 2px' },
  kpiSub: { fontSize: 11, color: '#9ca3af' }
};
