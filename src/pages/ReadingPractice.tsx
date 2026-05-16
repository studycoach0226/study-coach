import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '../lib/db';
import { fetchReadingArticleById, addReadingHistory } from '../lib/readingContent';
import { ReadingItem, StudentLearningRecord } from '../lib/types';
import FinalSummary, { GapProgressItem } from '../components/FinalSummary';
import { generateMeaningFromContext, evaluateRecording, EvaluationFeedback, ComprehensionFeedback, PronunciationFeedback } from '../lib/aiService';
import { startSafeMediaRecorder } from '../lib/audioRecorderUtils';

type ReadingStage = 'firstTry' | 'fixLearn' | 'finalTry';
type GapType = 'pronunciation' | 'meaning';

type MarkedWord = {
  word: string;
  pronunciation: boolean;
  meaning: boolean;
};

type TaskKey =
  | 'first_explanation'
  | 'first_reading'
  | 'final_explanation'
  | 'final_reading';

const wordSupportMap: Record<string, { zh: string }> = {
  region: { zh: '地區' },
  pollution: { zh: '污染' },
  government: { zh: '政府' },
  persuade: { zh: '說服' },
  habits: { zh: '習慣' },
  citizens: { zh: '公民' },
  adopt: { zh: '採用' },
  notice: { zh: '注意到' },
  ocean: { zh: '海洋' },
  trash: { zh: '垃圾' },
  although: { zh: '雖然' },
  starting: { zh: '開始' },
  control: { zh: '控制' },
  green: { zh: '環保的；綠色的' },
  people: { zh: '人們' },
  take: { zh: '採取；拿' },
  of: { zh: '的；屬於' },
};

