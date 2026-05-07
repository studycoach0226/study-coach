import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { db } from '../lib/db';
import { LearningItem, StudentLearningRecord, ConnectionFields, ChunkItem, ChunkRecord } from '../lib/types';
import AudioRecorder from '../components/AudioRecorder';
import { playUnifiedAudio } from '../lib/audioUtils';

type LoadingStatus = 'idle' | 'loading' | 'error' | 'ready';

type MissionErrorCode =
  | 'WORD_NOT_FOUND'
  | 'STUDENT_WORD_NOT_FOUND'
  | 'MISSING_REQUIRED_FIELDS'
  | 'UNKNOWN_ERROR';

export default function ConnectionBuilder() {
  const navigate = useNavigate();
  const studentId = db.getCurrentUserId();
  const [searchParams] = useSearchParams();
  const wordIdParam = searchParams.get('wordId');

  // Loading & Error State
  const [status, setStatus] = useState<LoadingStatus>('idle');
  const [errorCode, setErrorCode] = useState<MissionErrorCode | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [pendingQueue, setPendingQueue] = useState<{ item: LearningItem, record: StudentLearningRecord }[]>([]);
  const [currentItem, setCurrentItem] = useState<LearningItem | null>(null);
  const [currentRecord, setCurrentRecord] = useState<StudentLearningRecord | null>(null);

  // Section 1: Content State (Student Overrides)
  const [editableChunk, setEditableChunk] = useState('');
  const [editableTranslation, setEditableTranslation] = useState('');
  const [editableFocusExpression, setEditableFocusExpression] = useState('');
  const [editablePronunciation, setEditablePronunciation] = useState('');
  const [editableSentenceMeaning, setEditableSentenceMeaning] = useState('');

  const [isEditingFocus, setIsEditingFocus] = useState(false);
  const [isEditingPronunciation, setIsEditingPronunciation] = useState(false);
  const [isEditingChunk, setIsEditingChunk] = useState(false);
  const [isEditingTranslation, setIsEditingTranslation] = useState(false);
  const [isEditingSentenceMeaning, setIsEditingSentenceMeaning] = useState(false);

  // Encoding Form State
  const [connections, setConnections] = useState<ConnectionFields>({});
  const [audioUrls, setAudioUrls] = useState<{ word?: string; chunk?: string; focusExpression?: string }>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const clearMissionState = () => {
    setCurrentItem(null);
    setCurrentRecord(null);
    setEditableChunk('');
    setEditableTranslation('');
    setEditableFocusExpression('');
    setEditablePronunciation('');
    setEditableSentenceMeaning('');
    setConnections({});
    setAudioUrls({});
    setErrorCode(null);
    setErrorMessage(null);
    setSaveError(null);
  };

  useEffect(() => {
    const loadData = async () => {
      if (!wordIdParam) {
        setStatus('idle');
        setErrorCode(null);
        setErrorMessage(null);

        const sId = db.getCurrentUserId();
        if (!sId) return;

        const allItems = db.getLearningItems();
        const allRecords = db.getLearningRecords().filter(r => r.studentId === sId);

        const queue = allRecords
          .map(record => ({ record, item: allItems.find(i => i.id === record.learningItemId)! }))
          .filter(pair => pair.item && !db.isOnboardingComplete(pair.record));

        setPendingQueue(queue);
        return;
      }

      setStatus('loading');
      clearMissionState();

      try {
        const sId = db.getCurrentUserId();
        if (!sId) throw new Error('No user logged in');

        const item = db.getLearningItems().find(i => i.id === wordIdParam);
        const record = db.getLearningRecord(sId, wordIdParam);

        if (!item) {
          setErrorCode('WORD_NOT_FOUND');
          setErrorMessage(`Learning item with ID "${wordIdParam}" not found.`);
          setStatus('error');
          return;
        }

        if (!record) {
          setErrorCode('STUDENT_WORD_NOT_FOUND');
          setErrorMessage('No student record found for this item.');
          setStatus('error');
          return;
        }

        if (item.itemType === 'reading' || record.itemType === 'reading') {
          setErrorCode('UNKNOWN_ERROR');
          setErrorMessage('Reading items do not require encoding missions.');
          setStatus('error');
          return;
        }

        const chunkItem = item as ChunkItem;
        const chunkRecord = record as ChunkRecord;

        setCurrentItem(chunkItem);
        setCurrentRecord(chunkRecord);

        // Populate overrides, explicitly mapping any teacher original items
        const currentConns = chunkRecord.studentConnections || {};
        setConnections(currentConns);
        setAudioUrls(chunkRecord.audioUrls || {});
        setEditableChunk(currentConns.customChunk || chunkItem.chunk);
        setEditableTranslation(currentConns.customTranslation || chunkItem.chunkTranslation);
        setEditableFocusExpression(currentConns.customFocusExpression || chunkItem.focusExpression || '');
        setEditablePronunciation(currentConns.pronunciation || chunkItem.pronunciation || '');
        setEditableSentenceMeaning(currentConns.sentenceMeaning || chunkItem.sentenceMeaning || '');

        setStatus('ready');

      } catch (err) {
        setErrorCode('UNKNOWN_ERROR');
        setErrorMessage(err instanceof Error ? err.message : 'An unexpected error occurred.');
        setStatus('error');
      }
    };

    loadData();
  }, [wordIdParam]);

  const playAudio = (type: 'focusExpression' | 'chunk') => {
    const studentUrl = type === 'focusExpression' ? (audioUrls.focusExpression || audioUrls.word) : audioUrls.chunk;
    const text = type === 'focusExpression' ? editableFocusExpression : editableChunk;
    playUnifiedAudio(text, studentUrl);
  };

  const handleAudioSave = (type: 'focusExpression' | 'chunk', base64: string) => {
    setAudioUrls(prev => ({ ...prev, [type]: base64 }));
  };

  const handleConnectionChange = (field: keyof ConnectionFields, value: string) => {
    setConnections(prev => ({ ...prev, [field]: value }));
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          setConnections(prev => ({ ...prev, imageUrl: reader.result as string }));
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = () => {
    if (!currentRecord || !currentItem) return;
    setIsSaving(true);
    setSaveError(null);

    const hasChunkAudio = !!(audioUrls.focusExpression || audioUrls.word);

    // Explicit array of strictly tracked 'Encoding Connections'
    const validConnectionFields = [
      connections.looksLike,
      connections.soundsLike,
      connections.similarMeaning,
      connections.oppositeMeaning,
      connections.usageContext,
      connections.story,
      connections.imageUrl
    ];

    // personalSentence is EXCLUDED from standard textCount calculations
    const connectionCount = validConnectionFields.filter(v => !!v && v.trim() !== '').length;

    let isValid = true;
    if (!hasChunkAudio) {
      setSaveError('Please record audio for the Chunk (Primary).');
      isValid = false;
    } else if (connectionCount < 2) {
      setSaveError('Please complete at least 2 encoding connections (Text or Visual).');
      isValid = false;
    }

    const chunkItem = currentItem as ChunkItem;
    const chunkRecord = currentRecord as ChunkRecord;

    const nextStudentConnections = {
      ...connections,
      customChunk: editableChunk !== chunkItem.chunk ? editableChunk : undefined,
      customTranslation: editableTranslation !== chunkItem.chunkTranslation ? editableTranslation : undefined,
      customFocusExpression: editableFocusExpression !== (chunkItem.focusExpression || '') ? editableFocusExpression : undefined,
      pronunciation: editablePronunciation !== (chunkItem.pronunciation || '') ? editablePronunciation : undefined,
      sentenceMeaning: editableSentenceMeaning !== (chunkItem.sentenceMeaning || '') ? editableSentenceMeaning : undefined,
    };

    const updatedRecord: StudentLearningRecord = {
      ...chunkRecord,
      studentConnections: nextStudentConnections,
      audioUrls,
      encodingCompleted: isValid,
      updatedAt: Date.now()
    } as ChunkRecord;

    const updatedItem: LearningItem = {
      ...chunkItem,
      focusExpression: editableFocusExpression.trim() || chunkItem.focusExpression,
      chunkTranslation: editableTranslation.trim() || chunkItem.chunkTranslation,
      pronunciation: editablePronunciation.trim() || chunkItem.pronunciation,
      chunk: editableChunk.trim() || chunkItem.chunk,
      sentenceMeaning: editableSentenceMeaning.trim() || chunkItem.sentenceMeaning,
    };

    db.saveLearningRecord(updatedRecord);
    db.updateLearningItem(updatedItem);
    
    setCurrentRecord(updatedRecord);
    setCurrentItem(updatedItem);
    setIsSaving(false);
  };

  // 1. Loading State
  if (status === 'loading') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '80vh', gap: '1rem' }}>
        <div className="spinner" style={{ width: '40px', height: '40px', border: '4px solid var(--border)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        <p style={{ color: 'var(--text-muted)', fontSize: '1.2rem' }}>Preparing Encoding Mission...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // 2. Error State
  if (status === 'error') {
    return (
      <div style={{ maxWidth: '600px', margin: '4rem auto', textAlign: 'center' }}>
        <div className="card" style={{ border: '2px solid var(--danger)', background: '#fef2f2', padding: '3rem' }}>
          <h1 style={{ fontSize: '4rem', margin: 0 }}>⚠️</h1>
          <h2 style={{ color: 'var(--danger)', margin: '1rem 0' }}>Mission Failed to Load</h2>
          <div style={{ background: '#fff', padding: '1.5rem', borderRadius: '8px', border: '1px solid var(--border)', marginBottom: '2rem', textAlign: 'left' }}>
            <p style={{ fontWeight: 'bold', margin: '0 0 0.5rem 1px' }}>Reason:</p>
            <p style={{ margin: '0 0 1rem 0', color: 'var(--text-muted)' }}>{errorMessage || 'Unknown error occurred.'}</p>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border)', paddingTop: '0.5rem' }}>Error Code: <code>{errorCode}</code></p>
          </div>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => navigate(`/student/${studentId}/builder`)}>Back to Encoding Queue</button>
        </div>
      </div>
    );
  }

  // 3. Idle State (Queue)
  if (status === 'idle') {
    return (
      <div style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem' }}>
        <h1 style={{ marginBottom: '0.5rem' }}>Encoding Missions</h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: '2rem', fontSize: '1.2rem' }}>Master these units to start practicing:</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem' }}>
          {pendingQueue.map(({ item }) => {
            const chunkItem = item as ChunkItem;
            return (
              <div key={item.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', border: '2px solid var(--border)' }}>
                <h2 style={{ margin: 0 }}>{chunkItem.focusExpression}</h2>
                <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', flex: 1 }}>{item.topic || 'New Mission'}</p>
                <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => navigate(`/student/builder?wordId=${item.id}`)}>Start Mission</button>
              </div>
            );
          })}
          {pendingQueue.length === 0 && (
            <div className="card" style={{ gridColumn: '1 / -1', background: '#f0fdf4', borderColor: 'var(--success)', textAlign: 'center', padding: '3rem' }}>
              <h1 style={{ margin: 0, color: 'var(--success)', fontSize: '3rem' }}>🎯</h1>
              <h2 style={{ margin: '1rem 0' }}>All Units Encoded!</h2>
              <p style={{ color: 'var(--text-muted)' }}>You have no pending encoding missions. Head to Retrieval Practice to maintain your mastery.</p>
               <button className="btn btn-primary" style={{ marginTop: '2rem' }} onClick={() => navigate(`/student/${studentId}`)}>Back to Dashboard</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // 4. Ready State (Mission Flow, Single Page Layout)
  if (status !== 'ready' || !currentItem || !currentRecord) return null;

  return (
    <div style={{ maxWidth: '800px', margin: '2rem auto', padding: '0 1rem' }}>

      {/* Header */}
      <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
           <button onClick={() => navigate(`/student/${studentId}`)} className="btn btn-outline" style={{ marginBottom: '1rem', background: '#fff' }}>&larr; Back to Dashboard</button>
          <h1 style={{ margin: 0, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            Build <span style={{ color: 'var(--text-muted)' }}>&rarr;</span> Encode <span style={{ color: 'var(--text-muted)' }}>&rarr;</span> Generate
          </h1>
          <p style={{ margin: '0.5rem 0 0 0', color: 'var(--text-muted)' }}>Focus Unit: <strong style={{ fontSize: '1.25rem' }}>{editableFocusExpression || (currentItem as ChunkItem).focusExpression || (currentItem as ChunkItem).chunk}</strong></p>
        </div>
        <div>
          {(currentRecord as ChunkRecord).encodingCompleted ? (
            <span style={{ background: '#d1fae5', color: '#059669', padding: '0.5rem 1rem', borderRadius: '8px', fontWeight: 'bold' }}>
              ✓ Fully Encoded
            </span>
          ) : (
            <span style={{ background: '#fef3c7', color: '#92400e', padding: '0.5rem 1rem', borderRadius: '8px', fontWeight: 'bold' }}>
              Pending Completion
            </span>
          )}
        </div>
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '3rem', padding: '2.5rem' }}>

        {/* Section 1: Content (Editable) */}
        <section>
          <h3 style={{ margin: '0 0 1rem 0', color: 'var(--text-main)', borderBottom: '2px solid var(--border)', paddingBottom: '0.5rem' }}>
            1. Content Definition
          </h3>
          <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', fontSize: '0.95rem' }}>
            Modify the base chunk and translation, and establish pronunciations organically inline.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            
            {/* Pronunciation Section */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>Pronunciation / Pinyin</label>
              {isEditingPronunciation ? (
                <input
                  value={editablePronunciation}
                  onChange={e => setEditablePronunciation(e.target.value)}
                  onBlur={() => setIsEditingPronunciation(false)}
                  className="input-field"
                  style={{ fontSize: '1.2rem', background: '#f8fafc' }}
                  placeholder="e.g. děng gōngchē"
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && setIsEditingPronunciation(false)}
                />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#f8fafc', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid transparent', cursor: 'text' }} onClick={() => setIsEditingPronunciation(true)}>
                  <span style={{ fontSize: '1.2rem', color: editablePronunciation ? 'var(--text-main)' : 'var(--text-muted)', flex: 1 }}>{editablePronunciation || 'Enter pronunciation...'}</span>
                  <button className="btn btn-outline" style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem', background: '#fff', border: 'none', color: 'var(--text-muted)' }}>✏️</button>
                </div>
              )}
            </div>

            {/* Target Expression Section */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <label style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>Target Expression <span style={{ color: 'var(--danger)' }}>*</span></label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {(audioUrls.focusExpression || audioUrls.word) && <span style={{ fontSize: '0.8rem', color: 'var(--success)' }}>✓ Recorded</span>}
                  <button className="btn btn-outline" style={{ borderRadius: '50%', width: '32px', height: '32px', padding: 0, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => playAudio('focusExpression')}>
                    {(audioUrls.focusExpression || audioUrls.word) ? '▶️' : '🔊'}
                  </button>
                  <AudioRecorder customAudio={audioUrls.focusExpression || audioUrls.word} onSave={(base64) => handleAudioSave('focusExpression', base64)} />
                </div>
              </div>
              {isEditingFocus ? (
                <input
                  value={editableFocusExpression}
                  onChange={e => setEditableFocusExpression(e.target.value)}
                  onBlur={() => setIsEditingFocus(false)}
                  className="input-field"
                  style={{ fontSize: '1.5rem', background: '#f8fafc', fontWeight: 'bold' }}
                  placeholder="e.g. key phrase to remember"
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && setIsEditingFocus(false)}
                />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#f8fafc', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid transparent', cursor: 'text' }} onClick={() => setIsEditingFocus(true)}>
                  <span style={{ fontSize: '1.5rem', fontWeight: 'bold', flex: 1 }}>{editableFocusExpression || <span style={{ color: 'var(--text-muted)' }}>Empty...</span>}</span>
                  <button className="btn btn-outline" style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem', background: '#fff', border: 'none', color: 'var(--text-muted)' }}>✏️</button>
                </div>
              )}
            </div>

            {/* Meaning Section */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <label style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>Meaning</label>
                {isEditingTranslation ? (
                  <input
                    value={editableTranslation}
                    onChange={e => setEditableTranslation(e.target.value)}
                    onBlur={() => setIsEditingTranslation(false)}
                    className="input-field"
                    style={{ fontSize: '1.25rem', background: '#f8fafc' }}
                    placeholder={(currentItem as ChunkItem).chunkTranslation}
                    autoFocus
                    onKeyDown={e => e.key === 'Enter' && setIsEditingTranslation(false)}
                  />
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#f8fafc', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid transparent', cursor: 'text' }} onClick={() => setIsEditingTranslation(true)}>
                    <span style={{ fontSize: '1.25rem', flex: 1 }}>{editableTranslation || <span style={{ color: 'var(--text-muted)' }}>Empty...</span>}</span>
                    <button className="btn btn-outline" style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem', background: '#fff', border: 'none', color: 'var(--text-muted)' }}>✏️</button>
                  </div>
                )}
            </div>

            {/* Sentence Section */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', background: '#f1f5f9', padding: '1.5rem', borderRadius: '12px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <label style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>Sentence / Context <span style={{ fontWeight: 'normal', color: 'var(--text-muted)' }}>(Optional Audio)</span></label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {audioUrls.chunk && <span style={{ fontSize: '0.8rem', color: 'var(--success)' }}>✓ Recorded</span>}
                    <button className="btn btn-outline" style={{ borderRadius: '50%', width: '32px', height: '32px', padding: 0, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => playAudio('chunk')}>
                      {audioUrls.chunk ? '▶️' : '🔊'}
                    </button>
                    <AudioRecorder customAudio={audioUrls.chunk} onSave={(base64) => handleAudioSave('chunk', base64)} />
                  </div>
                </div>
                {isEditingChunk ? (
                  <input
                    value={editableChunk}
                    onChange={e => setEditableChunk(e.target.value)}
                    onBlur={() => setIsEditingChunk(false)}
                    className="input-field"
                    style={{ fontStyle: 'italic', fontSize: '1.1rem', background: '#fff' }}
                    placeholder={(currentItem as ChunkItem).chunk}
                    autoFocus
                    onKeyDown={e => e.key === 'Enter' && setIsEditingChunk(false)}
                  />
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#fff', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid var(--border)', cursor: 'text' }} onClick={() => setIsEditingChunk(true)}>
                    <span style={{ fontSize: '1.1rem', fontStyle: 'italic', flex: 1 }}>{editableChunk || <span style={{ color: 'var(--text-muted)' }}>Empty...</span>}</span>
                    <button className="btn btn-outline" style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem', background: '#fff', border: 'none', color: 'var(--text-muted)' }}>✏️</button>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <label style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>Sentence Meaning</label>
                {isEditingSentenceMeaning ? (
                  <input
                    value={editableSentenceMeaning}
                    onChange={e => setEditableSentenceMeaning(e.target.value)}
                    onBlur={() => setIsEditingSentenceMeaning(false)}
                    className="input-field"
                    style={{ fontSize: '1.1rem', background: '#fff' }}
                    placeholder="e.g. Translation of the sentence"
                    autoFocus
                    onKeyDown={e => e.key === 'Enter' && setIsEditingSentenceMeaning(false)}
                  />
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#fff', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid var(--border)', cursor: 'text' }} onClick={() => setIsEditingSentenceMeaning(true)}>
                    <span style={{ fontSize: '1.1rem', flex: 1 }}>{editableSentenceMeaning || <span style={{ color: 'var(--text-muted)' }}>Enter sentence meaning...</span>}</span>
                    <button className="btn btn-outline" style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem', background: '#fff', border: 'none', color: 'var(--text-muted)' }}>✏️</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Section 2: Connections */}
        <section>
          <h3 style={{ margin: '0 0 1rem 0', color: 'var(--text-main)', borderBottom: '2px solid var(--border)', paddingBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            2. Mental Connections <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>(Complete at least 2)</span>
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-muted)' }}>👀 Looks Like</label>
              <input className="input-field" value={connections.looksLike || ''} onChange={e => handleConnectionChange('looksLike', e.target.value)} placeholder="e.g. Shape of letters" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-muted)' }}>👂 Sounds Like</label>
              <input className="input-field" value={connections.soundsLike || ''} onChange={e => handleConnectionChange('soundsLike', e.target.value)} placeholder="e.g. Rhymes with..." />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-muted)' }}>✨ Similar Meaning</label>
              <input className="input-field" value={connections.similarMeaning || ''} onChange={e => handleConnectionChange('similarMeaning', e.target.value)} placeholder="Synonym or related concept" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-muted)' }}>🌓 Opposite Meaning</label>
              <input className="input-field" value={connections.oppositeMeaning || ''} onChange={e => handleConnectionChange('oppositeMeaning', e.target.value)} placeholder="Antonym" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-muted)' }}>📍 Usage Context</label>
              <input className="input-field" value={connections.usageContext || ''} onChange={e => handleConnectionChange('usageContext', e.target.value)} placeholder="When/Where do you use it?" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', gridColumn: 'span 2' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-muted)' }}>📖 Memory Story</label>
              <textarea className="input-field" style={{ minHeight: '80px' }} value={connections.story || ''} onChange={e => handleConnectionChange('story', e.target.value)} placeholder="A short story to remember this word" />
            </div>
          </div>
        </section>

        {/* Section 3: Visual Connection */}
        <section>
          <h3 style={{ margin: '0 0 1rem 0', color: 'var(--text-main)', borderBottom: '2px solid var(--border)', paddingBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            3. Visual Connection
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '250px 1fr', gap: '2rem' }}>
            <div style={{
              width: '250px', height: '180px', borderRadius: '12px', border: '2px dashed var(--border)',
              background: connections.imageUrl ? `url(${connections.imageUrl}) center/cover` : '#f8fafc',
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', position: 'relative'
            }} onClick={() => fileInputRef.current?.click()}>
              {!connections.imageUrl && <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Click to Upload Image</span>}
              <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept="image/*" onChange={handleImageUpload} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-muted)' }}>Image Note</label>
              <textarea
                className="input-field"
                style={{ flex: 1 }}
                value={connections.imageNote || ''}
                onChange={e => handleConnectionChange('imageNote', e.target.value)}
                placeholder="Briefly describe why this image helps you remember."
              />
              {connections.imageUrl && (
                <button onClick={() => handleConnectionChange('imageUrl', '')} className="btn btn-outline" style={{ background: '#fee2e2', color: '#dc2626', borderColor: '#fca5a5', width: 'fit-content' }}>
                  🗑 Remove Image
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Section 4: Generation / Try to use it */}
        <section>
          <h3 style={{ margin: '0 0 1rem 0', color: 'var(--text-main)', borderBottom: '2px solid var(--border)', paddingBottom: '0.5rem' }}>
            4. Try To Use It
          </h3>
          <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', fontSize: '0.95rem' }}>
            <strong>Create your own sentence.</strong> <br />
            Optional Hint: You can re-use the chunk pattern and just replace keywords!
          </p>
          <textarea
            className="input-field"
            style={{ width: '100%', minHeight: '100px', fontSize: '1.1rem' }}
            value={connections.personalSentence || ''}
            onChange={e => handleConnectionChange('personalSentence', e.target.value)}
            placeholder="Type your sentence here..."
          />
        </section>

        {/* Save Button & Validation Feedback */}
        <div style={{ marginTop: '1rem', textAlign: 'center', padding: '2rem', background: '#f0f9ff', borderRadius: '16px' }}>
          {saveError && <p style={{ color: 'var(--danger)', fontWeight: 'bold', marginBottom: '1rem' }}>⚠️ {saveError}</p>}
          <div style={{ display: 'flex', gap: '1.5rem', justifyContent: 'center' }}>
            <button
              className="btn btn-primary"
              style={{ padding: '1rem 3rem', fontSize: '1.2rem', minWidth: '240px' }}
              onClick={() => {
                handleSave();
                // Navigate back to Flashcards library
                navigate(`/student/${studentId}/flashcards`);
              }}
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : 'Save & Back'}
            </button>
          </div>
          <p style={{ marginTop: '1rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
            To fully complete encoding, require: Target Expression Audio & 2 Text/Visual connections.
          </p>
        </div>

      </div>
    </div>
  );
}
