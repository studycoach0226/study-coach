import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { db } from '../lib/db';
import { fetchStudentById } from '../lib/studentContent';
import { fetchAssignmentsByStudentId } from '../lib/readingContent';


export default function StudentDashboard() {
  const navigate = useNavigate();
  const studentId = db.getCurrentUserId();
  const [studentName, setStudentName] = useState<string>('');
  const [stats, setStats] = useState({
    pendingEncoding: 0,
    dueForReview: 0,
    readingPending: 0,
    cardsLearnedTotal: 0,
    completedThisWeek: 0,
  });

  useEffect(() => {
    const sId = db.getCurrentUserId();
    if (!sId) return;

    // 1. Fetch student name
    fetchStudentById(sId).then(s => {
      if (s) setStudentName(s.studentName);
    });

    // 2. Calculate Flashcard & Retrieval stats
    const allRecords = db.getLearningRecords().filter(r => r.studentId === sId);
    const pendingEncoding = allRecords.filter(r => !db.isOnboardingComplete(r)).length;
    const cardsLearnedTotal = allRecords.filter(r => db.isOnboardingComplete(r)).length;
    
    // Simple "due for review" logic: practiced more than 24h ago or status not 'completed'
    const dueForReview = allRecords.filter(r => r.status !== 'completed' && db.isOnboardingComplete(r)).length;

    // 3. Weekly progress (last 7 days)
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const completedThisWeek = allRecords.filter(r => r.updatedAt > sevenDaysAgo && r.status === 'completed').length;

    // 4. Reading stats
    fetchAssignmentsByStudentId(sId).then(assignments => {
      const pending = assignments.filter(a => a.status !== 'completed').length;
      setStats(prev => ({
        ...prev,
        pendingEncoding,
        dueForReview,
        readingPending: pending,
        cardsLearnedTotal,
        completedThisWeek
      }));
    });

  }, []);

  const quickActions = [
    { 
      title: 'Flashcard Encoding', 
      desc: 'Create and sync your personal units.', 
      icon: '✏️', 
      path: `/student/${studentId}/flashcards`,
      color: '#f0fdf4',
      borderColor: '#bcf0da'
    },
    { 
      title: 'Retrieval Practice', 
      desc: 'Strengthen your long-term memory.', 
      icon: '🧠', 
      path: `/student/${studentId}/practice`,
      color: '#eff6ff',
      borderColor: '#bfdbfe'
    },
    { 
      title: 'My Reading', 
      desc: 'Read articles and practice speaking.', 
      icon: '📖', 
      path: `/student/${studentId}/reading`,
      color: '#fff7ed',
      borderColor: '#fed7aa'
    }
  ];

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '1rem' }}>
      <header style={{ marginBottom: '2.5rem' }}>
        <h1 style={{ margin: '0 0 0.5rem 0', fontSize: '2rem' }}>
          {studentName ? `Hi, ${studentName}!` : 'Hello Student!'}
        </h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '1.2rem' }}>
          Welcome back to your learning mission control. 🚀
        </p>
      </header>

      {/* Section 1: Continue Learning (Summary Cards) */}
      <section style={{ marginBottom: '3rem' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1.25rem', color: 'var(--text-main)' }}>Current Focus</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1.25rem' }}>
            <div style={{ fontSize: '2rem' }}>✍️</div>
            <div>
              <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{stats.pendingEncoding} Units Pending</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Awaiting encoding & sync</div>
            </div>
          </div>
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1.25rem' }}>
            <div style={{ fontSize: '2rem' }}>🎯</div>
            <div>
              <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{stats.dueForReview} Units Due</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Ready for retrieval practice</div>
            </div>
          </div>
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1.25rem' }}>
            <div style={{ fontSize: '2rem' }}>📚</div>
            <div>
              <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{stats.readingPending} Reading Tasks</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Pending teacher assignments</div>
            </div>
          </div>
        </div>
      </section>

      {/* Section 2: Quick Actions */}
      <section style={{ marginBottom: '3rem' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1.25rem', color: 'var(--text-main)' }}>Start Practice</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.25rem' }}>
          {quickActions.map(action => (
            <div 
              key={action.path}
              className="clickable-card"
              onClick={() => navigate(action.path)}
              style={{ 
                background: action.color, 
                border: `1px solid ${action.borderColor}`,
                padding: '1.5rem',
                textAlign: 'center'
              }}
            >
              <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>{action.icon}</div>
              <h3 style={{ margin: '0 0 0.5rem 0' }}>{action.title}</h3>
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.95rem' }}>{action.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Section 3: Weekly Progress */}
      <section>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1.25rem', color: 'var(--text-main)' }}>Weekly Activity</h2>
        <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'space-around', flexWrap: 'wrap', gap: '2rem' }}>
            <div>
              <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--primary)' }}>{stats.cardsLearnedTotal}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.25rem' }}>Total Units</div>
            </div>
            <div style={{ borderLeft: '1px solid var(--border)', paddingLeft: '2rem' }}>
              <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--success)' }}>{stats.completedThisWeek}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.25rem' }}>Completed This Week</div>
            </div>
            <div style={{ borderLeft: '1px solid var(--border)', paddingLeft: '2rem' }}>
              <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#8b5cf6' }}>100%</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.25rem' }}>Sync Status</div>
            </div>
          </div>
        </div>
      </section>

      <div style={{ marginTop: '3rem', textAlign: 'center' }}>
        <Link to={`/student/${studentId}/report`} style={{ color: 'var(--primary)', fontWeight: 'bold', textDecoration: 'none' }}>
          View Full Performance Report →
        </Link>
      </div>
    </div>
  );
}