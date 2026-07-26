import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

export default function RegisterPage() {
  const [name, setName] = useState('');
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
      const res = await api.post('/api/register', { name, phone, password });
      localStorage.setItem('businessPhone', phone);
      localStorage.setItem('token', res.data.token);
      localStorage.setItem('businessName', name);
      navigate('/settings');
    } catch (err) {
      if (err.response && err.response.status === 409) setError('מספר הטלפון כבר רשום. נסה להתחבר.');
      else setError('שגיאה בהרשמה, נסה שוב');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <div className="card">
        <div className="logo">TorBot</div>
        <div className="subtitle">מערכת תורים חכמה לעסקים קטנים</div>
        <h2>הרשמה לעסק</h2>
        <form onSubmit={handleSubmit}>
          <input className="input" placeholder="שם העסק" value={name} onChange={e => setName(e.target.value)} required />
          <input className="input" placeholder="מספר וואטסאפ (+972...)" value={phone} onChange={e => setPhone(e.target.value)} required />
          <input className="input" type="password" placeholder="סיסמה" value={password} onChange={e => setPassword(e.target.value)} required />
          {error && <div className="error-msg">{error}</div>}
          <button className="btn" type="submit" disabled={loading}>{loading ? 'נרשם…' : 'יצירת חשבון'}</button>
        </form>
        <span className="link" onClick={() => navigate('/login')}>כבר יש לך חשבון? התחבר</span>
      </div>
    </div>
  );
}
