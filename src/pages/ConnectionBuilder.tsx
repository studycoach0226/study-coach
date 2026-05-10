import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, useParams } from 'react-router-dom';
import { db } from '../lib/db';
import { LearningItem, StudentLearningRecord, ConnectionFields, ChunkItem, ChunkRecord, SelectedConnection } from '../lib/types';
import AudioRecorder from '../components/AudioRecorder';
import { playUnifiedAudio, getAvailableGenders } from '../lib/audioUtils';
import { saveFlashcard, getFlashcardRecord, mapFirestoreToLocal } from '../lib/firebaseDb';
import { getActiveEncodingFields, MediaMetadata } from '../config/encodingSchema';
import { uploadAudioFile } from '../lib/storageUtils';
import { generateConnectionSuggestions, generateChineseCharacters } from '../lib/aiService';

type LoadingStatus = 'idle' | 'loading' | 'error' | 'ready';

type MissionErrorCode =
  | 'WORD_NOT_FOUND'
  | 'STUDENT_WORD_NOT_FOUND'
  | 'MISSING_REQUIRED_FIELDS'
  | 'UNKNOWN_ERROR';

const PRESET_TAGS = ['meaning', 'sound', 'character', 'collocation', 'usage', 'story', 'image', 'visual', 'root', 'shape', 'note'];

