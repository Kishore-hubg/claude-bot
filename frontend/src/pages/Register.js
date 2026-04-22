import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';

const ROLES = ['requester', 'manager', 'ai_coe_lead', 'it_governance', 'tech_lead', 'architect', 'support', 'cto', 'admin'];
const apiBaseURL = process.env.REACT_APP_API_URL || '/api';

export default function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'requester', department: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await axios.post(`${apiBaseURL}/auth/register`, form);
      navigate('/login', { state: { message: 'Account created! Please log in.' } });
    } catch (err) {
      setError(err.response?.data?.message || 'Registration failed.');
    } finally {
      setLoading(false);
    }
  };

  const field = (label, key, type = 'text', placeholder = '') => (
    <div style={styles.field}>
      <label style={styles.label}>{label}</label>
      <input
        type={type}
        value={form[key]}
        onChange={e => setForm({ ...form, [key]: e.target.value })}
        style={styles.input}
        placeholder={placeholder}
        required={key !== 'department'}
      />
    </div>
  );

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.brand}>
          <div style={styles.logoCircle}><span style={{ fontSize: 28 }}>🤖</span></div>
          <h1 style={styles.title}>Create Account</h1>
          <p style={styles.subtitle}>Claude Assistant Bot — InfoVision</p>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <form onSubmit={handleSubmit} style={styles.form}>
          {field('Full Name', 'name', 'text', 'Jane Doe')}
          {field('Email', 'email', 'email', 'jane@infovision.com')}
          {field('Password (min 8 chars)', 'password', 'password', '••••••••')}
          {field('Department (optional)', 'department', 'text', 'Engineering')}

          <div style={styles.field}>
            <label style={styles.label}>Role</label>
            <select
              value={form.role}
              onChange={e => setForm({ ...form, role: e.target.value })}
              style={styles.select}
            >
              {ROLES.map(r => (
                <option key={r} value={r}>{r.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
              ))}
            </select>
          </div>

          <button type="submit" style={loading ? styles.btnOff : styles.btn} disabled={loading}>
            {loading ? 'Creating…' : 'Create Account'}
          </button>
        </form>

        <p style={styles.foot}>
          Already have an account? <Link to="/login" style={styles.link}>Sign in</Link>
        </p>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh', background: 'linear-gradient(135deg, #1e3a5f, #0d2137)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
  },
  card: {
    background: '#fff', borderRadius: 16, padding: '36px', width: '100%',
    maxWidth: 440, boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
  },
  brand: { textAlign: 'center', marginBottom: 24 },
  logoCircle: {
    width: 60, height: 60, borderRadius: '50%',
    background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px'
  },
  title: { fontSize: 22, fontWeight: 700, color: '#111', margin: '0 0 4px' },
  subtitle: { fontSize: 13, color: '#6b7280', margin: 0 },
  error: {
    background: '#fef2f2', border: '1px solid #fca5a5', color: '#b91c1c',
    borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13
  },
  form: { display: 'flex', flexDirection: 'column', gap: 14 },
  field: { display: 'flex', flexDirection: 'column', gap: 5 },
  label: { fontSize: 13, fontWeight: 600, color: '#374151' },
  input: { border: '1px solid #d1d5db', borderRadius: 8, padding: '10px 12px', fontSize: 14, outline: 'none' },
  select: { border: '1px solid #d1d5db', borderRadius: 8, padding: '10px 12px', fontSize: 14, outline: 'none', background: '#fff' },
  btn: {
    background: 'linear-gradient(135deg, #2563eb, #7c3aed)', color: '#fff',
    border: 'none', borderRadius: 8, padding: 12, fontSize: 15, fontWeight: 600, cursor: 'pointer'
  },
  btnOff: {
    background: '#9ca3af', color: '#fff', border: 'none',
    borderRadius: 8, padding: 12, fontSize: 15, cursor: 'not-allowed'
  },
  foot: { textAlign: 'center', fontSize: 13, color: '#6b7280', marginTop: 16 },
  link: { color: '#2563eb', fontWeight: 600, textDecoration: 'none' }
};
