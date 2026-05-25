import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../lib/db';
import { LearningItem, StudentLearningRecord, Attempt } from '../lib/types';
import {
  fetchReadingHistoryByStudentId,
  fetchReadingWeeklyGoalByStudentId,
  fetchAllReadingArticles,
  SheetReadingArticle
} from '../lib/readingContent';
import { UI_LABELS } from '../lib/appConfig';
import { getStudentFlashcards, mapFirestoreToLocal } from '../lib/firebaseDb';

function parseAssignedRange(rangeStr: string): string[] {
  if (!rangeStr || rangeStr === '-') return [];
  const parts = rangeStr.split('-').map(s => s.trim());
  if (parts.length !== 2) return [];
  const start = parts[0];
  const end = parts[1];

  const startNum = parseInt(start.replace(/\D/g, ''), 10);
  const endNum = parseInt(end.replace(/\D/g, ''), 10);
  const prefix = start.replace(/\d/g, '');

  if (isNaN(startNum) || isNaN(endNum)) return [];

  const codes = [];
  for (let i = startNum; i <= endNum; i++) {
    codes.push(`${prefix}${String(i).padStart(3, '0')}`);
  }
  return codes;
}

const getReflectionDisplay = (rating: number, label: string) => {
  const l = (label || '').toLowerCase();
  if (l.includes('not yet') || l.includes('not familiar') || rating === 1) {
    return '🔴 Not yet';
  }
  if (l.includes('ok') || l.includes('getting better') || rating === 2) {
    return '🟡 OK';
  }
  if (l.includes('good') || l.includes('confident') || rating === 3 || rating === 4) {
    return '🟢 Good';
  }
  return '-';
};

type GroupedReadingReport = {
  articleCode: string;
  title: string;
  status: 'completed' | 'not_done';
  latestCompletedAt: string | null;
  attempts: ReadingReportItem[];
};



type FlashcardStat = {
  item: LearningItem;
  record: StudentLearningRecord;
  attempts: Attempt[];
  accuracy: number;
  latest: Attempt | null;
};

type ToneStat = {
  item: LearningItem;
  record: StudentLearningRecord;
  attempts: any[];
  bestScore: number | null;
  latestScore: number | null;
  latest: any | null;
};

type ReadingReportItem = {
  id: string;
  articleCode: string;
  title: string;
  status: 'completed' | 'not_done';
  completedAt: string;
  durationText: string;
};

type WeeklyReadingGoal = {
  weekRange: string;
  assignedRange: string;
  dailyTarget: number;
  remainingToday: number;
};

