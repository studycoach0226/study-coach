import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../lib/db';
import { fetchAllExercises, fetchExerciseAssignmentsByStudentId, SheetExerciseQuestion } from '../lib/exerciseContent';

export default function StudentExercises() {
  const navigate = useNavigate();
  const studentId = db.getCurrentUserId();
  const [exercises, setExercises] = useState<SheetExerciseQuestion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sId = db.getCurrentUserId();
    if (!sId) {
      setLoading(false);
      return;
    }

    Promise.all([
      fetchExerciseAssignmentsByStudentId(sId),
      fetchAllExercises(),
    ])
      .then(([assignments, allQuestions]) => {
        console.log('[DEBUG] Current studentId:', sId);
        console.log('[DEBUG] Loaded exercise assignments:', assignments);
        console.log('[DEBUG] Loaded exercise questions:', allQuestions);

        const assignedCodes = new Set(
          assignments
            .filter(a => a.status === 'assigned')
            .map(a => a.exerciseCode)
        );
        console.log('[DEBUG] Assigned exercise codes:', Array.from(assignedCodes));

        const filtered = allQuestions.filter(q => assignedCodes.has(q.exerciseCode));
        console.log('[DEBUG] Filtered exercises:', filtered);
        
        setExercises(filtered);
      })
      .catch((error) => {
        console.error('❌ Failed to load exercises:', error);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '2rem', textAlign: 'center' }}>
        <p>載入練習題中...</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '1rem' }}>
      <header style={{ marginBottom: '2rem' }}>
        <h1 style={{ margin: 0 }}>My Exercises</h1>
        <p style={{ margin: 0, color: 'var(--text-muted)' }}>您的老師為您安排的練習題 ✨</p>
      </header>

      <div className="card">
        {exercises.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem', marginBottom: '1rem' }}>
              目前還沒有練習題喔。
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              當老師為您指派練習題時，它們會出現在這裡。
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
            {exercises.map((item) => (
              <div
                key={item.id}
                className="clickable-card"
                onClick={() => navigate(`/student/${studentId}/exercise-practice/${item.id}`)}
                style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
              >
                <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 600 }}>
                  {item.exerciseCode}
                </div>
                <h3 style={{ margin: 0, fontSize: '1.2rem' }}>
                  Exercise {item.exerciseCode}
                </h3>
                <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                  {item.questionText}
                </div>
                {item.wordRange && (
                  <div style={{ marginTop: 'auto', fontSize: '0.8rem', color: 'var(--primary)', fontWeight: 600 }}>
                    📍 {item.wordRange}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
