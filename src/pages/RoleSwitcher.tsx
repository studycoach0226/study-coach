import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../lib/db';
import { User } from '../lib/types';

export default function RoleSwitcher() {
  const navigate = useNavigate();
  const [users, setUsers] = useState<User[]>([]);

  useEffect(() => {
    // Clear current user when entering RoleSwitcher
    localStorage.removeItem('currentUserId');
    localStorage.removeItem('activeRole');

    // Fetch users (reactive to DB initialization)
    setUsers(db.getUsers());
  }, []);

  const handleSelect = (user: User) => {
    db.setCurrentUserId(user.id);
    if (user.role === 'teacher') navigate('/teacher');
    else navigate(`/student/${user.id}`);
  };


  return (
    <div style={{ maxWidth: '600px', margin: '4rem auto', textAlign: 'center' }}>
      <h1 style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>Study Coach</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '3rem', fontSize: '1.2rem' }}>你的學習教練，陪你每天練習</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {users.map(u => (
          <button key={u.id} className="btn btn-outline" style={{ padding: '1.25rem', background: '#fff' }} onClick={() => handleSelect(u)}>
            <strong>Login as {u.name}</strong> <span style={{ opacity: 0.6, fontWeight: 'normal', marginLeft: '0.5rem' }}>({u.role})</span>
          </button>
        ))}
      </div>
    </div>
  );
}
