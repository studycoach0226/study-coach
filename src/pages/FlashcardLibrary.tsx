import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { db } from '../lib/db';
import { LearningItem, StudentLearningRecord, ChunkItem, ChunkRecord } from '../lib/types';
import { fetchAssignmentsByStudentId } from '../lib/readingContent';
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

type ViewMode = 'list' | 'cards';

export default function FlashcardLibrary() {
  const navigate = useNavigate();
  const studentId = db.getCurrentUserId();
  const [items, setItems] = useState<{ item: LearningItem; record: StudentLearningRecord }[]>([]);
  const [assignedItems, setAssignedItems] = useState<AssignedReadingTask[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  const [addMode, setAddMode] = useState<'none' | 'single' | 'bulk'>('none');
  const [newChunk, setNewChunk] = useState(''); // Target Expression
  const [newTargetText, setNewTargetText] = useState(''); // Chinese Characters
  const [newSentence, setNewSentence] = useState(''); // Context
  const [newContextText, setNewContextText] = useState(''); // Chinese Sentence
  const [newTranslation, setNewTranslation] = useState(''); // Meaning
  const [newSentenceMeaning, setNewSentenceMeaning] = useState(''); // Context Meaning
  const [bulkInput, setBulkInput] = useState('');

  const [learnerType, setLearnerType] = useState<'english' | 'chinese'>('english');
  const [displayPrefs, setDisplayPrefs] = useState({
    showPronunciation: true,
    showTargetExpression: true,
    showMeaning: true,
  });
  const [saveMessage, setSaveMessage] = useState('');

  useEffect(() => {
    const sId = db.getCurrentUserId();
    if (!sId) return;

    // Load Preferences
    const savedMode = localStorage.getItem(`flashcardLearningMode:${sId}`);
    if (savedMode) setLearnerType(savedMode as any);

    const savedPrefs = localStorage.getItem(`flashcardDisplayPrefs:${sId}`);
    if (savedPrefs) {
      try {
        setDisplayPrefs(JSON.parse(savedPrefs));
      } catch (e) {
        console.error('Failed to parse display prefs', e);
      }
    }

    const allItems = db.getLearningItems();
    const studentRecords = db.getLearningRecords().filter(r => r.studentId === sId);

    setItems(
      studentRecords
        .map(record => ({ record, item: allItems.find(i => i.id === record.learningItemId)! }))
        .filter(pair => pair.item && pair.item.itemType !== 'reading')
    );

    fetchAssignmentsByStudentId(sId)
      .then(assignments => setAssignedItems(assignments))
      .catch(() => setAssignedItems([]));
  }, []);

  const handleSavePreferences = () => {
    const sId = db.getCurrentUserId();
    if (!sId) return;

    localStorage.setItem(`flashcardLearningMode:${sId}`, learnerType);
    localStorage.setItem(`flashcardDisplayPrefs:${sId}`, JSON.stringify(displayPrefs));

    setSaveMessage('Preferences saved.');
    setTimeout(() => setSaveMessage(''), 3000);
  };

  const handleCreateSingle = (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    if (learnerType === 'english') {
      if (!newChunk.trim() || !newTranslation.trim()) return;
    } else {
      if (!newChunk.trim()) return;
      if (!newTranslation.trim()) return;
    }

    const newLearningItem = {
      chunk: newSentence.trim(),
      contextText: newContextText.trim(),
      chunkTranslation: newTranslation.trim(),
      focusExpression: newChunk.trim(),
      targetText: newTargetText.trim(),
      sentenceMeaning: newSentenceMeaning.trim(),
      languageDirection: (learnerType === 'english' ? 'en-zh' : 'zh-en') as 'en-zh' | 'zh-en',
      topic: 'Custom',
      difficulty: 'beginner' as 'beginner' | 'intermediate' | 'advanced',
      createdBy: 'student',
    };
    db.addLearningItem(newLearningItem);

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
    setNewTargetText('');
    setNewSentence('');
    setNewContextText('');
    setNewTranslation('');
    setNewSentenceMeaning('');
  };

  const handleBulkImport = (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkInput.trim()) return;

    bulkInput.split('\n').forEach(line => {
      if (!line.trim()) return;
      const parts = line.split('|').map(p => p.trim());

      let targetExpression = '';
      let targetText = '';
      let meaning = '';
      let context = '';
      let contextText = '';
      let contextMeaning = '';

      if (learnerType === 'english') {
        // format: targetExpression | meaning | context | contextMeaning
        targetExpression = parts[0] || '';
        meaning = parts[1] || '';
        context = parts[2] || '';
        contextMeaning = parts[3] || '';

        if (!targetExpression || !meaning) return;
      } else {
        // format: targetExpression | targetText | meaning | context | contextText | contextMeaning
        targetExpression = parts[0] || '';
        targetText = parts[1] || '';
        meaning = parts[2] || '';
        context = parts[3] || '';
        contextText = parts[4] || '';
        contextMeaning = parts[5] || '';

        if (!targetExpression || !meaning) return;
      }

      db.addLearningItem({
        chunk: context,
        contextText: contextText,
        chunkTranslation: meaning,
        focusExpression: targetExpression,
        targetText: targetText,
        sentenceMeaning: contextMeaning,
        languageDirection: learnerType === 'english' ? 'en-zh' : 'zh-en',
        topic: 'Custom Import',
        difficulty: 'beginner',
        createdBy: 'student',
      });
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
    if (window.confirm('Delete this card?\nThis will remove it from your library.')) {
      const pair = items.find(p => p.record.id === recordId);
      if (pair) {
        deleteFlashcardFromCloud(pair.record.studentId, pair.record.learningItemId).catch(() => { });
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

  const renderListView = (list: typeof items) => {
    if (list.length === 0) {
      return <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No items in this category.</p>;
    }
    return (
      <div style={{ overflowX: 'auto', marginBottom: '1.5rem' }}>
        <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border)', color: 'var(--text-muted)' }}>
              <th style={{ paddingBottom: '0.75rem', paddingRight: '1rem' }}>Target Unit</th>
              {learnerType === 'chinese' && displayPrefs.showTargetExpression && (
                <th style={{ paddingBottom: '0.75rem', paddingRight: '1rem' }}>Chinese Characters</th>
              )}
              <th style={{ paddingBottom: '0.75rem', paddingRight: '1rem' }}>Meaning</th>
              <th style={{ paddingBottom: '0.75rem', paddingRight: '1rem' }}>Mastery</th>
              <th style={{ paddingBottom: '0.75rem', paddingRight: '1rem' }}>Encoding</th>
              <th style={{ paddingBottom: '0.75rem' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {list.map(({ item, record }) => {
              const sColor = getStatusColor(record.status);
              const isComplete = db.isOnboardingComplete(record);
              return (
                <tr key={record.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '0.85rem 1rem 0.85rem 0' }}>
                    <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>{(item as ChunkItem).focusExpression}</div>
                  </td>
                  {learnerType === 'chinese' && displayPrefs.showTargetExpression && (
                    <td style={{ padding: '0.85rem 1rem 0.85rem 0' }}>
                      <div style={{ fontSize: '1.1rem', color: 'var(--text-main)' }}>
                        {(record as any).targetText || (item as any).targetText || (record as ChunkRecord).studentConnections?.targetText || '-'}
                      </div>
                    </td>
                  )}
                  <td style={{ color: 'var(--text-muted)', paddingRight: '1rem' }}>
                    <div style={{ fontWeight: 'bold', color: 'var(--text-main)' }}>{(record as ChunkRecord).studentConnections?.customTranslation || (item as ChunkItem).chunkTranslation || '-'}</div>
                  </td>
                  <td style={{ paddingRight: '1rem' }}>
                    <span className="status-badge" style={{ background: sColor.bg, color: sColor.color }}>
                      {record.status}
                    </span>
                  </td>
                  <td style={{ paddingRight: '1rem' }}>
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
                        style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem' }}
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
                          fontSize: '0.85rem',
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

  const renderCardsView = (list: typeof items) => {
    if (list.length === 0) {
      return <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No items in this category.</p>;
    }
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: '0.75rem',
          marginBottom: '1.5rem',
        }}
      >
        {list.map(({ item, record }) => {
          const sColor = getStatusColor(record.status);
          const isComplete = db.isOnboardingComplete(record);
          return (
            <div
              key={record.id}
              onClick={() => navigate(`/student/${studentId}/builder?wordId=${item.id}`)}
              style={{
                padding: '1rem',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                background: '#fff',
                cursor: 'pointer',
                transition: 'border-color 0.15s ease',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.35rem',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = '#cbd5e1')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-main)' }}>
                    {(item as ChunkItem).focusExpression}
                  </div>
                  {learnerType === 'chinese' && displayPrefs.showTargetExpression && (
                    <div style={{ fontSize: '1rem', color: 'var(--primary)', marginTop: '0.2rem', fontWeight: 'bold' }}>
                      {(record as any).targetText || (item as any).targetText || (record as ChunkRecord).studentConnections?.targetText}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                  <div style={{ fontWeight: 'bold' }}>{(record as ChunkRecord).studentConnections?.customTranslation || (item as ChunkItem).chunkTranslation || '-'}</div>
                </div>
              </div>
              <div style={{ marginTop: '0.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="status-badge" style={{ background: sColor.bg, color: sColor.color, fontSize: '0.75rem' }}>
                  {record.status}
                </span>
                {isComplete ? (
                  <span style={{ fontSize: '0.75rem', color: 'var(--success)', fontWeight: 600 }}>✓</span>
                ) : (
                  <span style={{ fontSize: '0.75rem', color: 'var(--warning)', fontWeight: 600 }}>⚠️</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const pendingItems = items.filter(({ record }) => !db.isOnboardingComplete(record));
  const readyItems = items.filter(({ record }) => db.isOnboardingComplete(record));

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '1rem' }}>

      {/* Header */}
      <header style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: '0 0 0.25rem 0' }}>My Flashcards</h1>
        <p style={{ margin: 0, color: 'var(--text-muted)' }}>
          Manage all your flashcards — words, chunks, phrases, and sentences.
        </p>
      </header>

      {/* Action Bar */}
      <div className="card" style={{ marginBottom: '1.5rem', padding: '1.25rem' }}>
        <div style={{ marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontWeight: 'bold', color: 'var(--text-muted)', fontSize: '0.9rem' }}>Learning Mode:</span>
            <select
              value={learnerType}
              onChange={(e) => setLearnerType(e.target.value as any)}
              style={{ padding: '0.3rem 0.6rem', borderRadius: '8px', border: '1px solid var(--border)', background: '#fff', fontSize: '0.9rem', cursor: 'pointer', outline: 'none' }}
            >
              <option value="english">English Learner</option>
              <option value="chinese">Chinese Learner</option>
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ display: 'flex', gap: '1rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              {learnerType === 'chinese' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={displayPrefs.showTargetExpression} onChange={e => setDisplayPrefs({ ...displayPrefs, showTargetExpression: e.target.checked })} />
                  Show Chinese Characters
                </label>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button onClick={handleSavePreferences} className="btn btn-outline" style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem', background: '#fff', borderRadius: '6px' }}>
                Save Prefs
              </button>
              {saveMessage && <span style={{ fontSize: '0.75rem', color: 'var(--success)', fontWeight: 600 }}>{saveMessage}</span>}
            </div>
          </div>
        </div>

        {addMode === 'none' ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
            <Link to={`/student/${studentId}/assignments`}>
              <button
                className="btn btn-primary"
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                🎓 Assigned from Teacher
                {assignedItems.length > 0 && (
                  <span
                    style={{
                      background: '#fff',
                      color: 'var(--primary)',
                      padding: '0.1rem 0.4rem',
                      borderRadius: '10px',
                      fontSize: '0.8rem',
                    }}
                  >
                    {assignedItems.length}
                  </span>
                )}
              </button>
            </Link>
            <button
              className="btn btn-outline"
              style={{ background: '#fff' }}
              onClick={() => setAddMode('single')}
            >
              + Add a Card
            </button>
            <button
              className="btn btn-outline"
              style={{ background: '#fff' }}
              onClick={() => setAddMode('bulk')}
            >
              + Bulk Import
            </button>
          </div>
        ) : addMode === 'single' ? (
          <form onSubmit={handleCreateSingle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>Create New Card ({learnerType === 'english' ? 'English' : 'Chinese'})</h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
              {/* Target Expression Section */}
              <div style={{ display: 'grid', gridTemplateColumns: learnerType === 'chinese' ? '1fr 1fr' : '1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 'bold' }}>Target Expression {learnerType === 'chinese' && '(Pinyin / Readable)'}</label>
                  <input
                    value={newChunk}
                    onChange={e => setNewChunk(e.target.value)}
                    className="input-field"
                    style={{ width: '100%', boxSizing: 'border-box' }}
                    placeholder={learnerType === 'english' ? "e.g. waiting for" : "e.g. deng3 gong1che1"}
                    required
                  />
                </div>
                {learnerType === 'chinese' && (
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 'bold' }}>Chinese Characters</label>
                    <input
                      value={newTargetText}
                      onChange={e => setNewTargetText(e.target.value)}
                      className="input-field"
                      style={{ width: '100%', boxSizing: 'border-box' }}
                      placeholder="e.g. 等公車"
                    />
                  </div>
                )}
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 'bold' }}>Meaning {learnerType === 'chinese' ? '(English)' : '(Chinese)'}</label>
                <input
                  value={newTranslation}
                  onChange={e => setNewTranslation(e.target.value)}
                  className="input-field"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                  placeholder={learnerType === 'english' ? "e.g. 等公車" : "e.g. waiting for a bus"}
                  required
                />
              </div>

              {/* Context Section */}
              <div style={{ display: 'grid', gridTemplateColumns: learnerType === 'chinese' ? '1fr 1fr' : '1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 'bold' }}>Sentence / Context {learnerType === 'chinese' && '(Pinyin)'}</label>
                  <input
                    value={newSentence}
                    onChange={e => setNewSentence(e.target.value)}
                    className="input-field"
                    style={{ width: '100%', boxSizing: 'border-box' }}
                    placeholder={learnerType === 'english' ? "e.g. Jimmy is waiting for a bus." : "e.g. wo3 zai4 deng3 gong1che1"}
                  />
                </div>
                {learnerType === 'chinese' && (
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 'bold' }}>Chinese Sentence</label>
                    <input
                      value={newContextText}
                      onChange={e => setNewContextText(e.target.value)}
                      className="input-field"
                      style={{ width: '100%', boxSizing: 'border-box' }}
                      placeholder="e.g. 我在等公車。"
                    />
                  </div>
                )}
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 'bold' }}>Sentence Meaning {learnerType === 'chinese' ? '(English)' : '(Chinese)'}</label>
                <input
                  value={newSentenceMeaning}
                  onChange={e => setNewSentenceMeaning(e.target.value)}
                  className="input-field"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                  placeholder={learnerType === 'english' ? "e.g. Jimmy 在等公車。" : "e.g. I am waiting for a bus."}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="submit" className="btn btn-primary">Save Card</button>
              <button type="button" className="btn btn-outline" style={{ background: '#fff' }} onClick={() => setAddMode('none')}>Cancel</button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleBulkImport}>
            <h3 style={{ marginTop: 0, marginBottom: '0.5rem' }}>Bulk Import Cards ({learnerType === 'english' ? 'English' : 'Chinese'})</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
              {learnerType === 'english' ? (
                <>Format: <code>targetExpression | meaning | context | contextMeaning</code></>
              ) : (
                <>Format: <code>targetExpression | targetText | meaning | context | contextText | contextMeaning</code></>
              )}
            </p>
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
                fontFamily: 'monospace',
                boxSizing: 'border-box',
                marginBottom: '1rem',
              }}
              placeholder={learnerType === 'english'
                ? 'waiting for | 等公車 | Jimmy is waiting for a bus. | Jimmy 在等公車'
                : 'deng3 gong1che1 | 等公車 | waiting for a bus | wo3 zai4 deng3 gong1che1 | 我在等公車。 | I am waiting for a bus.'
              }
            />
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="submit" className="btn btn-primary">Import Cards</button>
              <button type="button" className="btn btn-outline" style={{ background: '#fff' }} onClick={() => setAddMode('none')}>Cancel</button>
            </div>
          </form>
        )}
      </div>

      {/* Main Content */}
      <div className="card" style={{ marginBottom: '2rem' }}>

        {/* Card header: count + view toggle */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
            <h2 style={{ margin: 0 }}>All Cards</h2>
            <span style={{ fontSize: '0.95rem', color: 'var(--text-muted)' }}>{items.length} units total</span>
          </div>

          {/* View Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>View:</span>
            <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: '6px', padding: '2px' }}>
              <button
                onClick={() => setViewMode('list')}
                style={{
                  padding: '0.3rem 0.75rem',
                  fontSize: '0.85rem',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: 600,
                  background: viewMode === 'list' ? '#fff' : 'transparent',
                  color: viewMode === 'list' ? 'var(--primary)' : 'var(--text-muted)',
                  boxShadow: viewMode === 'list' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                ☰ List
              </button>
              <button
                onClick={() => setViewMode('cards')}
                style={{
                  padding: '0.3rem 0.75rem',
                  fontSize: '0.85rem',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: 600,
                  background: viewMode === 'cards' ? '#fff' : 'transparent',
                  color: viewMode === 'cards' ? 'var(--primary)' : 'var(--text-muted)',
                  boxShadow: viewMode === 'cards' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                ⊞ Cards
              </button>
            </div>
          </div>
        </div>

        {items.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>
            No flashcards yet. Add your own unit or check your teacher assignments.
          </p>
        ) : (
          <>
            {/* Stage 2 */}
            <h3 style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem', color: 'var(--text-main)', marginTop: 0 }}>
              Stage 2: Pending Encoding ({pendingItems.length})
            </h3>
            {viewMode === 'list' ? renderListView(pendingItems) : renderCardsView(pendingItems)}

            {/* Stage 3 */}
            <h3 style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem', color: 'var(--text-main)', marginTop: '2rem' }}>
              Stage 3: Ready to Practice ({readyItems.length})
            </h3>
            {viewMode === 'list' ? renderListView(readyItems) : renderCardsView(readyItems)}
          </>
        )}
      </div>
    </div>
  );
}
