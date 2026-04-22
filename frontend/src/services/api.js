import axios from 'axios';

// Centralized API service — all HTTP calls go through here.
// This makes it easy to switch base URLs, add retry logic, or mock
// the API during testing without touching component code.

const apiBaseURL = process.env.REACT_APP_API_URL || '/api';
const api = axios.create({ baseURL: apiBaseURL });

// Attach JWT token to every API request from this shared client.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// If token is invalid/expired, force re-login for a clean auth state.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      if (typeof window !== 'undefined') window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

// ── Auth ──────────────────────────────────────────────────────────────────
export const authAPI = {
  login: (credentials) => api.post('/auth/login', credentials),
  register: (data) => api.post('/auth/register', data),
  me: () => api.get('/auth/me')
};

// ── Requests ──────────────────────────────────────────────────────────────
export const requestAPI = {
  // Send a chat message to the bot
  chat: (message, conversationHistory) =>
    api.post('/requests/chat', { message, conversationHistory }),

  // List all requests visible to the current user
  getAll: (params) => api.get('/requests', { params }),

  // Get a single request with full details
  getById: (id) => api.get(`/requests/${id}`),

  // Approve or reject a request
  decide: (id, decision, comments) =>
    api.post(`/requests/${id}/approve`, { decision, comments }),

  // Close a request
  close: (id, reason) => api.post(`/requests/${id}/close`, { reason }),

  // Dashboard stats
  getStats: () => api.get('/requests/stats/overview')
};

// ── Notifications ──────────────────────────────────────────────────────────
export const notificationAPI = {
  getAll: (params) => api.get('/notifications', { params }),
  markRead: (id) => api.patch(`/notifications/${id}/read`),
  markAllRead: () => api.patch('/notifications/mark-all-read')
};

// ── Users ──────────────────────────────────────────────────────────────────
export const userAPI = {
  getAll: () => api.get('/users'),
  getApprovers: () => api.get('/users/approvers'),
  update: (id, data) => api.patch(`/users/${id}`, data)
};
