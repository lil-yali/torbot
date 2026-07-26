import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const fmtHe = (d) => new Date(d).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });

export default function SettingsPage() {
  const [selectedDays, setSelectedDays] = useState(['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי']);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('18:00');
  const [slotDuration, setSlotDuration] = useState(30);
  const [maxDaysAhead, setMaxDaysAhead] = useState(30);
  const [ownerPhone, setOwnerPhone] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [saving, setSaving] = useState(false);

  const [exceptions, setExceptions] = useState({ blocked: [], overrides: [] });
  const [blockDate, setBlockDate] = useState('');
  const [ovr, setOvr] = useState({ date: '', start: '09:00', end: '20:00' });

  const [pw, setPw] = useState({ current: '', next: '' });
  const [pwMsg, setPwMsg] = useState('');

  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/api/settings');
        const wh = typeof data.working_hours === 'string' ? JSON.parse(data.working_hours) : data.working_hours;
        if (wh && Array.isArray(wh.days) && wh.days.length) setSelectedDays(wh.days);
        if (wh && wh.start) setStartTime(wh.start);
        if (wh && wh.end) setEndTime(wh.end);
        if (data.slot_duration) setSlotDuration(data.slot_duration);
        if (data.max_days_ahead) setMaxDaysAhead(data.max_days_ahead);
        if (data.owner_phone) setOwnerPhone(data.owner_phone);
        if (data.whatsapp_number) setWhatsappNumber(data.whatsapp_number);
      } catch { /* first-time setup: keep defaults */ }
      loadExceptions();
    })();
  }, []);

  async function loadExceptions() {
    try { setExceptions((await api.get('/api/schedule-exceptions')).data); } catch { /* ignore */ }
  }

  function toggleDay(day) {
    setSelectedDays(prev => (prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api.post('/api/settings', { workingDays: selectedDays, startTime, endTime, slotDuration, maxDaysAhead, ownerPhone, whatsappNumber });
      navigate('/calendar');
    } catch { alert('שגיאה בשמירה'); }
    finally { setSaving(false); }
  }

  async function addBlocked() {
    if (!blockDate) return;
    await api.post('/api/blocked', { date: blockDate });
    setBlockDate(''); loadExceptions();
  }
  async function removeBlocked(date) { await api.delete(`/api/blocked/${date}`); loadExceptions(); }

  async function addHours() {
    if (!ovr.date || !ovr.start || !ovr.end) return;
    await api.post('/api/hours', ovr);
    setOvr({ date: '', start: '09:00', end: '20:00' }); loadExceptions();
  }
  async function removeHours(date) { await api.delete(`/api/hours/${date}`); loadExceptions(); }

  async function changePassword() {
    setPwMsg('');
    if (pw.next.length < 4) { setPwMsg('סיסמה חדשה קצרה מדי (לפחות 4 תווים)'); return; }
    try {
      await api.post('/api/change-password', { currentPassword: pw.current, newPassword: pw.next });
      setPw({ current: '', next: '' });
      setPwMsg('הסיסמה עודכנה ✅');
    } catch (err) {
      setPwMsg(err.response && err.response.data && err.response.data.error === 'wrong_password' ? 'הסיסמה הנוכחית שגויה' : 'שגיאה, נסה שוב');
    }
  }

  return (
    <div className="page">
      <div style={{ width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* ---- main settings ---- */}
        <div className="card">
          <div className="dashboard-header" style={{ marginBottom: 20 }}>
            <div className="logo" style={{ marginBottom: 0 }}>TorBot</div>
            <button className="btn-ghost" onClick={() => navigate('/calendar')}>← לדשבורד</button>
          </div>
          <h2>הגדרות העסק</h2>

          <p className="field-label">ימי עבודה</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
            {DAYS.map(day => (
              <button key={day} className={`day-btn ${selectedDays.includes(day) ? 'active' : ''}`} onClick={() => toggleDay(day)}>{day}</button>
            ))}
          </div>

          <p className="field-label">שעות עבודה</p>
          <div style={{ display: 'flex', gap: 12, marginBottom: 24, alignItems: 'center' }}>
            <input type="time" className="input" style={{ marginBottom: 0 }} value={startTime} onChange={e => setStartTime(e.target.value)} />
            <span style={{ color: 'var(--text-muted)' }}>עד</span>
            <input type="time" className="input" style={{ marginBottom: 0 }} value={endTime} onChange={e => setEndTime(e.target.value)} />
          </div>

          <p className="field-label">משך תור (דקות)</p>
          <input type="number" className="input" value={slotDuration} onChange={e => setSlotDuration(e.target.value)} />

          <p className="field-label" style={{ marginTop: 12 }}>כמה ימים מראש אפשר לקבוע תור?</p>
          <input type="number" className="input" value={maxDaysAhead} onChange={e => setMaxDaysAhead(e.target.value)} />

          <p className="field-label" style={{ marginTop: 12 }}>מספר הוואטסאפ שלך לניהול דרך הבוט</p>
          <input type="tel" className="input" placeholder="+972..." value={ownerPhone} onChange={e => setOwnerPhone(e.target.value)} />

          <p className="field-label" style={{ marginTop: 12 }}>מספר הוואטסאפ העסקי (שהלקוחות כותבים אליו)</p>
          <input type="tel" className="input" placeholder="+972... (לרוב עסקים)" value={whatsappNumber} onChange={e => setWhatsappNumber(e.target.value)} />

          <button className="btn" onClick={handleSave} disabled={saving}>{saving ? 'שומר…' : 'שמור ←'}</button>
        </div>

        {/* ---- blocked dates & special hours ---- */}
        <div className="card">
          <h2 style={{ fontSize: 22 }}>ימים מיוחדים</h2>

          <p className="field-label">ימים חסומים (אין תורים)</p>
          {exceptions.blocked.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 12 }}>אין ימים חסומים</p>}
          {exceptions.blocked.map(d => (
            <div key={d} className="exc-row"><span>{fmtHe(d)}</span><button className="cancel-btn" onClick={() => removeBlocked(d)}>הסר</button></div>
          ))}
          <div style={{ display: 'flex', gap: 10, marginTop: 10, marginBottom: 24 }}>
            <input type="date" className="input" style={{ marginBottom: 0 }} value={blockDate} onChange={e => setBlockDate(e.target.value)} />
            <button className="btn-ghost" onClick={addBlocked}>חסום יום</button>
          </div>

          <p className="field-label">שעות מיוחדות ליום ספציפי</p>
          {exceptions.overrides.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 12 }}>אין שעות מיוחדות</p>}
          {exceptions.overrides.map(o => (
            <div key={o.date} className="exc-row"><span>{fmtHe(o.date)} · {o.start_time}–{o.end_time}</span><button className="cancel-btn" onClick={() => removeHours(o.date)}>הסר</button></div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <input type="date" className="input" style={{ marginBottom: 0, flex: '1 1 140px' }} value={ovr.date} onChange={e => setOvr({ ...ovr, date: e.target.value })} />
            <input type="time" className="input" style={{ marginBottom: 0, width: 110 }} value={ovr.start} onChange={e => setOvr({ ...ovr, start: e.target.value })} />
            <input type="time" className="input" style={{ marginBottom: 0, width: 110 }} value={ovr.end} onChange={e => setOvr({ ...ovr, end: e.target.value })} />
            <button className="btn-ghost" onClick={addHours}>הוסף</button>
          </div>
        </div>

        {/* ---- change password ---- */}
        <div className="card">
          <h2 style={{ fontSize: 22 }}>שינוי סיסמה</h2>
          <input type="password" className="input" placeholder="סיסמה נוכחית" value={pw.current} onChange={e => setPw({ ...pw, current: e.target.value })} />
          <input type="password" className="input" placeholder="סיסמה חדשה" value={pw.next} onChange={e => setPw({ ...pw, next: e.target.value })} />
          {pwMsg && <div className={pwMsg.includes('✅') ? 'ok-msg' : 'error-msg'}>{pwMsg}</div>}
          <button className="btn" onClick={changePassword}>עדכן סיסמה</button>
        </div>

      </div>
    </div>
  );
}
