import React, { useState, useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { requestAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';

const REQUEST_STARTERS = {
  access: "I need access to ",
  skills: "I'd like to add a skill: ",
  connectors: "I need to set up a connector for ",
  plugins: "I want to deploy the plugin: ",
  apis: "I need API access for ",
  support_qa: "I have a support question: "
};

const TYPE_BADGES = {
  access: { bg: '#dbeafe', color: '#1d4ed8', label: 'Access' },
  skills: { bg: '#ede9fe', color: '#7c3aed', label: 'Skills' },
  connectors: { bg: '#fce7f3', color: '#be185d', label: 'Connector' },
  plugins: { bg: '#ffedd5', color: '#c2410c', label: 'Plugin' },
  apis: { bg: '#dcfce7', color: '#15803d', label: 'API' },
  support_qa: { bg: '#e0f2fe', color: '#0369a1', label: 'Support' }
};

export default function ChatPage() {
  const { user } = useAuth();
  const location = useLocation();
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: `Hi ${user?.name?.split(' ')[0]}! 👋 I'm your Claude Assistant Bot. I can help you with:\n\n🔑 Access requests  🎓 Skill additions  🔌 Connector setups\n🧩 Plugin deployments  ⚡ API access  🎫 Support tickets\n\nJust describe what you need in plain English and I'll take care of the rest!`,
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastRequest, setLastRequest] = useState(null);
  const [conversationHistory, setConversationHistory] = useState([]);
  const messagesEndRef = useRef(null);

  // If the user clicked a quick action on the dashboard, pre-fill the input
  useEffect(() => {
    if (location.state?.preload) {
      setInput(REQUEST_STARTERS[location.state.preload] || '');
    }
  }, [location.state]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const userText = input.trim();
    setInput('');

    // Append the user's message immediately for responsive feel
    const userMsg = { role: 'user', content: userText, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const { data } = await requestAPI.chat(userText, conversationHistory);

      const botMsg = {
        role: 'assistant',
        content: data.botMessage,
        timestamp: new Date(),
        request: data.request,
        classification: data.classification
      };

      setMessages(prev => [...prev, botMsg]);

      // Update conversation history for multi-turn context
      setConversationHistory(prev => [
        ...prev,
        { role: 'user', content: userText },
        { role: 'assistant', content: data.botMessage }
      ]);

      if (data.request) setLastRequest(data.request);

    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, I encountered an error processing your request. Please try again.',
        timestamp: new Date(),
        isError: true
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const formatTime = (d) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.botAvatar}>🤖</div>
          <div>
            <div style={styles.botName}>Claude Assistant Bot</div>
            <div style={styles.botStatus}>
              <span style={styles.statusDot} /> Online · Powered by Claude
            </div>
          </div>
        </div>
        {lastRequest && (
          <div style={styles.lastRef}>
            Last: <strong>{lastRequest.referenceId}</strong>
            <span style={{ ...styles.statusBadge, background: '#dbeafe', color: '#1d4ed8' }}>
              {lastRequest.status?.replace(/_/g, ' ')}
            </span>
          </div>
        )}
      </div>

      {/* Messages */}
      <div style={styles.messages}>
        {messages.map((msg, i) => (
          <div key={i} style={{ ...styles.msgRow, justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            {msg.role === 'assistant' && <div style={styles.avatarSmall}>🤖</div>}
            <div style={{
              ...styles.bubble,
              ...(msg.role === 'user' ? styles.userBubble : styles.botBubble),
              ...(msg.isError ? styles.errorBubble : {})
            }}>
              <div style={styles.bubbleText}>{msg.content}</div>

              {/* Request confirmation card */}
              {msg.request && (
                <div style={styles.requestCard}>
                  <div style={styles.requestCardHeader}>
                    <span>✅ Request Created</span>
                    <span style={styles.refId}>{msg.request.referenceId}</span>
                  </div>
                  <div style={styles.requestCardBody}>
                    <div style={styles.requestCardRow}>
                      <span style={styles.rLabel}>Type</span>
                      <span style={{
                        ...styles.typeBadge,
                        background: TYPE_BADGES[msg.request.type]?.bg,
                        color: TYPE_BADGES[msg.request.type]?.color
                      }}>
                        {TYPE_BADGES[msg.request.type]?.label}
                      </span>
                    </div>
                    <div style={styles.requestCardRow}>
                      <span style={styles.rLabel}>Status</span>
                      <span style={styles.rVal}>{msg.request.status?.replace(/_/g, ' ')}</span>
                    </div>
                    <div style={styles.requestCardRow}>
                      <span style={styles.rLabel}>Priority</span>
                      <span style={styles.rVal}>{msg.request.priority}</span>
                    </div>
                  </div>
                </div>
              )}

              <div style={styles.bubbleTime}>{formatTime(msg.timestamp)}</div>
            </div>
            {msg.role === 'user' && <div style={styles.userAvatar}>{user?.name?.[0]}</div>}
          </div>
        ))}

        {/* Typing indicator */}
        {loading && (
          <div style={{ ...styles.msgRow, justifyContent: 'flex-start' }}>
            <div style={styles.avatarSmall}>🤖</div>
            <div style={styles.botBubble}>
              <div style={styles.typingDots}>
                <span style={styles.dot} /><span style={{ ...styles.dot, animationDelay: '0.2s' }} />
                <span style={{ ...styles.dot, animationDelay: '0.4s' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick suggestion chips */}
      {messages.length === 1 && (
        <div style={styles.suggestions}>
          {Object.entries(REQUEST_STARTERS).map(([type, text]) => (
            <button key={type} style={styles.chip} onClick={() => setInput(text)}>
              {text.split(' ').slice(0, 4).join(' ')}…
            </button>
          ))}
        </div>
      )}

      {/* Input area */}
      <div style={styles.inputArea}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          style={styles.textarea}
          placeholder="Describe your request in plain English… (Enter to send)"
          rows={2}
          disabled={loading}
        />
        <button
          onClick={sendMessage}
          disabled={loading || !input.trim()}
          style={loading || !input.trim() ? styles.sendBtnOff : styles.sendBtn}
        >
          {loading ? '⏳' : '➤'}
        </button>
      </div>

      <style>{`
        @keyframes bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
      `}</style>
    </div>
  );
}

const styles = {
  page: {
    display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)',
    maxWidth: 800, margin: '0 auto', padding: '0 16px 16px'
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 0', borderBottom: '1px solid #e5e7eb', marginBottom: 8
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 12 },
  botAvatar: {
    width: 44, height: 44, borderRadius: '50%', fontSize: 22,
    background: 'linear-gradient(135deg,#2563eb,#7c3aed)',
    display: 'flex', alignItems: 'center', justifyContent: 'center'
  },
  botName: { fontWeight: 700, fontSize: 15, color: '#111' },
  botStatus: { fontSize: 12, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 5 },
  statusDot: { width: 7, height: 7, borderRadius: '50%', background: '#10b981', display: 'inline-block' },
  lastRef: { fontSize: 13, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 8 },
  statusBadge: { borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600 },
  messages: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 8 },
  msgRow: { display: 'flex', alignItems: 'flex-end', gap: 8 },
  avatarSmall: {
    width: 30, height: 30, borderRadius: '50%', fontSize: 16,
    background: 'linear-gradient(135deg,#2563eb,#7c3aed)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
  },
  userAvatar: {
    width: 30, height: 30, borderRadius: '50%', fontSize: 13, fontWeight: 700,
    background: '#1e3a5f', color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
  },
  bubble: { maxWidth: '75%', borderRadius: 14, padding: '10px 14px', fontSize: 14, lineHeight: 1.5 },
  botBubble: { background: '#f3f4f6', color: '#111', borderBottomLeftRadius: 4 },
  userBubble: {
    background: 'linear-gradient(135deg, #2563eb, #7c3aed)', color: '#fff', borderBottomRightRadius: 4
  },
  errorBubble: { background: '#fef2f2', color: '#b91c1c' },
  bubbleText: { whiteSpace: 'pre-wrap' },
  bubbleTime: { fontSize: 10, opacity: 0.6, marginTop: 6, textAlign: 'right' },
  requestCard: {
    marginTop: 10, background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb',
    overflow: 'hidden'
  },
  requestCardHeader: {
    background: '#f0fdf4', padding: '8px 12px', display: 'flex',
    justifyContent: 'space-between', alignItems: 'center', fontSize: 12, fontWeight: 700, color: '#166534'
  },
  refId: { fontSize: 11, color: '#6b7280', fontFamily: 'monospace' },
  requestCardBody: { padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4 },
  requestCardRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 },
  rLabel: { color: '#6b7280' },
  rVal: { fontWeight: 600, color: '#111', textTransform: 'capitalize' },
  typeBadge: { borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600 },
  typingDots: { display: 'flex', gap: 4, padding: '4px 0' },
  dot: { width: 8, height: 8, borderRadius: '50%', background: '#9ca3af', animation: 'bounce 1s infinite' },
  suggestions: { display: 'flex', flexWrap: 'wrap', gap: 8, padding: '8px 0' },
  chip: {
    background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 20,
    padding: '6px 14px', fontSize: 12, cursor: 'pointer', color: '#374151'
  },
  inputArea: {
    display: 'flex', gap: 10, alignItems: 'flex-end',
    padding: '12px 0 0', borderTop: '1px solid #e5e7eb', marginTop: 8
  },
  textarea: {
    flex: 1, border: '1px solid #d1d5db', borderRadius: 12, padding: '10px 14px',
    fontSize: 14, outline: 'none', resize: 'none', fontFamily: 'inherit', lineHeight: 1.5
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: '50%',
    background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
    color: '#fff', border: 'none', fontSize: 18, cursor: 'pointer', flexShrink: 0
  },
  sendBtnOff: {
    width: 44, height: 44, borderRadius: '50%',
    background: '#e5e7eb', color: '#9ca3af', border: 'none', fontSize: 18,
    cursor: 'not-allowed', flexShrink: 0
  }
};
