import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { requestAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';

const STATUS_STYLES = {
  submitted:        { bg: '#ede9fe', color: '#7c3aed' },
  pending_approval: { bg: '#fef3c7', color: '#d97706' },
  approved:         { bg: '#dcfce7', color: '#16a34a' },
  rejected:         { bg: '#fee2e2', color: '#dc2626' },
  in_progress:      { bg: '#dbeafe', color: '#2563eb' },
  deployed:         { bg: '#f3e8ff', color: '#9333ea' },
  closed:           { bg: '#f3f4f6', color: '#6b7280' }
};

const TYPE_ICONS = {
  access: '🔑', skills: '🎓', connectors: '🔌',
  plugins: '🧩', apis: '⚡', support_qa: '🎫'
};

const PRIORITY_DOT = { low: '#22c55e', medium: '#f59e0b', high: '#ef4444', critical: '#7c3aed' };

export default function RequestsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [requests, setRequests] = useState([]);
  const [pagination, setPagination] = useState({});
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: '', type: '', priority: '', page: 1 });
  const [approveModal, setApproveModal] = useState(null); // { request, decision }
  const [comment, setComment] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const canApprove = ['manager', 'tech_lead', 'architect', 'admin', 'support', 'cto'].includes(user?.role);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { ...filters };
      if (!params.status) delete params.status;
      if (!params.type) delete params.type;
      if (!params.priority) delete params.priority;
      const { data } = await requestAPI.getAll(params);
      setRequests(data.requests);
      setPagination(data.pagination);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const handleDecision = async () => {
    if (!approveModal) return;
    setActionLoading(true);
    try {
      await requestAPI.decide(approveModal.request._id, approveModal.decision, comment);
      setApproveModal(null);
      setComment('');
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Action failed');
    } finally {
      setActionLoading(false);
    }
  };

  const isCurrentApprover = (req) => {
    const step = req.approvalSteps?.[req.currentApprovalStep];
    return step?.approver?._id === user?._id && step?.status === 'pending';
  };

  return (
    <div style={styles.page}>
      <div style={styles.topBar}>
        <h1 style={styles.pageTitle}>Requests</h1>
        <button style={styles.newBtn} onClick={() => navigate('/chat')}>+ New Request</button>
      </div>

      {/* Filters */}
      <div style={styles.filterRow}>
        {[
          { key: 'status', label: 'Status', options: ['','submitted','pending_approval','approved','rejected','in_progress','deployed','closed'] },
          { key: 'type', label: 'Type', options: ['','access','skills','connectors','plugins','apis','support_qa'] },
          { key: 'priority', label: 'Priority', options: ['','low','medium','high','critical'] },
        ].map(f => (
          <select
            key={f.key}
            value={filters[f.key]}
            onChange={e => setFilters(prev => ({ ...prev, [f.key]: e.target.value, page: 1 }))}
            style={styles.filterSelect}
          >
            {f.options.map(o => (
              <option key={o} value={o}>{o ? o.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : `All ${f.label}s`}</option>
            ))}
          </select>
        ))}
        <button style={styles.clearBtn} onClick={() => setFilters({ status: '', type: '', priority: '', page: 1 })}>
          Clear
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div style={styles.loading}>Loading requests…</div>
      ) : requests.length === 0 ? (
        <div style={styles.empty}>
          <div style={{ fontSize: 48 }}>📭</div>
          <p>No requests found. Try adjusting your filters or submit a new request.</p>
          <button style={styles.newBtn} onClick={() => navigate('/chat')}>Submit Request</button>
        </div>
      ) : (
        <>
          <div style={styles.tableWrapper}>
            <table style={styles.table}>
              <thead>
                <tr style={styles.thead}>
                  {['Ref ID', 'Type', 'Title', 'Requester', 'Priority', 'Status', 'Created', 'Actions'].map(h => (
                    <th key={h} style={styles.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {requests.map(req => (
                  <tr key={req._id} style={styles.tr} onClick={() => navigate(`/requests/${req._id}`)}>
                    <td style={styles.td}><span style={styles.refId}>{req.referenceId}</span></td>
                    <td style={styles.td}>
                      <span title={req.type}>{TYPE_ICONS[req.type] || '📋'} {req.type?.replace(/_/g, ' ')}</span>
                    </td>
                    <td style={{ ...styles.td, maxWidth: 220 }}>
                      <div style={styles.ellipsis}>{req.title}</div>
                    </td>
                    <td style={styles.td}>{req.requester?.name || '—'}</td>
                    <td style={styles.td}>
                      <span style={{ display:'flex', alignItems:'center', gap:6 }}>
                        <span style={{ width:8, height:8, borderRadius:'50%', background: PRIORITY_DOT[req.priority], display:'inline-block' }} />
                        {req.priority}
                      </span>
                    </td>
                    <td style={styles.td}>
                      <span style={{ ...styles.badge, ...STATUS_STYLES[req.status] }}>
                        {req.status?.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td style={styles.td}>{new Date(req.createdAt).toLocaleDateString()}</td>
                    <td style={styles.td} onClick={e => e.stopPropagation()}>
                      {canApprove && isCurrentApprover(req) && (
                        <div style={{ display:'flex', gap:6 }}>
                          <button style={styles.approveBtn} onClick={() => setApproveModal({ request: req, decision: 'approved' })}>✓</button>
                          <button style={styles.rejectBtn} onClick={() => setApproveModal({ request: req, decision: 'rejected' })}>✗</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div style={styles.pagRow}>
            <span style={styles.pagInfo}>
              Showing {requests.length} of {pagination.total} requests
            </span>
            <div style={styles.pagBtns}>
              <button
                style={filters.page <= 1 ? styles.pagBtnOff : styles.pagBtn}
                disabled={filters.page <= 1}
                onClick={() => setFilters(p => ({ ...p, page: p.page - 1 }))}
              >‹ Prev</button>
              <span style={styles.pagNum}>Page {filters.page} of {pagination.pages || 1}</span>
              <button
                style={filters.page >= (pagination.pages || 1) ? styles.pagBtnOff : styles.pagBtn}
                disabled={filters.page >= (pagination.pages || 1)}
                onClick={() => setFilters(p => ({ ...p, page: p.page + 1 }))}
              >Next ›</button>
            </div>
          </div>
        </>
      )}

      {/* Approve/Reject Modal */}
      {approveModal && (
        <div style={styles.modalOverlay} onClick={() => setApproveModal(null)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>
              {approveModal.decision === 'approved' ? '✅ Approve Request' : '❌ Reject Request'}
            </h3>
            <p style={styles.modalSub}>
              <strong>{approveModal.request.referenceId}</strong> — {approveModal.request.title}
            </p>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              style={styles.commentArea}
              placeholder={approveModal.decision === 'approved' ? 'Optional: Add approval notes…' : 'Required: Reason for rejection…'}
              rows={3}
            />
            <div style={styles.modalActions}>
              <button style={styles.cancelBtn} onClick={() => setApproveModal(null)}>Cancel</button>
              <button
                style={approveModal.decision === 'approved' ? styles.confirmApprove : styles.confirmReject}
                onClick={handleDecision}
                disabled={actionLoading || (approveModal.decision === 'rejected' && !comment.trim())}
              >
                {actionLoading ? 'Processing…' : approveModal.decision === 'approved' ? 'Approve' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  page: { padding: 24, maxWidth: 1200, margin: '0 auto' },
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  pageTitle: { fontSize: 22, fontWeight: 700, color: '#111', margin: 0 },
  newBtn: {
    background: 'linear-gradient(135deg, #2563eb, #7c3aed)', color: '#fff',
    border: 'none', borderRadius: 8, padding: '9px 18px', fontWeight: 700, fontSize: 14, cursor: 'pointer'
  },
  filterRow: { display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' },
  filterSelect: { border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px', fontSize: 13, background: '#fff', outline: 'none' },
  clearBtn: { border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer', background: '#fff' },
  loading: { textAlign: 'center', padding: 60, color: '#6b7280' },
  empty: { textAlign: 'center', padding: 60, color: '#6b7280' },
  tableWrapper: { overflowX: 'auto', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', background: '#fff' },
  table: { width: '100%', borderCollapse: 'collapse' },
  thead: { background: '#f9fafb' },
  th: { padding: '12px 14px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' },
  tr: { borderTop: '1px solid #f3f4f6', cursor: 'pointer', transition: 'background 0.1s' },
  td: { padding: '13px 14px', fontSize: 13, color: '#374151', verticalAlign: 'middle' },
  refId: { fontFamily: 'monospace', fontSize: 12, color: '#6b7280' },
  ellipsis: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  badge: { borderRadius: 6, padding: '3px 10px', fontSize: 11, fontWeight: 600, textTransform: 'capitalize' },
  approveBtn: { background: '#dcfce7', color: '#16a34a', border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontWeight: 700 },
  rejectBtn: { background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontWeight: 700 },
  pagRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 },
  pagInfo: { fontSize: 13, color: '#6b7280' },
  pagBtns: { display: 'flex', gap: 10, alignItems: 'center' },
  pagBtn: { border: '1px solid #d1d5db', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 13, background: '#fff' },
  pagBtnOff: { border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 14px', cursor: 'not-allowed', fontSize: 13, background: '#f9fafb', color: '#9ca3af' },
  pagNum: { fontSize: 13, color: '#374151' },
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 },
  modal: { background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 440, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' },
  modalTitle: { fontSize: 18, fontWeight: 700, color: '#111', margin: '0 0 8px' },
  modalSub: { fontSize: 13, color: '#6b7280', marginBottom: 14 },
  commentArea: { width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: 10, fontSize: 13, resize: 'vertical', outline: 'none', boxSizing: 'border-box' },
  modalActions: { display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14 },
  cancelBtn: { border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', background: '#fff', fontSize: 13 },
  confirmApprove: { background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', cursor: 'pointer', fontWeight: 700, fontSize: 13 },
  confirmReject: { background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', cursor: 'pointer', fontWeight: 700, fontSize: 13 }
};
