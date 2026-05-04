import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchStudentById, SheetStudent } from '../lib/studentContent';
import { db } from '../lib/db';
import StudentDashboard from '../pages/StudentDashboard';

export default function StudentRouteHandler() {
  const { studentId } = useParams<{ studentId: string }>();
  const navigate = useNavigate();
  const [student, setStudent] = useState<SheetStudent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (studentId) {
      // 1. Immediately treat URL as source of truth to prevent race conditions
      db.setCurrentUserId(studentId);
      localStorage.setItem('activeRole', 'student');
    }

    async function loadStudent() {
      if (!studentId) {
        setError('未提供學生 ID');
        setLoading(false);
        return;
      }

      try {
        const found = await fetchStudentById(studentId);
        if (found && (found.status === 'active' || found.status === '')) {
          // Sync to localStorage so db.getLoggedUser() works for Navbar and other components
          const existingUsers = db.getUsers();
          if (!existingUsers.find(u => u.id === found.studentId)) {
            existingUsers.push({
              id: found.studentId,
              name: found.studentName,
              role: 'student'
            });
            localStorage.setItem('vocab_users', JSON.stringify(existingUsers));
          }

          // Ensure state is locked
          db.setCurrentUserId(found.studentId);
          setStudent(found);
        } else {
          setError('找不到這位學生，請確認連結是否正確。');
        }
      } catch (err) {
        console.error('Error loading student:', err);
        setError('載入學生資料時發生錯誤，請稍後再試。');
      } finally {
        setLoading(false);
      }
    }

    loadStudent();
  }, [studentId]);


  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <div className="animate-pulse">正在載入學生資料...</div>
      </div>
    );
  }

  if (error || !student) {
    return (
      <div style={{ padding: '4rem 2rem', textAlign: 'center' }}>
        <div style={{ fontSize: '1.2rem', color: '#dc2626', marginBottom: '1.5rem' }}>
          {error || '找不到這位學生，請確認連結是否正確。'}
        </div>
        <button
          className="btn btn-outline"
          onClick={() => navigate('/')}
        >
          回首頁
        </button>
      </div>
    );
  }

  // If valid, render the dashboard
  return <StudentDashboard key={studentId} />;
}
