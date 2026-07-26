import axios from 'axios';

// API base URL: in production the server serves the client (same origin → empty base).
// In local dev the server runs on :3000 while the client runs on :3001.
// Override with REACT_APP_API_URL at build time if hosting them separately.
const baseURL = process.env.REACT_APP_API_URL !== undefined
  ? process.env.REACT_APP_API_URL
  : (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000');

// Central API client. Automatically attaches the login token to every request.
const api = axios.create({ baseURL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// On an expired/invalid token, drop the session and send the user back to login.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response && err.response.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('businessPhone');
      if (window.location.pathname !== '/login') window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
