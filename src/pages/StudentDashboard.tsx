import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { db } from '../lib/db';
import { LearningItem, StudentLearningRecord, ReadingItem, ChunkItem } from '../lib/types';
import { fetchAllReadingArticles, fetchAssignmentsByStudentId } from '../lib/readingContent';
import { fetchStudentById } from '../lib/studentContent';
import { deleteFlashcardFromCloud } from '../lib/firebaseDb';

type AssignedReadingTask = {
  assignmentId: string;
  studentId: string;
  articleId: string;
  articleCode: string;
  status: string;
  assignedDate: string;
  dueDate: string;
};

export default function StudentDashboard() {
  const navigate = useNavigate();
  const studentId = db.getCurrentUserId();
  const [items, setItems] = useState<{ item: LearningItem, record: StudentLearningRecord }[]>([]);
  const [assignedItems, setAssignedItems] = useState<AssignedReadingTask[]>([]);
  const [readingItems, setReadingItems] = useState<ReadingItem[]>([]);
  const [studentName, setStudentName] = useState<string>('');

  const [addMode, setAddMode] = useState<'none' | 'single' | 'bulk'>('none');
  const [newChunk, setNewChunk] = useState('');
  const [newSentence, setNewSentence] = useState('');
  const [newTranslation, setNewTranslation] = useState('');
  const [bulkInput, setBulkInput] = useState('');

  useEffect(() => {
    const sId = db.getCurrentUserId();
    if (!sId) return;

    // 0. Fetch student name
    fetchStudentById(sId).then(s => {
      if (s) setStudentName(s.studentName);
    });

    // 1. Fetch vocabulary library items
    const allItems = db.getLearningItems();
    const studentRecords = db.getLearningRecords().filter(r => r.studentId === sId);

    setItems(
      studentRecords
        .map(record => ({ record, item: allItems.find(i => i.id === record.learningItemId)! }))
        .filter(pair => pair.item && pair.item.itemType !== 'reading')
    );

    // 2. Fetch reading assignments + reading articles from Google Sheets
    Promise.all([
      fetchAssignmentsByStudentId(sId),
      fetchAllReadingArticles(),
    ])
      .then(([assignments, sheetItems]) => {
        console.log('📘 Dashboard assignments:', assignments);
        console.log('🔥 Dashboard sheetItems:', sheetItems);

        setAssignedItems(assignments);

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
        console.error('❌ Failed to load reading assignments / reading items:', error);
        setAssignedItems([]);
        setReadingItems([]);
      });
  }, []);

  const handleCreateSingle = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChunk.trim() || !newSentence.trim()) return;

    db.addLearningItem({
      chunk: newChunk,
      chunkTranslation: newTranslation,
      focusExpression: newChunk,
      languageDirection: 'en-zh',
      topic: 'Custom',
      difficulty: 'beginner',
      createdBy: 'student'
    });

    // Update local state instead of reload
    const sId = db.getCurrentUserId();
    if (sId) {
      const allItems = db.getLearningItems();
      const studentRecords = db.getLearningRecords().filter(r => r.studentId === sId);
      const localPairs = studentRecords
        .map(record => ({ record, item: allItems.find(i => i.id === record.learningItemId)! }))
        .filter(pair => pair.item && pair.item.itemType !== 'reading');
      setItems(localPairs);
    }

    setAddMode('none');
    setNewChunk('');
    setNewSentence('');
    setNewTranslation('');
  };

  const handleBulkImport = (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkInput.trim()) return;

    const lines = bulkInput.split('\n');
    lines.forEach(line => {
      if (!line.trim()) return;
      const parts = line.split('|');
      const chunk = parts[0]?.trim() || '';
      const sentence = parts[1]?.trim() || '';
      const translation = parts[2]?.trim() || '';

      if (chunk && sentence) {
        db.addLearningItem({
          chunk: sentence,
          chunkTranslation: translation,
          focusExpression: chunk,
          languageDirection: 'en-zh',
          topic: 'Custom Import',
          difficulty: 'beginner',
          createdBy: 'student'
        });
      }
    });

    // Update local state instead of reload
    const sId = db.getCurrentUserId();
    if (sId) {
      const allItems = db.getLearningItems();
      const studentRecords = db.getLearningRecords().filter(r => r.studentId === sId);
      const localPairs = studentRecords
        .map(record => ({ record, item: allItems.find(i => i.id === record.learningItemId)! }))
        .filter(pair => pair.item && pair.item.itemType !== 'reading');
      setItems(localPairs);
    }

    setAddMode('none');
    setBulkInput('');
  };

  const handleDeleteCard = (recordId: string) => {
    if (window.confirm("Delete this card?\nThis will remove it from your library.")) {
      const pair = items.find(p => p.record.id === recordId);
      if (pair) {
        deleteFlashcardFromCloud(pair.record.studentId, pair.record.learningItemId).catch(() => {});
      }
      db.deleteLearningRecord(recordId);
      setItems(prev => prev.filter(p => p.record.id !== recordId));
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return { bg: '#d1fae5', color: '#059669' };
      case 'weak': return { bg: '#fee2e2', color: '#dc2626' };
      case 'practicing': return { bg: '#e0f2fe', color: '#0284c7' };
      default: return { bg: '#f1f5f9', color: '#475569' };
    }
  };

  const renderTable = (list: typeof items) => {
    if (list.length === 0) {
      return <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No items in this category.</p>;
    }

    return (
      <div style={{ overflowX: 'auto', marginBottom: '2rem' }}>
        <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border)', color: 'var(--text-muted)' }}>
              <th style={{ paddingBottom: '1rem' }}>Unit</th>
              <th style={{ paddingBottom: '1rem' }}>Meaning</th>
              <th style={{ paddingBottom: '1rem' }}>Mastery</th>
              <th style={{ paddingBottom: '1rem' }}>Encoding Status</th>
              <th style={{ paddingBottom: '1rem' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {list.map(({ item, record }) => {
              const sColor = getStatusColor(record.status);
              const isComplete = db.isOnboardingComplete(record);

              return (
                <tr key={record.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '1rem 0', fontSize: '1.25rem', fontWeight: 600 }}>
                    {(item as ChunkItem).focusExpression}
                  </td>
                  <td style={{ color: 'var(--text-muted)' }}>
                    {(item as ChunkItem).chunkTranslation || '-'}
                  </td>
                  <td>
                    <span className="status-badge" style={{ background: sColor.bg, color: sColor.color }}>
                      {record.status}
                    </span>
                  </td>
                  <td>
                    {isComplete ? (
                      <span style={{ color: 'var(--success)', fontWeight: 'bold' }}>✓ Done</span>
                    ) : (
                      <span style={{ color: 'var(--warning)', fontWeight: 'bold' }}>⚠️ Pending</span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        onClick={() => navigate(`/student/${studentId}/builder?wordId=${item.id}`)}
                        className={isComplete ? "btn btn-outline" : "btn btn-success"}
                        style={{ padding: '0.4rem 0.75rem', fontSize: '0.9rem' }}
                        title="Edit Card"
                      >
                        {isComplete ? '✏️ Edit' : 'Start'}
                      </button>
                      <button
                        onClick={() => handleDeleteCard(record.id)}
                        className="btn btn-outline"
                        style={{
                          background: '#fee2e2',
                          color: '#dc2626',
                          borderColor: '#fca5a5',
                          padding: '0.4rem 0.5rem',
                          fontSize: '0.9rem'
                        }}
                        title="Delete Card"
                      >
                        🗑
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

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


      <div className="card" style={{ marginBottom: '2rem' }}>
        <h2 style={{ marginTop: 0, marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          My Reading
        </h2>

        {readingItems.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No reading assignments yet.</p>
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

      <div className="card" style={{ marginBottom: '2rem' }}>
        <h2 style={{ marginTop: 0, marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          My Flashcards
          <span style={{ fontSize: '1rem', fontWeight: 'normal', color: 'var(--text-muted)' }}>
            {items.length} units total
          </span>
        </h2>

        {addMode === 'none' ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <Link to={`/student/${studentId}/assignments`}>
              <button className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                🎓 Assigned from Teacher
                {assignedItems.length > 0 && (
                  <span
                    style={{
                      background: '#fff',
                      color: 'var(--primary)',
                      padding: '0.1rem 0.4rem',
                      borderRadius: '10px',
                      fontSize: '0.8rem'
                    }}
                  >
                    {assignedItems.length}
                  </span>
                )}
              </button>
            </Link>
            <button className="btn btn-outline" style={{ background: '#fff' }} onClick={() => setAddMode('single')}>+ Add a Card</button>
            <button className="btn btn-outline" style={{ background: '#fff' }} onClick={() => setAddMode('bulk')}>+ Bulk Import</button>
          </div>
        ) : addMode === 'single' ? (
          <form
            onSubmit={handleCreateSingle}
            style={{
              marginBottom: '1.5rem',
              padding: '1rem',
              background: '#f8fafc',
              borderRadius: '8px',
              border: '1px solid var(--border)'
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: '1rem' }}>Create New Card</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 'bold' }}>
                  Chunk (Primary)
                </label>
                <input
                  value={newChunk}
                  onChange={e => setNewChunk(e.target.value)}
                  required
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border)' }}
                  placeholder="e.g. waiting for"
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 'bold' }}>
                  Sentence (Context)
                </label>
                <input
                  value={newSentence}
                  onChange={e => setNewSentence(e.target.value)}
                  required
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border)' }}
                  placeholder="e.g. Jimmy is waiting for a bus."
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 'bold' }}>
                  Translation
                </label>
                <input
                  value={newTranslation}
                  onChange={e => setNewTranslation(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border)' }}
                  placeholder="e.g. Jimmy 在等公車"
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="submit" className="btn btn-primary">Save Card</button>
              <button type="button" className="btn btn-outline" style={{ background: '#fff' }} onClick={() => setAddMode('none')}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <form
            onSubmit={handleBulkImport}
            style={{
              marginBottom: '1.5rem',
              padding: '1rem',
              background: '#f8fafc',
              borderRadius: '8px',
              border: '1px solid var(--border)'
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: '0.5rem' }}>Bulk Import Custom Cards</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
              Format: <code>chunk | sentence | translation</code> (one card per line).
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1rem' }}>
              <textarea
                value={bulkInput}
                onChange={e => setBulkInput(e.target.value)}
                required
                style={{
                  width: '100%',
                  minHeight: '120px',
                  padding: '0.75rem',
                  borderRadius: '4px',
                  border: '1px solid var(--border)',
                  fontFamily: 'monospace'
                }}
                placeholder="waiting for | Jimmy is waiting for a bus. | Jimmy 在等公車&#10;take a picture | I take a picture. | 我拍照"
              />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="submit" className="btn btn-primary">Import Cards</button>
              <button type="button" className="btn btn-outline" style={{ background: '#fff' }} onClick={() => setAddMode('none')}>
                Cancel
              </button>
            </div>
          </form>
        )}

        {items.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>
            No items in your library yet. Add your own custom unit or check your teacher assignments.
          </p>
        ) : (
          <div>
            <h3 style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem', color: 'var(--text-main)' }}>
              Stage 2: Pending Encoding ({items.filter(({ record }) => !db.isOnboardingComplete(record)).length})
            </h3>
            {renderTable(items.filter(({ record }) => !db.isOnboardingComplete(record)))}

            <h3 style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem', color: 'var(--text-main)', marginTop: '2rem' }}>
              Stage 3: Ready to Practice ({items.filter(({ record }) => db.isOnboardingComplete(record)).length})
            </h3>
            {renderTable(items.filter(({ record }) => db.isOnboardingComplete(record)))}
          </div>
        )}
      </div>
    </div>
  );
}