import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getStudentFlashcards, mapFirestoreToLocal, logRetrievalAttempt } from '../lib/firebaseDb';
import { db } from '../lib/db';
import { LearningItem, StudentLearningRecord, ChunkItem, ReadingItem, ChunkRecord } from '../lib/types';
import { retrievalEngine } from '../lib/retrievable/retrievalEngine';
import { assignmentStore } from '../lib/retrievable/assignmentStore';
import { templateBank } from '../lib/retrievable/templateBank';
import { GeneratedTask } from '../lib/retrievable/types';
import { playUnifiedAudio } from '../lib/audioUtils';
import { evaluateTypedAnswer } from '../lib/aiService';
import { startSafeMediaRecorder } from '../lib/audioRecorderUtils';

export default function TonePractice() {
  const navigate = useNavigate();
  const { studentId: routeStudentId } = useParams<{ studentId: string }>();
  const studentId = routeStudentId || db.getCurrentUserId();
  const [practiceQueue, setPracticeQueue] = useState<{ item: LearningItem, record: StudentLearningRecord, task: GeneratedTask }[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  // Self Test states
  const [typedAnswer, setTypedAnswer] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error', msg: string } | null>(null);
  const [showHints, setShowHints] = useState(false);
  const answerMode = 'voice';
  const [promptMode, setPromptMode] = useState<'meaning' | 'pronunciation'>('meaning');
  const [isRecording, setIsRecording] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [recordedBlobUrl, setRecordedBlobUrl] = useState<string | null>(null);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState('');
  const [recognition, setRecognition] = useState<any>(null);
  const [voicePref, setVoicePref] = useState<'female' | 'male' | 'system'>('system');

  useEffect(() => {
    const sId = routeStudentId || db.getCurrentUserId();
    if (!sId) return;

    // Sync session from route
    if (routeStudentId) db.setCurrentUserId(routeStudentId);

    console.log(`[DEBUG] RetrievalPractice loading for studentId: ${sId}`);

    const loadData = async () => {
      try {
        // 1. Fetch Cloud Records (Source of Truth)
        console.log(`[DEBUG] RetrievalPractice fetching from Firebase...`);
        const cloudDocs = await getStudentFlashcards(sId);
        console.log(`[DEBUG] Firebase records count fetched: ${cloudDocs.length}`);

        const cloudPairs = cloudDocs.map(doc => mapFirestoreToLocal(doc));

        // 2. Sync local db with Firebase
        const studentRecords = db.getLearningRecords().filter(r => r.studentId === sId);
        const cloudItemIds = new Set(cloudPairs.map(p => p.item.id));
        
        const staleLocalRecords = studentRecords.filter(r => !cloudItemIds.has(r.learningItemId));
        if (staleLocalRecords.length > 0) {
          console.log(`[DEBUG] Removing ${staleLocalRecords.length} stale local records missing from Firebase`);
          staleLocalRecords.forEach(r => db.deleteLearningRecord(r.id));
        }

        cloudPairs.forEach(pair => {
          db.updateLearningItem(pair.item);
          db.saveLearningRecord(pair.record);
        });

        // 3. Prepare Queue
        const syncedTemplates = templateBank.getSynced();
        const globallyEnabledIds = new Set(syncedTemplates.filter(t => t.enabled).map(t => t.template_id));
        const syncedAssignment = assignmentStore.getSyncedByStudentId(sId);

        let enabledTemplateIds: string[] = [];
        if (syncedAssignment?.template_ids && syncedAssignment.template_ids.length > 0) {
          enabledTemplateIds = syncedAssignment.template_ids.filter(id => globallyEnabledIds.has(id));
        } else {
          enabledTemplateIds = ['tA', 'tB', 'tD', 'tS'].filter(id => globallyEnabledIds.has(id));
        }

        const encodedItems = cloudPairs
          .filter(pair => {
            const isDone = pair.record.encodingStatus === 'done' || pair.record.encodingCompleted || pair.record.isConnectionBuilt;
            return isDone;
          })
          .map(pair => {
            const { item, record } = pair;
            let task: GeneratedTask | null = null;
            const templateId = enabledTemplateIds[Math.floor(Math.random() * enabledTemplateIds.length)];
            const syncedTemplate = syncedTemplates.find(t => t.template_id === templateId);

            if (syncedTemplate) {
              task = retrievalEngine.generateTask(item.id, templateId, syncedTemplate);
            }

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
          });

        const addedIds = new Set<string>();
        const dueItems: any[] = [];
        const weakItems: any[] = [];
        const extraItems: any[] = [];

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
        console.log(`[DEBUG] RetrievalPractice Page - studentId: ${sId}`);
        console.log(`[DEBUG] RetrievalPractice - Firebase flashcards count: ${cloudPairs.length}`);
        
        encodedItems.forEach((p, idx) => {
           console.log(`[DEBUG]   Item ${idx}: ${p.item.focusExpression}, retrievalCount: ${p.record.retrievalCount}, historyLength: ${(p.record as any).retrievalHistory?.length || 0}`);
        });

        console.log(`[DEBUG] RetrievalPractice final queue count: ${finalQueue.length}`);
        setPracticeQueue(finalQueue);
        // We'll also store the total count for the empty state message
        (window as any)._retrievalTotalCount = cloudPairs.length;
        (window as any)._retrievalReadyCount = encodedItems.length;
      } catch (err) {
        console.error('[DEBUG] Failed to load data from Firebase:', err);
      }
    };

    loadData();
  }, [routeStudentId]);

  const handleNext = () => {
    if (currentIndex < practiceQueue.length - 1) {
      setCurrentIndex(i => i + 1);
      setTypedAnswer('');
      setFeedback(null);
      setShowHints(false);
      setIsRecording(false);
      setIsEvaluating(false);
      setRecordedBlobUrl(null);
      setValidationError(null);
      setTranscript('');
    } else {
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
    const aiDirection = 'en-zh';

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

      // REQUIREMENT: Log retrieval to Firebase
      logRetrievalAttempt(studentId as string, {
        targetExpression: (item as ChunkItem).focusExpression,
        targetText: (item as ChunkItem).targetText,
        meaning: (item as ChunkItem).chunkTranslation,
        practiceMode: 'selfTest',
        direction: promptMode === 'meaning' ? 'L1_TO_L2' : 'L2_TO_L2',
        isCorrect: result.passed,
        studentAnswer: studentAnswer,
        expectedAnswer: testContent.rawExpected
      }, currentPair.record as any).catch(err => console.error('[DEBUG] Failed to log retrieval to Firebase:', err));

      if (result.passed) {
        setFeedback({ type: 'success', msg: result.feedback || '✅ Correct!' });
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
        const { recorder, mimeType } = await startSafeMediaRecorder(stream);
        const chunks: Blob[] = [];
        recorder.ondataavailable = (e) => chunks.push(e.data);
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: mimeType });
          setRecordedBlobUrl(URL.createObjectURL(blob));
          setValidationError(null);
        };
        recorder.start();
        setMediaRecorder(recorder);

        if (SpeechRecognition) {
          const recognizer = new SpeechRecognition();
          // Tone Practice always expects Chinese speech
          recognizer.lang = 'zh-TW';
          
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
      } catch (err: any) {
        console.error("Failed to start recording:", err);
        setValidationError(`Recording failed: ${err.message || 'Microphone access denied'}`);
      }
    }
  };

  const getTtsText = (item: LearningItem, record: StudentLearningRecord, type: 'focusExpression' | 'chunk'): string => {
    const isChineseLearner = item.languageDirection === 'zh-en';
    const chunkItem = item as ChunkItem;
    const chunkRecord = record as ChunkRecord;

    if (isChineseLearner) {
      if (type === 'focusExpression') {
        // Preference: targetText (Chinese characters) > targetExpression (Pinyin)
        return chunkRecord?.studentConnections?.targetText || chunkItem?.targetText || chunkItem?.focusExpression || '';
      } else {
        // Preference: contextText (Chinese sentence) > context (Pinyin sentence)
        return chunkRecord?.studentConnections?.contextText || chunkItem?.contextText || chunkItem?.chunk || '';
      }
    } else {
      // English learner: use standard fields
      if (type === 'focusExpression') {
        return chunkItem?.focusExpression || '';
      } else {
        return chunkItem?.chunk || '';
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
    if (record && (type === 'focusExpression' || type === 'chunk')) {
      ttsText = getTtsText(currentItem, record, type);
    }
    
    if (ttsText) {
      playUnifiedAudio(ttsText, undefined, lang, voicePref);
    }
  };



  const totalCount = (window as any)._retrievalTotalCount || 0;
  const readyCount = (window as any)._retrievalReadyCount || 0;

  if (practiceQueue.length === 0) {
    return (
      <div style={{ maxWidth: '600px', margin: '4rem auto', textAlign: 'center' }} className="card">
        {totalCount === 0 ? (
          <>
            <h2>📭 Your Library is Empty</h2>
            <p>Go to the home page to add some cards first!</p>
          </>
        ) : (
          <>
            <h2>🎉 All Caught Up!</h2>
            <p>You have <strong>{totalCount}</strong> cards in your library.</p>
            <p style={{ margin: '1rem 0' }}>
              ✅ {readyCount} Ready to Practice<br />
              ⏳ {totalCount - readyCount} Not Ready (Complete encoding missions first)
            </p>
            {readyCount === 0 && (
              <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', padding: '1rem', borderRadius: '12px', margin: '1.5rem 0', color: '#92400e' }}>
                <p style={{ fontSize: '0.9rem', margin: 0 }}>
                  <strong>Note:</strong> You must finish the encoding missions for your new cards before they appear here for retrieval.
                </p>
              </div>
            )}
          </>
        )}
        <button className="btn btn-primary" onClick={() => navigate(`/student/${studentId}`)}>Back to Dashboard</button>
      </div>
    );
  }

  const current = practiceQueue[currentIndex];





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

    if (promptMode === 'meaning') {
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
        expected: l2,
        rawExpected: l2,
        displayExpected: formattedL2,
        instruction: 'Read the Chinese characters'
      };
    }
  };


  const testContent = getTestContent();

  const renderTestInput = () => {
    const current = practiceQueue[currentIndex];
    if (!current) return null;
    const isChineseLearner = current.item.languageDirection === 'zh-en';

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
                      "You said: {isChineseLearner && transcript === ((current.item as ChunkItem).targetText || (current.record as any).targetText) ? `${(current.item as ChunkItem).focusExpression} / ${transcript}` : transcript}"
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
          
          <div style={{ margin: '1rem 0', background: '#f8fafc', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border)', textAlign: 'left' }}>
            <p style={{ margin: '0 0 0.5rem', fontWeight: 'bold', color: 'var(--text-muted)', fontSize: '0.8rem', textTransform: 'uppercase' }}>Your Answer:</p>
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>
                {answerMode === 'voice' && transcript ? (
                  isChineseLearner && transcript === ((current.item as ChunkItem).targetText || (current.record as any).targetText) 
                    ? `${(current.item as ChunkItem).focusExpression} / ${transcript}` 
                    : transcript
                ) : typedAnswer}
              </div>
              {recordedBlobUrl && (
                <button className="btn btn-outline" style={{ background: '#fff', padding: '0.3rem 0.6rem', fontSize: '0.8rem' }} onClick={playRecording}>
                  🔊 Play Your Answer
                </button>
              )}
            </div>

            <p style={{ margin: '0 0 0.5rem', fontWeight: 'bold', color: 'var(--text-muted)', fontSize: '0.8rem', textTransform: 'uppercase' }}>Expected Answer:</p>
            <div style={{ marginBottom: '1rem' }}>{testContent.displayExpected}</div>
            
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-start', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
              <button className="btn btn-outline" style={{ background: '#fff', fontSize: '0.85rem' }} onClick={() => speak(testContent.rawExpected, current.record, 'focusExpression', 'ai')}>🤖 AI Voice</button>
              {(current.record.audioUrls?.studentWord || current.record.audioUrls?.focusExpression || current.record.audioUrls?.word) && (
                <button className="btn btn-outline" style={{ background: '#fff', fontSize: '0.85rem' }} onClick={() => speak(testContent.rawExpected, current.record, 'focusExpression', 'student')}>🎤 My Voice</button>
              )}
            </div>
          </div>
        </div>

        {feedback && (
          <div style={{ marginTop: '1.5rem' }}>
            <button className="btn btn-primary" style={{ width: '100%', padding: '1rem' }} onClick={handleNext}>
              {currentIndex < practiceQueue.length - 1 ? 'Next Card' : 'Finish Practice'}
            </button>
          </div>
        )}

        {feedback.type === 'error' && showHints && current.task.hint && (
          <div style={{ marginTop: '1.5rem', padding: '1.25rem', background: '#fffbeb', border: '1px solid #fef3c7', borderRadius: '12px', textAlign: 'left' }}>
            <p style={{ margin: 0, fontWeight: 'bold', color: '#92400e' }}>💡 Hint:</p>
            <p style={{ margin: '0.5rem 0', color: '#b45309' }}>{current.task.hint}</p>
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
            onClick={() => navigate(`/student/${studentId}`)}
          >
            ← Exit Practice
          </button>
          <h1 style={{ margin: '0.5rem 0 0' }}>Tone Practice</h1>
        </div>
        <span className="status-badge" style={{ background: '#f1f5f9' }}>{currentIndex + 1} / {practiceQueue.length}</span>
      </div>


        <div style={{ textAlign: 'center' }}>
          <div style={{ marginBottom: '2rem', background: '#f8fafc', padding: '1.25rem', borderRadius: '16px', border: '1px solid var(--border)', display: 'flex', flexWrap: 'wrap', gap: '1.5rem', justifyContent: 'center', alignItems: 'flex-end' }}>
            <div style={{ flex: '1', minWidth: '150px' }}>
              <p style={{ margin: '0 0 0.5rem', fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Prompt Mode</p>
              <div style={{ display: 'flex', background: '#e2e8f0', padding: '0.2rem', borderRadius: '8px' }}>
                {[
                  { id: 'meaning', label: 'Meaning' },
                  { id: 'pronunciation', label: 'Pronunciation' }
                ].map(d => (
                  <button
                    key={d.id}
                    className="btn"
                    style={{
                      flex: '1',
                      padding: '0.4rem 0.8rem',
                      fontSize: '0.8rem',
                      border: 'none',
                      background: promptMode === d.id ? '#fff' : 'transparent',
                      color: promptMode === d.id ? 'var(--primary)' : 'var(--text-muted)',
                      boxShadow: promptMode === d.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                      fontWeight: promptMode === d.id ? 'bold' : 'normal'
                    }}
                    onClick={() => setPromptMode(d.id as any)}
                  >
                    {d.label}
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

            {/* Reserved Visualization Container for Future Tone Analysis */}
            <div style={{ 
              margin: '0 auto 2rem', 
              width: '100%', 
              maxWidth: '600px', 
              height: '150px', 
              background: '#f8fafc', 
              borderRadius: '12px', 
              border: '1px dashed var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
              fontSize: '0.9rem'
            }}>
              Visualization Area (Reserved for Future Tone Curves)
            </div>

            {renderTestInput()}
          </div>
        </div>

    </div>
  );
}