function FlashcardExpandableRow({ stat }: { stat: FlashcardStat }) {
  const [expanded, setExpanded] = useState(false);

  const getEncodingDisplay = (completed: boolean) => {
    if (completed) {
      return { bg: '#d1fae5', color: '#059669', label: 'Done' };
    } else {
      return { bg: '#f1f5f9', color: '#475569', label: 'Pending / Not Yet' };
    }
  };

  const getLatestText = (latest: any) => {
    if (!latest) return 'No tests';
    const dateStr = new Date(latest.date).toLocaleDateString();
    return `${dateStr} ${latest.passed ? '✅' : '❌'}`;
  };

  const encoding = getEncodingDisplay(!!stat.record.encodingCompleted);
  const accuracyText = stat.attempts.length > 0 ? `${Math.round(stat.accuracy * 100)}%` : '-';
  const latestText = getLatestText(stat.latest);

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: '8px',
        marginBottom: '0.5rem',
        background: '#fff',
        overflow: 'hidden',
      }}
    >
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: '1rem',
          display: 'flex',
          alignItems: 'center',
          cursor: 'pointer',
          background: expanded ? '#f8fafc' : '#fff',
        }}
      >
        {/* Word column */}
        <div style={{ flex: '1.2', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span
            style={{
              fontSize: '1.2rem',
              fontWeight: 'bold',
              color: 'var(--primary)',
              minWidth: '120px',
            }}
          >
            {stat.item.focusExpression}
          </span>
        </div>

        {/* Encoding column */}
        <div style={{ flex: '1', textAlign: 'center' }}>
          <span
            style={{
              fontSize: '0.85rem',
              color: encoding.color,
              background: encoding.bg,
              padding: '0.25rem 0.5rem',
              borderRadius: '4px',
              fontWeight: 'bold',
              display: 'inline-block',
            }}
          >
            {encoding.label}
          </span>
        </div>

        {/* Retrieval column */}
        <div style={{ flex: '1', textAlign: 'center', color: 'var(--text-main)', fontSize: '0.95rem' }}>
          {stat.attempts.length}
        </div>

        {/* Accuracy column */}
        <div
          style={{
            flex: '1',
            textAlign: 'center',
            color: 'var(--text-main)',
            fontSize: '0.95rem',
            fontWeight: stat.accuracy >= 0.8 && stat.attempts.length > 0 ? 'bold' : 'normal',
          }}
        >
          {accuracyText}
        </div>

        {/* Latest Test column */}
        <div style={{ flex: '1.2', textAlign: 'right', color: 'var(--text-muted)', fontSize: '0.9rem', paddingRight: '1rem' }}>
          {latestText}
        </div>

        <div style={{ paddingLeft: '1rem', color: 'var(--text-muted)' }}>{expanded ? '▲' : '▼'}</div>
      </div>

      {expanded && (
        <div style={{ padding: '1rem', background: '#fafafa', borderTop: '1px solid var(--border)' }}>
          <h4
            style={{
              margin: '0 0 1rem 0',
              fontSize: '0.9rem',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
            }}
          >
            Self-Test History
          </h4>
          {stat.attempts.length === 0 ? (
            <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              No self-test records available.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {stat.attempts.map((a, idx) => (
                <div
                  key={a.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '0.5rem',
                    background: '#fff',
                    borderRadius: '4px',
                    border: '1px solid #e2e8f0',
                    fontSize: '0.9rem',
                  }}
                >
                  <span style={{ color: 'var(--text-muted)' }}>
                    {stat.attempts.length - idx}. {new Date(a.date).toLocaleString()}
                  </span>
                  <span style={{ fontWeight: 'bold', color: a.passed ? '#059669' : '#dc2626' }}>
                    {a.passed ? '✅ Passed' : '❌ Failed'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ToneExpandableRow({ stat }: { stat: ToneStat }) {
  const [expanded, setExpanded] = useState(false);

  const getLatestText = (latest: any) => {
    if (!latest) return '—';
    return new Date(latest.date).toLocaleDateString();
  };

  const latestScoreText = stat.latestScore !== null ? `${stat.latestScore.toFixed(1)}` : '—';
  const latestPracticeText = getLatestText(stat.latest);

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: '8px',
        marginBottom: '0.5rem',
        background: '#fff',
        overflow: 'hidden',
      }}
    >
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: '1rem',
          display: 'flex',
          alignItems: 'center',
          cursor: 'pointer',
          background: expanded ? '#f8fafc' : '#fff',
        }}
      >
        {/* Tone Card column */}
        <div style={{ flex: '1.2', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span
            style={{
              fontSize: '1.2rem',
              fontWeight: 'bold',
              color: 'var(--primary)',
              minWidth: '120px',
            }}
          >
            {stat.item.focusExpression}
          </span>
        </div>

        {/* Attempts column */}
        <div style={{ flex: '0.8', textAlign: 'center', color: 'var(--text-main)', fontSize: '0.95rem' }}>
          {stat.attempts.length}
        </div>

        {/* Reflection column */}
        <div style={{ flex: '1.2', textAlign: 'center', color: 'var(--text-main)', fontSize: '0.95rem' }}>
          {stat.attempts.length > 0 ? getReflectionDisplay(stat.attempts[0].selfRating, stat.attempts[0].selfRatingLabel) : '—'}
        </div>

        {/* Latest Practice column */}
        <div style={{ flex: '1.2', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          {latestPracticeText}
        </div>

        {/* AI Ref. column */}
        <div style={{ flex: '1', textAlign: 'right', color: 'var(--text-muted)', fontSize: '0.85rem', paddingRight: '1.5rem', fontWeight: '500' }}>
          {latestScoreText}
        </div>

        <div style={{ paddingLeft: '1rem', color: 'var(--text-muted)' }}>{expanded ? '▲' : '▼'}</div>
      </div>

      {expanded && (
        <div style={{ padding: '1rem', background: '#fafafa', borderTop: '1px solid var(--border)' }}>
          <h4
            style={{
              margin: '0 0 1rem 0',
              fontSize: '0.9rem',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
            }}
          >
            Tone Practice History
          </h4>
          {stat.attempts.length === 0 ? (
            <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              No practice records available.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {stat.attempts.map((a, idx) => (
                <div
                  key={a.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '0.5rem',
                    background: '#fff',
                    borderRadius: '4px',
                    border: '1px solid #e2e8f0',
                    fontSize: '0.9rem',
                  }}
                >
                  <span style={{ color: 'var(--text-muted)' }}>
                    {stat.attempts.length - idx}. {new Date(a.date).toLocaleString()}
                  </span>
                  <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <span style={{ color: 'var(--text-main)', fontWeight: '500' }}>
                      Reflection: {getReflectionDisplay(a.selfRating, a.selfRatingLabel)}
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      AI Ref.: <span style={{ fontWeight: 'bold' }}>{a.score !== null && a.score !== undefined ? a.score.toFixed(1) : '-'}</span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ReadingHistoryExpandableRow({ group }: { group: GroupedReadingReport }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: '8px',
        marginBottom: '0.5rem',
        background: '#fff',
        overflow: 'hidden',
      }}
    >
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'grid',
          gridTemplateColumns: '2.4fr 1fr 1.5fr 1fr 0.5fr',
          gap: '1rem',
          alignItems: 'center',
          padding: '0.9rem 0.5rem',
          cursor: 'pointer',
          background: expanded ? '#f8fafc' : '#fff',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontWeight: 700 }}>
            {group.articleCode}
          </div>
          <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>{group.title}</div>
        </div>

        <div>
          <span
            style={{
              display: 'inline-block',
              padding: '0.25rem 0.55rem',
              borderRadius: '999px',
              fontSize: '0.85rem',
              fontWeight: 'bold',
              background: group.status === 'completed' ? '#d1fae5' : '#fee2e2',
              color: group.status === 'completed' ? '#059669' : '#dc2626',
            }}
          >
            {group.status === 'completed' ? 'Completed' : 'Not Done'}
          </span>
        </div>

        <div style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>
          {group.latestCompletedAt ? new Date(group.latestCompletedAt).toLocaleDateString() : '-'}
        </div>

        <div style={{ color: 'var(--text-main)', fontSize: '0.95rem' }}>
          {group.attempts.length}
        </div>

        <div style={{ textAlign: 'right', paddingRight: '0.5rem', color: 'var(--text-muted)' }}>
          {expanded ? '▲' : '▼'}
        </div>
      </div>

      {expanded && (
        <div style={{ padding: '1rem', background: '#fafafa', borderTop: '1px solid var(--border)' }}>
          <h4
            style={{
              margin: '0 0 1rem 0',
              fontSize: '0.9rem',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
            }}
          >
            Attempt History
          </h4>
          {group.attempts.length === 0 ? (
            <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              No historical records available.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {group.attempts.map((a, idx) => (
                <div
                  key={a.id || idx}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '0.5rem',
                    background: '#fff',
                    borderRadius: '4px',
                    border: '1px solid #e2e8f0',
                    fontSize: '0.9rem',
                  }}
                >
                  <span style={{ color: 'var(--text-muted)' }}>
                    {group.attempts.length - idx}. {a.completedAt !== '-' ? new Date(a.completedAt).toLocaleString() : '-'}
                  </span>
                  <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Duration: {a.durationText}</span>
                    <span style={{ fontWeight: 'bold', color: a.status === 'completed' ? '#059669' : '#dc2626' }}>
                      {a.status === 'completed' ? '✅ Completed' : '❌ Not Done'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ReportCard() {
  const navigate = useNavigate();

  // Load preferences from localStorage if exists
  const getInitialPreference = (key: string, defaultValue: boolean): boolean => {
    try {
      const saved = localStorage.getItem(`report_pref_${key}`);
      return saved !== null ? JSON.parse(saved) : defaultValue;
    } catch {
      return defaultValue;
    }
  };

  const [showFlashcards, setShowFlashcards] = useState(() => getInitialPreference('flashcards', true));
  const [showTonePractice, setShowTonePractice] = useState(() => getInitialPreference('tonePractice', true));
  const [showReading, setShowReading] = useState(() => getInitialPreference('reading', true));
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle');

  const handleSavePreferences = () => {
    try {
      localStorage.setItem('report_pref_flashcards', JSON.stringify(showFlashcards));
      localStorage.setItem('report_pref_tonePractice', JSON.stringify(showTonePractice));
      localStorage.setItem('report_pref_reading', JSON.stringify(showReading));
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 1500);
    } catch (e) {
      console.error('[DEBUG] Failed to save preferences:', e);
    }
  };

  const [stats, setStats] = useState({ totalAttempts: 0, onboardedCount: 0 });
  const [flashcardStats, setFlashcardStats] = useState<FlashcardStat[]>([]);
  const [toneStats, setToneStats] = useState<ToneStat[]>([]);
  const [filter, setFilter] = useState<'all' | 'completed' | 'practicing' | 'weak'>('all');

  const [weeklyReadingGoal, setWeeklyReadingGoal] = useState<WeeklyReadingGoal>({
    weekRange: '-',
    assignedRange: '-',
    dailyTarget: 0,
    remainingToday: 0,
  });

  const [readingItems, setReadingItems] = useState<ReadingReportItem[]>([]);
  const [allReadingArticles, setAllReadingArticles] = useState<SheetReadingArticle[]>([]);

  useEffect(() => {
    const sId = db.getCurrentUserId();
    if (!sId) return;

    console.log(`[DEBUG] ReportCard loading for student: ${sId}`);

    const loadCloudData = async () => {
      try {
        const cloudDocs = await getStudentFlashcards(sId);
        console.log(`[DEBUG] ReportCard - Firebase flashcards count: ${cloudDocs.length}`);
        
        const cloudPairs = cloudDocs.map(doc => mapFirestoreToLocal(doc));
        
        // 1. Calculate Flashcard stats (Self-test only)
        const computedFlashcards: FlashcardStat[] = cloudPairs.map(({ item, record }) => {
          const history = (record as any).retrievalHistory || [];
          
          const selfTestAttempts: Attempt[] = history
            .filter((h: any) => h.practiceMode === 'selfTest')
            .map((h: any) => ({
              id: h.attemptId || `att_${Date.now()}_${Math.random()}`,
              wordId: record.learningItemId,
              studentId: record.studentId,
              date: h.createdAt,
              passed: h.isCorrect,
              mode: h.practiceMode || 'selfTest',
              typedAnswer: h.studentAnswer || '',
              expectedAnswer: h.expectedAnswer || '',
              usedHint: false,
            }))
            .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());

          const correctSelfTests = selfTestAttempts.filter(a => a.passed).length;
          const totalSelfTests = selfTestAttempts.length;
          const accuracy = totalSelfTests > 0 ? correctSelfTests / totalSelfTests : 0;

          return {
            item,
            record,
            attempts: selfTestAttempts,
            accuracy,
            latest: selfTestAttempts.length > 0 ? selfTestAttempts[0] : null
          };
        });

        // Sort flashcards by latest activity
        computedFlashcards.sort((a, b) => {
          if (!a.latest && !b.latest) return 0;
          if (!a.latest) return 1;
          if (!b.latest) return -1;
          return new Date(b.latest.date).getTime() - new Date(a.latest.date).getTime();
        });

        // Calculate summary stats based on flashcard self-tests only
        let totalOnboarded = 0;
        let totalRetrievalAttempts = 0;
        computedFlashcards.forEach(f => {
          if (f.record.encodingCompleted) totalOnboarded++;
          totalRetrievalAttempts += f.attempts.length;
        });

        // 2. Calculate Tone Practice stats
        const computedTone: ToneStat[] = cloudPairs
          .filter(({ record }) => {
            const isEligibleForTone = record.encodingStatus === 'done' || record.encodingCompleted || record.isConnectionBuilt;
            return isEligibleForTone;
          })
          .map(({ item, record }) => {
            const history = (record as any).retrievalHistory || [];
            
            const toneAttempts = history
              .filter((h: any) => h.practiceMode === 'tonePractice')
              .map((h: any) => ({
                id: h.attemptId || `att_${Date.now()}_${Math.random()}`,
                wordId: record.learningItemId,
                studentId: record.studentId,
                date: h.createdAt,
                isCorrect: h.isCorrect,
                selfRating: h.selfRating,
                selfRatingLabel: h.selfRatingLabel,
                score: h.score
              }))
              .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());

            const bestScore = toneAttempts.length > 0 
              ? Math.max(...toneAttempts.map((a: any) => a.score || 0)) 
              : null;
            const latestScore = toneAttempts.length > 0 ? toneAttempts[0].score : null;

            return {
              item,
              record,
              attempts: toneAttempts,
              bestScore,
              latestScore,
              latest: toneAttempts.length > 0 ? toneAttempts[0] : null
            };
          });

        console.log(`[DEBUG] ReportCard - Flashcards: ${computedFlashcards.length}, Tone cards with history: ${computedTone.length}`);

        setStats({
          totalAttempts: totalRetrievalAttempts,
          onboardedCount: totalOnboarded,
        });
        setFlashcardStats(computedFlashcards);
        setToneStats(computedTone);

      } catch (error) {
        console.error('[DEBUG] ReportCard - Failed to load cloud data:', error);
      }
    };

    loadCloudData();
  }, []);

  useEffect(() => {
    const sId = db.getCurrentUserId();
    if (!sId) return;

    // 1. Fetch History
    fetchReadingHistoryByStudentId(sId)
      .then((rows) => {
        const mapped: ReadingReportItem[] = rows.map((row) => ({
          id: row.historyId || `hist_${Math.random()}`,
          articleCode: row.articleCode,
          title: row.title,
          status: row.status,
          completedAt: row.completedAt || '-',
          durationText: row.durationSec ? `${row.durationSec}s` : '-',
        }));
        setReadingItems(mapped);
      })
      .catch((error) => {
        console.error('Failed to load reading history:', error);
      });

    // 2. Fetch Weekly Goal
    fetchReadingWeeklyGoalByStudentId(sId)
      .then((goal) => {
        console.log("studentId:", sId);
        console.log("weeklyGoal from Google Sheet:", goal);
        console.log("assignedRange:", goal?.assignedRange);

        if (goal) {
          setWeeklyReadingGoal({
            weekRange: goal.weekRange || '-',
            assignedRange: goal.assignedRange || '-',
            dailyTarget: goal.dailyTarget || 0,
            remainingToday: goal.remainingToday || 0,
          });
        }
      })
      .catch((error) => {
        console.error('Failed to load reading weekly goals:', error);
      });

    // 3. Fetch All Articles
    fetchAllReadingArticles()
      .then((articles) => {
        setAllReadingArticles(articles);
      })
      .catch((error) => {
        console.error('Failed to load reading articles:', error);
      });
  }, []);

  const filteredFlashcardStats = flashcardStats.filter((s) => {
    if (filter === 'all') return true;
    if (filter === 'practicing' && (s.record.status === 'learning' || s.record.status === 'practicing')) {
      return true;
    }
    return s.record.status === filter;
  });

  const renderFlashcardSection = () => (
    <>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1.5rem',
          marginBottom: '3rem',
        }}
      >
        <div
          className="card"
          style={{ background: '#f8fafc', padding: '1.5rem', border: '1px solid var(--border)' }}
        >
          <h3
            style={{
              margin: '0 0 0.5rem 0',
              color: 'var(--text-muted)',
              fontSize: '0.9rem',
              textTransform: 'uppercase',
            }}
          >
            Words Onboarded
          </h3>
          <p style={{ fontSize: '2.5rem', margin: 0, fontWeight: 800, color: 'var(--text-main)' }}>
            {stats.onboardedCount}
          </p>
        </div>

        <div
          className="card"
          style={{ background: '#f8fafc', padding: '1.5rem', border: '1px solid var(--border)' }}
        >
          <h3
            style={{
              margin: '0 0 0.5rem 0',
              color: 'var(--text-muted)',
              fontSize: '0.9rem',
              textTransform: 'uppercase',
            }}
          >
            Retrieval Tests
          </h3>
          <p style={{ fontSize: '2.5rem', margin: 0, fontWeight: 800, color: 'var(--primary)' }}>
            {stats.totalAttempts}
          </p>
        </div>
      </div>

      <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
        <div
          style={{
            padding: '1.5rem',
            borderBottom: '1px solid var(--border)',
            background: '#fefefe',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <h2 style={{ margin: 0 }}>Flashcard History</h2>

          <div
            style={{
              display: 'flex',
              gap: '0.5rem',
              background: '#f1f5f9',
              padding: '0.25rem',
              borderRadius: '8px',
            }}
          >
            <button
              onClick={() => setFilter('all')}
              style={{
                background: filter === 'all' ? '#fff' : 'transparent',
                border: 'none',
                padding: '0.4rem 1rem',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: filter === 'all' ? 'bold' : 'normal',
                color: filter === 'all' ? 'var(--text-main)' : 'var(--text-muted)',
                boxShadow: filter === 'all' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
              }}
            >
              All
            </button>
            <button
              onClick={() => setFilter('completed')}
              style={{
                background: filter === 'completed' ? '#fff' : 'transparent',
                border: 'none',
                padding: '0.4rem 1rem',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: filter === 'completed' ? 'bold' : 'normal',
                color: filter === 'completed' ? '#059669' : 'var(--text-muted)',
                boxShadow: filter === 'completed' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
              }}
            >
              Mastered
            </button>
            <button
              onClick={() => setFilter('practicing')}
              style={{
                background: filter === 'practicing' ? '#fff' : 'transparent',
                border: 'none',
                padding: '0.4rem 1rem',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: filter === 'practicing' ? 'bold' : 'normal',
                color: filter === 'practicing' ? '#0284c7' : 'var(--text-muted)',
                boxShadow: filter === 'practicing' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
              }}
            >
              Practicing
            </button>
            <button
              onClick={() => setFilter('weak')}
              style={{
                background: filter === 'weak' ? '#fff' : 'transparent',
                border: 'none',
                padding: '0.4rem 1rem',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: filter === 'weak' ? 'bold' : 'normal',
                color: filter === 'weak' ? '#dc2626' : 'var(--text-muted)',
                boxShadow: filter === 'weak' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
              }}
            >
              Weak
            </button>
          </div>
        </div>

        <div style={{ padding: '1.5rem' }}>
          <div
            style={{
              display: 'flex',
              padding: '0 1rem 0.5rem 1rem',
              color: 'var(--text-muted)',
              fontSize: '0.85rem',
              fontWeight: 'bold',
              textTransform: 'uppercase',
              borderBottom: '1px solid var(--border)',
              marginBottom: '0.75rem',
            }}
          >
            <div style={{ flex: '1.2' }}>Word</div>
            <div style={{ flex: '1', textAlign: 'center' }}>Encoding</div>
            <div style={{ flex: '1', textAlign: 'center' }}>Retrieval</div>
            <div style={{ flex: '1', textAlign: 'center' }}>Accuracy</div>
            <div style={{ flex: '1.2', textAlign: 'right', paddingRight: '2rem' }}>Latest Test</div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {filteredFlashcardStats.map((stat) => (
              <FlashcardExpandableRow key={stat.record.id} stat={stat} />
            ))}
            {filteredFlashcardStats.length === 0 && (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                No words match this filter.
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );

  const renderTonePracticeSection = () => (
    <>
      <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
        <div
          style={{
            padding: '1.5rem',
            borderBottom: '1px solid var(--border)',
            background: '#fefefe',
          }}
        >
          <h2 style={{ margin: 0 }}>Tone Practice History</h2>
        </div>

        <div style={{ padding: '1.5rem' }}>
          <div
            style={{
              display: 'flex',
              padding: '0 1rem 0.5rem 1rem',
              color: 'var(--text-muted)',
              fontSize: '0.85rem',
              fontWeight: 'bold',
              textTransform: 'uppercase',
              borderBottom: '1px solid var(--border)',
              marginBottom: '0.75rem',
            }}
          >
            <div style={{ flex: '1.2' }}>Tone Card</div>
            <div style={{ flex: '0.8', textAlign: 'center' }}>Attempts</div>
            <div style={{ flex: '1.2', textAlign: 'center' }}>Reflection</div>
            <div style={{ flex: '1.2', textAlign: 'center' }}>Latest Practice</div>
            <div style={{ flex: '1', textAlign: 'right', paddingRight: '2.5rem' }}>AI Ref.</div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {toneStats.map((stat) => (
              <ToneExpandableRow key={stat.record.id} stat={stat} />
            ))}
            {toneStats.length === 0 && (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                No tone practice history available.
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );

  const assignedCodes = parseAssignedRange(weeklyReadingGoal.assignedRange);

  const groupedReadingReports: GroupedReadingReport[] = assignedCodes.map(code => {
    const article = allReadingArticles.find(a => a.articleCode === code);
    const title = article ? article.title : 'Unknown Title';

    // Sort attempts newest first
    const attempts = readingItems
      .filter(item => item.articleCode === code)
      .sort((a, b) => {
        const timeA = a.completedAt !== '-' ? new Date(a.completedAt).getTime() : 0;
        const timeB = b.completedAt !== '-' ? new Date(b.completedAt).getTime() : 0;
        return timeB - timeA;
      });

    const hasCompleted = attempts.some(a => a.status === 'completed');
    const completedAttempts = attempts.filter(a => a.status === 'completed');

    const latestCompletedAt = completedAttempts.length > 0
      ? completedAttempts[0].completedAt
      : null;

    return {
      articleCode: code,
      title,
      status: hasCompleted ? 'completed' : 'not_done',
      latestCompletedAt,
      attempts
    };
  });

  const assignedReadingCount = assignedCodes.length;
  const completedReadingCount = groupedReadingReports.filter(g => g.status === 'completed').length;
  const calculatedCompletionRate =
    assignedReadingCount > 0 ? Math.round((completedReadingCount / assignedReadingCount) * 100) : 0;

  const renderReadingSection = () => (
    <>
      <div
        className="card"
        style={{
          padding: '1.5rem',
          marginBottom: '2rem',
          background: '#f8fafc',
          border: '1px solid var(--border)',
        }}
      >
        <h2 style={{ marginTop: 0, marginBottom: '1rem' }}>{UI_LABELS.WEEKLY_READING_GOAL_TITLE}</h2>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '1rem',
          }}
        >
          <div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
              Week Range
            </div>
            <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>{weeklyReadingGoal.weekRange}</div>
          </div>

          <div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
              Assigned Range
            </div>
            <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>{weeklyReadingGoal.assignedRange}</div>
          </div>

          <div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
              Daily Target
            </div>
            <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>
              {weeklyReadingGoal.dailyTarget} articles / day
            </div>
          </div>

          <div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
              Remaining Today
            </div>
            <div
              style={{
                fontWeight: 700,
                fontSize: '1.05rem',
                color: weeklyReadingGoal.remainingToday > 0 ? '#dc2626' : '#059669',
              }}
            >
              {weeklyReadingGoal.remainingToday}
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1.5rem',
          marginBottom: '3rem',
        }}
      >
        <div className="card" style={{ background: '#f8fafc', padding: '1.5rem', border: '1px solid var(--border)' }}>
          <h3 style={{ margin: '0 0 0.5rem 0', color: 'var(--text-muted)', fontSize: '0.9rem', textTransform: 'uppercase' }}>
            Assigned Articles
          </h3>
          <p style={{ fontSize: '2.5rem', margin: 0, fontWeight: 800, color: 'var(--text-main)' }}>
            {assignedReadingCount}
          </p>
        </div>

        <div className="card" style={{ background: '#f8fafc', padding: '1.5rem', border: '1px solid var(--border)' }}>
          <h3 style={{ margin: '0 0 0.5rem 0', color: 'var(--text-muted)', fontSize: '0.9rem', textTransform: 'uppercase' }}>
            Completed Articles
          </h3>
          <p style={{ fontSize: '2.5rem', margin: 0, fontWeight: 800, color: '#059669' }}>
            {completedReadingCount}
          </p>
        </div>

        <div className="card" style={{ background: '#f8fafc', padding: '1.5rem', border: '1px solid var(--border)' }}>
          <h3 style={{ margin: '0 0 0.5rem 0', color: 'var(--text-muted)', fontSize: '0.9rem', textTransform: 'uppercase' }}>
            Completion Rate
          </h3>
          <p style={{ fontSize: '2.5rem', margin: 0, fontWeight: 800, color: 'var(--primary)' }}>
            {calculatedCompletionRate}%
          </p>
        </div>

        <div className="card" style={{ background: '#f8fafc', padding: '1.5rem', border: '1px solid var(--border)' }}>
          <h3 style={{ margin: '0 0 0.5rem 0', color: 'var(--text-muted)', fontSize: '0.9rem', textTransform: 'uppercase' }}>
            Remaining This Week
          </h3>
          <p style={{ fontSize: '2.5rem', margin: 0, fontWeight: 800, color: '#dc2626' }}>
            {assignedReadingCount - completedReadingCount}
          </p>
        </div>
      </div>

      <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
        <div
          style={{
            padding: '1.5rem',
            borderBottom: '1px solid var(--border)',
            background: '#fefefe',
          }}
        >
          <h2 style={{ margin: 0 }}>{UI_LABELS.READING_HISTORY_TITLE}</h2>
        </div>

        <div style={{ padding: '1.5rem' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '2.4fr 1fr 1.5fr 1fr 0.5fr',
              gap: '1rem',
              padding: '0 0.5rem 0.75rem 0.5rem',
              color: 'var(--text-muted)',
              fontSize: '0.85rem',
              fontWeight: 'bold',
              textTransform: 'uppercase',
              borderBottom: '1px solid var(--border)',
              marginBottom: '0.75rem',
            }}
          >
            <div>Article</div>
            <div>Status</div>
            <div>Latest Completed</div>
            <div>Attempts</div>
            <div></div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {groupedReadingReports.map((group) => (
              <ReadingHistoryExpandableRow key={group.articleCode} group={group} />
            ))}

            {groupedReadingReports.length === 0 && (
              <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                No assigned reading articles.
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '1rem' }}>
      <button
        onClick={() => navigate(`/student/${db.getCurrentUserId()}`)}
        className="btn btn-outline"
        style={{ marginBottom: '2rem', background: '#fff' }}
      >
        &larr; Back to Dashboard
      </button>

      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ margin: '0 0 0.5rem 0', fontSize: '2.5rem', color: 'var(--primary)' }}>
          {UI_LABELS.REPORT_TITLE}
        </h1>
        <p style={{ color: 'var(--text-muted)', margin: 0 }}>
          Review your weekly performance metrics.
        </p>
      </div>

      {/* Visibility Filters Panel */}
      {/* Visibility Filters Panel */}
      <div
        style={{
          background: '#fff',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          padding: '1rem 1.25rem',
          marginBottom: '2rem',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <span
            style={{
              fontSize: '0.8rem',
              fontWeight: 'bold',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Select Report Modules to Display
          </span>
          <button
            onClick={handleSavePreferences}
            style={{
              background: '#f1f5f9',
              border: '1px solid #cbd5e1',
              color: 'var(--text-main)',
              padding: '0.25rem 0.6rem',
              fontSize: '0.75rem',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 'bold',
              transition: 'all 0.2s',
            }}
          >
            {saveStatus === 'saved' ? 'Saved! ✓' : 'Save Preference'}
          </button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
          {/* Flashcards Toggle */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              background: showFlashcards ? '#eff6ff' : '#fff',
              border: `1px solid ${showFlashcards ? '#bfdbfe' : 'var(--border)'}`,
              color: showFlashcards ? '#1e40af' : 'var(--text-muted)',
              padding: '0.4rem 1rem',
              borderRadius: '999px',
              cursor: 'pointer',
              fontWeight: 500,
              fontSize: '0.85rem',
              transition: 'all 0.2s ease',
              userSelect: 'none',
            }}
          >
            <input
              type="checkbox"
              checked={showFlashcards}
              onChange={(e) => setShowFlashcards(e.target.checked)}
              style={{
                cursor: 'pointer',
                accentColor: '#3b82f6',
                width: '14px',
                height: '14px',
              }}
            />
            Flashcards
          </label>

          {/* Tone Practice Toggle */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              background: showTonePractice ? '#fdf4ff' : '#fff',
              border: `1px solid ${showTonePractice ? '#f5d0fe' : 'var(--border)'}`,
              color: showTonePractice ? '#86198f' : 'var(--text-muted)',
              padding: '0.4rem 1rem',
              borderRadius: '999px',
              cursor: 'pointer',
              fontWeight: 500,
              fontSize: '0.85rem',
              transition: 'all 0.2s ease',
              userSelect: 'none',
            }}
          >
            <input
              type="checkbox"
              checked={showTonePractice}
              onChange={(e) => setShowTonePractice(e.target.checked)}
              style={{
                cursor: 'pointer',
                accentColor: '#d946ef',
                width: '14px',
                height: '14px',
              }}
            />
            Tone Practice
          </label>

          {/* Reading Toggle */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              background: showReading ? '#fff7ed' : '#fff',
              border: `1px solid ${showReading ? '#fed7aa' : 'var(--border)'}`,
              color: showReading ? '#c2410c' : 'var(--text-muted)',
              padding: '0.4rem 1rem',
              borderRadius: '999px',
              cursor: 'pointer',
              fontWeight: 500,
              fontSize: '0.85rem',
              transition: 'all 0.2s ease',
              userSelect: 'none',
            }}
          >
            <input
              type="checkbox"
              checked={showReading}
              onChange={(e) => setShowReading(e.target.checked)}
              style={{
                cursor: 'pointer',
                accentColor: '#f97316',
                width: '14px',
                height: '14px',
              }}
            />
            Reading
          </label>
        </div>
      </div>

      {showFlashcards && (
        <div style={{ marginBottom: '3rem' }}>{renderFlashcardSection()}</div>
      )}

      {showTonePractice && (
        <div style={{ marginBottom: '3rem' }}>{renderTonePracticeSection()}</div>
      )}

      {showReading && (
        <div>{renderReadingSection()}</div>
      )}
    </div>
  );
}