export default function ReadingPractice() {
  const { itemId } = useParams<{ itemId: string }>();
  const navigate = useNavigate();

  const [item, setItem] = useState<ReadingItem | null>(null);
  const [record, setRecord] = useState<StudentLearningRecord | null>(null);
  const [articleCode, setArticleCode] = useState('');

  const [currentStage, setCurrentStage] = useState<ReadingStage>('firstTry');
  const [firstTryStep, setFirstTryStep] = useState(1); // 1 explain, 2 read, 3 mark
  const [fixLearnStep, setFixLearnStep] = useState(1); // 1 support, 2 full passage
  const [finalTryStep, setFinalTryStep] = useState(1); // 1 explain, 2 read, 3 compare

  // Stage 1 + Stage 2 使用的資料（維持原本）
  const [markedWords, setMarkedWords] = useState<MarkedWord[]>([]);
  const [stepMarkedWords, setStepMarkedWords] = useState<MarkedWord[]>([]);

  // Stage 3 專用資料（新增）
  const [finalMarkedWords, setFinalMarkedWords] = useState<MarkedWord[]>([]);
  const [finalStepMarkedWords, setFinalStepMarkedWords] = useState<MarkedWord[]>([]);

  const [baselineMarkedWords, setBaselineMarkedWords] = useState<MarkedWord[]>([]);
  const [progressItems, setProgressItems] = useState<GapProgressItem[]>([]);

  const [currentGapMode, setCurrentGapMode] = useState<GapType | null>(null);

  const [aiMeanings, setAiMeanings] = useState<Record<string, string>>({});
  const [isAiLoading, setIsAiLoading] = useState<Record<string, boolean>>({});
  const fetchingAiRef = useRef<Set<string>>(new Set());

  const [isRecording, setIsRecording] = useState(false);
  const [recordingError, setRecordingError] = useState('');

  const [isSavingHistory, setIsSavingHistory] = useState(false);
  const [historySaved, setHistorySaved] = useState(false);
  const [historySaveError, setHistorySaveError] = useState('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef<string>('audio/webm');

  const [audioUrls, setAudioUrls] = useState<Record<TaskKey, string | null>>({
    first_explanation: null,
    first_reading: null,
    final_explanation: null,
    final_reading: null,
  });

  const [aiFeedback, setAiFeedback] = useState<Record<TaskKey, EvaluationFeedback | null>>({
    first_explanation: null,
    first_reading: null,
    final_explanation: null,
    final_reading: null,
  });

  const [isAiEvaluating, setIsAiEvaluating] = useState<Record<TaskKey, boolean>>({
    first_explanation: false,
    first_reading: false,
    final_explanation: false,
    final_reading: false,
  });

  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  const isFirstTry = currentStage === 'firstTry';
  const isFixLearn = currentStage === 'fixLearn';
  const isFinalTry = currentStage === 'finalTry';

  const currentMarkedWords = isFinalTry ? finalMarkedWords : markedWords;

  const normalizeWord = (word: string) => {
    return word
      .trim()
      .toLowerCase()
      .replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, '');
  };

  const tokens = useMemo(() => {
    if (!item?.articleText) return [];
    return item.articleText.split(/(\s+)/);
  }, [item?.articleText]);

  const currentStepKey = useMemo(() => {
    if (isFirstTry) return `first-${firstTryStep}`;
    if (isFixLearn) return `fix-${fixLearnStep}`;
    return `final-${finalTryStep}`;
  }, [isFirstTry, isFixLearn, firstTryStep, fixLearnStep, finalTryStep]);

  useEffect(() => {
    // Stage 1 / 2 維持原本
    if (isFirstTry || isFixLearn) {
      setStepMarkedWords([]);
    }

    // Stage 3 改用自己的 step state
    if (isFinalTry) {
      setFinalStepMarkedWords([]);
    }

    if (isFirstTry) {
      if (firstTryStep === 1) setCurrentGapMode('meaning');
      else if (firstTryStep === 2) setCurrentGapMode('pronunciation');
      else setCurrentGapMode(null);
      return;
    }

    if (isFinalTry) {
      if (finalTryStep === 1) setCurrentGapMode('meaning');
      else if (finalTryStep === 2) setCurrentGapMode('pronunciation');
      else setCurrentGapMode(null);
      return;
    }

    setCurrentGapMode(null);
  }, [currentStepKey, isFirstTry, isFinalTry, firstTryStep, finalTryStep, isFixLearn]);

  const getMarkedWord = (token: string, source: MarkedWord[]) => {
    const normalized = normalizeWord(token);
    return source.find((item) => item.word === normalized);
  };

  const isSelectableToken = (token: string) => normalizeWord(token).length > 0;

  const shouldShowPersistentHighlights =
    (isFirstTry && firstTryStep === 3) ||
    (isFixLearn && (fixLearnStep === 1 || fixLearnStep === 2));

  const getHighlightSource = () => {
    if (isFinalTry) {
      if (finalTryStep === 1 || finalTryStep === 2) return finalStepMarkedWords;
      return finalMarkedWords;
    }

    return shouldShowPersistentHighlights ? markedWords : stepMarkedWords;
  };

  const getWordHighlightColor = (token: string) => {
    const source = getHighlightSource();
    const marked = getMarkedWord(token, source);
    if (!marked) return 'transparent';
    if (marked.pronunciation && marked.meaning) return '#f9a8d4';
    if (marked.pronunciation) return '#fde68a';
    if (marked.meaning) return '#bfdbfe';
    return 'transparent';
  };

  const upsertMark = (
    source: MarkedWord[],
    token: string,
    gapType: GapType
  ): MarkedWord[] => {
    const normalized = normalizeWord(token);
    if (!normalized) return source;

    const existing = source.find((item) => item.word === normalized);

    if (!existing) {
      return [
        ...source,
        {
          word: normalized,
          pronunciation: gapType === 'pronunciation',
          meaning: gapType === 'meaning',
        },
      ];
    }

    return source
      .map((item) =>
        item.word === normalized
          ? {
            ...item,
            pronunciation:
              gapType === 'pronunciation'
                ? !item.pronunciation
                : item.pronunciation,
            meaning:
              gapType === 'meaning'
                ? !item.meaning
                : item.meaning,
          }
          : item
      )
      .filter((item) => item.pronunciation || item.meaning);
  };

  const handleTokenClick = (token: string) => {
    if (!currentGapMode) return;

    // Stage 3 改用自己的標記資料
    if (isFinalTry) {
      setFinalStepMarkedWords((prev) => upsertMark(prev, token, currentGapMode));
      setFinalMarkedWords((prev) => upsertMark(prev, token, currentGapMode));
      return;
    }

    // Stage 1 / 2 維持原本
    setStepMarkedWords((prev) => upsertMark(prev, token, currentGapMode));
    setMarkedWords((prev) => upsertMark(prev, token, currentGapMode));
  };

  const removeMarkedWord = (wordToRemove: string) => {
    if (isFinalTry) {
      setFinalMarkedWords((prev) => prev.filter((item) => item.word !== wordToRemove));
      return;
    }

    setMarkedWords((prev) => prev.filter((item) => item.word !== wordToRemove));
  };

  const handlePlayReferenceAudio = (text?: string) => {
    const content = text || item?.articleText;
    if (!content) return;

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(content);
    utterance.lang = 'en-US';
    utterance.rate = 0.95;
    utterance.pitch = 1;

    const voices = window.speechSynthesis.getVoices();
    const preferredVoice =
      voices.find((v) => /Google US English|Samantha|Alex/i.test(v.name)) ||
      voices.find((v) => v.lang.toLowerCase().startsWith('en')) ||
      null;

    if (preferredVoice) utterance.voice = preferredVoice;

    utterance.onstart = () => {
      setIsSpeaking(true);
      setIsPaused(false);
    };

    utterance.onend = () => {
      setIsSpeaking(false);
      setIsPaused(false);
      utteranceRef.current = null;
    };

    utterance.onerror = () => {
      setIsSpeaking(false);
      setIsPaused(false);
      utteranceRef.current = null;
    };

    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  };

  const handlePauseReferenceAudio = () => {
    if (!isSpeaking || isPaused) return;
    window.speechSynthesis.pause();
    setIsPaused(true);
  };

  const handleResumeReferenceAudio = () => {
    if (!isSpeaking || !isPaused) return;
    window.speechSynthesis.resume();
    setIsPaused(false);
  };

  const handleStopReferenceAudio = () => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    setIsPaused(false);
    utteranceRef.current = null;
  };

  const stopTracks = () => {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  };

  const resetRecordingState = () => {
    setIsRecording(false);
    setRecordingError('');
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    stopTracks();
  };

  const startRecordingForTask = async (taskKey: TaskKey) => {
    try {
      setRecordingError('');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const { recorder, mimeType } = await startSafeMediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      mimeTypeRef.current = mimeType;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
        const url = URL.createObjectURL(blob);
        setAudioUrls((prev) => {
          const oldUrl = prev[taskKey];
          if (oldUrl) URL.revokeObjectURL(oldUrl);
          return { ...prev, [taskKey]: url };
        });
        stopTracks();

        if (item?.articleText) {
          setIsAiEvaluating(prev => ({ ...prev, [taskKey]: true }));
          try {
            const feedback = await evaluateRecording({
              audioBlobOrBase64: url,
              targetText: item.articleText,
              taskType: (taskKey === 'first_explanation' || taskKey === 'final_explanation') ? 'explain' : 'read'
            });
            setAiFeedback(prev => ({ ...prev, [taskKey]: feedback }));
          } catch (err) {
            console.error('AI evaluation failed:', err);
          } finally {
            setIsAiEvaluating(prev => ({ ...prev, [taskKey]: false }));
          }
        }
      };

      recorder.start();
      setIsRecording(true);
    } catch (error: any) {
      console.error("[ReadingPractice] Error starting recording:", error);
      setRecordingError(`Recording failed: ${error.message || 'Microphone access failed.'}`);
      setIsRecording(false);
      stopTracks();
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const saveReadingHistory = async () => {
    if (!item || historySaved || isSavingHistory) return;

    const sId = db.getCurrentUserId();
    if (!sId) {
      setHistorySaveError('Student ID not found.');
      return;
    }

    try {
      setIsSavingHistory(true);
      setHistorySaveError('');

      const result = await addReadingHistory({
        studentId: sId,
        articleId: item.id,
        articleCode: articleCode || '',
        title: item.title,
        durationSec: 0,
        notes: '',
      });

      console.log('✅ addReadingHistory result:', result);
      setHistorySaved(true);
    } catch (error) {
      console.error('❌ Failed to save reading history:', error);
      setHistorySaveError('Failed to save reading history.');
    } finally {
      setIsSavingHistory(false);
    }
  };

  const fetchAiMeaning = async (word: string) => {
    if (!item?.articleText) return;
    setIsAiLoading(prev => ({ ...prev, [word]: true }));
    try {
      const meaning = await generateMeaningFromContext(word, item.articleText);
      setAiMeanings(prev => ({ ...prev, [word]: meaning }));
    } catch (error) {
      console.error('Failed to fetch AI meaning:', error);
    } finally {
      setIsAiLoading(prev => ({ ...prev, [word]: false }));
    }
  };

  useEffect(() => {
    if (!item?.articleText) return;

    currentMarkedWords.forEach(w => {
      const word = w.word;
      if (!wordSupportMap[word] && !aiMeanings[word] && !fetchingAiRef.current.has(word)) {
        fetchingAiRef.current.add(word);
        fetchAiMeaning(word);
      }
    });
  }, [currentMarkedWords, item?.articleText, aiMeanings]);

  const computeProgressItems = () => {
    const items: GapProgressItem[] = [];

    baselineMarkedWords.forEach((baseWord) => {
      const finalWord = finalMarkedWords.find(w => w.word === baseWord.word);
      const isTeacherRecommended = !!wordSupportMap[baseWord.word];
      const meaningStr = wordSupportMap[baseWord.word]?.zh || aiMeanings[baseWord.word] || '';

      if (finalWord) {
        items.push({
          word: finalWord.word,
          meaningStr,
          pronunciation: finalWord.pronunciation,
          meaning: finalWord.meaning,
          status: 'still',
          selectedForFlashcard: false,
          isTeacherRecommended
        });
      } else {
        items.push({
          word: baseWord.word,
          meaningStr,
          pronunciation: baseWord.pronunciation,
          meaning: baseWord.meaning,
          status: 'improved',
          selectedForFlashcard: false,
          isTeacherRecommended
        });
      }
    });

    finalMarkedWords.forEach((finalWord) => {
      const baseWord = baselineMarkedWords.find(w => w.word === finalWord.word);
      if (!baseWord) {
        const isTeacherRecommended = !!wordSupportMap[finalWord.word];
        const meaningStr = wordSupportMap[finalWord.word]?.zh || aiMeanings[finalWord.word] || '';
        items.push({
          word: finalWord.word,
          meaningStr,
          pronunciation: finalWord.pronunciation,
          meaning: finalWord.meaning,
          status: 'newly_noticed',
          selectedForFlashcard: false,
          isTeacherRecommended
        });
      }
    });

    setProgressItems(items);
  };

  const finishCurrentStep = async () => {
    if (isRecording) stopRecording();

    let requiredTaskKey: TaskKey | null = null;
    if (isFirstTry) {
      if (firstTryStep === 1) requiredTaskKey = 'first_explanation';
      if (firstTryStep === 2) requiredTaskKey = 'first_reading';
    } else if (isFinalTry) {
      if (finalTryStep === 1) requiredTaskKey = 'final_explanation';
      if (finalTryStep === 2) requiredTaskKey = 'final_reading';
    }

    if (requiredTaskKey && !audioUrls[requiredTaskKey]) {
      alert("Please record your voice before continuing.");
      return;
    }

    if (isFirstTry) {
      if (firstTryStep === 1) {
        setFirstTryStep(2);
        return;
      }
      if (firstTryStep === 2) {
        setFirstTryStep(3);
        return;
      }
    }

    if (isFinalTry) {
      if (finalTryStep === 1) {
        setFinalTryStep(2);
        return;
      }
      if (finalTryStep === 2) {
        computeProgressItems();
        setFinalTryStep(3);
        await saveReadingHistory();
        return;
      }
    }
  };

  const continueFlow = () => {
    if (isFirstTry && firstTryStep === 3) {
      setBaselineMarkedWords(markedWords.map((item) => ({ ...item })));
      setCurrentStage('fixLearn');
      setFixLearnStep(1);
      return;
    }

    if (isFixLearn && fixLearnStep === 1) {
      setFixLearnStep(2);
      return;
    }

    if (isFixLearn && fixLearnStep === 2) {
      // 進入 Stage 3 時清空，重新開始
      setFinalMarkedWords([]);
      setFinalStepMarkedWords([]);
      setHistorySaved(false);
      setHistorySaveError('');
      setCurrentStage('finalTry');
      setFinalTryStep(1);
      return;
    }
  };

  const pronunciationOnlyCount = currentMarkedWords.filter(
    (w) => w.pronunciation && !w.meaning
  ).length;

  const meaningOnlyCount = currentMarkedWords.filter(
    (w) => !w.pronunciation && w.meaning
  ).length;

  const doubleMarkedCount = currentMarkedWords.filter(
    (w) => w.pronunciation && w.meaning
  ).length;

  useEffect(() => {
    if (!itemId) return;

    let isCancelled = false;

    async function loadReadingItem() {
      const id = itemId!;
      try {
        const sheetItem = await fetchReadingArticleById(id);

        if (!isCancelled && sheetItem) {
          setArticleCode(sheetItem.articleCode || '');
          setItem({
            id: sheetItem.id,
            itemType: 'reading',
            title: sheetItem.title,
            articleText: sheetItem.articleText,
            fullMeaningZh: sheetItem.fullMeaningZh,
            languageDirection: 'en-zh',
            createdBy: 'system',
            assignedByTeacher: true,
            assignedToAll: true,
            assignedStudentIds: [],
            createdAt: Date.now(),
            updatedAt: Date.now()
          } as ReadingItem);
        } else {
          const items = db.getLearningItems();
          const foundItem = items.find((i) => i.id === id);

          if (!isCancelled && foundItem && foundItem.itemType === 'reading') {
            setItem(foundItem as ReadingItem);
          }
        }

        const sId = db.getCurrentUserId();
        if (sId) {
          const foundRecord = db.getLearningRecord(sId, id);
          if (!isCancelled && foundRecord) {
            setRecord(foundRecord);
          }
        }
      } catch (error) {
        console.error('Failed to load reading item from Google Sheets:', error);

        const items = db.getLearningItems();
        const foundItem = items.find((i) => i.id === id);

        if (!isCancelled && foundItem && foundItem.itemType === 'reading') {
          setItem(foundItem as ReadingItem);
        }

        const sId = db.getCurrentUserId();
        if (sId) {
          const foundRecord = db.getLearningRecord(sId, id);
          if (!isCancelled && foundRecord) {
            setRecord(foundRecord);
          }
        }
      }
    }

    loadReadingItem();

    return () => {
      isCancelled = true;
    };
  }, [itemId]);

  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel();
      stopTracks();
      (Object.values(audioUrls) as Array<string | null>).forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!item) {
    return (
      <div style={{ maxWidth: '800px', margin: '2rem auto', padding: '1rem', textAlign: 'center' }}>
        <h2>Loading or Item Not Found</h2>
        <button className="btn btn-outline" onClick={() => navigate(`/student/${db.getCurrentUserId()}`)}>
          Back to Dashboard
        </button>

      </div>
    );
  }

  const stageBadgeColor = isFirstTry
    ? { bg: '#dbeafe', text: '#1d4ed8' }
    : isFixLearn
      ? { bg: '#fef3c7', text: '#b45309' }
      : { bg: '#dcfce7', text: '#15803d' };

  const renderTopBar = () => {
    const trySteps = ['Explain', 'Read', 'Mark'];
    const fixSteps = ['Support', 'Full Passage'];

    const currentStepIndex = isFirstTry
      ? firstTryStep - 1
      : isFixLearn
        ? fixLearnStep - 1
        : finalTryStep - 1;

    const steps = isFixLearn ? fixSteps : trySteps;

    return (
      <div
        className="card"
        style={{
          padding: '0.85rem 1rem',
          marginBottom: '1rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '1rem',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <span
            style={{
              background: stageBadgeColor.bg,
              color: stageBadgeColor.text,
              padding: '0.3rem 0.7rem',
              borderRadius: '8px',
              fontWeight: 700,
            }}
          >
            {isFirstTry ? 'First Try' : isFixLearn ? 'Fix & Learn' : 'Final Try'}
          </span>

          <span style={{ color: '#999' }}>|</span>

          {steps.map((step, index) => (
            <React.Fragment key={step}>
              <span
                style={{
                  fontWeight: index === currentStepIndex ? 700 : 500,
                  color: index === currentStepIndex ? '#2563eb' : '#666',
                  borderBottom: index === currentStepIndex ? '2px solid #2563eb' : 'none',
                  paddingBottom: '2px',
                }}
              >
                {step}
              </span>
              {index < steps.length - 1 && <span style={{ color: '#999' }}>→</span>}
            </React.Fragment>
          ))}
        </div>
      </div>
    );
  };

  const renderPassageCard = () => (
    <div className="card" style={{ padding: '2rem', marginBottom: '1.25rem' }}>
      <h2
        style={{
          marginTop: 0,
          marginBottom: '1rem',
          fontSize: '1.8rem',
          borderBottom: '2px solid var(--border)',
          paddingBottom: '0.5rem',
        }}
      >
        {item.title}
      </h2>

      <div
        style={{
          fontSize: '1.2rem',
          lineHeight: '1.9',
          whiteSpace: 'pre-wrap',
          color: 'var(--text-main)',
        }}
      >
        {tokens.map((token, idx) => {
          if (/^\s+$/.test(token)) {
            return <React.Fragment key={idx}>{token}</React.Fragment>;
          }

          if (!isSelectableToken(token)) {
            return <span key={idx}>{token}</span>;
          }

          const marked = !!getMarkedWord(token, getHighlightSource());

          return (
            <span
              key={idx}
              onClick={() => handleTokenClick(token)}
              style={{
                backgroundColor: getWordHighlightColor(token),
                cursor: currentGapMode ? 'pointer' : 'default',
                borderRadius: '4px',
                padding: '0 2px',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                if (currentGapMode && !marked) {
                  e.currentTarget.style.backgroundColor =
                    currentGapMode === 'pronunciation' ? '#fef3c7' : '#dbeafe';
                }
              }}
              onMouseLeave={(e) => {
                if (!marked) {
                  e.currentTarget.style.backgroundColor = 'transparent';
                } else {
                  e.currentTarget.style.backgroundColor = getWordHighlightColor(token);
                }
              }}
            >
              {token}
            </span>
          );
        })}
      </div>
    </div>
  );

  const renderTaskControls = (
    taskKey: TaskKey,
    startLabel: string
  ) => {
    const isExplainTask = taskKey === 'first_explanation' || taskKey === 'final_explanation';

    return (
      <div style={{ marginBottom: '1rem' }}>
        <div
          style={{
            display: 'flex',
            gap: '0.75rem',
            alignItems: 'center',
            flexWrap: 'wrap',
            marginBottom: '0.75rem',
          }}
        >
          {!isRecording ? (
            <button
              className="btn btn-primary"
              onClick={() => startRecordingForTask(taskKey)}
            >
              🎙 {startLabel}
            </button>
          ) : (
            <button className="btn btn-outline" onClick={stopRecording}>
              ⏹ Stop Recording
            </button>
          )}

          {audioUrls[taskKey] && <audio controls src={audioUrls[taskKey] ?? undefined} />}

          {recordingError && (
            <span style={{ color: '#b91c1c', fontWeight: 600 }}>{recordingError}</span>
          )}
        </div>

        {isAiEvaluating[taskKey] && (
          <div style={{ marginTop: '1rem', padding: '1rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', color: '#64748b' }}>
            🤖 {isExplainTask ? '教練正在看你的理解...' : '教練正在聽你的朗讀...'}
          </div>
        )}

        {aiFeedback[taskKey] && !isAiEvaluating[taskKey] && (
          <div style={{ marginTop: '0.75rem', padding: '1rem', background: '#f0fdf4', borderRadius: '8px', border: '1px solid #bbf7d0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '1.25rem' }}>🎯</span>
              <span style={{ fontWeight: 700, fontSize: '1.1rem', color: '#16a34a' }}>
                {isExplainTask ? 'Understanding Score' : 'Reading Score'}: {aiFeedback[taskKey]?.score} / 100
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>

              <div style={{ padding: '0.5rem', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0', marginBottom: '0.25rem' }}>
                <strong style={{ color: '#475569' }}>🎤 你說的內容：</strong>
                <div style={{ color: '#64748b', fontSize: '0.95rem', marginTop: '0.25rem', fontStyle: 'italic' }}>
                  "{aiFeedback[taskKey]?.transcriptionText}"
                </div>
              </div>

              {isExplainTask ? (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', padding: '0.75rem', background: '#f0fdf4', borderRadius: '6px', border: '1px solid #bbf7d0' }}>
                    <div style={{ fontWeight: 600, color: '#166534', marginBottom: '0.1rem' }}>評分細項：</div>

                    {((aiFeedback[taskKey] as ComprehensionFeedback).completionScore !== undefined || (aiFeedback[taskKey] as ComprehensionFeedback).completionFeedback) && (
                      <div style={{ fontSize: '0.95rem' }}>
                        <strong style={{ color: '#15803d' }}>
                          完整度：{(aiFeedback[taskKey] as ComprehensionFeedback).completionScore !== undefined ? `${(aiFeedback[taskKey] as ComprehensionFeedback).completionScore} / 100` : ""}
                        </strong>
                        <div style={{ color: 'var(--text-main)', marginLeft: '0.25rem', marginTop: '0.15rem' }}>
                          → {(aiFeedback[taskKey] as ComprehensionFeedback).completionFeedback || "教練還沒有產生這一項回饋"}
                        </div>
                      </div>
                    )}

                    {((aiFeedback[taskKey] as ComprehensionFeedback).accuracyScore !== undefined || (aiFeedback[taskKey] as ComprehensionFeedback).accuracyFeedback) && (
                      <div style={{ fontSize: '0.95rem' }}>
                        <strong style={{ color: '#15803d' }}>
                          正確度：{(aiFeedback[taskKey] as ComprehensionFeedback).accuracyScore !== undefined ? `${(aiFeedback[taskKey] as ComprehensionFeedback).accuracyScore} / 100` : ""}
                        </strong>
                        <div style={{ color: 'var(--text-main)', marginLeft: '0.25rem', marginTop: '0.15rem' }}>
                          → {(aiFeedback[taskKey] as ComprehensionFeedback).accuracyFeedback || "教練還沒有產生這一項回饋"}
                        </div>
                      </div>
                    )}

                    {((aiFeedback[taskKey] as ComprehensionFeedback).detailScore !== undefined || (aiFeedback[taskKey] as ComprehensionFeedback).detailFeedback) && (
                      <div style={{ fontSize: '0.95rem' }}>
                        <strong style={{ color: '#15803d' }}>
                          細節度：{(aiFeedback[taskKey] as ComprehensionFeedback).detailScore !== undefined ? `${(aiFeedback[taskKey] as ComprehensionFeedback).detailScore} / 100` : ""}
                        </strong>
                        <div style={{ color: 'var(--text-main)', marginLeft: '0.25rem', marginTop: '0.15rem' }}>
                          → {(aiFeedback[taskKey] as ComprehensionFeedback).detailFeedback || "教練還沒有產生這一項回饋"}
                        </div>
                      </div>
                    )}

                    {((aiFeedback[taskKey] as ComprehensionFeedback).clarityScore !== undefined || (aiFeedback[taskKey] as ComprehensionFeedback).clarityFeedback) && (
                      <div style={{ fontSize: '0.95rem' }}>
                        <strong style={{ color: '#15803d' }}>
                          清楚度：{(aiFeedback[taskKey] as ComprehensionFeedback).clarityScore !== undefined ? `${(aiFeedback[taskKey] as ComprehensionFeedback).clarityScore} / 100` : ""}
                        </strong>
                        <div style={{ color: 'var(--text-main)', marginLeft: '0.25rem', marginTop: '0.15rem' }}>
                          → {(aiFeedback[taskKey] as ComprehensionFeedback).clarityFeedback || "教練還沒有產生這一項回饋"}
                        </div>
                      </div>
                    )}
                  </div>
                  <div><strong style={{ color: '#15803d' }}>你做得好的地方：</strong> <span style={{ color: 'var(--text-main)' }}>{(aiFeedback[taskKey] as ComprehensionFeedback).strengths || "教練還沒有產生這一項回饋"}</span></div>
                  <div><strong style={{ color: '#15803d' }}>還可以補強的地方：</strong> <span style={{ color: 'var(--text-main)' }}>{(aiFeedback[taskKey] as ComprehensionFeedback).needsWork || "教練還沒有產生這一項回饋"}</span></div>
                </>
              ) : (
                <>
                  <div><strong style={{ color: '#15803d' }}>完整度回饋:</strong> <span style={{ color: 'var(--text-main)' }}>{(aiFeedback[taskKey] as PronunciationFeedback).completenessFeedback}</span></div>
                  <div><strong style={{ color: '#15803d' }}>發音回饋:</strong> <span style={{ color: 'var(--text-main)' }}>{(aiFeedback[taskKey] as PronunciationFeedback).pronunciationFeedback}</span></div>
                  <div><strong style={{ color: '#15803d' }}>流暢度回饋:</strong> <span style={{ color: 'var(--text-main)' }}>{(aiFeedback[taskKey] as PronunciationFeedback).fluencyFeedback}</span></div>
                  <div><strong style={{ color: '#15803d' }}>漏念或改動的內容:</strong> <span style={{ color: 'var(--text-main)' }}>{(aiFeedback[taskKey] as PronunciationFeedback).missingOrChangedWords}</span></div>
                </>
              )}

              {!isExplainTask && (
                <div style={{ padding: '0.5rem', background: '#fff', borderRadius: '6px', border: '1px solid #bbf7d0', marginTop: '0.25rem' }}>
                  <strong style={{ color: '#047857' }}>💡 下一步可以這樣做：</strong> <span style={{ color: 'var(--text-main)' }}>{aiFeedback[taskKey]?.suggestion || "教練還沒有產生這一項回饋"}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderMarkedSummary = () => (
    <div
      className="card"
      style={{
        padding: '1.25rem',
        border: '1px dashed var(--border)',
        marginBottom: '1rem',
      }}
    >
      <h3 style={{ marginTop: 0, marginBottom: '0.85rem' }}>📌 Marked Gaps</h3>

      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}>
        <div style={{ padding: '0.45rem 0.8rem', borderRadius: '999px', background: '#f8fafc', border: '1px solid var(--border)' }}>
          Total: <strong>{currentMarkedWords.length}</strong>
        </div>
        <div style={{ padding: '0.45rem 0.8rem', borderRadius: '999px', background: '#fff7ed', border: '1px solid #fed7aa' }}>
          Pronunciation: <strong>{pronunciationOnlyCount}</strong>
        </div>
        <div style={{ padding: '0.45rem 0.8rem', borderRadius: '999px', background: '#eff6ff', border: '1px solid #bfdbfe' }}>
          Meaning: <strong>{meaningOnlyCount}</strong>
        </div>
        <div style={{ padding: '0.45rem 0.8rem', borderRadius: '999px', background: '#fdf2f8', border: '1px solid #fbcfe8' }}>
          Double: <strong>{doubleMarkedCount}</strong>
        </div>
      </div>

      {currentMarkedWords.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', marginBottom: 0 }}>No marked gaps yet.</p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
          {currentMarkedWords.map((item) => (
            <div
              key={item.word}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.55rem 0.85rem',
                borderRadius: '999px',
                background: '#fff',
                border: '1px solid var(--border)',
              }}
            >
              <span style={{ fontWeight: 700 }}>{item.word}</span>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                {item.pronunciation && item.meaning
                  ? 'P + M'
                  : item.pronunciation
                    ? 'P'
                    : 'M'}
              </span>
              <button
                onClick={() => removeMarkedWord(item.word)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  color: '#dc2626',
                  fontWeight: 700,
                  fontSize: '1rem',
                  padding: 0,
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderFirstTry = () => {
    if (firstTryStep === 1) {
      return (
        <>
          {renderPassageCard()}
          {renderTaskControls('first_explanation', 'Start Explanation Recording')}
          {renderMarkedSummary()}
          <div style={{ textAlign: 'right' }}>
            <button className="btn btn-success" onClick={finishCurrentStep}>
              ✅ Finish Step
            </button>
          </div>
        </>
      );
    }

    if (firstTryStep === 2) {
      return (
        <>
          {renderPassageCard()}
          {renderTaskControls('first_reading', 'Start Reading Recording')}
          {renderMarkedSummary()}
          <div style={{ textAlign: 'right' }}>
            <button className="btn btn-success" onClick={finishCurrentStep}>
              ✅ Finish Step
            </button>
          </div>
        </>
      );
    }

    return (
      <>
        {renderPassageCard()}
        {renderMarkedSummary()}
        <div style={{ textAlign: 'right' }}>
          <button className="btn btn-success" onClick={continueFlow}>
            Continue to Fix & Learn →
          </button>
        </div>
      </>
    );
  };

  const renderFixLearn = () => {
    if (fixLearnStep === 1) {
      return (
        <>
          {renderPassageCard()}

          <div
            className="card"
            style={{
              padding: '1.25rem',
              border: '1px dashed var(--border)',
              marginBottom: '1rem',
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: '0.85rem' }}>📌 Support Panel</h3>

            {markedWords.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', marginBottom: 0 }}>No marked words yet.</p>
            ) : (
              <div style={{ display: 'grid', gap: '0.9rem' }}>
                {markedWords.map((item) => {
                  const support = wordSupportMap[item.word];
                  const isTeacherRecommended = !!support;
                  return (
                    <div
                      key={item.word}
                      style={{
                        border: '1px solid var(--border)',
                        borderRadius: '14px',
                        padding: '1rem',
                        background: '#fff',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: '1rem',
                          flexWrap: 'wrap',
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div style={{ fontSize: '1.15rem', fontWeight: 700 }}>{item.word}</div>
                            {isTeacherRecommended && (
                              <span style={{ fontSize: '0.75rem', background: '#dbeafe', color: '#1d4ed8', padding: '0.15rem 0.4rem', borderRadius: '4px', fontWeight: 600 }}>
                                Teacher recommended
                              </span>
                            )}
                          </div>
                          <div style={{ color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                            {isTeacherRecommended
                              ? `中文：${support.zh}`
                              : isAiLoading[item.word]
                                ? '🤖 AI 正在預測意思...'
                                : `中文：${aiMeanings[item.word] || '尚未產生'}`
                            }
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <button
                            className="btn btn-outline"
                            onClick={() => handlePlayReferenceAudio(item.word)}
                          >
                            🔊 Play
                          </button>
                          <button
                            className="btn btn-outline"
                            onClick={() => removeMarkedWord(item.word)}
                          >
                            ✕ Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ textAlign: 'right' }}>
            <button className="btn btn-success" onClick={continueFlow}>
              Continue →
            </button>
          </div>
        </>
      );
    }

    return (
      <>
        {renderPassageCard()}

        <div
          className="card"
          style={{
            padding: '1.25rem',
            marginBottom: '1rem',
            background: '#fffdf5',
          }}
        >
          <h3 style={{ marginTop: 0 }}>Full Passage Meaning</h3>
          <div
            style={{
              borderRadius: '12px',
              padding: '1rem',
              background: '#fff',
              border: '1px solid var(--border)',
              lineHeight: 1.8,
              marginBottom: '1rem',
            }}
          >
            {item.fullMeaningZh || 'No full passage meaning yet.'}
          </div>

          <h3>Full Passage Audio</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => handlePlayReferenceAudio()}>
              ▶ Play Full Passage
            </button>
            <button
              className="btn btn-outline"
              onClick={handlePauseReferenceAudio}
              disabled={!isSpeaking || isPaused}
            >
              ⏸ Pause
            </button>
            <button
              className="btn btn-outline"
              onClick={handleResumeReferenceAudio}
              disabled={!isSpeaking || !isPaused}
            >
              ⏵ Resume
            </button>
            <button
              className="btn btn-outline"
              onClick={handleStopReferenceAudio}
              disabled={!isSpeaking}
            >
              ⏹ Stop
            </button>
          </div>
        </div>

        <div style={{ textAlign: 'right' }}>
          <button className="btn btn-success" onClick={continueFlow}>
            Continue to Final Try →
          </button>
        </div>
      </>
    );
  };

  const renderProgressComparison = () => {
    const firstExplain = aiFeedback['first_explanation'];
    const finalExplain = aiFeedback['final_explanation'];
    const firstRead = aiFeedback['first_reading'];
    const finalRead = aiFeedback['final_reading'];

    return (
      <div className="card" style={{ padding: '1.25rem', marginBottom: '1.25rem', background: '#f8fafc', border: '1px solid #e2e8f0' }}>
        <h3 style={{ marginTop: 0, marginBottom: '1rem' }}>📈 Overall Progress</h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
          {/* Explanation Progress */}
          <div style={{ background: '#fff', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
            <h4 style={{ margin: '0 0 0.85rem 0', color: '#1d4ed8' }}>Explanation Progress</h4>
            {firstExplain && finalExplain ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>First Try</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{firstExplain.score}</div>
                </div>
                <div style={{ color: '#cbd5e1', fontSize: '1.5rem' }}>→</div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Final Try</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: finalExplain.score >= firstExplain.score ? '#16a34a' : '#dc2626' }}>{finalExplain.score}</div>
                </div>
                <div style={{ background: finalExplain.score >= firstExplain.score ? '#dcfce7' : '#fee2e2', color: finalExplain.score >= firstExplain.score ? '#15803d' : '#b91c1c', padding: '0.25rem 0.6rem', borderRadius: '8px', fontWeight: 700, fontSize: '1.1rem' }}>
                  {finalExplain.score >= firstExplain.score ? '+' : ''}{finalExplain.score - firstExplain.score}
                </div>
              </div>
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Not enough data</div>
            )}
          </div>

          {/* Reading Progress */}
          <div style={{ background: '#fff', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
            <h4 style={{ margin: '0 0 0.85rem 0', color: '#1d4ed8' }}>Reading Progress</h4>
            {firstRead && finalRead ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>First Try</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{firstRead.score}</div>
                </div>
                <div style={{ color: '#cbd5e1', fontSize: '1.5rem' }}>→</div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Final Try</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: finalRead.score >= firstRead.score ? '#16a34a' : '#dc2626' }}>{finalRead.score}</div>
                </div>
                <div style={{ background: finalRead.score >= firstRead.score ? '#dcfce7' : '#fee2e2', color: finalRead.score >= firstRead.score ? '#15803d' : '#b91c1c', padding: '0.25rem 0.6rem', borderRadius: '8px', fontWeight: 700, fontSize: '1.1rem' }}>
                  {finalRead.score >= firstRead.score ? '+' : ''}{finalRead.score - firstRead.score}
                </div>
              </div>
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Not enough data</div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderFinalTry = () => {
    if (finalTryStep === 1) {
      return (
        <>
          {renderPassageCard()}
          {renderTaskControls('final_explanation', 'Start Final Explanation Recording')}
          {renderMarkedSummary()}
          <div style={{ textAlign: 'right' }}>
            <button className="btn btn-success" onClick={finishCurrentStep}>
              ✅ Finish Step
            </button>
          </div>
        </>
      );
    }

    if (finalTryStep === 2) {
      return (
        <>
          {renderPassageCard()}
          {renderTaskControls('final_reading', 'Start Final Reading Recording')}
          {renderMarkedSummary()}
          <div style={{ textAlign: 'right' }}>
            <button className="btn btn-success" onClick={finishCurrentStep}>
              ✅ Finish Step
            </button>
          </div>
        </>
      );
    }

    return (
      <>
        {renderPassageCard()}

        {renderProgressComparison()}
        <FinalSummary items={progressItems} onItemsChange={setProgressItems} />

        <div style={{ marginTop: '1rem', marginBottom: '1rem', padding: '1.25rem', background: '#fff', borderRadius: '12px', border: '1px solid var(--border)' }}>
          <h4 style={{ marginTop: 0, marginBottom: '0.5rem' }}>History Status</h4>
          {isSavingHistory && (
            <div style={{ color: '#b45309', fontWeight: 600 }}>Saving reading history...</div>
          )}
          {historySaved && (
            <div style={{ color: '#15803d', fontWeight: 600 }}>✅ Reading history saved.</div>
          )}
          {historySaveError && (
            <div style={{ color: '#b91c1c', fontWeight: 600 }}>{historySaveError}</div>
          )}
        </div>

        {renderMarkedSummary()}
      </>
    );
  };

  return (
    <div style={{ maxWidth: '980px', margin: '0 auto', padding: '1rem' }}>
      {renderTopBar()}

      {isFirstTry && renderFirstTry()}
      {isFixLearn && renderFixLearn()}
      {isFinalTry && renderFinalTry()}

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: '1rem',
          marginTop: '1.5rem',
          flexWrap: 'wrap',
        }}
      >
        <button
          className="btn btn-outline"
          onClick={() => {
            if (isFixLearn) {
              setCurrentStage('firstTry');
            } else if (isFinalTry) {
              setCurrentStage('fixLearn');
            }
            resetRecordingState();
          }}
          disabled={isFirstTry}
          style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem', opacity: isFirstTry ? 0.3 : 0.7 }}
        >
          ← Previous Stage
        </button>

        <button
          className="btn btn-outline"
          onClick={() => {
            if (isFirstTry) {
              setCurrentStage('fixLearn');
            } else if (isFixLearn) {
              setFinalMarkedWords([]);
              setFinalStepMarkedWords([]);
              setHistorySaved(false);
              setHistorySaveError('');
              setCurrentStage('finalTry');
              setFinalTryStep(1);
            }
            resetRecordingState();
          }}
          disabled={isFinalTry}
          style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem', opacity: isFinalTry ? 0.3 : 0.7 }}
        >
          Skip to Next Stage →
        </button>
      </div>

      {record && <div style={{ display: 'none' }}>{record.id}</div>}
    </div>
  );
}