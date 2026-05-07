import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../lib/db';
import { ReadingItem } from '../lib/types';
import { fetchAllReadingArticles, fetchAssignmentsByStudentId } from '../lib/readingContent';

export default function StudentReading() {
  const navigate = useNavigate();
  const studentId = db.getCurrentUserId();
  const [readingItems, setReadingItems] = useState<ReadingItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sId = db.getCurrentUserId();
    if (!sId) {
      setLoading(false);
      return;
    }

    Promise.all([
      fetchAssignmentsByStudentId(sId),
      fetchAllReadingArticles(),
    ])
      .then(([assignments, sheetItems]) => {
        const assignedArticleIds = new Set(assignments.map(a => a.articleId));
        const publishedAssigned = sheetItems.filter(
          (sheetItem) => sheetItem.isPublished && assignedArticleIds.has(sheetItem.id)
        );

        const mapped = publishedAssigned.map((sheetItem) => ({
          id: sheetItem.id,
          articleCode: sheetItem.articleCode,
          itemType: 'reading' as const,
          title: sheetItem.title,
          articleText: sheetItem.articleText,
          fullMeaningZh: sheetItem.fullMeaningZh,
        })) as unknown as ReadingItem[];

        setReadingItems(mapped);
      })
      .catch((error) => {
        console.error('❌ Failed to load reading assignments:', error);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '2rem', textAlign: 'center' }}>
        <p>載入閱讀作業中...</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '1rem' }}>
      <header style={{ marginBottom: '2rem' }}>
        <h1 style={{ margin: 0 }}>My Reading</h1>
        <p style={{ margin: 0, color: 'var(--text-muted)' }}>您的老師為您安排的閱讀練習 ✨</p>
      </header>

      <div className="card">
        {readingItems.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>
            目前還沒有閱讀作業喔。
          </p>
        ) : (
          <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
            {readingItems.map((item: any) => (
              <div
                key={item.id}
                className="clickable-card"
                onClick={() => navigate(`/student/${studentId}/reading-practice/${item.id}`)}
              >
                <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 600 }}>
                  {item.articleCode}
                </div>
                <h3 style={{ margin: 0, fontSize: '1.2rem' }}>
                  {item.title}
                </h3>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
