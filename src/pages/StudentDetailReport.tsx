import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { db } from '../lib/db';
import { User, LearningItem, StudentLearningRecord, Attempt } from '../lib/types';

export default function StudentDetailReport() {
  const { id } = useParams<{ id: string }>();
  const [student, setStudent] = useState<User | null>(null);
  const [records, setRecords] = useState<{ item: LearningItem, record: StudentLearningRecord, attempts: Attempt[] }[]>([]);

  useEffect(() => {
    if (!id) return;
    const allUsers = db.getUsers();
    setStudent(allUsers.find(u => u.id === id) || null);

    const sRecords = db.getLearningRecords().filter(r => r.studentId === id);
    const allItems = db.getLearningItems();
    const aData = db.getAttempts().filter(a => a.studentId === id);

    const detailed = sRecords.map(record => {
      const item = allItems.find(i => i.id === record.learningItemId);
      if (!item) return null;
      return {
        record,
        item,
        attempts: aData.filter(a => a.wordId === item.id).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      };
    }).filter((r): r is { item: LearningItem, record: StudentLearningRecord, attempts: Attempt[] } => !!r);

    setRecords(detailed);
  }, [id]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return { bg: '#ecfdf5', color: '#059669', label: 'Mastered' };
      case 'weak': return { bg: '#fef2f2', color: '#dc2626', label: 'Struggling' };
      case 'practicing': return { bg: '#e0f2fe', color: '#0284c7', label: 'Practicing' };
      default: return { bg: '#f1f5f9', color: '#475569', label: status };
    }
  };

  if (!student) return <div style={{ padding: '2rem' }}>Student not found.</div>;

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '1rem' }}>
      <div style={{ marginBottom: '2rem' }}>
        <Link to="/teacher" style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 600 }}>&larr; Back to Dashboard</Link>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ margin: '0 0 0.5rem 0', fontSize: '2.5rem' }}>{student.name}'s Report</h1>
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>Detailed Library Overview & Attempt History</p>
        </div>
      </div>

      <div className="card">
        {records.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>Student has no items in their library.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', minWidth: '800px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '0 0.5rem 1rem' }}>Expression</th>
                  <th style={{ padding: '0 0.5rem 1rem' }}>Status</th>
                  <th style={{ padding: '0 0.5rem 1rem' }}>Encoding</th>
                  <th style={{ padding: '0 0.5rem 1rem' }}>Retry Stats</th>
                  <th style={{ padding: '0 0.5rem 1rem' }}>Latest Activity</th>
                </tr>
              </thead>
              <tbody>
                {records.map(({ item, record, attempts }) => {
                  const sColor = getStatusColor(record.status);
                  const passCount = attempts.filter(a => a.passed && !a.usedHint).length;
                  const accuracy = attempts.length > 0 ? Math.round((passCount / attempts.length) * 100) : 0;

                  return (
                    <tr key={record.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '1.5rem 0.5rem', fontSize: '1.1rem', fontWeight: 600 }}>{item.focusExpression}</td>
                      <td style={{ padding: '0 0.5rem' }}><span className="status-badge" style={{ background: sColor.bg, color: sColor.color }}>{sColor.label}</span></td>
                      <td style={{ padding: '0 0.5rem' }}>
                        {record.encodingCompleted
                          ? <span style={{ color: 'var(--success)' }}>✓ Complete</span>
                          : <span style={{ color: 'var(--warning)', fontWeight: 'bold' }}>Pending</span>}
                      </td>
                      <td style={{ padding: '0 0.5rem' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          <span style={{ fontWeight: 600 }}>{attempts.length} attempts</span>
                          <span style={{ fontSize: '0.85rem', color: accuracy < 50 && attempts.length > 2 ? 'var(--danger)' : 'var(--text-muted)' }}>
                            {accuracy}% efficiency
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: '0 0.5rem' }}>
                        {attempts.length > 0 ? (
                          <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                            {attempts[0].passed ? <span style={{ color: 'var(--success)' }}>✅ Passed</span> : <span style={{ color: 'var(--danger)' }}>❌ Failed</span>}
                            <br />
                            {new Date(attempts[0].date).toLocaleDateString()}
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No activity</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
