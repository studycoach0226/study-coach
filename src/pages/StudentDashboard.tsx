import { useEffect, useState } from 'react';
import { db } from '../lib/db';
import { fetchStudentById } from '../lib/studentContent';




export default function StudentDashboard() {

  const [studentName, setStudentName] = useState<string>('');

  useEffect(() => {
    const sId = db.getCurrentUserId();
    if (!sId) return;

    // 0. Fetch student name
    fetchStudentById(sId).then(s => {
      if (s) setStudentName(s.studentName);
    });

    // 1. Fetch vocabulary library items (removed from dashboard)


    // 2. Reading assignments logic moved to StudentReading.tsx

  }, []);



  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '1rem' }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ margin: 0 }}>
            {studentName ? `${studentName} 的學習平台` : '學生學習平台'}
          </h1>
        </div>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '1.1rem' }}>
          你的學習教練正在陪你練習 ✨
        </p>
      </header>





    </div>
  );
}