import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

// The AuthContext provides the currently logged-in user and auth helpers
// to every component in the tree without prop-drilling.
const AuthContext = createContext(null);
const apiBaseURL = process.env.REACT_APP_API_URL || '/api';

// Configure axios to always attach the JWT token from localStorage.
// This runs once at module load time, so every API call automatically
// includes the Authorization header after the user logs in.
axios.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Auto-redirect to login if the server returns 401 (expired/invalid token)
axios.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);  // True during initial token validation

  // On first mount, validate any existing token so the user doesn't have to log in again
  useEffect(() => {
    const validateToken = async () => {
      const token = localStorage.getItem('token');
      if (!token) { setLoading(false); return; }

      try {
        const { data } = await axios.get(`${apiBaseURL}/auth/me`);
        setUser(data.user);
      } catch {
        // Token was invalid — clear it so the next render shows the login page
        localStorage.removeItem('token');
      } finally {
        setLoading(false);
      }
    };
    validateToken();
  }, []);

  const login = async (email, password) => {
    const { data } = await axios.post(`${apiBaseURL}/auth/login`, { email, password });
    localStorage.setItem('token', data.token);
    setUser(data.user);
    return data.user;
  };

  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
  };

  // Expose only what consumers need
  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

// Convenience hook so components can write: const { user } = useAuth()
export const useAuth = () => useContext(AuthContext);
