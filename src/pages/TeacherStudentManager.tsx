import { useEffect, useState } from 'react';
import { fetchAllStudents, SheetStudent } from '../lib/studentContent';

export default function TeacherStudentManager() {
  const [students, setStudents] = useState<SheetStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        const data = await fetchAllStudents();
        // Only show active students
        const activeOnly = data.filter(s => s.status === 'active');
        setStudents(activeOnly);
      } catch (err) {
        console.error('Failed to load students:', err);
        setError('無法載入學生清單');
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const handleCopy = (studentId: string) => {
    const url = `${window.location.origin}/student/${studentId}`;
    navigator.clipboard.writeText(url);
    alert('已複製連結');
  };

  if (loading) return <div style={{ padding: '2rem' }}>載入中...</div>;
  if (error) return <div style={{ padding: '2rem', color: 'red' }}>{error}</div>;

  return (
    <div style={{ maxWidth: '800px', margin: '2rem auto', padding: '0 1rem' }}>
      <h1>學生帳號管理 (僅顯示啟用中)</h1>
      <p style={{ color: '#666', marginBottom: '2rem' }}>
        您可以從這裡複製學生的直接登入連結。
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {students.length === 0 ? (
          <p>目前沒有啟用的學生。</p>
        ) : (
          students.map((s) => (
            <div
              key={s.studentId}
              style={{
                padding: '1rem',
                border: '1px solid #ddd',
                borderRadius: '8px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: '#fff'
              }}
            >
              <div>
                <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{s.studentName}</div>
                <div style={{ fontSize: '0.85rem', color: '#888' }}>ID: {s.studentId}</div>
              </div>
              <button
                className="btn btn-primary"
                onClick={() => handleCopy(s.studentId)}
              >
                複製直接連結
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
