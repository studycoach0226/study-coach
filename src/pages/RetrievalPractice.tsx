import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../lib/db';
import { LearningItem, StudentLearningRecord, ChunkItem, ReadingItem } from '../lib/types';
import { retrievalEngine } from '../lib/retrievable/retrievalEngine';
import { assignmentStore } from '../lib/retrievable/assignmentStore';
import { templateBank } from '../lib/retrievable/templateBank';
import { GeneratedTask } from '../lib/retrievable/types';
import { playUnifiedAudio } from '../lib/audioUtils';
import { evaluateTypedAnswer } from '../lib/aiService';

export default function RetrievalPractice() {
  const navigate = useNavigate();
  const studentId = db.getCurrentUserId();
  const [practiceQueue, setPracticeQueue] = useState<{ item: LearningItem, record: StudentLearningRecord, task: GeneratedTask }[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [mode, setMode] = useState<'selection' | 'flashcard' | 'test'>('selection');

  // Flashcard states
  const [fcDirection, setFcDirection] = useState<'l1-l2' | 'l2-l1' | 'auto'>('auto');
  const [isFlipped, setIsFlipped] = useState(false);

  // Self Test states
  const [typedAnswer, setTypedAnswer] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error', msg: string } | null>(null);
  const [showHints, setShowHints] = useState(false);
  const [answerMode, setAnswerMode] = useState<'voice' | 'type'>('type');
  const [testDirection, setTestDirection] = useState<'l1-l2' | 'l2-l1'>('l1-l2');
  const [isRecording, setIsRecording] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [recordedBlobUrl, setRecordedBlobUrl] = useState<string | null>(null);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState('');
  const [recognition, setRecognition] = useState<any>(null);
  const [voicePref, setVoicePref] = useState<'female' | 'male' | 'system'>('system');

  useEffect(() => {
    const sId = db.getCurrentUserId();
    if (!sId) return;

    const syncedAssignment = assignmentStore.getSyncedByStudentId(sId);
    const syncedTemplates = templateBank.getSynced();

    // Globally enabled templates
    const globallyEnabledIds = new Set(syncedTemplates.filter(t => t.enabled).map(t => t.template_id));

    let enabledTemplateIds: string[] = [];
    if (syncedAssignment?.template_ids && syncedAssignment.template_ids.length > 0) {
      enabledTemplateIds = syncedAssignment.template_ids.filter(id => globallyEnabledIds.has(id));
    } else {
      enabledTemplateIds = ['tA', 'tB', 'tD', 'tS'].filter(id => globallyEnabledIds.has(id));
    }

    const allItems = db.getLearningItems();
    const studentRecords = db.getLearningRecords().filter(r => r.studentId === sId && r.status !== 'completed');

    // Categorize encoded items
    const encodedItems = studentRecords
      .map(record => {
        const item = allItems.find(i => i.id === record.learningItemId);
        if (!item || !record.encodingCompleted) return null;

        let task: GeneratedTask | null = null;

        // Pick a random enabled template
        const templateId = enabledTemplateIds[Math.floor(Math.random() * enabledTemplateIds.length)];
        const syncedTemplate = syncedTemplates.find(t => t.template_id === templateId);

        if (syncedTemplate) {
          task = retrievalEngine.generateTask(item.id, templateId, syncedTemplate);
        }

        // Fallback for custom items or failed engine tasks
        if (!task) {
          const chunkItem = item as ChunkItem;
          task = {
            task_id: `fallback_${Date.now()}_${item.id}`,
            template_id: 't_fallback',
            content_id: item.id,
            prompt: `What is the meaning of "${chunkItem.focusExpression}"?`,
            expected_output: chunkItem.chunkTranslation || '',
            hint: chunkItem.chunk ? `Hint: ${chunkItem.chunk}` : undefined,
            created_at: new Date().toISOString()
          };
        }

        return { item, record, task };
      })
      .filter((pair): pair is { item: LearningItem, record: StudentLearningRecord, task: GeneratedTask } => !!pair);

    const addedIds = new Set<string>();
    const dueItems: typeof encodedItems = [];
    const weakItems: typeof encodedItems = [];
    const extraItems: typeof encodedItems = [];

    encodedItems.forEach(pair => {
      if (db.isWordDue(sId, pair.item.id)) {
        dueItems.push(pair);
        addedIds.add(pair.item.id);
      }
    });

    encodedItems.forEach(pair => {
      if (!addedIds.has(pair.item.id) && pair.record.status === 'weak') {
        weakItems.push(pair);
        addedIds.add(pair.item.id);
      }
    });

    encodedItems.forEach(pair => {
      if (!addedIds.has(pair.item.id)) {
        extraItems.push(pair);
        addedIds.add(pair.item.id);
      }
    });

    const finalQueue = [...dueItems, ...weakItems, ...extraItems];
    setPracticeQueue(finalQueue);
  }, []);

  const handleNext = () => {
    if (currentIndex < practiceQueue.length - 1) {
      setCurrentIndex(i => i + 1);
      setTypedAnswer('');
      setFeedback(null);
      setShowHints(false);
      setIsFlipped(false);
      setIsRecording(false);
      setIsEvaluating(false);
      setRecordedBlobUrl(null);
      setValidationError(null);
      setTranscript('');
    } else {
      setMode('selection');
      setCurrentIndex(0);
      setPracticeQueue([]);
      window.location.reload();
    }
  };

  const submitEval = async () => {
    setIsEvaluating(true);
    setValidationError(null);

    if (answerMode === 'voice' && !transcript.trim()) {
      setValidationError('Please record your answer first.');
      setIsEvaluating(false);
      return;
    }

    const currentPair = practiceQueue[currentIndex];
    const item = currentPair.item;
    // For Chinese learners (learning Chinese), target (L2) is Chinese.
    // Based on user rule: en-zh for English learners (L1=zh, L2=en), zh-en for Chinese learners (L1=en, L2=zh)
    const isChineseLearner = item.languageDirection === 'zh-en';
    const studentAnswer = answerMode === 'voice' ? transcript : typedAnswer;
    const aiDirection = isChineseLearner 
      ? (testDirection === 'l1-l2' ? 'en-zh' : 'zh-en')
      : (testDirection === 'l1-l2' ? 'zh-en' : 'en-zh');

    try {
      const result = await evaluateTypedAnswer({
        studentAnswer: studentAnswer,
        expectedAnswer: testContent.rawExpected,
        promptShown: testContent.rawPrompt,
        direction: aiDirection,
        learningMode: isChineseLearner ? 'chineseLearner' : 'englishLearner',
        targetExpression: (item as ChunkItem).focusExpression || (item as ReadingItem).title || '',
        pronunciation: (item as ChunkItem).teacherConnections?.pronunciation || (item as ChunkItem).pronunciation,
        meaning: (item as ChunkItem).chunkTranslation || (item as ReadingItem).fullMeaningZh || '',
        context: (item as ChunkItem).teacherConnections?.usageContext
      });

      db.saveAttempt({
        id: 'att_' + Date.now(),
        studentId: currentPair.record.studentId,
        wordId: item.id,
        date: new Date().toISOString(),
        passed: result.passed,
        usedHint: showHints
      });

      if (result.passed) {
        setFeedback({ type: 'success', msg: result.feedback || '✅ Correct!' });
        setTimeout(handleNext, 1500);
      } else {
        setFeedback({ type: 'error', msg: result.feedback || '❌ Not quite right.' });
        setShowHints(true);
      }
    } catch (err) {
      console.error("AI evaluation failed:", err);
      setFeedback({ type: 'error', msg: 'AI evaluation failed. Please check your connection or try again.' });
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleToggleRecording = async () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (isRecording) {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
      }
      if (recognition) {
        recognition.stop();
      }
      setIsRecording(false);
    } else {
      setTranscript('');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        const chunks: Blob[] = [];
        recorder.ondataavailable = (e) => chunks.push(e.data);
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: 'audio/webm' });
          setRecordedBlobUrl(URL.createObjectURL(blob));
          setValidationError(null);
        };
        recorder.start();
        setMediaRecorder(recorder);

        if (SpeechRecognition) {
          const recognizer = new SpeechRecognition();
          const currentItem = practiceQueue[currentIndex]?.item;
          const isChineseLearner = currentItem?.languageDirection === 'zh-en';
          
          // Using testDirection directly (l1-l2 or l2-l1)
          const resolvedDir = testDirection;
          
          let lang = 'en-US';
          if (isChineseLearner) {
            // L1=en, L2=zh. L1->L2 answer=zh, L2->L1 answer=en
            lang = resolvedDir === 'l1-l2' ? 'zh-TW' : 'en-US';
          } else {
            // L1=zh, L2=en. L1->L2 answer=en, L2->L1 answer=zh
            lang = resolvedDir === 'l1-l2' ? 'en-US' : 'zh-TW';
          }

          recognizer.lang = lang;
          
          recognizer.continuous = true;
          recognizer.interimResults = true;

          recognizer.onresult = (event: any) => {
            let finalTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
              if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
              }
            }
            if (finalTranscript) setTranscript(finalTranscript);
          };
          
          recognizer.start();
          setRecognition(recognizer);
        }

        setIsRecording(true);
        setRecordedBlobUrl(null);
        setValidationError(null);
      } catch (err) {
        console.error("Failed to start recording:", err);
      }
    }
  };

  const playRecording = () => {
    if (recordedBlobUrl) {
      const audio = new Audio(recordedBlobUrl);
      audio.play();
    }
  };
  const speak = (text: string, record?: StudentLearningRecord, type: 'focusExpression' | 'chunk' | 'other' = 'other', source: 'ai' | 'student' = 'ai') => {
    const currentItem = practiceQueue[currentIndex]?.item as ChunkItem;
    const isChineseLearner = currentItem?.languageDirection === 'zh-en';
    const isChineseTTS = isChineseLearner || (currentItem?.languageDirection === 'en-zh' && type === 'other' && text.match(/[\u4e00-\u9fa5]/));
    const lang = isChineseTTS ? 'zh-TW' : 'en-US';

    if (source === 'student') {
      const studentUrl = type === 'focusExpression' 
        ? (record?.audioUrls?.studentWord || record?.audioUrls?.word) 
        : (record?.audioUrls?.studentChunk || record?.audioUrls?.chunk);
      
      if (studentUrl) {
        playUnifiedAudio('', studentUrl, lang, voicePref);
      } else {
        alert("No recording yet. Please record first.");
      }
      return;
    }

    // AI Source - Strictly TTS or AI stored URL
    const aiUrl = type === 'focusExpression' ? record?.audioUrls?.aiWord : record?.audioUrls?.aiChunk;
    
    if (aiUrl) {
      playUnifiedAudio('', aiUrl, lang, voicePref);
      return;
    }

    // AI TTS Fallback
    let ttsText = text;
    if (isChineseLearner) {
      // Requirement: prioritize characters for better AI TTS quality
      if (type === 'focusExpression') {
        ttsText = record?.targetText || record?.studentConnections?.customFocusExpression || currentItem?.focusExpression || text;
      } else if (type === 'chunk') {
        ttsText = record?.contextText || record?.studentConnections?.customChunk || currentItem?.chunk || text;
      }
    }
    
    if (ttsText) {
      playUnifiedAudio(ttsText, undefined, lang, voicePref);
    }
  };



  if (practiceQueue.length === 0) {
    return (
      <div style={{ maxWidth: '600px', margin: '4rem auto', textAlign: 'center' }} className="card">
        <h2>🎉 All Caught Up!</h2>
        <p>No retrieval items ready. Complete encoding missions for your units first!</p>
        <button className="btn btn-primary" onClick={() => navigate(`/student/${studentId}`)}>Back to Dashboard</button>
      </div>
    );
  }

  const current = practiceQueue[currentIndex];

  if (mode === 'selection') {
    return (
      <div style={{ maxWidth: '800px', margin: '4rem auto', textAlign: 'center' }}>
        <h1 style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>How do you want to practice?</h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: '3rem', fontSize: '1.1rem' }}>Choose your preferred method to review your vocabulary.</p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
          <div className="mode-card" onClick={() => setMode('flashcard')}>
            <div className="mode-icon">🎴</div>
            <h3>Flashcard Practice</h3>
            <p>Look, flip, and review cards to build familiarity.</p>
          </div>

          <div className="mode-card" onClick={() => setMode('test')}>
            <div className="mode-icon">📝</div>
            <h3>Self Test</h3>
            <p>Type your answer and check yourself to build mastery.</p>
          </div>
        </div>

        <button
          className="btn btn-outline"
          style={{ marginTop: '3rem' }}
          onClick={() => navigate(`/student/${studentId}`)}
        >
          Cancel and Return
        </button>
      </div>
    );
  }

  const getFlashcardContent = () => {
    let l1 = ''; // Meaning
    let l2 = ''; // Target Expression
    if (current.item.itemType === 'reading') {
      l2 = (current.item as ReadingItem).title;
      l1 = (current.item as ReadingItem).fullMeaningZh || '';
    } else {
      l2 = (current.item as ChunkItem).focusExpression;
      l1 = (current.item as ChunkItem).chunkTranslation;
    }

    const pinyin = (current.item as ChunkItem).teacherConnections?.pronunciation || (current.item as ChunkItem).pronunciation;
    const targetText = (current.item as any).targetText || (current.record as any).targetText;
    const isChineseLearner = current.item.languageDirection === 'zh-en';

    // Redesign formattedL2 for Chinese learners
    const formattedL2 = isChineseLearner ? (
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: 'var(--primary)', marginBottom: '0.4rem' }}>{l2}</div>
        {targetText && <div style={{ fontSize: '1.5rem', color: 'var(--text-muted)' }}>{targetText}</div>}
        {!targetText && pinyin && <div style={{ fontSize: '1.2rem', color: 'var(--text-muted)' }}>{pinyin}</div>}
      </div>
    ) : l2;

    const resolvedDir = fcDirection === 'auto' ? 'l1-l2' : fcDirection;

    if (resolvedDir === 'l1-l2') {
      return { front: l1, back: formattedL2, audioText: l2, audioType: 'focusExpression' as const, labelFront: 'Meaning (L1)', labelBack: 'Target (L2)' };
    } else {
      return { front: formattedL2, back: l1, audioText: l2, audioType: 'focusExpression' as const, labelFront: 'Target (L2)', labelBack: 'Meaning (L1)' };
    }
  };

  const getTestContent = () => {
    let l1 = ''; // Meaning
    let l2 = ''; // Target Expression
    if (current.item.itemType === 'reading') {
      l2 = (current.item as ReadingItem).title;
      l1 = (current.item as ReadingItem).fullMeaningZh || '';
    } else {
      l2 = (current.item as ChunkItem).focusExpression;
      l1 = (current.item as ChunkItem).chunkTranslation;
    }

    const pinyin = (current.item as ChunkItem).teacherConnections?.pronunciation || (current.item as ChunkItem).pronunciation;
    const targetText = (current.item as any).targetText || (current.record as any).targetText;
    const isChineseLearner = current.item.languageDirection === 'zh-en';

    // Redesign formattedL2 for Chinese learners
    const formattedL2 = isChineseLearner ? (
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '2.2rem', fontWeight: 'bold', color: 'var(--primary)', marginBottom: '0.2rem' }}>{l2}</div>
        {targetText && <div style={{ fontSize: '1.4rem', color: 'var(--text-muted)' }}>{targetText}</div>}
        {!targetText && pinyin && <div style={{ fontSize: '1.1rem', color: 'var(--text-muted)' }}>{pinyin}</div>}
      </div>
    ) : l2;

    const resolvedDir = testDirection;

    if (resolvedDir === 'l1-l2') {
      return {
        prompt: l1,
        rawPrompt: l1,
        expected: l2,
        rawExpected: l2,
        displayExpected: formattedL2,
        instruction: 'Produce the target expression'
      };
    } else {
      return {
        prompt: formattedL2,
        rawPrompt: l2,
        expected: l1,
        rawExpected: l1,
        displayExpected: l1,
        instruction: 'How do you say this in the target language?'
      };
    }
  };

  const fcContent = getFlashcardContent();
  const testContent = getTestContent();

  const renderTestInput = () => {
    if (isEvaluating) {
      return (
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <div className="spinner" style={{ margin: '0 auto 1rem' }}></div>
          <p style={{ color: 'var(--text-muted)', fontWeight: 'bold' }}>Checking answer...</p>
        </div>
      );
    }

    if (!feedback) {
      return (
        <div>
          {answerMode === 'type' && (
            <input
              className="input-field"
              value={typedAnswer}
              onChange={e => setTypedAnswer(e.target.value)}
              placeholder="Type your answer..."
              onKeyDown={e => e.key === 'Enter' && submitEval()}
              style={{ marginBottom: '1.5rem', width: '100%', boxSizing: 'border-box' }}
              autoFocus
            />
          )}

          {answerMode === 'voice' && (
            <div style={{ marginBottom: '1.5rem', textAlign: 'center' }}>
              {!recordedBlobUrl ? (
                <>
                  <button
                    className={`btn ${isRecording ? 'btn-danger' : 'btn-primary'}`}
                    style={{
                      width: '80px',
                      height: '80px',
                      borderRadius: '50%',
                      fontSize: '1.5rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      margin: '0 auto',
                      boxShadow: isRecording ? '0 0 15px rgba(239, 68, 68, 0.5)' : 'none',
                      transition: 'all 0.2s ease'
                    }}
                    onClick={handleToggleRecording}
                  >
                    {isRecording ? '⏹' : '🎤'}
                  </button>
                  <p style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: isRecording ? 'var(--danger)' : 'var(--text-muted)' }}>
                    {isRecording ? 'Recording...' : 'Click to Speak'}
                  </p>
                </>
              ) : (
                <div style={{ padding: '1rem', background: '#f0fdf4', borderRadius: '12px', border: '1px solid #bbf7d0', display: 'inline-block' }}>
                  <p style={{ margin: '0 0 0.5rem', color: '#166534', fontWeight: 'bold', fontSize: '0.9rem' }}>✅ Answer Recorded</p>
                  {transcript && (
                    <p style={{ margin: '0 0 1rem', fontSize: '1rem', color: 'var(--text-main)', fontStyle: 'italic' }}>
                      "You said: {transcript}"
                    </p>
                  )}
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className="btn btn-outline" style={{ background: '#fff', padding: '0.3rem 0.6rem', fontSize: '0.8rem' }} onClick={playRecording}>▶️ Play</button>
                    <button className="btn btn-outline" style={{ background: '#fff', padding: '0.3rem 0.6rem', fontSize: '0.8rem' }} onClick={() => { setRecordedBlobUrl(null); setTranscript(''); }}>🔄 Re-record</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {validationError && (
            <p style={{ color: 'var(--danger)', fontSize: '0.85rem', marginBottom: '1rem', fontWeight: 'bold' }}>
              ⚠️ {validationError}
            </p>
          )}

          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
            <button
              className="btn btn-primary"
              disabled={isEvaluating}
              onClick={() => {
                if (answerMode === 'voice' && !transcript.trim()) {
                  setValidationError('Please record your answer first.');
                  return;
                }
                if (answerMode === 'type' && !typedAnswer.trim()) {
                  setValidationError('Please type your answer first.');
                  return;
                }
                submitEval();
              }}
            >
              Submit Answer
            </button>
          </div>
        </div>
      );
    }

    return (
      <>
        <div>
          <h3 style={{ color: feedback.type === 'success' ? 'var(--success)' : 'var(--danger)', marginBottom: '1.5rem' }}>{feedback.msg}</h3>
          <div style={{ margin: '1rem 0', background: '#f8fafc', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border)' }}>
            <p style={{ margin: 0, fontWeight: 'bold', color: 'var(--text-muted)', fontSize: '0.8rem', textTransform: 'uppercase' }}>Expected Answer:</p>
            <div style={{ margin: '0.5rem 0' }}>{testContent.displayExpected}</div>
            {current.task.feedback && <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.5rem' }}>{current.task.feedback}</p>}
            
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
              <button className="btn btn-outline" style={{ background: '#fff', fontSize: '0.85rem' }} onClick={() => speak(testContent.rawExpected, current.record, 'focusExpression', 'ai')}>🤖 AI Voice</button>
              {(current.record.audioUrls?.studentWord || current.record.audioUrls?.focusExpression || current.record.audioUrls?.word) && (
                <button className="btn btn-outline" style={{ background: '#fff', fontSize: '0.85rem' }} onClick={() => speak(testContent.rawExpected, current.record, 'focusExpression', 'student')}>🎤 My Voice</button>
              )}
            </div>
          </div>
        </div>

        {showHints && current.task.hint && (
          <div style={{ marginTop: '1.5rem', padding: '1.25rem', background: '#fffbeb', border: '1px solid #fef3c7', borderRadius: '12px', textAlign: 'left' }}>
            <p style={{ margin: 0, fontWeight: 'bold', color: '#92400e' }}>💡 Hint:</p>
            <p style={{ margin: '0.5rem 0', color: '#b45309' }}>{current.task.hint}</p>
            <button className="btn btn-primary" style={{ width: '100%', marginTop: '0.75rem' }} onClick={handleNext}>
              {currentIndex < practiceQueue.length - 1 ? 'Try Next Item' : 'Finish Practice'}
            </button>
          </div>
        )}
      </>
    );
  };

  return (
    <div style={{ maxWidth: '600px', margin: '2rem auto' }}>
      <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <button
            className="btn btn-outline"
            style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', border: 'none' }}
            onClick={() => setMode('selection')}
          >
            ← Exit Practice
          </button>
          <h1 style={{ margin: '0.5rem 0 0' }}>{mode === 'flashcard' ? 'Flashcard Practice' : 'Self Test'}</h1>
        </div>
        <span className="status-badge" style={{ background: '#f1f5f9' }}>{currentIndex + 1} / {practiceQueue.length}</span>
      </div>

      {mode === 'flashcard' ? (
        <div style={{ textAlign: 'center' }}>
          <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'center', gap: '0.5rem' }}>
            <button
              className={`btn ${fcDirection === 'auto' ? 'btn-primary' : 'btn-outline'}`}
              style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }}
              onClick={() => setFcDirection('auto')}
            >
              Auto
            </button>
            <button
              className={`btn ${fcDirection === 'l1-l2' ? 'btn-primary' : 'btn-outline'}`}
              style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }}
              onClick={() => setFcDirection('l1-l2')}
            >
              L1 → L2
            </button>
            <button
              className={`btn ${fcDirection === 'l2-l1' ? 'btn-primary' : 'btn-outline'}`}
              style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }}
              onClick={() => setFcDirection('l2-l1')}
            >
              L2 → L1
            </button>
          </div>

          <div className={`flip-card ${isFlipped ? 'flipped' : ''}`} onClick={() => setIsFlipped(!isFlipped)}>
            <div className="flip-card-inner">
              <div className="flip-card-front">
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '2rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  {fcContent.labelFront}
                </p>
                <div style={{ fontSize: '2.5rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100px' }}>{fcContent.front}</div>
                <p style={{ marginTop: '2rem', color: 'var(--primary)', fontSize: '0.9rem' }}>Click to flip</p>
              </div>
              <div className="flip-card-back">
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '2rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  {fcContent.labelBack}
                </p>
                <div style={{ fontSize: '2rem', color: 'var(--text-main)', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100px' }}>{fcContent.back}</div>
                <div style={{ marginTop: '3rem', display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
                  <button
                    className="btn btn-outline"
                    style={{ background: 'white', fontSize: '0.85rem', padding: '0.4rem 0.8rem' }}
                    onClick={(e) => { e.stopPropagation(); speak(fcContent.audioText, current.record, fcContent.audioType, 'ai'); }}
                  >
                    🤖 AI Voice
                  </button>
                  {(current.record.audioUrls?.studentWord || current.record.audioUrls?.focusExpression || current.record.audioUrls?.word) && (
                    <button
                      className="btn btn-outline"
                      style={{ background: 'white', fontSize: '0.85rem', padding: '0.4rem 0.8rem' }}
                      onClick={(e) => { e.stopPropagation(); speak(fcContent.audioText, current.record, fcContent.audioType, 'student'); }}
                    >
                      🎤 My Voice
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div style={{ marginTop: '2rem' }}>
            <button className="btn btn-primary" style={{ width: '100%', padding: '1rem' }} onClick={handleNext}>
              {currentIndex < practiceQueue.length - 1 ? 'Next Card' : 'Finish Practice'}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ textAlign: 'center' }}>
          <div style={{ marginBottom: '2rem', background: '#f8fafc', padding: '1.25rem', borderRadius: '16px', border: '1px solid var(--border)', display: 'flex', flexWrap: 'wrap', gap: '1.5rem', justifyContent: 'center', alignItems: 'flex-end' }}>
            <div style={{ flex: '1', minWidth: '150px' }}>
              <p style={{ margin: '0 0 0.5rem', fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Direction</p>
              <div style={{ display: 'flex', background: '#e2e8f0', padding: '0.2rem', borderRadius: '8px' }}>
                {[
                  { id: 'l1-l2', label: 'L1 → L2' },
                  { id: 'l2-l1', label: 'L2 → L1' }
                ].map(d => (
                  <button
                    key={d.id}
                    className="btn"
                    style={{
                      flex: '1',
                      padding: '0.4rem 0.8rem',
                      fontSize: '0.8rem',
                      border: 'none',
                      background: testDirection === d.id ? '#fff' : 'transparent',
                      color: testDirection === d.id ? 'var(--primary)' : 'var(--text-muted)',
                      boxShadow: testDirection === d.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                      fontWeight: testDirection === d.id ? 'bold' : 'normal'
                    }}
                    onClick={() => setTestDirection(d.id as any)}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ flex: '1', minWidth: '150px' }}>
              <p style={{ margin: '0 0 0.5rem', fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Answer Mode</p>
              <div style={{ display: 'flex', background: '#e2e8f0', padding: '0.2rem', borderRadius: '8px' }}>
                {['voice', 'type'].map(m => (
                  <button
                    key={m}
                    className="btn"
                    style={{
                      flex: '1',
                      padding: '0.4rem 0.8rem',
                      fontSize: '0.8rem',
                      border: 'none',
                      background: answerMode === m ? '#fff' : 'transparent',
                      color: answerMode === m ? 'var(--primary)' : 'var(--text-muted)',
                      boxShadow: answerMode === m ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                      fontWeight: answerMode === m ? 'bold' : 'normal'
                    }}
                    onClick={() => {
                      setAnswerMode(m as any);
                      setValidationError(null);
                    }}
                  >
                    {m.charAt(0).toUpperCase() + m.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* AI Voice Preference Selector */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', marginBottom: '2rem', padding: '0.5rem 1rem', background: '#f1f5f9', borderRadius: '20px' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-muted)' }}>AI Voice:</span>
            {(['system', 'female', 'male'] as const).map(p => (
              <button
                key={p}
                onClick={() => setVoicePref(p)}
                style={{
                  padding: '0.2rem 0.6rem',
                  fontSize: '0.7rem',
                  border: 'none',
                  borderRadius: '12px',
                  cursor: 'pointer',
                  background: voicePref === p ? 'var(--primary)' : 'transparent',
                  color: voicePref === p ? '#fff' : 'var(--text-muted)',
                  fontWeight: voicePref === p ? 'bold' : 'normal',
                  textTransform: 'capitalize'
                }}
              >
                {p}
              </button>
            ))}
          </div>

          <div className="card" style={{ textAlign: 'center', minHeight: '400px', display: 'flex', flexDirection: 'column', justifyContent: 'center', position: 'relative' }}>
            <p style={{ color: 'var(--text-muted)', fontWeight: 'bold', fontSize: '0.75rem', letterSpacing: '0.1em', margin: 0 }}>TASK PROMPT</p>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
              {testContent.instruction}
            </p>
            <div style={{ fontSize: '2rem', margin: '0 0 2rem', fontWeight: 'bold', color: 'var(--primary)' }}>
              {testContent.prompt}
            </div>

            {renderTestInput()}
          </div>
        </div>
      )}
    </div>
  );
}
