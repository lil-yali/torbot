import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

export default function LoginPage({ setIsLoggedIn }) {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/api/login', { phone, password });
      if (res.data.success) {
        localStorage.setItem('businessPhone', phone);
        localStorage.setItem('token', res.data.token);
        if (res.data.name) localStorage.setItem('businessName', res.data.name);
        setIsLoggedIn(true);
        navigate('/calendar');
      } else {
        setError('מספר טלפון או סיסמה שגויים');
      }
    } catch (err) {
      setError('שגיאה בהתחברות, נסה שוב');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <div className="card">
        <div className="logo">TorBot</div>
        <div className="subtitle">מערכת תורים חכמה לעסקים קטנים</div>
        <h2>התחברות</h2>
        <form onSubmit={handleSubmit}>
          <input className="input" placeholder="מספר וואטסאפ (+972...)" value={phone} onChange={e => setPhone(e.target.value)} required />
          <input className="input" type="password" placeholder="סיסמה" value={password} onChange={e => setPassword(e.target.value)} required />
          {error && <div className="error-msg">{error}</div>}
          <button className="btn" type="submit" disabled={loading}>{loading ? 'מתחבר…' : 'התחברות'}</button>
        </form>
        <span className="link" onClick={() => navigate('/register')}>אין לך חשבון? הרשם</span>
      </div>
    </div>
  );
}
