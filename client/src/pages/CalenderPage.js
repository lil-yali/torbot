import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { API_BASE } from '../api';

const HE_DOW = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isSameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const waNumber = (phone) => (phone || '').replace('whatsapp:', '').replace(/[^0-9]/g, '');

const REASONS = {
  taken: 'השעה כבר תפוסה', closed_day: 'העסק סגור ביום הזה', blocked: 'התאריך חסום',
  outside_hours: 'השעה מחוץ לשעות הפעילות', past_date: 'תאריך שעבר', past_time: 'שעה שעברה',
  unaligned: 'השעה לא מתאימה לרשת התורים', too_far: 'רחוק מדי מראש', slot_taken: 'השעה כבר תפוסה',
};

export default function CalendarPage({ setIsLoggedIn }) {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('list');
  const [monthCursor, setMonthCursor] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; });
  const [selectedKey, setSelectedKey] = useState(dayKey(new Date()));
  const [modal, setModal] = useState(null); // { type:'add'|'reschedule', apt? }
  const [form, setForm] = useState({ name: '', phone: '', date: '', time: '' });
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const businessName = localStorage.getItem('businessName');

  useEffect(() => { fetchAppointments(); }, []);

  async function fetchAppointments() {
    setLoading(true);
    try { setAppointments((await api.get('/api/appointments')).data); }
    catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  async function cancelAppointment(id) {
    if (!window.confirm('לבטל את התור? הלקוח יקבל הודעת ביטול בוואטסאפ.')) return;
    try { await api.delete(`/api/appointments/${id}`); fetchAppointments(); }
    catch { alert('שגיאה בביטול'); }
  }

  function openAdd() {
    setForm({ name: '', phone: '', date: selectedKey, time: '' });
    setModal({ type: 'add' });
  }
  function openReschedule(apt) {
    const d = new Date(apt.datetime);
    setForm({ name: apt.customer_name, phone: apt.customer_phone, date: dayKey(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` });
    setModal({ type: 'reschedule', apt });
  }

  async function submitModal() {
    setBusy(true);
    try {
      if (modal.type === 'add') {
        await api.post('/api/appointments', { name: form.name, phone: form.phone, date: form.date, time: form.time });
      } else {
        await api.post(`/api/appointments/${modal.apt.id}/reschedule`, { date: form.date, time: form.time });
      }
      setModal(null);
      fetchAppointments();
    } catch (err) {
      const reason = err.response && err.response.data && err.response.data.error;
      alert(REASONS[reason] || 'שגיאה, נסה שוב');
    } finally { setBusy(false); }
  }

  function logout() {
    ['businessPhone', 'token', 'businessName'].forEach(k => localStorage.removeItem(k));
    setIsLoggedIn(false);
    navigate('/login');
  }

  const { todayCount, weekCount, byDayList, byDayMap } = useMemo(() => {
    const now = new Date();
    const weekEnd = new Date(now); weekEnd.setDate(now.getDate() + 7);
    let today = 0, week = 0;
    const listMap = new Map();
    const keyMap = new Map();
    for (const a of appointments) {
      const dt = new Date(a.datetime);
      if (isSameDay(dt, now)) today++;
      if (dt >= now && dt <= weekEnd) week++;
      const label = dt.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
      if (!listMap.has(label)) listMap.set(label, []);
      listMap.get(label).push(a);
      const k = dayKey(dt);
      if (!keyMap.has(k)) keyMap.set(k, []);
      keyMap.get(k).push(a);
    }
    return { todayCount: today, weekCount: week, byDayList: [...listMap.entries()], byDayMap: keyMap };
  }, [appointments]);

  function renderApt(apt) {
    const phone = waNumber(apt.customer_phone);
    return (
      <div key={apt.id} className="apt-card">
        <div className="apt-time">{new Date(apt.datetime).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</div>
        <div className="apt-main">
          <div className="apt-name">{apt.customer_name || 'לקוח'}</div>
          {phone && (
            <div className="apt-contact">
              <a className="wa-link" href={`https://wa.me/${phone}`} target="_blank" rel="noreferrer">💬 וואטסאפ</a>
              <a className="tel-link" href={`tel:+${phone}`}>{'+' + phone}</a>
            </div>
          )}
        </div>
        <div className="apt-actions">
          <button className="cancel-btn" onClick={() => openReschedule(apt)}>הזז</button>
          <button className="cancel-btn" onClick={() => cancelAppointment(apt.id)}>ביטול</button>
        </div>
      </div>
    );
  }

  const monthCells = useMemo(() => {
    const y = monthCursor.getFullYear(), m = monthCursor.getMonth();
    const startWeekday = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(y, m, d));
    return cells;
  }, [monthCursor]);

  const selectedAppts = byDayMap.get(selectedKey) || [];

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <div>
          <div className="logo" style={{ marginBottom: 0 }}>TorBot</div>
          {businessName && <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>{businessName}</div>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-ghost" onClick={() => navigate('/settings')}>הגדרות</button>
          <button className="btn-ghost danger" onClick={logout}>התנתקות</button>
        </div>
      </div>

      <div className="stats-row">
        <div className="stat-card"><div className="stat-num">{todayCount}</div><div className="stat-label">היום</div></div>
        <div className="stat-card"><div className="stat-num">{weekCount}</div><div className="stat-label">השבוע</div></div>
        <div className="stat-card"><div className="stat-num">{appointments.length}</div><div className="stat-label">סה"כ קרובים</div></div>
      </div>

      {!loading && appointments.length === 0 && (
        <div className="onboard-card">
          <h3>ברוך הבא ל-TorBot 👋 בוא נתחיל</h3>
          <ol>
            <li><b>הגדר את שעות הפעילות</b> — ימי עבודה, שעות ומשך תור. <span className="link" onClick={() => navigate('/settings')}>להגדרות ←</span></li>
            <li><b>נסה את הבוט</b> — דבר איתו כמו לקוח וכמו בעל עסק. <a className="link" href={`${API_BASE}/chat`} target="_blank" rel="noreferrer">פתח צ'אט בדיקה ←</a></li>
            <li><b>שתף את מספר הוואטסאפ שלך</b> עם הלקוחות — הם פשוט כותבים והבוט קובע להם תור.</li>
          </ol>
        </div>
      )}

      <div className="section-head">
        <div className="view-toggle">
          <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>רשימה</button>
          <button className={view === 'calendar' ? 'active' : ''} onClick={() => setView('calendar')}>לוח שנה</button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-ghost" onClick={openAdd}>+ תור חדש</button>
          <button className="btn-ghost" onClick={fetchAppointments}>רענן</button>
        </div>
      </div>

      {loading && <div className="empty">טוען…</div>}

      {!loading && view === 'list' && (
        appointments.length === 0
          ? <div className="empty">אין תורים עדיין 📭</div>
          : byDayList.map(([label, list]) => (
            <div key={label} className="day-group">
              <div className="day-header">{label}</div>
              {list.map(renderApt)}
            </div>
          ))
      )}

      {!loading && view === 'calendar' && (
        <>
          <div className="cal-wrap">
            <div className="cal-head">
              <button className="btn-ghost" onClick={() => setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() - 1, 1))}>‹</button>
              <div className="cal-title">{HE_MONTHS[monthCursor.getMonth()]} {monthCursor.getFullYear()}</div>
              <button className="btn-ghost" onClick={() => setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1))}>›</button>
            </div>
            <div className="cal-grid cal-dow-row">
              {HE_DOW.map(d => <div key={d} className="cal-dow">{d}</div>)}
            </div>
            <div className="cal-grid">
              {monthCells.map((cell, i) => {
                if (!cell) return <div key={'e' + i} className="cal-cell empty" />;
                const k = dayKey(cell);
                const count = (byDayMap.get(k) || []).length;
                const cls = ['cal-cell'];
                if (count) cls.push('has');
                if (k === selectedKey) cls.push('selected');
                if (isSameDay(cell, new Date())) cls.push('today');
                return (
                  <div key={k} className={cls.join(' ')} onClick={() => setSelectedKey(k)}>
                    <span className="cal-daynum">{cell.getDate()}</span>
                    {count > 0 && <span className="cal-count">{count}</span>}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="section-head" style={{ marginTop: 24 }}>
            <div className="day-header" style={{ border: 'none', margin: 0 }}>
              תורים ל־{new Date(selectedKey).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })}
            </div>
            <button className="btn-ghost" onClick={openAdd}>+ תור חדש</button>
          </div>
          {selectedAppts.length === 0
            ? <div className="empty" style={{ padding: '40px 0' }}>אין תורים ביום זה</div>
            : selectedAppts.map(renderApt)}
        </>
      )}

      {/* ---- Add / Reschedule modal ---- */}
      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>{modal.type === 'add' ? 'תור חדש' : 'הזזת תור'}</h3>
            {modal.type === 'add' && (
              <>
                <input className="input" placeholder="שם הלקוח" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                <input className="input" placeholder="טלפון (+972...)" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
              </>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <input type="date" className="input" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
              <input type="time" className="input" value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} />
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button className="btn" style={{ marginTop: 0 }} onClick={submitModal} disabled={busy || !form.date || !form.time}>
                {busy ? 'שומר…' : 'שמור'}
              </button>
              <button className="btn-ghost" onClick={() => setModal(null)}>ביטול</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
