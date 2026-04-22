import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(form.email, form.password);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        {/* Logo / Brand */}
        <div style={styles.brand}>
          <div style={styles.logoCircle}>
            <span style={styles.logoIcon}>🤖</span>
          </div>
          <h1 style={styles.title}>Claude Assistant Bot</h1>
          <p style={styles.subtitle}>InfoVision Workflow Automation Platform</p>
        </div>

        {error && <div style={styles.errorBanner}>{error}</div>}

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.field}>
            <label style={styles.label}>Email Address</label>
            <input
              type="email"
              value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })}
              style={styles.input}
              placeholder="you@infovision.com"
              required
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Password</label>
            <input
              type="password"
              value={form.password}
              onChange={e => setForm({ ...form, password: e.target.value })}
              style={styles.input}
              placeholder="••••••••"
              required
            />
          </div>
          <button type="submit" style={loading ? styles.btnDisabled : styles.btn} disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p style={styles.registerText}>
          Don't have an account?{' '}
          <Link to="/register" style={styles.link}>Create one</Link>
        </p>

        {/* Quick demo credentials box */}
        <div style={styles.demoBox}>
          <p style={styles.demoTitle}>Demo Credentials</p>
          <p style={styles.demoLine}><b>Admin:</b> admin@infovision.com / password123</p>
          <p style={styles.demoLine}><b>Manager:</b> manager@infovision.com / password123</p>
          <p style={styles.demoLine}><b>User:</b> user@infovision.com / password123</p>
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh', background: 'linear-gradient(135deg, #1e3a5f 0%, #0d2137 100%)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
  },
  card: {
    background: '#fff', borderRadius: 16, padding: '40px 36px', width: '100%',
    maxWidth: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
  },
  brand: { textAlign: 'center', marginBottom: 28 },
  logoCircle: {
    width: 64, height: 64, borderRadius: '50%',
    background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    margin: '0 auto 12px'
  },
  logoIcon: { fontSize: 28 },
  title: { fontSize: 22, fontWeight: 700, color: '#111', margin: '0 0 4px' },
  subtitle: { fontSize: 13, color: '#6b7280', margin: 0 },
  errorBanner: {
    background: '#fef2f2', border: '1px solid #fca5a5', color: '#b91c1c',
    borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13
  },
  form: { display: 'flex', flexDirection: 'column', gap: 16 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 13, fontWeight: 600, color: '#374151' },
  input: {
    border: '1px solid #d1d5db', borderRadius: 8, padding: '10px 12px',
    fontSize: 14, outline: 'none', transition: 'border-color 0.2s'
  },
  btn: {
    background: 'linear-gradient(135deg, #2563eb, #7c3aed)', color: '#fff',
    border: 'none', borderRadius: 8, padding: '12px', fontSize: 15,
    fontWeight: 600, cursor: 'pointer', marginTop: 4
  },
  btnDisabled: {
    background: '#9ca3af', color: '#fff', border: 'none', borderRadius: 8,
    padding: '12px', fontSize: 15, fontWeight: 600, cursor: 'not-allowed', marginTop: 4
  },
  registerText: { textAlign: 'center', fontSize: 13, color: '#6b7280', marginTop: 16 },
  link: { color: '#2563eb', fontWeight: 600, textDecoration: 'none' },
  demoBox: {
    marginTop: 20, background: '#f0f9ff', border: '1px solid #bae6fd',
    borderRadius: 8, padding: '12px 14px'
  },
  demoTitle: { fontSize: 12, fontWeight: 700, color: '#0369a1', margin: '0 0 6px' },
  demoLine: { fontSize: 12, color: '#0c4a6e', margin: '2px 0' }
};
