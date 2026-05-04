import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '../lib/db';
import { LearningItem, StudentLearningRecord, ConnectionFields, ChunkItem, ChunkRecord } from '../lib/types';
import AudioRecorder from '../components/AudioRecorder';
import { playUnifiedAudio } from '../lib/audioUtils';

export default function WordCard() {
  const { id: itemId } = useParams();
  const navigate = useNavigate();
  const studentId = db.getCurrentUserId();

  const [item, setItem] = useState<LearningItem | null>(null);
  const [record, setRecord] = useState<StudentLearningRecord | null>(null);

  // Editable fields
  const [editableFocusExpression, setEditableFocusExpression] = useState('');
  const [isEditingFocus, setIsEditingFocus] = useState(false);

  const [editableChunk, setEditableChunk] = useState('');
  const [editableChunkTranslation, setEditableChunkTranslation] = useState('');
  const [isEditingChunk, setIsEditingChunk] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedChunk, setGeneratedChunk] = useState('');
  const [generatedChunkTranslation, setGeneratedChunkTranslation] = useState('');
  const [editableSentenceMeaning, setEditableSentenceMeaning] = useState('');
  const [isEditingSentenceMeaning, setIsEditingSentenceMeaning] = useState(false);

  const [editablePronunciation, setEditablePronunciation] = useState('');
  const [isEditingPronunciation, setIsEditingPronunciation] = useState(false);

  const [studentConnections, setStudentConnections] = useState<ConnectionFields>({});
  const [saveMessage, setSaveMessage] = useState('');

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    const sId = db.getCurrentUserId();
    if (!sId || !itemId) return;

    const allItems = db.getLearningItems();
    const allRecords = db.getLearningRecords();

    const foundItem = allItems.find(i => i.id === itemId);
    const foundRecord = allRecords.find(r => r.learningItemId === itemId && r.studentId === sId);

    if (foundItem && foundRecord) {
      setItem(foundItem);
      setRecord(foundRecord);

      // Handle different item types
      if (foundItem.itemType !== 'reading' && foundRecord.itemType !== 'reading') {
        const chunkItem = foundItem as ChunkItem;
        const chunkRecord = foundRecord as ChunkRecord;
        setEditableFocusExpression(chunkRecord.studentConnections?.customFocusExpression || chunkItem.focusExpression);
        setEditableChunk(chunkRecord.studentConnections?.customChunk || chunkItem.chunk);
        setEditableChunkTranslation(chunkRecord.studentConnections?.customTranslation || chunkItem.chunkTranslation);
        setEditablePronunciation(chunkRecord.studentConnections?.pronunciation || chunkItem.pronunciation || '');
        setEditableSentenceMeaning(chunkRecord.studentConnections?.sentenceMeaning || chunkItem.sentenceMeaning || '');
        setStudentConnections(chunkRecord.studentConnections || {});
      }
    }
  }, [itemId]);

  if (!item || !record) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>Learning item not found.</div>;
  }

  if (item.itemType === 'reading' || record.itemType === 'reading') {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>Reading items should be practiced in the Reading section.</div>;
  }

  const chunkItem = item as ChunkItem;
  const chunkRecord = record as ChunkRecord;

  const obStatus = db.getOnboardingStatus(chunkItem, chunkRecord);

  // --- Focus Expression Logic ---
  const handleSaveFocus = () => {
    handleConnectionChange('customFocusExpression', editableFocusExpression);
    setIsEditingFocus(false);
  };

  const handleSavePronunciation = () => {
    handleConnectionChange('pronunciation', editablePronunciation);
    setIsEditingPronunciation(false);
  };

  // --- Chunk Logic ---
  const handleGenerateChunk = () => {
    setIsGenerating(true);
    setGeneratedChunk('');
    setGeneratedChunkTranslation('');
    setIsEditingChunk(false);

    setTimeout(() => {
      const translationBase = chunkItem.chunkTranslation || '這個內容';
      const chunks = [
        { c: `a beautiful ${chunkItem.focusExpression.toLowerCase()}`, cm: `一個美麗的${translationBase}` },
        { c: `${chunkItem.focusExpression.toLowerCase()} in the morning`, cm: `早晨的${translationBase}` },
        { c: `I always use this ${chunkItem.focusExpression.toLowerCase()}`, cm: `我總是使用${translationBase}` }
      ];
      const selected = chunks[Math.floor(Math.random() * chunks.length)];
      setGeneratedChunk(selected.c);
      setGeneratedChunkTranslation(selected.cm);
      setIsGenerating(false);
    }, 1000);
  };

  const handleSaveChunk = () => {
    const updatedConns = { ...studentConnections, customChunk: editableChunk, customTranslation: editableChunkTranslation, sentenceMeaning: editableSentenceMeaning };
    setStudentConnections(updatedConns);
    const updatedRecord = { ...chunkRecord!, studentConnections: updatedConns };
    setRecord(updatedRecord);
    db.saveLearningRecord(updatedRecord);

    setIsEditingChunk(false);
    setGeneratedChunk('');
    setGeneratedChunkTranslation('');
  };

  const handleAcceptGenerated = () => {
    const updatedConns = { ...studentConnections, customChunk: generatedChunk, customTranslation: generatedChunkTranslation };
    setStudentConnections(updatedConns);
    const updatedRecord = { ...chunkRecord!, studentConnections: updatedConns };
    setRecord(updatedRecord);
    db.saveLearningRecord(updatedRecord);

    setGeneratedChunk('');
    setGeneratedChunkTranslation('');
  };

  // --- Connections Logic ---
  const handleConnectionChange = (field: keyof ConnectionFields, value: string) => {
    const updated = { ...studentConnections, [field]: value };
    setStudentConnections(updated);
    const updatedRecord = { ...chunkRecord, studentConnections: updated };
    setRecord(updatedRecord);
    db.saveLearningRecord(updatedRecord);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => handleConnectionChange('imageUrl', reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  // --- Audio ---
  const speakText = (text: string, customAudio?: string) => {
    playUnifiedAudio(text, customAudio, 'en-US');
  };

  const handleSaveCard = () => {
    if (isEditingFocus) handleSaveFocus();
    if (isEditingPronunciation) handleSavePronunciation();
    if (isEditingChunk) handleSaveChunk();
    if (isEditingSentenceMeaning) {
      handleConnectionChange('sentenceMeaning', editableSentenceMeaning);
      setIsEditingSentenceMeaning(false);
    }
    if (generatedChunk) handleAcceptGenerated();

    db.saveLearningRecord(chunkRecord);
    setSaveMessage('Card saved! Onboarding status has been re-evaluated.');
    setTimeout(() => setSaveMessage(''), 3000);
  };

  const handleDeleteConfirm = () => {
    db.deleteLearningRecord(chunkRecord.id);
    navigate(`/student/${studentId}`);
  };

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '1rem' }}>
      <button onClick={() => navigate(`/student/${studentId}`)} className="btn btn-outline" style={{ marginBottom: '1.5rem', background: '#fff' }}>&larr; Back to Dashboard</button>

      <div className="card" style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border)', paddingBottom: '1.5rem', marginBottom: '1.5rem' }}>
          <div>
            <h1 style={{ margin: '0 0 0.5rem 0', fontSize: '2.5rem', color: 'var(--primary)' }}>{studentConnections.customFocusExpression || chunkItem.focusExpression || studentConnections.customChunk || chunkItem.chunk}</h1>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.85rem', fontWeight: 'bold', background: chunkRecord.encodingCompleted ? '#d1fae5' : '#fee2e2', color: chunkRecord.encodingCompleted ? '#059669' : '#dc2626' }}>
                Encoding Mission: {chunkRecord.encodingCompleted ? 'Complete' : 'Incomplete'}
              </span>
              <span style={{ padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.85rem', fontWeight: 'bold', background: '#f1f5f9', color: '#475569' }}>
                Mastery: {chunkRecord.status}
              </span>
            </div>


            {!chunkRecord.encodingCompleted && (
              <div style={{ marginTop: '1.5rem', padding: '1rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid var(--border)', width: 'fit-content' }}>
                <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--text-main)', fontSize: '0.9rem', textTransform: 'uppercase' }}>Encoding Progress</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.5rem', fontSize: '0.95rem' }}>
                  <span style={{ color: obStatus.isValid ? 'var(--success)' : 'var(--text-muted)' }}>
                    {obStatus.isValid ? '✅ All requirements met' : '⚪ Requirements pending'}
                  </span>
                  {!obStatus.isValid && obStatus.missing.map(m => (
                    <span key={m} style={{ fontSize: '0.85rem', color: 'var(--danger)', marginLeft: '1rem' }}>• {m}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ margin: '0 0 0.5rem 0', fontWeight: 'bold', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Chunk Audio</p>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', justifyContent: 'flex-end' }}>
              <button onClick={() => speakText(studentConnections.customFocusExpression || chunkItem.focusExpression, chunkRecord.audioUrls.focusExpression || chunkRecord.audioUrls.word)} className="btn btn-outline" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '36px', height: '36px', padding: 0, borderRadius: '50%', background: '#fff', borderColor: 'var(--primary)', color: 'var(--primary)' }}>🔊</button>
              <AudioRecorder
                customAudio={chunkRecord.audioUrls.focusExpression || chunkRecord.audioUrls.word}
                onSave={(base64) => {
                  const updated = { ...chunkRecord, audioUrls: { ...chunkRecord.audioUrls, focusExpression: base64 }, updatedAt: Date.now() };
                  setRecord(updated);
                  db.saveLearningRecord(updated);
                }}
              />
            </div>
          </div>
        </div>

        {/* Pronunciation Section */}
        <div style={{ marginBottom: '2rem' }}>
          <h3 style={{ marginTop: 0, marginBottom: '0.5rem', color: 'var(--text-main)' }}>Pronunciation / Pinyin</h3>
          {isEditingPronunciation ? (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input value={editablePronunciation} onChange={e => setEditablePronunciation(e.target.value)} className="input-field" style={{ flex: 1 }} placeholder="Enter pronunciation..." autoFocus />
              <button onClick={handleSavePronunciation} className="btn btn-primary">Save</button>
              <button onClick={() => setIsEditingPronunciation(false)} className="btn btn-outline" style={{ background: '#fff' }}>Cancel</button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <span style={{ fontSize: '1.25rem', color: 'var(--text-muted)' }}>{studentConnections.pronunciation || chunkItem.pronunciation || '(Not set)'}</span>
              <button onClick={() => { setEditablePronunciation(studentConnections.pronunciation || chunkItem.pronunciation || ''); setIsEditingPronunciation(true); }} className="btn btn-outline" style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem', background: '#fff' }}>✍️ Edit</button>
            </div>
          )}
        </div>

        {/* Expression Section */}
        <div style={{ marginBottom: '2rem' }}>
          <h3 style={{ marginTop: 0, marginBottom: '0.5rem', color: 'var(--text-main)' }}>Target Expression</h3>
          {isEditingFocus ? (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input value={editableFocusExpression} onChange={e => setEditableFocusExpression(e.target.value)} className="input-field" style={{ flex: 1 }} placeholder="Enter expression..." autoFocus />
              <button onClick={handleSaveFocus} className="btn btn-primary" disabled={!editableFocusExpression.trim()}>Save</button>
              <button onClick={() => setIsEditingFocus(false)} className="btn btn-outline" style={{ background: '#fff' }}>Cancel</button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <span style={{ fontSize: '1.25rem' }}>{studentConnections.customFocusExpression || chunkItem.focusExpression}</span>
              <button onClick={() => { setEditableFocusExpression(studentConnections.customFocusExpression || chunkItem.focusExpression); setIsEditingFocus(true); }} className="btn btn-outline" style={{ padding: '0.2rem 0.5rem', fontSize: '0.85rem', background: '#fff' }}>✍️ Edit</button>
            </div>
          )}
        </div>

        {/* Chunk Section */}
        <div style={{ marginBottom: '2rem', background: '#f8fafc', padding: '1.5rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0, color: 'var(--text-main)' }}>Sentence / Context</h3>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button onClick={() => speakText(studentConnections.customChunk || chunkItem.chunk || '', chunkRecord.audioUrls.chunk)} className="btn btn-outline" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px', padding: 0, borderRadius: '50%', background: '#fff' }} disabled={!(studentConnections.customChunk || chunkItem.chunk)}>🔊</button>
              <AudioRecorder
                customAudio={chunkRecord.audioUrls.chunk}
                onSave={(base64) => {
                  const updated = { ...chunkRecord, audioUrls: { ...chunkRecord.audioUrls, chunk: base64 }, updatedAt: Date.now() };
                  setRecord(updated);
                  db.saveLearningRecord(updated);
                }}
              />
            </div>
          </div>

          {(!(studentConnections.customChunk || chunkItem.chunk) && !isEditingChunk && !generatedChunk) ? (
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button onClick={() => setIsEditingChunk(true)} className="btn btn-outline" style={{ background: '#fff' }}>✍️ Write my own sentence</button>
              <button onClick={handleGenerateChunk} className="btn btn-primary" disabled={isGenerating}>{isGenerating ? 'Generating...' : '✨ Generate with AI'}</button>
            </div>
          ) : isEditingChunk ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.25rem', fontSize: '0.85rem' }}>Sentence</label>
                <input value={editableChunk} onChange={e => setEditableChunk(e.target.value)} className="input-field" style={{ width: '100%', fontStyle: 'italic' }} placeholder="e.g. eat an apple" autoFocus />
              </div>
              <div>
                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.25rem', fontSize: '0.85rem' }}>Meaning</label>
                <input value={editableChunkTranslation} onChange={e => setEditableChunkTranslation(e.target.value)} className="input-field" style={{ width: '100%' }} placeholder="e.g. 吃一顆蘋果" />
              </div>
              <div>
                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.25rem', fontSize: '0.85rem' }}>Sentence Meaning</label>
                <input value={editableSentenceMeaning} onChange={e => setEditableSentenceMeaning(e.target.value)} className="input-field" style={{ width: '100%' }} placeholder="e.g. Translation of the sentence" />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button onClick={handleSaveChunk} className="btn btn-primary" disabled={!editableChunk.trim()}>Save Sentence</button>
                <button onClick={() => { setIsEditingChunk(false); setEditableChunk(studentConnections.customChunk || chunkItem.chunk || ''); setEditableChunkTranslation(studentConnections.customTranslation || chunkItem.chunkTranslation || ''); }} className="btn btn-outline" style={{ background: '#fff' }}>Cancel</button>
              </div>
            </div>
          ) : generatedChunk ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ color: 'var(--primary)', padding: '1rem', border: '1px dashed var(--primary)', borderRadius: '8px' }}>
                <div style={{ fontSize: '1.25rem', fontStyle: 'italic', marginBottom: '0.5rem' }}>"{generatedChunk}"</div>
                <div>{generatedChunkTranslation}</div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button onClick={handleAcceptGenerated} className="btn btn-success">✅ Accept</button>
                <button onClick={handleGenerateChunk} className="btn btn-outline" style={{ background: '#fff' }} disabled={isGenerating}>🔄 Regenerate</button>
                <button onClick={() => { setEditableChunk(generatedChunk); setEditableChunkTranslation(generatedChunkTranslation); setIsEditingChunk(true); setGeneratedChunk(''); }} className="btn btn-outline" style={{ background: '#fff' }}>✍️ Edit manually</button>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: '1.25rem', fontStyle: 'italic', marginBottom: '0.5rem' }}>"{studentConnections.customChunk || chunkItem.chunk}"</div>
              {(studentConnections.customTranslation || chunkItem.chunkTranslation) && <div style={{ color: 'var(--text-muted)', marginBottom: '0.25rem' }}>{studentConnections.customTranslation || chunkItem.chunkTranslation}</div>}
              {(studentConnections.sentenceMeaning || chunkItem.sentenceMeaning) && <div style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontStyle: 'italic', fontSize: '0.9rem' }}>{studentConnections.sentenceMeaning || chunkItem.sentenceMeaning}</div>}
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button onClick={() => { setEditableChunk(studentConnections.customChunk || chunkItem.chunk || ''); setEditableChunkTranslation(studentConnections.customTranslation || chunkItem.chunkTranslation || ''); setIsEditingChunk(true); }} className="btn btn-outline" style={{ background: '#fff', fontSize: '0.85rem', padding: '0.25rem 0.5rem' }}>✍️ Edit</button>
                <button onClick={handleGenerateChunk} className="btn btn-outline" style={{ background: '#fff', fontSize: '0.85rem', padding: '0.25rem 0.5rem' }} disabled={isGenerating}>✨ Replace via AI</button>
              </div>
            </div>
          )}
        </div>

        {/* Section 3: Mental Connections */}
        <div style={{ marginBottom: '2rem' }}>
          <h3 style={{ marginTop: 0, marginBottom: '1rem', color: 'var(--text-main)' }}>Encoding Connections</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '0.25rem' }}>👀 Looks Like</label>
              <input className="input-field" value={studentConnections.looksLike || ''} onChange={e => handleConnectionChange('looksLike', e.target.value)} placeholder="e.g. Shape of letters" style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '0.25rem' }}>👂 Sounds Like</label>
              <input className="input-field" value={studentConnections.soundsLike || ''} onChange={e => handleConnectionChange('soundsLike', e.target.value)} placeholder="e.g. Rhymes with..." style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '0.25rem' }}>✨ Similar Meaning</label>
              <input className="input-field" value={studentConnections.similarMeaning || ''} onChange={e => handleConnectionChange('similarMeaning', e.target.value)} placeholder="Synonym or related concept" style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '0.25rem' }}>🌓 Opposite Meaning</label>
              <input className="input-field" value={studentConnections.oppositeMeaning || ''} onChange={e => handleConnectionChange('oppositeMeaning', e.target.value)} placeholder="Antonym" style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '0.25rem' }}>📍 Usage Context</label>
              <input className="input-field" value={studentConnections.usageContext || ''} onChange={e => handleConnectionChange('usageContext', e.target.value)} placeholder="When/Where do you use it?" style={{ width: '100%' }} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '0.25rem' }}>📖 Memory Story</label>
              <textarea className="input-field" value={studentConnections.story || ''} onChange={e => handleConnectionChange('story', e.target.value)} placeholder="A short story to remember this word" style={{ width: '100%', minHeight: '80px' }} />
            </div>
          </div>
        </div>

        {/* Section 4: Visual Connection */}
        <div style={{ marginBottom: '2rem' }}>
          <h3 style={{ marginTop: 0, marginBottom: '1rem', color: 'var(--text-main)' }}>Visual Connection</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 250px) 1fr', gap: '2rem' }}>
            <div style={{
              width: '100%', height: '180px', borderRadius: '12px', border: '2px dashed var(--border)',
              background: studentConnections.imageUrl ? `url(${studentConnections.imageUrl}) center/cover` : '#f8fafc',
              display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden'
            }}>
              {!studentConnections.imageUrl && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '1rem' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '0.5rem' }}>Upload Image</span>
                  <input type="file" accept="image/*" onChange={handleImageUpload} style={{ width: '100%', fontSize: '0.85rem' }} />
                </div>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '0.25rem', color: 'var(--text-muted)' }}>Image Note</label>
                <textarea
                  className="input-field"
                  style={{ flex: 1, width: '100%', minHeight: '80px' }}
                  value={studentConnections.imageNote || ''}
                  onChange={e => handleConnectionChange('imageNote', e.target.value)}
                  placeholder="Briefly describe why this image helps you remember."
                />
              </div>
              {studentConnections.imageUrl && (
                <button onClick={() => handleConnectionChange('imageUrl', '')} className="btn btn-outline" style={{ background: '#fee2e2', color: '#dc2626', borderColor: '#fca5a5', width: 'fit-content' }}>
                  🗑 Remove Image
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Section 5: Try To Use It */}
        <div style={{ marginBottom: '2rem' }}>
          <h3 style={{ marginTop: 0, marginBottom: '1rem', color: 'var(--text-main)' }}>Try To Use It</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-muted)' }}>Create your own sentence. Optional Hint: You can re-use the chunk pattern and just replace keywords!</label>
            <textarea
              className="input-field"
              style={{ width: '100%', minHeight: '100px', fontSize: '1.1rem' }}
              value={studentConnections.personalSentence || ''}
              onChange={e => handleConnectionChange('personalSentence', e.target.value)}
              placeholder="Type your sentence here..."
            />
          </div>
        </div>

        <div style={{ marginTop: '3rem', paddingTop: '2rem', borderTop: '2px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center' }}>
          <button onClick={handleSaveCard} className="btn btn-primary" style={{ padding: '1rem 2.5rem', fontSize: '1.15rem', width: '100%', maxWidth: '400px' }}>
            💾 Save and Recheck Encoding
          </button>

          <button onClick={() => setShowDeleteConfirm(true)} className="btn btn-outline" style={{ background: '#fef2f2', color: '#dc2626', borderColor: '#fca5a5', width: '100%', maxWidth: '400px' }}>
            🗑️ Delete Card
          </button>

          {saveMessage && (
            <div style={{ background: '#ecfdf5', color: '#059669', padding: '1rem', borderRadius: '8px', border: '1px solid #10b981', marginTop: '1rem', fontWeight: 'bold', display: 'inline-block' }}>
              {saveMessage}
            </div>
          )}
        </div>
      </div>

      {showDeleteConfirm && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="card" style={{ maxWidth: '400px', width: '90%', margin: '0 auto', textAlign: 'center' }}>
            <h3 style={{ marginTop: 0, color: 'var(--danger)' }}>Delete this card?</h3>
            <p style={{ color: 'var(--text-muted)', marginBottom: '2rem' }}>
              This will permanently remove the card from the student dashboard. If it has already been added to the library, it should also be removed there.
            </p>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
              <button onClick={() => setShowDeleteConfirm(false)} className="btn btn-outline" style={{ background: '#fff' }}>Cancel</button>
              <button onClick={handleDeleteConfirm} className="btn btn-primary" style={{ background: 'var(--danger)' }}>Confirm delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