export default function ConnectionBuilder() {
  const navigate = useNavigate();
  const { studentId: routeStudentId } = useParams<{ studentId: string }>();
  const studentId = routeStudentId || db.getCurrentUserId();
  const [searchParams] = useSearchParams();
  const wordIdParam = searchParams.get('wordId');

  // Loading & Error State
  const [status, setStatus] = useState<LoadingStatus>('idle');
  const [errorCode, setErrorCode] = useState<MissionErrorCode | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [pendingQueue, setPendingQueue] = useState<{ item: LearningItem, record: StudentLearningRecord }[]>([]);
  const [currentItem, setCurrentItem] = useState<LearningItem | null>(null);
  const [currentRecord, setCurrentRecord] = useState<StudentLearningRecord | null>(null);
  const isChineseLearner = currentItem?.languageDirection === 'zh-en';

  // Section 1: Content State (Student Overrides)
  const [editableChunk, setEditableChunk] = useState('');
  const [editableContextText, setEditableContextText] = useState('');
  const [editableTranslation, setEditableTranslation] = useState('');
  const [editableFocusExpression, setEditableFocusExpression] = useState('');
  const [editableTargetText, setEditableTargetText] = useState('');
  const [editablePronunciation, setEditablePronunciation] = useState('');
  const [editableSentenceMeaning, setEditableSentenceMeaning] = useState('');

  const [isEditingChunk, setIsEditingChunk] = useState(false);
  const [isEditingContextText, setIsEditingContextText] = useState(false);
  const [isEditingTranslation, setIsEditingTranslation] = useState(false);
  const [isEditingFocus, setIsEditingFocus] = useState(false);
  const [isEditingTargetText, setIsEditingTargetText] = useState(false);
  const [isEditingSentenceMeaning, setIsEditingSentenceMeaning] = useState(false);

  // Encoding Form State
  const [connections, setConnections] = useState<ConnectionFields>({});
  const [audioUrls, setAudioUrls] = useState<ChunkRecord['audioUrls']>({
    aiWord: '',
    aiChunk: '',
    studentWord: '',
    studentChunk: ''
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // AI Connection Suggestions State
  const [aiSuggestions, setAiSuggestions] = useState<SelectedConnection[]>([]);
  const [isAiSuggestionsLoading, setIsAiSuggestionsLoading] = useState(false);
  const [voicePref, setVoicePref] = useState<'female' | 'male' | 'system'>('system');
  const [availableGenders, setAvailableGenders] = useState<('female' | 'male')[]>(['female']);
  const [isGeneratingCharacters, setIsGeneratingCharacters] = useState<{[key: string]: boolean}>({});
  const [editingConnectionIds, setEditingConnectionIds] = useState<Set<string>>(new Set());

  // Audio State (Unified)
  const [sentenceUploadMetadata, setSentenceUploadMetadata] = useState<MediaMetadata | null>(null);
  const [audioFiles, setAudioFiles] = useState<{ targetAudio?: MediaMetadata; chunkAudio?: MediaMetadata }>({});


  const clearMissionState = () => {
    setCurrentItem(null);
    setCurrentRecord(null);
     setEditableChunk('');
    setEditableContextText('');
    setEditableTranslation('');
    setEditableFocusExpression('');
    setEditableTargetText('');
    setEditablePronunciation('');
    setEditableSentenceMeaning('');
    setConnections({});
    setAudioUrls({});
    setAudioFiles({});
    setErrorCode(null);
    setErrorMessage(null);
    setSaveError(null);
    setAiSuggestions([]);
    setEditingConnectionIds(new Set());
  };

  useEffect(() => {
    // Synchronize session from route to prevent identity mismatch on cross-device refresh
    if (routeStudentId) {
      db.setCurrentUserId(routeStudentId);
    }

    const loadData = async () => {
      const sId = routeStudentId || db.getCurrentUserId();
      console.log(`[DEBUG] ConnectionBuilder loadData. studentId: ${sId}, wordIdParam: ${wordIdParam}`);

      if (!wordIdParam) {
        setStatus('idle');
        setErrorCode(null);
        setErrorMessage(null);

        if (!sId) return;

        const allItems = db.getLearningItems();
        const allRecords = db.getLearningRecords().filter(r => r.studentId === sId);

        const queue = allRecords
          .map(record => ({ record, item: allItems.find(i => i.id === record.learningItemId)! }))
          .filter(pair => pair.item && !pair.item.id.includes('reading') && !db.isOnboardingComplete(pair.record));

        setPendingQueue(queue);
        return;
      }

      setStatus('loading');
      clearMissionState();

      try {
        if (!sId) throw new Error('No user logged in');

        // 1. Attempt local lookup
        let item = db.getLearningItems().find(i => i.id === wordIdParam);
        let record = db.getLearningRecord(sId, wordIdParam);
        console.log(`[DEBUG] Local lookup result - item: ${!!item}, record: ${!!record}`);

        // 2. Attempt Firebase lookup if local failed
        if (!item || !record) {
          console.log(`[DEBUG] Local data missing, fetching from Firebase...`);
          const cloudDoc = await getFlashcardRecord(sId, wordIdParam);
          console.log(`[DEBUG] Firebase lookup result: ${!!cloudDoc}`);
          
          if (cloudDoc) {
            const mapped = mapFirestoreToLocal(cloudDoc);
            item = mapped.item;
            record = mapped.record;
            console.log(`[DEBUG] Mission loaded from: Firebase`);
            
            // Cache locally for this session
            db.updateLearningItem(item);
            db.saveLearningRecord(record);
          } else {
             console.log(`[DEBUG] Mission loaded from: None (Not found in cloud either)`);
          }
        } else {
          console.log(`[DEBUG] Mission loaded from: Local`);
        }

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
        // Initialize audioFiles from record if present
        const recordAudioFiles = (chunkRecord as any).audioFiles || {};
        setAudioFiles(recordAudioFiles);
        // Sync to auto-upload metadata states for UI feedback
        if (recordAudioFiles.chunkAudio) setSentenceUploadMetadata(recordAudioFiles.chunkAudio);

        setEditableChunk(currentConns.customChunk || chunkItem.chunk);
        setEditableContextText(currentConns.contextText || (chunkItem as any).contextText || '');
        setEditableTranslation(currentConns.customTranslation || chunkItem.chunkTranslation);
        setEditableFocusExpression(currentConns.customFocusExpression || chunkItem.focusExpression || '');
        setEditableTargetText(currentConns.targetText || (chunkItem as any).targetText || '');
        setEditablePronunciation(currentConns.pronunciation || chunkItem.pronunciation || '');
        setEditableSentenceMeaning(currentConns.sentenceMeaning || chunkItem.sentenceMeaning || '');

        const isChineseLearner = chunkItem.languageDirection === 'zh-en';
        const lang = isChineseLearner ? 'zh-TW' : 'en-US';
        setAvailableGenders(getAvailableGenders(lang));
        setStatus('ready');

        // Trigger AI suggestions
        loadAiSuggestions(chunkItem, sId);

      } catch (err) {
        setErrorCode('UNKNOWN_ERROR');
        setErrorMessage(err instanceof Error ? err.message : 'An unexpected error occurred.');
        setStatus('error');
      }
    };

    loadData();
  }, [wordIdParam]);

  const loadAiSuggestions = async (item: ChunkItem, sId: string) => {
    setIsAiSuggestionsLoading(true);
    try {
      const allRecords = db.getLearningRecords().filter(r => r.studentId === sId);
      const allItems = db.getLearningItems();
      const knownWords = allRecords
        .filter(r => r.encodingCompleted)
        .map(r => allItems.find(i => i.id === r.learningItemId)?.focusExpression || '')
        .filter(Boolean);

      const suggestions = await generateConnectionSuggestions({
        word: item.focusExpression || item.chunk,
        learningLanguage: item.languageDirection === 'en-zh' ? 'English' : 'Chinese',
        nativeLanguage: item.languageDirection === 'en-zh' ? 'Chinese' : 'English',
        chunk: item.chunk,
        sentence: item.chunk, 
        knownWords: knownWords.slice(0, 20) 
      });

      setAiSuggestions(suggestions.map((s, idx) => ({ 
        ...s, 
        id: 'ai_' + idx + '_' + Date.now(),
        source: 'ai' 
      } as SelectedConnection)));
    } catch (error) {
      console.error('Failed to load AI suggestions:', error);
    } finally {
      setIsAiSuggestionsLoading(false);
    }
  };

  const playAudio = (type: 'focusExpression' | 'chunk', source: 'ai' | 'student' = 'student') => {
    let url: string | undefined;
    const isChineseLearner = currentItem?.languageDirection === 'zh-en';
    const lang = isChineseLearner ? 'zh-TW' : 'en-US';
    
    if (source === 'student') {
      // Strictly student recordings only
      url = type === 'focusExpression' 
        ? (audioUrls.studentWord || audioUrls.word) 
        : (audioUrls.studentChunk || audioUrls.chunk);
        
      // Also check unified audioFiles state for immediate playback of new recordings
      if (!url) {
        if (type === 'focusExpression' && audioFiles.targetAudio?.url) {
          url = audioFiles.targetAudio.url;
        } else if (type === 'chunk' && audioFiles.chunkAudio?.url) {
          url = audioFiles.chunkAudio.url;
        }
      }

      if (url) {
        playUnifiedAudio('', url, lang, voicePref);
      } else {
        alert("No recording yet. Please record first.");
      }
      return;
    }

    // AI Source
    url = type === 'focusExpression' ? audioUrls.aiWord : audioUrls.aiChunk;
    
    if (url) {
      playUnifiedAudio('', url, lang, voicePref);
      return;
    }

    // AI TTS Fallback
    let ttsText = type === 'focusExpression' ? editableFocusExpression : editableChunk;
    if (isChineseLearner) {
       // Prioritize characters for Chinese TTS
       if (type === 'focusExpression') {
         ttsText = editableTargetText || editableFocusExpression;
       } else {
         ttsText = editableContextText || editableChunk;
       }
    }
    
    if (ttsText) {
      playUnifiedAudio(ttsText, undefined, lang, voicePref);
    }
  };


  const handleAiGenerateCharacters = async (pinyin: string, field: 'targetText' | 'contextText') => {
    if (!pinyin.trim()) return;
    
    // Don't overwrite unless empty or student confirms (we'll assume student wants it if they click)
    const currentVal = field === 'targetText' ? editableTargetText : editableContextText;
    if (currentVal.trim() && !confirm('Overwrite existing characters?')) return;

    setIsGeneratingCharacters(prev => ({ ...prev, [field]: true }));
    try {
      const generated = await generateChineseCharacters(pinyin);
      if (generated) {
        if (field === 'targetText') setEditableTargetText(generated);
        else setEditableContextText(generated);
      }
    } catch (error) {
      console.error('Failed to generate characters:', error);
    } finally {
      setIsGeneratingCharacters(prev => ({ ...prev, [field]: false }));
    }
  };

  const handleConnectionChange = (field: keyof ConnectionFields, value: any) => {
    setConnections(prev => ({ ...prev, [field]: value }));
  };


  const handleSave = async () => {
    if (!currentRecord || !currentItem) return;
    setIsSaving(true);
    setSaveError(null);

    // Debug: Trace loading source
    const sId = db.getCurrentUserId();
    const isCloudLoaded = currentRecord.id.startsWith(sId || '') || currentRecord.id.includes('_');
    console.log(`[DEBUG] Saving record. Loaded from: ${isCloudLoaded ? 'Firebase' : 'Local'}`);
    console.log(`[DEBUG] Record ID used for save: ${currentRecord.id}`);

    // Requirement 4: Student recording is required, not AI.
    // Check studentWord or legacy focusExpression/word
    const hasStudentTargetAudio = !!(audioFiles.targetAudio?.url || audioUrls.studentWord || audioUrls.focusExpression || audioUrls.word);

    // Explicit array of strictly tracked 'Encoding Connections'
    const validConnectionFields = [
      connections.looksLike,
      connections.soundsLike,
      connections.similarMeaning,
      connections.oppositeMeaning,
      connections.usageContext,
      connections.story,
      connections.imageUrl,
      ...(connections.selectedConnections || [])
    ];

    // personalSentence is EXCLUDED from standard textCount calculations
    const connectionCount = validConnectionFields.filter(v => {
      if (typeof v === 'string') return !!v && v.trim() !== '';
      return !!v; // For objects (selectedConnections)
    }).length;

    let isValid = true;
    if (!hasStudentTargetAudio) {
      setSaveError('Please record audio for the Target Expression.');
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
      contextText: editableContextText !== (chunkItem as any).contextText ? editableContextText : undefined,
      customTranslation: editableTranslation !== chunkItem.chunkTranslation ? editableTranslation : undefined,
      customFocusExpression: editableFocusExpression !== (chunkItem.focusExpression || '') ? editableFocusExpression : undefined,
      targetText: editableTargetText !== (chunkItem as any).targetText ? editableTargetText : undefined,
      pronunciation: editablePronunciation !== (chunkItem.pronunciation || '') ? editablePronunciation : undefined,
      sentenceMeaning: editableSentenceMeaning !== (chunkItem.sentenceMeaning || '') ? editableSentenceMeaning : undefined,
    };

    // Ensure audioUrls is properly synchronized with any new uploads before saving
    const finalAudioUrls = {
      ...audioUrls,
      // Ensure current uploads are reflected even if handleAutoUpload state update is pending
      studentWord: audioFiles.targetAudio?.url || audioUrls.studentWord || audioUrls.focusExpression || audioUrls.word,
      studentChunk: audioFiles.chunkAudio?.url || audioUrls.studentChunk || audioUrls.chunk
    };

    const status = isValid ? 'done' : 'pending';
    console.log(`[DEBUG] Save payload encodingStatus: ${status}`);

    const updatedRecord: any = {
      ...chunkRecord,
      studentConnections: nextStudentConnections,
      audioUrls: finalAudioUrls,
      audioFiles,
      encodingCompleted: isValid,
      encodingStatus: status,
      isConnectionBuilt: isValid,
      updatedAt: Date.now()
    };

    const updatedItem: LearningItem = {
      ...chunkItem,
      focusExpression: editableFocusExpression.trim() || chunkItem.focusExpression,
      chunkTranslation: editableTranslation.trim() || chunkItem.chunkTranslation,
      chunk: editableChunk.trim() || chunkItem.chunk,
      sentenceMeaning: editableSentenceMeaning.trim() || chunkItem.sentenceMeaning,
    };

    db.saveLearningRecord(updatedRecord);
    db.updateLearningItem(updatedItem);

    // Sync to Firebase (Awaited for reliability on cross-device)
    try {
      console.log(`[DEBUG] Firebase update path: learningRecords/${updatedRecord.firebaseDocId || (updatedRecord.studentId + '_' + updatedRecord.learningItemId)}`);
      const firebaseDocId = await saveFlashcard(updatedRecord, updatedItem);
      console.log(`[DEBUG] Firebase save success. Document ID: ${firebaseDocId}`);
      
      // Verification Step (Requirement 3)
      console.log('[DEBUG] Verifying persistence...');
      const verifiedDoc = await getFlashcardRecord(updatedRecord.studentId, updatedRecord.learningItemId);
      if (verifiedDoc) {
        console.log(`[DEBUG] Verified Cloud Status: ${verifiedDoc.encodingStatus}`);
        console.log(`[DEBUG] Verified Cloud UpdatedAt: ${verifiedDoc.updatedAt?.toMillis ? verifiedDoc.updatedAt.toMillis() : verifiedDoc.updatedAt}`);
        
        const mapped = mapFirestoreToLocal(verifiedDoc);
        setCurrentRecord(mapped.record);
        setCurrentItem(mapped.item);
        
        if (mapped.record.encodingStatus === status) {
          console.log('[DEBUG] Verification SUCCESS: Status matches payload.');
        } else {
          console.error('[DEBUG] Verification FAILURE: Status mismatch in cloud!');
        }
      }
    } catch (err) {
      console.error('[DEBUG] Firebase sync failed:', err);
      alert('CRITICAL: Cloud sync failed. Your changes may not be visible on other devices.');
      setSaveError('Cloud sync failed. Your changes are saved locally but may not appear on other devices.');
    } finally {
      setIsSaving(false);
    }
  };


  const handleAutoUpload = async (base64: string, type: 'targetAudio' | 'chunkAudio' = 'targetAudio') => {
    if (!currentItem || !studentId) return;
    
    try {
      // 1. Convert base64 to File
      const arr = base64.split(',');
      const mime = arr[0].match(/:(.*?);/)?.[1] || 'audio/webm';
      const bstr = atob(arr[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      const filename = type === 'targetAudio' ? 'student-pronunciation.webm' : 'sentence-context.webm';
      const file = new File([u8arr], filename, { type: mime });

      // 2. Upload
      const path = `studentAudio/${studentId}/${currentItem.id}/${filename}`;
      const metadata = await uploadAudioFile(file, path);
      
      // 3. Update local state
      setAudioFiles(prev => ({ ...prev, [type]: metadata }));
      if (type === 'chunkAudio') setSentenceUploadMetadata(metadata);
      
      // Update audioUrls mapping
      setAudioUrls(prev => ({
        ...prev,
        [type === 'targetAudio' ? 'studentWord' : 'studentChunk']: metadata.url
      }));
      
      console.log(`[DEBUG] Auto-Upload Metadata (${type}):`, metadata);
    } catch (err) {
      console.error(`Auto-upload failed (${type}):`, err);
    }
  };

  const handleAddSuggestion = (suggestion: Omit<SelectedConnection, 'id' | 'source' | 'createdAt' | 'updatedAt' | 'studentComment'>) => {
    const id = 'sel_' + Date.now();
    const newConn: SelectedConnection = { 
      ...suggestion, 
      id, 
      studentComment: '', 
      source: 'ai',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    const nextConns = [...(connections.selectedConnections || []), newConn];
    handleConnectionChange('selectedConnections', nextConns);
    setEditingConnectionIds(prev => new Set(prev).add(id));
  };

  const handleAddManualConnection = () => {
    const id = 'man_' + Date.now();
    const newConn: SelectedConnection = {
      id,
      type: 'Personal Connection',
      relationshipTag: 'meaning',
      noteLine: '',
      explanation: '',
      studentComment: '',
      source: 'manual',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    const nextConns = [...(connections.selectedConnections || []), newConn];
    handleConnectionChange('selectedConnections', nextConns);
    setEditingConnectionIds(prev => new Set(prev).add(id));
  };

  const handleRemoveSelectedSuggestion = (id: string) => {
    const nextConns = (connections.selectedConnections || []).filter(s => s.id !== id);
    handleConnectionChange('selectedConnections', nextConns);
    setEditingConnectionIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const handleUpdateSelectedSuggestion = (id: string, updates: Partial<SelectedConnection>) => {
    const nextConns = (connections.selectedConnections || []).map(s => s.id === id ? { ...s, ...updates, updatedAt: Date.now() } : s);
    handleConnectionChange('selectedConnections', nextConns);
  };

  const toggleEditingConnection = (id: string) => {
    setEditingConnectionIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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

  const currentSelectedConnections = connections.selectedConnections || [];

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
            

            {/* Target Expression Section */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <label style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>Target Expression <span style={{ color: 'var(--danger)' }}>*</span></label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    <span>AI Voice:</span>
                    <select 
                      value={voicePref} 
                      onChange={(e) => setVoicePref(e.target.value as any)}
                      style={{ padding: '0.2rem', borderRadius: '4px', border: '1px solid var(--border)', fontSize: '0.75rem' }}
                    >
                      <option value="system">System</option>
                      <option value="female">Female</option>
                      <option value="male">Male</option>
                    </select>
                  </div>
                  {/* AI Audio Model */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>AI:</span>
                    <button 
                      className="btn btn-outline" 
                      style={{ borderRadius: '50%', width: '32px', height: '32px', padding: 0, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: audioUrls.aiWord ? '#eff6ff' : '#fff' }} 
                      onClick={() => playAudio('focusExpression', 'ai')}
                      title="Listen to AI voice"
                    >
                      {audioUrls.aiWord ? '🤖' : '🔊'}
                    </button>
                  </div>
                  
                  {/* Student Audio Practice */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Me:</span>
                    <button 
                      className="btn btn-outline" 
                      style={{ borderRadius: '50%', width: '32px', height: '32px', padding: 0, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: (audioFiles.targetAudio?.url || audioUrls.studentWord || audioUrls.focusExpression || audioUrls.word) ? '#f0fdf4' : '#fff' }} 
                      onClick={() => playAudio('focusExpression', 'student')}
                      title="Play my voice"
                    >
                      {(audioFiles.targetAudio?.url || audioUrls.studentWord || audioUrls.focusExpression || audioUrls.word) ? '▶️' : '🎤'}
                    </button>
                    <AudioRecorder onSave={(base64) => handleAutoUpload(base64, 'targetAudio')} />
                  </div>
                </div>
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: isChineseLearner ? '1fr 1fr' : '1fr', gap: '1rem' }}>
                {/* Target Expression (Primary) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  {isChineseLearner && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 'bold', textTransform: 'uppercase' }}>Pinyin / Readable</span>}
                  {isEditingFocus ? (
                    <input
                      value={editableFocusExpression}
                      onChange={e => setEditableFocusExpression(e.target.value)}
                      onBlur={() => setIsEditingFocus(false)}
                      className="input-field"
                      style={{ fontSize: isChineseLearner ? '1.25rem' : '1.5rem', background: '#f8fafc', fontWeight: 'bold' }}
                      placeholder="e.g. pinyin form"
                      autoFocus
                      onKeyDown={e => e.key === 'Enter' && setIsEditingFocus(false)}
                    />
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#f8fafc', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid transparent', cursor: 'text' }} onClick={() => setIsEditingFocus(true)}>
                      <span style={{ fontSize: isChineseLearner ? '1.25rem' : '1.5rem', fontWeight: 'bold', flex: 1 }}>{editableFocusExpression || <span style={{ color: 'var(--text-muted)' }}>Empty...</span>}</span>
                      <button className="btn btn-outline" style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem', background: '#fff', border: 'none', color: 'var(--text-muted)' }}>✏️</button>
                    </div>
                  )}
                </div>

                {/* Target Text (Characters - Chinese Learners only) */}
                {isChineseLearner && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 'bold', textTransform: 'uppercase' }}>Chinese Characters</span>
                      <button 
                        className="btn btn-outline" 
                        style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem', background: '#eff6ff', color: 'var(--primary)', border: '1px solid #dbeafe' }}
                        onClick={() => handleAiGenerateCharacters(editableFocusExpression, 'targetText')}
                        disabled={isGeneratingCharacters['targetText']}
                      >
                        {isGeneratingCharacters['targetText'] ? '⌛...' : '✨ Generate'}
                      </button>
                    </div>
                    {isEditingTargetText ? (
                      <input
                        value={editableTargetText}
                        onChange={e => setEditableTargetText(e.target.value)}
                        onBlur={() => setIsEditingTargetText(false)}
                        className="input-field"
                        style={{ fontSize: '1.25rem', background: '#f8fafc', fontWeight: 'bold' }}
                        placeholder="e.g. 漢字"
                        autoFocus
                        onKeyDown={e => e.key === 'Enter' && setIsEditingTargetText(false)}
                      />
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#f8fafc', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid transparent', cursor: 'text' }} onClick={() => setIsEditingTargetText(true)}>
                        <span style={{ fontSize: '1.25rem', fontWeight: 'bold', flex: 1 }}>{editableTargetText || <span style={{ color: 'var(--text-muted)' }}>Empty...</span>}</span>
                        <button className="btn btn-outline" style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem', background: '#fff', border: 'none', color: 'var(--text-muted)' }}>✏️</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    {/* AI Audio Model */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>AI:</span>
                      <button 
                        className="btn btn-outline" 
                        style={{ borderRadius: '50%', width: '32px', height: '32px', padding: 0, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: audioUrls.aiChunk ? '#eff6ff' : '#fff' }} 
                        onClick={() => playAudio('chunk', 'ai')}
                        title="Listen to AI voice"
                      >
                        {audioUrls.aiChunk ? '🤖' : '🔊'}
                      </button>
                    </div>

                    {/* Student Audio Practice */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Me:</span>
                      <button 
                        className="btn btn-outline" 
                        style={{ borderRadius: '50%', width: '32px', height: '32px', padding: 0, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: (sentenceUploadMetadata?.url || audioUrls.studentChunk || audioUrls.chunk) ? '#f0fdf4' : '#fff' }} 
                        onClick={() => playAudio('chunk', 'student')}
                        title="Play my voice"
                      >
                        {(sentenceUploadMetadata?.url || audioUrls.studentChunk || audioUrls.chunk) ? '▶️' : '🎤'}
                      </button>
                      <AudioRecorder onSave={(base64) => handleAutoUpload(base64, 'chunkAudio')} />
                    </div>
                  </div>
                </div>
                
                <div style={{ display: 'grid', gridTemplateColumns: isChineseLearner ? '1fr 1fr' : '1fr', gap: '1rem' }}>
                  {/* Sentence (Primary) */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    {isChineseLearner && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 'bold', textTransform: 'uppercase' }}>Pinyin Sentence</span>}
                    {isEditingChunk ? (
                      <textarea
                        value={editableChunk}
                        onChange={e => setEditableChunk(e.target.value)}
                        onBlur={() => setIsEditingChunk(false)}
                        className="input-field"
                        style={{ fontSize: '1.1rem', background: '#fff', minHeight: '80px' }}
                        placeholder="e.g. pinyin sentence"
                        autoFocus
                      />
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', background: '#fff', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid transparent', cursor: 'text', minHeight: '80px' }} onClick={() => setIsEditingChunk(true)}>
                        <span style={{ fontSize: '1.1rem', flex: 1, color: editableChunk ? 'var(--text-main)' : 'var(--text-muted)' }}>{editableChunk || 'Enter sentence...'}</span>
                        <button className="btn btn-outline" style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem', background: '#fff', border: 'none', color: 'var(--text-muted)' }}>✏️</button>
                      </div>
                    )}
                  </div>

                  {/* Context Text (Characters - Chinese Learners only) */}
                  {isChineseLearner && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 'bold', textTransform: 'uppercase' }}>Chinese Sentence</span>
                      <button 
                        className="btn btn-outline" 
                        style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem', background: '#eff6ff', color: 'var(--primary)', border: '1px solid #dbeafe' }}
                        onClick={() => handleAiGenerateCharacters(editableChunk, 'contextText')}
                        disabled={isGeneratingCharacters['contextText']}
                      >
                        {isGeneratingCharacters['contextText'] ? '⌛...' : '✨ Generate'}
                      </button>
                    </div>
                      {isEditingContextText ? (
                        <textarea
                          value={editableContextText}
                          onChange={e => setEditableContextText(e.target.value)}
                          onBlur={() => setIsEditingContextText(false)}
                          className="input-field"
                          style={{ fontSize: '1.1rem', background: '#fff', minHeight: '80px' }}
                          placeholder="e.g. 漢字句子"
                          autoFocus
                        />
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', background: '#fff', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid transparent', cursor: 'text', minHeight: '80px' }} onClick={() => setIsEditingContextText(true)}>
                          <span style={{ fontSize: '1.1rem', flex: 1, color: editableContextText ? 'var(--text-main)' : 'var(--text-muted)' }}>{editableContextText || 'Enter characters...'}</span>
                          <button className="btn btn-outline" style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem', background: '#fff', border: 'none', color: 'var(--text-muted)' }}>✏️</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
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

        {/* Section 2: Unified Connections */}
        <section>
          <h3 style={{ margin: '0 0 1rem 0', color: 'var(--text-main)', borderBottom: '2px solid var(--border)', paddingBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            2. Connections <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>(Complete at least 2)</span>
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
          </div>
        </section>

        <section style={{ marginTop: '2rem', background: '#f8fafc', padding: '2rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
          
          {/* My Selected Connections Area */}
          <div style={{ marginBottom: '2rem', padding: '1.5rem', background: '#fff', borderRadius: '12px', border: '2px solid var(--primary)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h4 style={{ margin: 0, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                📍 My Selected Connections
              </h4>
              <button 
                onClick={handleAddManualConnection}
                className="btn btn-outline" 
                style={{ fontSize: '0.85rem', padding: '0.4rem 1rem', background: 'var(--primary)', color: '#fff', border: 'none' }}
              >
                + Add My Own Connection
              </button>
            </div>
            {currentSelectedConnections.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', fontStyle: 'italic', margin: '1rem 0' }}>
                No suggestions selected yet. Explore teacher-style notes below!
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {currentSelectedConnections.map(s => {
                  const isEditing = editingConnectionIds.has(s.id);
                  const isManual = s.source === 'manual';
                  
                  if (!isEditing) {
                    return (
                      <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem', background: '#f8fafc', borderRadius: '12px', border: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                          <span style={{ fontSize: '0.65rem', fontWeight: 'bold', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.relationshipTag}</span>
                          <div style={{ fontWeight: 'bold', fontSize: '1.05rem', color: 'var(--text-main)', whiteSpace: 'pre-wrap' }}>{s.noteLine || (isManual ? '(Empty Note)' : '')}</div>
                          {s.studentComment && <div style={{ fontSize: '0.85rem', color: 'var(--primary)', fontStyle: 'italic' }}>"{s.studentComment}"</div>}
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button onClick={() => toggleEditingConnection(s.id)} className="btn btn-outline" style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', background: '#fff' }}>✏️ Edit</button>
                          <button onClick={() => handleRemoveSelectedSuggestion(s.id)} className="btn btn-outline" style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', color: 'var(--danger)', borderColor: '#fca5a5', background: '#fff' }}>🗑 Remove</button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={s.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '1.25rem', background: '#f8fafc', borderRadius: '12px', border: '1px solid var(--primary)', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <select 
                            style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-muted)', textTransform: 'uppercase', outline: 'none', cursor: 'pointer', padding: '0.2rem 0.5rem' }}
                            value={PRESET_TAGS.includes(s.relationshipTag) ? s.relationshipTag : 'custom'}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === 'custom') {
                                handleUpdateSelectedSuggestion(s.id, { relationshipTag: '' });
                              } else {
                                handleUpdateSelectedSuggestion(s.id, { relationshipTag: val });
                              }
                            }}
                          >
                            {PRESET_TAGS.map(tag => (
                              <option key={tag} value={tag}>{tag}</option>
                            ))}
                            <option value="custom">Custom Tag...</option>
                          </select>
                          {(!PRESET_TAGS.includes(s.relationshipTag) || s.relationshipTag === '') && (
                            <input 
                              placeholder="Type tag..."
                              className="input-field"
                              style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', width: '100px' }}
                              value={s.relationshipTag}
                              onChange={(e) => handleUpdateSelectedSuggestion(s.id, { relationshipTag: e.target.value })}
                            />
                          )}
                        </div>
                        <button 
                          style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 500 }}
                          onClick={() => handleRemoveSelectedSuggestion(s.id)}
                        >
                          ✕ Remove
                        </button>
                      </div>
                      
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 'bold' }}>MEMORY NOTE</label>
                          <textarea 
                            className="input-field"
                            style={{ fontWeight: 'bold', fontSize: '1.1rem', background: '#fff', minHeight: '80px' }}
                            value={s.noteLine}
                            onChange={(e) => handleUpdateSelectedSuggestion(s.id, { noteLine: e.target.value })}
                            placeholder="Break down the word or write a mnemonic..."
                          />
                        </div>
                        
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 'bold' }}>MY COMMENT / EXTRA NOTE</label>
                          <textarea 
                            className="input-field" 
                            value={s.studentComment}
                            onChange={(e) => handleUpdateSelectedSuggestion(s.id, { studentComment: e.target.value })}
                            style={{ minHeight: '60px', fontSize: '0.9rem', background: '#fff' }}
                            placeholder="Add your own thought or comment..."
                          />
                        </div>

                        {!isManual && s.explanation && (
                          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontStyle: 'italic', background: '#fff', padding: '0.75rem', borderRadius: '8px', border: '1px solid #eee' }}>
                            <span style={{ fontWeight: 'bold', color: 'var(--primary)', fontSize: '0.7rem', display: 'block', marginBottom: '0.25rem', textTransform: 'uppercase' }}>Teacher Explanation:</span>
                            {s.explanation}
                          </div>
                        )}
                        
                        <button 
                          onClick={() => toggleEditingConnection(s.id)} 
                          className="btn btn-primary" 
                          style={{ width: 'fit-content', alignSelf: 'flex-end', padding: '0.5rem 1.5rem', fontSize: '0.9rem' }}
                        >
                          Save Connection
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <h4 style={{ margin: '0 0 1rem 0', fontSize: '0.85rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            AI Teacher Suggestions
          </h4>
          
          {isAiSuggestionsLoading ? (
            <div style={{ textAlign: 'center', padding: '2rem' }}>
              <div className="spinner" style={{ width: '30px', height: '30px', border: '3px solid var(--border)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto' }} />
              <p style={{ color: 'var(--text-muted)', marginTop: '1rem', fontSize: '0.9rem' }}>Writing teacher notes...</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
              {aiSuggestions.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', textAlign: 'center', gridColumn: '1/-1' }}>No suggestions available for this word.</p>
              ) : (
                aiSuggestions.map(item => {
                  const isSelected = !!currentSelectedConnections.find(s => s.noteLine === item.noteLine && s.relationshipTag === item.relationshipTag);
                  return (
                    <div 
                      key={item.id} 
                      style={{ 
                        background: '#fff', 
                        padding: '1.25rem', 
                        borderRadius: '16px', 
                        border: '1px solid var(--border)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.75rem',
                        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
                        opacity: isSelected ? 0.6 : 1,
                        transition: 'all 0.2s ease'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <span style={{ 
                          fontSize: '0.7rem', 
                          fontWeight: 'bold', 
                          color: 'var(--primary)', 
                          background: '#eff6ff', 
                          padding: '0.2rem 0.5rem', 
                          borderRadius: '4px',
                          textTransform: 'uppercase'
                        }}>
                          {item.relationshipTag}
                        </span>
                        <button 
                          className="btn btn-outline" 
                          style={{ 
                            padding: '0.25rem 0.75rem', 
                            fontSize: '0.85rem', 
                            background: isSelected ? 'var(--success)' : '#fff', 
                            color: isSelected ? '#fff' : 'var(--primary)', 
                            borderColor: isSelected ? 'var(--success)' : 'var(--primary)',
                            fontWeight: 600
                          }}
                          onClick={() => handleAddSuggestion(item)}
                          disabled={isSelected}
                        >
                          {isSelected ? '✓ Added' : '+ Add'}
                        </button>
                      </div>
                      
                      <div style={{ fontWeight: 'bold', fontSize: '1.15rem', color: 'var(--text-main)', lineHeight: '1.3', whiteSpace: 'pre-wrap' }}>
                        {item.noteLine}
                      </div>

                      <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                        {item.explanation}
                      </p>

                      {(item.optionalPronunciation || item.optionalMeaning) && (
                        <div style={{ fontSize: '0.8rem', color: 'var(--primary)', marginTop: 'auto', paddingTop: '0.5rem', borderTop: '1px solid #f8fafc' }}>
                          {item.optionalPronunciation} {item.optionalMeaning && <span style={{ color: 'var(--text-muted)' }}> - {item.optionalMeaning}</span>}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </section>



        {/* Save Button & Validation Feedback */}
        <div style={{ marginTop: '2rem', textAlign: 'center', padding: '2rem', background: '#f0f9ff', borderRadius: '16px' }}>
          {saveError && <p style={{ color: 'var(--danger)', fontWeight: 'bold', marginBottom: '1rem' }}>⚠️ {saveError}</p>}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', background: '#f8fafc', padding: '0.75rem', borderRadius: '8px' }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>AI Voice Preference:</span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={() => setVoicePref('system')}
                className={`btn ${voicePref === 'system' ? 'btn-primary' : 'btn-outline'}`}
                style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
              >
                System
              </button>
              {availableGenders.map(g => (
                <button
                  key={g}
                  onClick={() => setVoicePref(g as any)}
                  className={`btn ${voicePref === g ? 'btn-primary' : 'btn-outline'}`}
                  style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem', textTransform: 'capitalize' }}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1.5rem', justifyContent: 'center' }}>
            <button
              className="btn btn-primary"
              style={{ padding: '1rem 3rem', fontSize: '1.2rem', minWidth: '240px' }}
              onClick={async () => {
                await handleSave();
                // Navigate back to Flashcards library
                navigate(`/student/${studentId}/flashcards`);
              }}
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : 'Save & Back'}
            </button>
          </div>
        </div>

        {/* Media Schema Preview Section (Temporary Verification) */}
        <section style={{ marginTop: '2rem', padding: '2rem', background: '#f8fafc', border: '2px dashed var(--border)', borderRadius: '16px' }}>
          <h3 style={{ margin: '0 0 1rem 0', color: 'var(--text-main)' }}>
            🧪 Media Schema Preview (v1)
          </h3>
          <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
            Verifying dynamic field discovery from <code>encodingSchema.ts</code>.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            {getActiveEncodingFields().filter(f => f.section === 'media').map(field => (
              <div key={field.fieldKey} style={{ background: '#fff', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <div style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{field.label}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>Type: {field.type}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--primary)', marginTop: '0.5rem', fontFamily: 'monospace' }}>{field.firestorePath}</div>
              </div>
            ))}
          </div>
        </section>

        <p style={{ marginTop: '1.5rem', textAlign: 'center', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
          To fully complete encoding, require: Target Expression Audio & 2 Text/Visual connections.
        </p>

      </div>
    </div>
  );
}
