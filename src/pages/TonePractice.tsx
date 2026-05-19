import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getStudentFlashcards, mapFirestoreToLocal, logRetrievalAttempt, uploadAsset, logToneAttempt } from '../lib/firebaseDb';
import { db } from '../lib/db';
import { LearningItem, StudentLearningRecord, ChunkItem, ReadingItem } from '../lib/types';
import { retrievalEngine } from '../lib/retrievable/retrievalEngine';
import { assignmentStore } from '../lib/retrievable/assignmentStore';
import { templateBank } from '../lib/retrievable/templateBank';
import { GeneratedTask } from '../lib/retrievable/types';
import { evaluateTypedAnswer } from '../lib/aiService';

const SPEECH_API_BASE = (import.meta as any).env.VITE_SPEECH_API_BASE || "http://localhost:8000";

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
  const [validationError, setValidationError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState('');
  const [voicePref, setVoicePref] = useState<'female' | 'male' | 'system'>('system');
  const [targetCurve, setTargetCurve] = useState<number[]>([]);
  const [userCurve, setUserCurve] = useState<number[]>([]);
  const [processedUserCurve, setProcessedUserCurve] = useState<number[]>([]);
  const [pipelineVersion, setPipelineVersion] = useState<'v1' | 'v2' | 'v3' | 'v4'>('v3');
  const [matchScore, setMatchScore] = useState<number | null>(null);
  const [isScoringLoading, setIsScoringLoading] = useState(false);

  const [currentRecordingInfo, setCurrentRecordingInfo] = useState<{
    blob: Blob | null;
    attemptId: string | null;
    audioUrl: string | null;
    isUploading: boolean;
    uploadError: boolean;
    mimeType: string | null;
  }>({
    blob: null,
    attemptId: null,
    audioUrl: null,
    isUploading: false,
    uploadError: false,
    mimeType: null
  });
  const [selectedRating, setSelectedRating] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const toneWsRef = useRef<WebSocket | null>(null);
  const toneCtxRef = useRef<AudioContext | null>(null);
  const toneProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const toneMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStartTimeRef = useRef<number>(0);

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

  useEffect(() => {
    const current = practiceQueue[currentIndex];
    if (!current) return;

    const urls = current.record?.audioUrls;
    const audioUrl = urls?.studentWord ||
      urls?.word ||
      urls?.studentChunk ||
      urls?.chunk ||
      urls?.focusExpression ||
      urls?.aiWord ||
      urls?.aiChunk;

    console.log("🌐 [DEBUG] Auto-load check, resolved audioUrl:", audioUrl);
    if (audioUrl) {
      fetchTargetCurveFromUrl(audioUrl);
    } else {
      setTargetCurve([]);
    }
  }, [currentIndex, practiceQueue]);

  const recordingInfoRef = useRef(currentRecordingInfo);
  useEffect(() => {
    recordingInfoRef.current = currentRecordingInfo;
  }, [currentRecordingInfo]);

  const resetToneStates = () => {
    setTypedAnswer('');
    setFeedback(null);
    setShowHints(false);
    setIsRecording(false);
    setIsEvaluating(false);
    setRecordedBlobUrl(null);
    setValidationError(null);
    setTranscript('');
    setUserCurve([]);
    setProcessedUserCurve([]);
    setMatchScore(null);
    setIsScoringLoading(false);
    setSelectedRating(null);
    setIsSaving(false);
    setCurrentRecordingInfo({
      blob: null,
      attemptId: null,
      audioUrl: null,
      isUploading: false,
      uploadError: false,
      mimeType: null
    });
  };

  const handleReRecord = () => {
    resetToneStates();
  };

  const RATING_OPTIONS = [
    { rating: 1, label: "Not familiar yet" },
    { rating: 2, label: "Getting better" },
    { rating: 3, label: "Good" },
    { rating: 4, label: "Very confident" }
  ];

  const handleSaveAndNext = async () => {
    if (selectedRating === null) {
      setValidationError("Please select how you feel about this attempt.");
      return;
    }

    const currentPair = practiceQueue[currentIndex];
    if (!currentPair) return;

    setIsSaving(true);
    setValidationError(null);

    let audioUrl = recordingInfoRef.current.audioUrl;
    let uploadError = recordingInfoRef.current.uploadError;

    if (recordingInfoRef.current.isUploading) {
      console.log("[DEBUG] Audio upload still in progress. Waiting up to 10 seconds...");
      try {
        await new Promise<void>((resolve) => {
          let checkCount = 0;
          const interval = setInterval(() => {
            checkCount++;
            if (!recordingInfoRef.current.isUploading) {
              clearInterval(interval);
              audioUrl = recordingInfoRef.current.audioUrl;
              uploadError = recordingInfoRef.current.uploadError;
              resolve();
            } else if (checkCount > 100) {
              clearInterval(interval);
              uploadError = true;
              resolve();
            }
          }, 100);
        });
      } catch (e) {
        uploadError = true;
      }
    }

    const ratingOption = RATING_OPTIONS.find(o => o.rating === selectedRating);
    const selfRatingLabel = ratingOption ? ratingOption.label : "";

    try {
      await logToneAttempt(
        studentId as string,
        {
          audioUrl: audioUrl || null,
          audioMimeType: recordingInfoRef.current.mimeType || null,
          uploadError: uploadError || undefined,
          selectedPipelineVersion: pipelineVersion,
          processedUserCurve: processedUserCurve,
          targetCurve: targetCurve || undefined,
          selfRating: selectedRating,
          selfRatingLabel,
          score: matchScore
        },
        currentPair.record as any
      );

      console.log("✅ [DEBUG] Tone attempt logged successfully in Firestore");

      if (currentIndex < practiceQueue.length - 1) {
        setCurrentIndex(i => i + 1);
        resetToneStates();
      } else {
        setCurrentIndex(0);
        setPracticeQueue([]);
        window.location.reload();
      }
    } catch (err: any) {
      console.error("❌ [DEBUG] Failed to save tone attempt:", err);
      setValidationError("Failed to save attempt. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handlePrevCard = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      resetToneStates();
    }
  };

  const handleNextCard = () => {
    if (currentIndex < practiceQueue.length - 1) {
      setCurrentIndex(currentIndex + 1);
      resetToneStates();
    }
  };

  const submitEval = async () => {
    setIsEvaluating(true);
    setValidationError(null);

    // 💡 Tone 模式下略過 AI 評分，直接設為成功
    setFeedback({ type: 'success', msg: 'Tone practice recorded' });
    setIsEvaluating(false);
    return;

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

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve(reader.result as string);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const getExtensionFromMimeType = (mimeType: string): string => {
    if (!mimeType) return 'webm';
    const type = mimeType.toLowerCase();
    if (type.includes('audio/webm') || type.includes('video/webm')) return 'webm';
    if (type.includes('audio/mp4') || type.includes('video/mp4')) return 'mp4';
    if (type.includes('audio/mpeg') || type.includes('audio/mp3')) return 'mp3';
    if (type.includes('audio/wav') || type.includes('audio/x-wav')) return 'wav';
    if (type.includes('audio/ogg')) return 'ogg';
    if (type.includes('audio/x-m4a') || type.includes('audio/aac') || type.includes('audio/m4a')) return 'm4a';
    return 'webm';
  };

  const startBackgroundAudioUpload = async (blob: Blob) => {
    const currentPair = practiceQueue[currentIndex];
    if (!currentPair) return;

    const randomSuffix = Math.floor(Math.random() * 10000);
    const attemptId = `attempt_${Date.now()}_${randomSuffix}`;
    const ext = getExtensionFromMimeType(blob.type);
    const mimeType = blob.type || 'audio/webm';
    const storagePath = `studentAudio/${studentId}/${currentPair.item.id}/toneAttempts/${attemptId}.${ext}`;

    setCurrentRecordingInfo({
      blob,
      attemptId,
      audioUrl: null,
      isUploading: true,
      uploadError: false,
      mimeType
    });

    try {
      console.log(`[DEBUG] Starting background audio upload. Path: ${storagePath}, MIME: ${mimeType}`);
      const base64 = await blobToBase64(blob);
      const audioUrl = await uploadAsset(base64, storagePath);
      console.log("✅ [DEBUG] Background audio upload success:", audioUrl);
      
      setCurrentRecordingInfo(prev => {
        if (prev.attemptId === attemptId) {
          return { ...prev, audioUrl, isUploading: false, uploadError: false };
        }
        return prev;
      });
    } catch (err: any) {
      console.error("❌ [DEBUG] Background audio upload failed:", err);
      setCurrentRecordingInfo(prev => {
        if (prev.attemptId === attemptId) {
          return { ...prev, isUploading: false, uploadError: true };
        }
        return prev;
      });
    }
  };

  const startToneRecording = async () => {
    try {
      // 1. Log diagnostics & MediaRecorder support info
      const ua = navigator.userAgent;
      const hasMediaRecorder = typeof MediaRecorder !== 'undefined';
      console.log(`[DIAGNOSTICS] User Agent: ${ua}`);
      console.log(`[DIAGNOSTICS] MediaRecorder available: ${hasMediaRecorder}`);

      const candidateMimeTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4;codecs=mp4a.40.2',
        'audio/mp4',
        'audio/aac',
        'audio/wav'
      ];
      const supportedTypes = candidateMimeTypes.filter(type => {
        return hasMediaRecorder && typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(type);
      });
      console.log(`[DIAGNOSTICS] Supported MIME types:`, supportedTypes);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Determine preferred MIME type options
      const options: MediaRecorderOptions = {};
      if (supportedTypes.length > 0) {
        options.mimeType = supportedTypes[0];
      }
      console.log(`[DIAGNOSTICS] Selected MIME type option: ${options.mimeType || 'default'}`);

      const recorder = new MediaRecorder(stream, options);
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunks.push(e.data);
          console.log(`[DIAGNOSTICS] Chunk received - size: ${e.data.size} bytes, type: ${e.data.type}`);
        }
      };

      recorder.onstop = async () => {
        // Safari may trigger onstop before all chunks are pushed or flushed.
        // Wait 150ms to allow final chunk in the stream buffer to be fully processed by ondataavailable.
        await new Promise(resolve => setTimeout(resolve, 150));

        const finalMimeType = recorder.mimeType || options.mimeType || 'audio/webm';
        const durationSec = (Date.now() - recordingStartTimeRef.current) / 1000;
        
        console.log(`[DIAGNOSTICS] Recording stopped.`);
        console.log(`[DIAGNOSTICS] Chunks collected: ${chunks.length}`);
        console.log(`[DIAGNOSTICS] Calculated Duration: ${durationSec.toFixed(2)}s`);
        console.log(`[DIAGNOSTICS] Recorder mimeType: ${recorder.mimeType}`);

        const blob = new Blob(chunks, { type: finalMimeType });
        console.log(`[DIAGNOSTICS] Created Blob - size: ${blob.size} bytes, type: ${blob.type}`);

        // Validate blob size & duration
        if (blob.size < 1000) {
          console.error(`❌ [DIAGNOSTICS] Validation failed: Audio blob size is too small (${blob.size} bytes).`);
          setValidationError("Recording failed: No audio captured. Please check your microphone and try again.");
          return;
        }

        // Local playback validation
        console.log(`[DIAGNOSTICS] Starting local playback validation...`);
        const validation = await new Promise<{ isValid: boolean; error?: string; duration?: number }>((resolve) => {
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          audio.muted = true;

          const cleanup = () => {
            audio.removeEventListener('loadedmetadata', onLoaded);
            audio.removeEventListener('error', onError);
            URL.revokeObjectURL(url);
          };

          const onLoaded = () => {
            const dur = audio.duration;
            cleanup();
            if (isNaN(dur) || dur === 0 || dur === Infinity) {
              resolve({ isValid: false, error: `Invalid audio duration (${dur}s)`, duration: dur });
            } else {
              resolve({ isValid: true, duration: dur });
            }
          };

          const onError = () => {
            cleanup();
            resolve({ isValid: false, error: `Browser audio decoder error (code: ${audio.error?.code}, message: ${audio.error?.message})` });
          };

          audio.addEventListener('loadedmetadata', onLoaded);
          audio.addEventListener('error', onError);
          audio.load();

          // Safety timeout to prevent hanging the UI in case of autoplay policy blocks
          setTimeout(() => {
            cleanup();
            resolve({ isValid: true, duration: 0, isFallback: true } as any);
          }, 1500);
        });

        if (!validation.isValid) {
          console.error(`❌ [DIAGNOSTICS] Local validation failed: ${validation.error}`);
          setValidationError(`Recording failed: Audio file is corrupted or silent. (${validation.error})`);
          return;
        }

        console.log(`✅ [DIAGNOSTICS] Local validation passed successfully. Duration: ${validation.duration}s`);

        const url = URL.createObjectURL(blob);
        setRecordedBlobUrl(url);
        fetchProcessedUserCurve(blob);
        startBackgroundAudioUpload(blob);
      };

      // Record start time
      recordingStartTimeRef.current = Date.now();
      
      // Start recording with 250ms timeslice to flush chunks periodically
      recorder.start(250);
      toneMediaRecorderRef.current = recorder;

      // 🔥 建立 WebSocket
      const ws = new WebSocket(SPEECH_API_BASE.replace('http', 'ws') + "/ws/pitch");
      ws.binaryType = "arraybuffer";
      toneWsRef.current = ws;

      ws.onmessage = (event) => {
        const pitch = JSON.parse(event.data);
        // 🔥 即時更新藍線 (直接複製 Demo)
        setUserCurve(prev => [...prev, ...pitch].slice(-140));
      };

      // 🔥 關鍵：強制指定 16000 採樣率
      const audioContext = new AudioContext({ sampleRate: 16000 });
      toneCtxRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);

      const processor = audioContext.createScriptProcessor(1024, 1, 1);
      toneProcessorRef.current = processor;

      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        if (ws.readyState === 1) {
          ws.send(input.buffer); // 🔥 直接送 float32
        }
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      setUserCurve([]); // 🔥 清空舊曲線
      setIsRecording(true);
      setRecordedBlobUrl(null);
      setValidationError(null);

    } catch (err: any) {
      console.error("Failed to start tone recording:", err);
      setValidationError(`Recording failed: ${err.message || 'Microphone access denied'}`);
    }
  };

  const stopToneRecording = () => {
    if (!isRecording) return;

    if (toneMediaRecorderRef.current && toneMediaRecorderRef.current.state !== "inactive") {
      toneMediaRecorderRef.current.stop();
    }

    if (toneProcessorRef.current) {
      toneProcessorRef.current.disconnect();
    }

    setTimeout(() => {
      const currentWs = toneWsRef.current;
      if (currentWs && currentWs.readyState === WebSocket.OPEN) {
        currentWs.close(1000, "Normal Closure");
      }
    }, 50);

    try {
      if (toneCtxRef.current && toneCtxRef.current.state !== 'closed') {
        toneCtxRef.current.close();
      }

      if (toneMediaRecorderRef.current && toneMediaRecorderRef.current.stream) {
        toneMediaRecorderRef.current.stream.getTracks().forEach(track => {
          track.stop();
        });
      }
    } catch (e) {
      console.error("Cleanup error:", e);
    }

    setIsRecording(false);
  };

  // getTtsText was removed because it was unused and caused build errors.

  const renderPitchLine = (data: number[], color: string, strokeWidth: number, opacity = 1) => {
    if (!Array.isArray(data) || data.length < 2) return null;

    const SVG_WIDTH = 500;
    const SVG_HEIGHT = 300;
    const MIDDLE_Y = 150; // Center for 300px height
    const SAFE_TOP = 12;
    const SAFE_BOTTOM = SVG_HEIGHT - 12;

    const validPoints = data.filter(v => v > 0);
    if (validPoints.length === 0) return null;
    const avg = validPoints.reduce((a, b) => a + b, 0) / validPoints.length;

    const stepX = SVG_WIDTH / (data.length - 1);

    return data.map((v, i) => {
      if (i === 0 || v <= 0 || data[i - 1] <= 0) return null;

      let y1 = MIDDLE_Y - (data[i - 1] - avg) * 6;
      let y2 = MIDDLE_Y - (v - avg) * 6;

      // Clamp values to keep inside chart
      y1 = Math.max(SAFE_TOP, Math.min(SAFE_BOTTOM, y1));
      y2 = Math.max(SAFE_TOP, Math.min(SAFE_BOTTOM, y2));

      return (
        <line
          key={`${color}-${i}`}
          x1={(i - 1) * stepX}
          y1={y1}
          x2={i * stepX}
          y2={y2}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          style={{ opacity, transition: 'all 0.05s linear' }}
        />
      );
    });
  };

  const fetchTargetCurveFromUrl = async (audioUrl: string) => {
    console.log("🌐 [DEBUG] Fetching baseline curve for:", audioUrl);
    try {
      const res = await fetch(`${SPEECH_API_BASE}/get_pitch_from_url_v3`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          audio_url: audioUrl
        })
      });

      const curve = await res.json();
      setTargetCurve(curve);
      console.log("✅ [DEBUG] Target curve loaded:", curve.length);
    } catch (err) {
      console.error("❌ [DEBUG] Failed to fetch target curve:", err);
    }
  };

  const fetchProcessedUserCurve = async (blob: Blob) => {
    let endpoint = '/get_pitch_v3';
    if (pipelineVersion === 'v1') endpoint = '/get_pitch';
    if (pipelineVersion === 'v2') endpoint = '/get_pitch_v2';
    if (pipelineVersion === 'v4') endpoint = '/get_pitch_v4';

    console.log(`🌐 [DEBUG] Uploading to ${endpoint} starts...`);
    const formData = new FormData();
    formData.append('file', blob, 'recording.webm');
    
    try {
      const res = await fetch(`${SPEECH_API_BASE}${endpoint}`, {
        method: "POST",
        body: formData
      });
      
      console.log(`🌐 [DEBUG] Response status: ${res.status}`);
      
      if (!res.ok) {
        throw new Error(`Server returned status ${res.status}`);
      }
      
      const curve = await res.json();
      
      if (Array.isArray(curve)) {
        setProcessedUserCurve(curve);
        console.log("✅ [DEBUG] Returned curve length:", curve.length);
        fetchContourScore(targetCurve, curve);
      } else {
        console.error("❌ [DEBUG] Returned curve is not an array:", curve);
      }
    } catch (err: any) {
      console.error("❌ [DEBUG] Failed to fetch processed user curve:", err.message || err);
    }
  };

  const fetchContourScore = async (target: number[], user: number[]) => {
    console.log("📊 [DEBUG] targetCurve length:", target ? target.length : 'null/undefined');
    console.log("📊 [DEBUG] processedUserCurve length:", user ? user.length : 'null/undefined');
    if (target && target.length > 0) {
      console.log("📊 [DEBUG] targetCurve (first 5):", target.slice(0, 5));
    }
    if (user && user.length > 0) {
      console.log("📊 [DEBUG] processedUserCurve (first 5):", user.slice(0, 5));
    }

    if (!target || target.length === 0 || !user || user.length === 0) {
      console.log("⚠️ [DEBUG] Skip scoring: target or user curve is empty.");
      return;
    }
    setIsScoringLoading(true);
    setMatchScore(null);
    console.log("🌐 [DEBUG] Fetching tone match score...");
    try {
      const res = await fetch(`${SPEECH_API_BASE}/score`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          user_curve: user,
          target_curve: target
        })
      });
      console.log(`🌐 [DEBUG] Score response status: ${res.status}`);
      if (!res.ok) {
        throw new Error(`Server returned status ${res.status}`);
      }
      const data = await res.json();
      console.log("📊 [DEBUG] Score API response JSON:", data);
      if (typeof data.score === 'number') {
        setMatchScore(data.score);
        console.log("✅ [DEBUG] Tone Match Score loaded:", data.score);
      } else {
        console.error("❌ [DEBUG] Invalid score response format:", data);
      }
    } catch (err: any) {
      console.error("❌ [DEBUG] Failed to fetch tone match score:", err.message || err);
    } finally {
      setIsScoringLoading(false);
    }
  };

  const playRecording = () => {
    if (recordedBlobUrl) {
      const audio = new Audio(recordedBlobUrl);
      audio.play();
    }
  };

  const playTargetAudio = () => {
    const current = practiceQueue[currentIndex];
    if (!current) return;

    const urls = current.record?.audioUrls;
    const audioUrl = urls?.studentWord ||
      urls?.word ||
      urls?.studentChunk ||
      urls?.chunk ||
      urls?.focusExpression ||
      urls?.aiWord ||
      urls?.aiChunk;

    if (audioUrl) {
      const audio = new Audio(audioUrl);
      audio.play().catch(err => {
        console.error("❌ Failed to play target audio:", err);
      });
    } else {
      console.warn("⚠️ No target audio URL resolved.");
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
    // isChineseLearner was removed because it was unused and caused build errors.

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
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
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
                      boxShadow: isRecording ? '0 0 15px rgba(239, 68, 68, 0.5)' : 'none',
                      transition: 'all 0.2s ease'
                    }}
                    onClick={isRecording ? stopToneRecording : startToneRecording}
                  >
                    {isRecording ? '⏹' : '🎤'}
                  </button>
                  <p style={{ marginTop: '0.2rem', fontSize: '0.85rem', color: isRecording ? 'var(--danger)' : 'var(--text-muted)' }}>
                    {isRecording ? 'Recording...' : 'Click to Speak'}
                  </p>
                </div>
              ) : (
                <div style={{ padding: '1rem', background: '#f0fdf4', borderRadius: '12px', border: '1px solid #bbf7d0', display: 'inline-block' }}>
                  {/* 💡 略過文字顯示，只保留按鈕 */}
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                    <button className="btn btn-outline" style={{ background: '#fff', padding: '0.3rem 0.6rem', fontSize: '0.8rem' }} onClick={playRecording}>▶️ Play</button>
                    <button className="btn btn-outline" style={{ background: '#fff', padding: '0.3rem 0.6rem', fontSize: '0.8rem' }} onClick={handleReRecord}>🔄 Re-record</button>
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

          {/* 💡 Tone 模式下改為檢查是否有錄音或曲線數據 */}
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
            <button
              className="btn btn-primary"
              disabled={isEvaluating}
              onClick={() => {
                if (answerMode === 'voice' && !recordedBlobUrl && userCurve.length === 0) {
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
        <div style={{ padding: '1.5rem', background: '#f0fdf4', borderRadius: '12px', border: '1px solid #bbf7d0', textAlign: 'center', margin: '1rem 0' }}>
          <h3 style={{ color: '#166534', marginBottom: '1rem' }}>Tone practice recorded</h3>

          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
            <button className="btn btn-outline" style={{ background: '#fff' }} onClick={playTargetAudio}>🔊 Play Target Audio</button>
            {recordedBlobUrl && (
              <button className="btn btn-outline" style={{ background: '#fff' }} onClick={playRecording}>▶️ Play</button>
            )}
            <button className="btn btn-outline" style={{ background: '#fff' }} onClick={handleReRecord}>🔄 Re-record</button>
          </div>

          {/* 5. Self Rating Section */}
          <div style={{ borderTop: '1px solid #bbf7d0', paddingTop: '1rem', marginTop: '1rem' }}>
            <p style={{ fontWeight: 'bold', color: '#166534', marginBottom: '0.75rem', fontSize: '0.95rem' }}>
              How do you feel about this attempt?
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.75rem', maxWidth: '400px', margin: '0 auto' }}>
              {[
                { rating: 1, label: "🔴 Not familiar yet", color: '#fee2e2', border: '#fca5a5', text: '#991b1b' },
                { rating: 2, label: "🟡 Getting better", color: '#fef3c7', border: '#fcd34d', text: '#92400e' },
                { rating: 3, label: "🟢 Good", color: '#dcfce7', border: '#86efac', text: '#166534' },
                { rating: 4, label: "🔵 Very confident", color: '#dbeafe', border: '#93c5fd', text: '#1e40af' }
              ].map(opt => {
                const isSelected = selectedRating === opt.rating;
                return (
                  <button
                    key={opt.rating}
                    type="button"
                    style={{
                      padding: '0.6rem 0.4rem',
                      borderRadius: '8px',
                      border: isSelected ? `2px solid ${opt.text}` : `1px solid ${opt.border}`,
                      background: isSelected ? opt.color : '#fff',
                      color: opt.text,
                      fontSize: '0.85rem',
                      fontWeight: isSelected ? 'bold' : 'normal',
                      cursor: 'pointer',
                      transform: isSelected ? 'scale(1.02)' : 'none',
                      transition: 'all 0.15s ease',
                      boxShadow: isSelected ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
                    }}
                    onClick={() => setSelectedRating(opt.rating)}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {validationError && (
          <p style={{ color: 'var(--danger)', fontSize: '0.85rem', marginBottom: '1rem', fontWeight: 'bold', textAlign: 'center' }}>
            ⚠️ {validationError}
          </p>
        )}

        {feedback && (
          <div style={{ marginTop: '1.5rem' }}>
            <button
              className="btn btn-primary"
              style={{ width: '100%', padding: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
              onClick={handleSaveAndNext}
              disabled={isSaving || selectedRating === null}
            >
              {isSaving ? (
                <span>
                  {currentRecordingInfo.isUploading ? "Uploading Audio..." : "Saving..."}
                </span>
              ) : (
                currentIndex < practiceQueue.length - 1 ? 'Save & Next Card' : 'Save & Finish Practice'
              )}
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

        {/* Green Curve Pipeline Selector */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', marginBottom: '2rem', padding: '0.5rem 1rem', background: '#f1f5f9', borderRadius: '20px' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-muted)' }}>Green Line:</span>
          {(['v1', 'v2', 'v3', 'v4'] as const).map(p => (
            <button
              key={p}
              onClick={() => setPipelineVersion(p)}
              style={{
                padding: '0.2rem 0.6rem',
                fontSize: '0.7rem',
                border: 'none',
                borderRadius: '12px',
                cursor: 'pointer',
                background: pipelineVersion === p ? 'var(--primary)' : 'transparent',
                color: pipelineVersion === p ? '#fff' : 'var(--text-muted)',
                fontWeight: pipelineVersion === p ? 'bold' : 'normal',
                textTransform: 'uppercase'
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

          {/* 實作的語調分析畫布 */}
          <div style={{
            margin: '0 auto 2rem',
            width: '100%',
            maxWidth: '600px',
            height: '300px', // 💡 對齊 Demo 高度
            background: '#f8fafc',
            borderRadius: '12px',
            border: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative'
          }}>
            <svg width="500" height="300" style={{ overflow: 'visible' }}> {/* 💡 對齊 Demo 高度 */}
              {renderPitchLine(targetCurve, "#ff4d4d", 4, 0.8)}
              {processedUserCurve.length === 0 && renderPitchLine(userCurve, "#00d2ff", 4, 1)}
              {processedUserCurve.length > 0 && renderPitchLine(processedUserCurve, "#10b981", 4, 1)}
            </svg>
          </div>

          {/* Tone Match Score Display (Temporarily Hidden) */}
          {false && (isScoringLoading || matchScore !== null) && (
            <div style={{ 
              marginBottom: '1.5rem', 
              fontSize: '1.2rem', 
              fontWeight: 'bold', 
              color: isScoringLoading ? 'var(--text-muted)' : '#10b981',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem'
            }}>
              {isScoringLoading ? (
                <span>⏳ Calculating score...</span>
              ) : (
                <span style={{ padding: '0.4rem 1rem', background: '#dcfce7', borderRadius: '20px', border: '1px solid #bbf7d0' }}>
                  🎯 Tone Match Score: {matchScore} / 100
                </span>
              )}
            </div>
          )}

          {/* Card Navigation Controls */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', maxWidth: '500px', margin: '0 auto 1rem' }}>
            <button 
              className="btn btn-outline" 
              onClick={handlePrevCard}
              disabled={currentIndex === 0}
              style={{ padding: '0.5rem 1rem' }}
            >
              ⬅️ Previous
            </button>
            <span style={{ fontWeight: 'bold', color: 'var(--text-muted)' }}>
              {currentIndex + 1} / {practiceQueue.length}
            </span>
            <button 
              className="btn btn-outline" 
              onClick={handleNextCard}
              disabled={currentIndex === practiceQueue.length - 1}
              style={{ padding: '0.5rem 1rem' }}
            >
              Next ➡️
            </button>
          </div>

          {renderTestInput()}
        </div>
      </div>

    </div>
  );
}
