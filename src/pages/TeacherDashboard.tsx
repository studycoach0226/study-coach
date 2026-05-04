import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../lib/db';
import { User } from '../lib/types';

export default function TeacherDashboard() {
  const [students, setStudents] = useState<{user: User, swCount: number, completedCount: number}[]>([]);

  useEffect(() => {
    const users = db.getUsers().filter(u => u.role === 'student');
    const allSws = db.getStudentWords();
    
    const mapped = users.map(u => {
      const mySws = allSws.filter(sw => sw.studentId === u.id);
      return {
        user: u,
        swCount: mySws.length,
        completedCount: mySws.filter(w => w.status === 'completed').length
      };
    });
    
    setStudents(mapped);
  }, []);

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '1rem' }}>
      <h1 style={{ marginBottom: '2rem' }}>Teacher Dashboard</h1>

      <div className="card" style={{ marginBottom: '2rem' }}>
        <h2 style={{ marginTop: 0 }}>Retrievable Module Management</h2>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <Link to="/teacher/content-bank" className="btn btn-outline" style={{ flex: 1, textAlign: 'center' }}>Manage Content Bank</Link>
          <Link to="/teacher/template-bank" className="btn btn-outline" style={{ flex: 1, textAlign: 'center' }}>Manage Template Bank</Link>
          <Link to="/teacher/assignments" className="btn btn-outline" style={{ flex: 1, textAlign: 'center' }}>Student Assignments</Link>
        </div>
      </div>
      
      <div className="card">
        <h2 style={{ marginTop: 0, marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          Class Roster
          <span style={{ fontSize: '1rem', fontWeight: 'normal', color: 'var(--text-muted)' }}>{students.length} students</span>
        </h2>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem' }}>
          {students.map(s => (
            <div key={s.user.id} style={{ padding: '1.5rem', border: '1px solid var(--border)', borderRadius: '8px', background: '#f8fafc' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                <h3 style={{ margin: 0, fontSize: '1.4rem' }}>{s.user.name}</h3>
                <span className="status-badge" style={{ background: '#e0f2fe', color: '#0284c7' }}>Active</span>
              </div>
              
              <div style={{ display: 'flex', gap: '2rem', marginBottom: '1.5rem' }}>
                <div>
                  <p style={{ margin: '0 0 0.25rem 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Library Size</p>
                  <p style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700 }}>{s.swCount}</p>
                </div>
                <div>
                  <p style={{ margin: '0 0 0.25rem 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Mastered</p>
                  <p style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: 'var(--success)' }}>{s.completedCount}</p>
                </div>
              </div>
              
              <Link to={`/teacher/student/${s.user.id}`}>
                <button className="btn btn-outline" style={{ width: '100%', background: '#fff' }}>View Detailed Report</button>
              </Link>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
