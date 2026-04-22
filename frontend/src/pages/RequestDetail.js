import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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

const LIFECYCLE = ['submitted', 'pending_approval', 'approved', 'in_progress', 'deployed', 'closed'];

export default function RequestDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [decision, setDecision] = useState('');
  const [comment, setComment] = useState('');
  const [acting, setActing] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await requestAPI.getById(id);
        setRequest(data.request);
      } catch {
        navigate('/requests');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id, navigate]);

  const isCurrentApprover = () => {
    const step = request?.approvalSteps?.[request.currentApprovalStep];
    return step?.approver?._id === user?._id && step?.status === 'pending';
  };

  const handleDecision = async () => {
    setActing(true);
    try {
      await requestAPI.decide(request._id, decision, comment);
      const { data } = await requestAPI.getById(id);
      setRequest(data.request);
      setDecision('');
      setComment('');
    } catch (err) {
      alert(err.response?.data?.message || 'Action failed');
    } finally {
      setActing(false);
    }
  };

  if (loading) return <div style={styles.loading}>Loading request…</div>;
  if (!request) return null;

  const statusStyle = STATUS_STYLES[request.status] || { bg: '#f3f4f6', color: '#6b7280' };
  const currentLifecycleIndex = LIFECYCLE.indexOf(request.status);

  return (
    <div style={styles.page}>
      {/* Back & Header */}
      <button style={styles.backBtn} onClick={() => navigate('/requests')}>← Back to Requests</button>

      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <h1 style={styles.refId}>{request.referenceId}</h1>
          <h2 style={styles.title}>{request.title}</h2>
        </div>
        <span style={{ ...styles.statusBadge, background: statusStyle.bg, color: statusStyle.color }}>
          {request.status?.replace(/_/g, ' ')}
        </span>
      </div>

      {/* Lifecycle progress bar */}
      <div style={styles.lifecycle}>
        {LIFECYCLE.map((stage, i) => {
          const isDone = i < currentLifecycleIndex;
          const isCurrent = i === currentLifecycleIndex;
          return (
            <React.Fragment key={stage}>
              <div style={styles.stageWrapper}>
                <div style={{
                  ...styles.stageDot,
                  background: isDone ? '#16a34a' : isCurrent ? '#2563eb' : '#e5e7eb',
                  border: isCurrent ? '3px solid #93c5fd' : '3px solid transparent'
                }}>
                  {isDone && <span style={{ color: '#fff', fontSize: 10 }}>✓</span>}
                </div>
                <span style={{ ...styles.stageLabel, color: isDone || isCurrent ? '#111' : '#9ca3af' }}>
                  {stage.replace(/_/g, ' ')}
                </span>
              </div>
              {i < LIFECYCLE.length - 1 && (
                <div style={{ ...styles.stageLine, background: isDone ? '#16a34a' : '#e5e7eb' }} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      <div style={styles.body}>
        {/* Left column: main info */}
        <div style={styles.main}>
          {/* Meta cards */}
          <div style={styles.metaGrid}>
            {[
              { label: 'Type', value: request.type?.replace(/_/g, ' ') },
              { label: 'Priority', value: request.priority },
              { label: 'Requester', value: request.requester?.name },
              { label: 'Department', value: request.requester?.department || '—' },
              { label: 'Submitted', value: new Date(request.createdAt).toLocaleString() },
              { label: 'Last Updated', value: new Date(request.updatedAt).toLocaleString() },
            ].map(m => (
              <div key={m.label} style={styles.metaCard}>
                <div style={styles.metaLabel}>{m.label}</div>
                <div style={styles.metaValue}>{m.value || '—'}</div>
              </div>
            ))}
          </div>

          {/* Description */}
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>Description</h3>
            <p style={styles.description}>{request.description}</p>
          </div>

          {/* Extracted Fields */}
          {request.details && Object.keys(request.details).length > 0 && (
            <div style={styles.card}>
              <h3 style={styles.cardTitle}>Extracted Details (AI-Parsed)</h3>
              <div style={styles.detailsGrid}>
                {Object.entries(request.details).map(([k, v]) => (
                  typeof v !== 'object' && (
                    <div key={k} style={styles.detailRow}>
                      <span style={styles.detailKey}>{k.replace(/([A-Z])/g, ' $1').trim()}</span>
                      <span style={styles.detailVal}>{String(v)}</span>
                    </div>
                  )
                ))}
              </div>
            </div>
          )}

          {/* Approval steps */}
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>Approval Chain</h3>
            {request.approvalSteps?.length === 0 ? (
              <p style={{ color: '#9ca3af', fontSize: 13 }}>No approval steps defined.</p>
            ) : (
              request.approvalSteps?.map((step, i) => {
                const stepStatus = step.status || 'pending';
                const dotColor = stepStatus === 'approved' ? '#16a34a' : stepStatus === 'rejected' ? '#dc2626' : '#9ca3af';
                return (
                  <div key={i} style={styles.stepRow}>
                    <div style={{ ...styles.stepDot, background: dotColor }} />
                    <div style={styles.stepInfo}>
                      <div style={styles.stepRole}>{step.approverRole?.replace('_', ' ').toUpperCase()}</div>
                      <div style={styles.stepApprover}>{step.approver?.name || 'Unassigned'}</div>
                      {step.comments && <div style={styles.stepComment}>"{step.comments}"</div>}
                      {step.decidedAt && <div style={styles.stepDate}>{new Date(step.decidedAt).toLocaleString()}</div>}
                    </div>
                    <span style={{ ...styles.stepBadge, color: dotColor }}>
                      {stepStatus.toUpperCase()}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          {/* Approver action panel */}
          {isCurrentApprover() && (
            <div style={styles.actionCard}>
              <h3 style={styles.cardTitle}>⚡ Your Approval Required</h3>
              <p style={{ fontSize: 13, color: '#374151', marginBottom: 12 }}>
                This request is awaiting your decision as <strong>{user?.role?.replace('_', ' ')}</strong>.
              </p>
              <div style={styles.decisionBtns}>
                <button
                  style={{ ...styles.decBtn, background: decision === 'approved' ? '#16a34a' : '#f0fdf4', color: decision === 'approved' ? '#fff' : '#16a34a', border: '2px solid #16a34a' }}
                  onClick={() => setDecision('approved')}
                >✓ Approve</button>
                <button
                  style={{ ...styles.decBtn, background: decision === 'rejected' ? '#dc2626' : '#fef2f2', color: decision === 'rejected' ? '#fff' : '#dc2626', border: '2px solid #dc2626' }}
                  onClick={() => setDecision('rejected')}
                >✗ Reject</button>
              </div>
              {decision && (
                <>
                  <textarea
                    value={comment}
                    onChange={e => setComment(e.target.value)}
                    style={styles.commentArea}
                    placeholder={decision === 'rejected' ? 'Required: Reason for rejection…' : 'Optional: Approval notes…'}
                    rows={3}
                  />
                  <button
                    style={styles.submitDecision}
                    onClick={handleDecision}
                    disabled={acting || (decision === 'rejected' && !comment.trim())}
                  >
                    {acting ? 'Processing…' : `Submit ${decision === 'approved' ? 'Approval' : 'Rejection'}`}
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Right column: audit log & conversation */}
        <div style={styles.sidebar}>
          {/* AI Classification */}
          {request.aiClassification && (
            <div style={styles.card}>
              <h3 style={styles.cardTitle}>🤖 AI Analysis</h3>
              <div style={styles.aiRow}>
                <span style={styles.aiLabel}>Confidence</span>
                <span style={styles.aiVal}>{Math.round((request.aiClassification.confidence || 0) * 100)}%</span>
              </div>
              <div style={styles.aiRow}>
                <span style={styles.aiLabel}>Processed</span>
                <span style={styles.aiVal}>{request.aiClassification.processedAt ? new Date(request.aiClassification.processedAt).toLocaleTimeString() : '—'}</span>
              </div>
            </div>
          )}

          {/* Audit Log */}
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>📋 Audit Trail</h3>
            <div style={styles.auditList}>
              {(request.auditLog || []).slice().reverse().map((log, i) => (
                <div key={i} style={styles.auditItem}>
                  <div style={styles.auditDot} />
                  <div>
                    <div style={styles.auditAction}>{log.action?.replace(/_/g, ' ')}</div>
                    <div style={styles.auditTime}>{new Date(log.timestamp).toLocaleString()}</div>
                    {log.details && typeof log.details === 'object' && Object.keys(log.details).length > 0 && (
                      <div style={styles.auditDetails}>{JSON.stringify(log.details).slice(0, 80)}…</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: { padding: 24, maxWidth: 1200, margin: '0 auto' },
  loading: { textAlign: 'center', padding: 80, color: '#6b7280' },
  backBtn: { background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 13, padding: 0, marginBottom: 16, fontWeight: 600 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  headerLeft: {},
  refId: { fontSize: 13, fontFamily: 'monospace', color: '#6b7280', margin: '0 0 4px' },
  title: { fontSize: 22, fontWeight: 700, color: '#111', margin: 0 },
  statusBadge: { borderRadius: 8, padding: '6px 14px', fontSize: 13, fontWeight: 700, textTransform: 'capitalize', flexShrink: 0 },
  lifecycle: { display: 'flex', alignItems: 'center', background: '#fff', borderRadius: 12, padding: '16px 20px', marginBottom: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.07)', overflowX: 'auto' },
  stageWrapper: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 70 },
  stageDot: { width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  stageLabel: { fontSize: 10, textAlign: 'center', textTransform: 'capitalize', fontWeight: 600 },
  stageLine: { flex: 1, height: 2, minWidth: 20, marginBottom: 16 },
  body: { display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20 },
  main: { display: 'flex', flexDirection: 'column', gap: 16 },
  sidebar: { display: 'flex', flexDirection: 'column', gap: 16 },
  metaGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 },
  metaCard: { background: '#fff', borderRadius: 10, padding: '12px 14px', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' },
  metaLabel: { fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 },
  metaValue: { fontSize: 14, fontWeight: 600, color: '#111', textTransform: 'capitalize' },
  card: { background: '#fff', borderRadius: 12, padding: '18px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' },
  cardTitle: { fontSize: 14, fontWeight: 700, color: '#111', margin: '0 0 14px' },
  description: { fontSize: 14, color: '#374151', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' },
  detailsGrid: { display: 'flex', flexDirection: 'column', gap: 8 },
  detailRow: { display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f3f4f6', paddingBottom: 6 },
  detailKey: { fontSize: 13, color: '#6b7280', textTransform: 'capitalize' },
  detailVal: { fontSize: 13, fontWeight: 600, color: '#111' },
  stepRow: { display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 },
  stepDot: { width: 12, height: 12, borderRadius: '50%', flexShrink: 0, marginTop: 4 },
  stepInfo: { flex: 1 },
  stepRole: { fontSize: 11, color: '#9ca3af', letterSpacing: '0.05em' },
  stepApprover: { fontSize: 13, fontWeight: 700, color: '#111', margin: '2px 0' },
  stepComment: { fontSize: 12, color: '#6b7280', fontStyle: 'italic' },
  stepDate: { fontSize: 11, color: '#9ca3af', marginTop: 2 },
  stepBadge: { fontSize: 11, fontWeight: 700, flexShrink: 0 },
  actionCard: { background: '#fffbeb', borderRadius: 12, padding: '18px 20px', border: '1px solid #fde68a' },
  decisionBtns: { display: 'flex', gap: 10, marginBottom: 12 },
  decBtn: { flex: 1, borderRadius: 8, padding: '10px', fontWeight: 700, fontSize: 14, cursor: 'pointer' },
  commentArea: { width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: 10, fontSize: 13, resize: 'vertical', outline: 'none', marginBottom: 10, boxSizing: 'border-box' },
  submitDecision: { background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontWeight: 700, fontSize: 14, cursor: 'pointer', width: '100%' },
  aiRow: { display: 'flex', justifyContent: 'space-between', marginBottom: 6 },
  aiLabel: { fontSize: 13, color: '#6b7280' },
  aiVal: { fontSize: 13, fontWeight: 700, color: '#111' },
  auditList: { display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 320, overflowY: 'auto' },
  auditItem: { display: 'flex', gap: 10, alignItems: 'flex-start' },
  auditDot: { width: 8, height: 8, borderRadius: '50%', background: '#6366f1', flexShrink: 0, marginTop: 4 },
  auditAction: { fontSize: 12, fontWeight: 600, color: '#374151', textTransform: 'capitalize' },
  auditTime: { fontSize: 11, color: '#9ca3af' },
  auditDetails: { fontSize: 11, color: '#6b7280', fontFamily: 'monospace', marginTop: 2 }
};
