import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { notificationAPI } from '../services/api';

const TYPE_ICONS = {
  request_submitted: '📤', approval_required: '⏳', request_approved: '✅',
  request_rejected: '❌', request_deployed: '🚀', request_closed: '🔒',
  comment_added: '💬', sla_warning: '⚠️', system_alert: '🔔'
};

export default function NotificationsPage() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const { data } = await notificationAPI.getAll({ limit: 50 });
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const markRead = async (id) => {
    await notificationAPI.markRead(id);
    setNotifications(prev => prev.map(n => n._id === id ? { ...n, isRead: true } : n));
    setUnreadCount(c => Math.max(0, c - 1));
  };

  const markAllRead = async () => {
    await notificationAPI.markAllRead();
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    setUnreadCount(0);
  };

  const handleClick = (notif) => {
    if (!notif.isRead) markRead(notif._id);
    if (notif.request?._id) navigate(`/requests/${notif.request._id}`);
  };

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Notifications</h1>
          {unreadCount > 0 && <span style={styles.unreadBadge}>{unreadCount} unread</span>}
        </div>
        {unreadCount > 0 && (
          <button style={styles.markAllBtn} onClick={markAllRead}>Mark all read</button>
        )}
      </div>

      {loading ? (
        <div style={styles.empty}>Loading…</div>
      ) : notifications.length === 0 ? (
        <div style={styles.empty}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🔕</div>
          <p>No notifications yet. Start by submitting a request!</p>
        </div>
      ) : (
        <div style={styles.list}>
          {notifications.map(n => (
            <div
              key={n._id}
              style={{ ...styles.item, background: n.isRead ? '#fff' : '#f0f9ff', cursor: n.request ? 'pointer' : 'default' }}
              onClick={() => handleClick(n)}
            >
              <div style={styles.iconCol}>
                <span style={styles.typeIcon}>{TYPE_ICONS[n.type] || '🔔'}</span>
                {!n.isRead && <span style={styles.unreadDot} />}
              </div>
              <div style={styles.textCol}>
                <div style={styles.notifTitle}>{n.title}</div>
                <div style={styles.notifMsg}>{n.message}</div>
                {n.request && (
                  <div style={styles.refRow}>
                    <span style={styles.refBadge}>{n.request.referenceId}</span>
                    <span style={styles.refType}>{n.request.type?.replace('_', ' ')}</span>
                  </div>
                )}
                <div style={styles.notifTime}>{new Date(n.createdAt).toLocaleString()}</div>
              </div>
              {!n.isRead && (
                <button style={styles.readBtn} onClick={e => { e.stopPropagation(); markRead(n._id); }}>
                  ✓
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles = {
  page: { padding: 24, maxWidth: 800, margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 22, fontWeight: 700, color: '#111', margin: '0 0 4px' },
  unreadBadge: { background: '#dbeafe', color: '#1d4ed8', borderRadius: 12, padding: '2px 10px', fontSize: 12, fontWeight: 700 },
  markAllBtn: { background: 'none', border: '1px solid #d1d5db', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 13, color: '#374151' },
  empty: { textAlign: 'center', padding: 60, color: '#6b7280' },
  list: { display: 'flex', flexDirection: 'column', gap: 2 },
  item: {
    display: 'flex', gap: 14, padding: '14px 16px', borderRadius: 10,
    border: '1px solid #e5e7eb', transition: 'background 0.15s', alignItems: 'flex-start'
  },
  iconCol: { position: 'relative', flexShrink: 0 },
  typeIcon: { fontSize: 22 },
  unreadDot: { position: 'absolute', top: 0, right: -2, width: 8, height: 8, borderRadius: '50%', background: '#2563eb' },
  textCol: { flex: 1, minWidth: 0 },
  notifTitle: { fontSize: 14, fontWeight: 700, color: '#111', marginBottom: 3 },
  notifMsg: { fontSize: 13, color: '#374151', lineHeight: 1.5, marginBottom: 6 },
  refRow: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 },
  refBadge: { background: '#f3f4f6', borderRadius: 4, padding: '1px 6px', fontSize: 11, fontFamily: 'monospace', color: '#6b7280' },
  refType: { fontSize: 11, color: '#9ca3af', textTransform: 'capitalize' },
  notifTime: { fontSize: 11, color: '#9ca3af' },
  readBtn: { background: '#e0f2fe', border: 'none', color: '#0369a1', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12, fontWeight: 700, flexShrink: 0 }
};
