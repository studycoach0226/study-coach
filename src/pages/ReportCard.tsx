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

type GroupedReadingReport = {
  articleCode: string;
  title: string;
  status: 'completed' | 'not_done';
  latestCompletedAt: string | null;
  attempts: ReadingReportItem[];
};

type WordStat = {
  item: LearningItem;
  record: StudentLearningRecord;
  attempts: Attempt[];
  accuracy: number;
  latest: Attempt | null;
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

function ExpandableRow({ stat }: { stat: WordStat }) {
  const [expanded, setExpanded] = useState(false);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return { bg: '#d1fae5', color: '#059669', label: 'Mastered' };
      case 'weak':
        return { bg: '#fee2e2', color: '#dc2626', label: 'Weak' };
      case 'practicing':
      case 'learning':
        return { bg: '#e0f2fe', color: '#0284c7', label: 'Practicing' };
      default:
        return { bg: '#f1f5f9', color: '#475569', label: 'Pending' };
    }
  };

  const sColor = getStatusColor(stat.record.status);
  const accuracyText = stat.attempts.length > 0 ? `${Math.round(stat.accuracy * 100)}%` : '-';
  const latestText = stat.latest
    ? `${new Date(stat.latest.date).toLocaleDateString()} ${stat.latest.passed ? '✅' : '❌'}`
    : 'No attempts';

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
        <div style={{ flex: '1', display: 'flex', alignItems: 'center', gap: '1rem' }}>
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
          <span
            style={{
              fontSize: '0.85rem',
              color: sColor.color,
              background: sColor.bg,
              padding: '0.25rem 0.5rem',
              borderRadius: '4px',
              fontWeight: 'bold',
            }}
          >
            {sColor.label}
          </span>
        </div>

        <div style={{ flex: '1', textAlign: 'center', color: 'var(--text-main)', fontSize: '0.95rem' }}>
          {stat.attempts.length}
        </div>

        <div
          style={{
            flex: '1',
            textAlign: 'center',
            color: 'var(--text-main)',
            fontSize: '0.95rem',
            fontWeight: stat.accuracy >= 0.8 ? 'bold' : 'normal',
          }}
        >
          {accuracyText}
        </div>

        <div style={{ flex: '1', textAlign: 'right', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
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
            Attempt History
          </h4>
          {stat.attempts.length === 0 ? (
            <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              No historical records available.
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

  const [stats, setStats] = useState({ totalAttempts: 0, onboardedCount: 0 });
  const [wordStats, setWordStats] = useState<WordStat[]>([]);
  const [filter, setFilter] = useState<'all' | 'completed' | 'practicing' | 'weak'>('all');
  const [reportMode, setReportMode] = useState<'all' | 'flashcard' | 'reading'>('all');

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
        
        let totalOnboarded = 0;
        let totalRetrievalAttempts = 0;

        const computed: WordStat[] = cloudPairs.map(({ item, record }) => {
          if (record.encodingCompleted) totalOnboarded++;
          
          const history = (record as any).retrievalHistory || [];
          totalRetrievalAttempts += (record as any).retrievalCount || 0;

          // Map retrievalHistory entries back to Attempt structure
          const attempts: Attempt[] = history.map((h: any) => ({
            id: h.attemptId || `att_${Date.now()}_${Math.random()}`,
            wordId: record.learningItemId,
            studentId: record.studentId,
            date: h.createdAt,
            passed: h.isCorrect,
            mode: h.practiceMode || 'flashcard',
            typedAnswer: h.studentAnswer || '',
            expectedAnswer: h.expectedAnswer || '',
            usedHint: false
          })).sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());

          console.log(`[DEBUG] Card: ${item.focusExpression}, retrievalCount: ${record.retrievalCount}, historyLength: ${history.length}`);

          return {
            item,
            record,
            attempts,
            accuracy: record.retrievalCount && record.retrievalCount > 0 
              ? (record.correctCount || 0) / record.retrievalCount 
              : 0,
            latest: attempts.length > 0 ? attempts[0] : null
          };
        });

        computed.sort((a, b) => {
          if (!a.latest && !b.latest) return 0;
          if (!a.latest) return 1;
          if (!b.latest) return -1;
          return new Date(b.latest.date).getTime() - new Date(a.latest.date).getTime();
        });

        console.log(`[DEBUG] ReportCard - Final rendered count: ${computed.length}`);

        setStats({
          totalAttempts: totalRetrievalAttempts,
          onboardedCount: totalOnboarded,
        });
        setWordStats(computed);

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

  const filteredStats = wordStats.filter((s) => {
    if (filter === 'all') return true;
    if (filter === 'practicing' && (s.record.status === 'learning' || s.record.status === 'practicing')) {
      return true;
    }
    return s.record.status === filter;
  });

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
            Retrieval
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
          <h2 style={{ margin: 0 }}>{UI_LABELS.FLASHCARD_HISTORY_TITLE}</h2>

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
            }}
          >
            <div style={{ flex: '1' }}>Word</div>
            <div style={{ flex: '1', textAlign: 'center' }}>Retrieval</div>
            <div style={{ flex: '1', textAlign: 'center' }}>Accuracy</div>
            <div style={{ flex: '1', textAlign: 'right', paddingRight: '2rem' }}>Latest Activity</div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {filteredStats.map((stat) => (
              <ExpandableRow key={stat.record.id} stat={stat} />
            ))}
            {filteredStats.length === 0 && (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                No words match this filter.
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );

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
          Review your weekly flashcard and reading performance.
        </p>
      </div>

      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          background: '#f1f5f9',
          padding: '0.3rem',
          borderRadius: '10px',
          width: 'fit-content',
          marginBottom: '2rem',
        }}
      >
        <button
          onClick={() => setReportMode('all')}
          style={{
            background: reportMode === 'all' ? '#fff' : 'transparent',
            border: 'none',
            padding: '0.5rem 1rem',
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: reportMode === 'all' ? 'bold' : 'normal',
            color: reportMode === 'all' ? 'var(--text-main)' : 'var(--text-muted)',
          }}
        >
          All
        </button>
        <button
          onClick={() => setReportMode('flashcard')}
          style={{
            background: reportMode === 'flashcard' ? '#fff' : 'transparent',
            border: 'none',
            padding: '0.5rem 1rem',
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: reportMode === 'flashcard' ? 'bold' : 'normal',
            color: reportMode === 'flashcard' ? '#0284c7' : 'var(--text-muted)',
          }}
        >
          Flashcard
        </button>
        <button
          onClick={() => setReportMode('reading')}
          style={{
            background: reportMode === 'reading' ? '#fff' : 'transparent',
            border: 'none',
            padding: '0.5rem 1rem',
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: reportMode === 'reading' ? 'bold' : 'normal',
            color: reportMode === 'reading' ? '#059669' : 'var(--text-muted)',
          }}
        >
          Reading
        </button>
      </div>

      {(reportMode === 'all' || reportMode === 'flashcard') && (
        <div style={{ marginBottom: '3rem' }}>{renderFlashcardSection()}</div>
      )}

      {(reportMode === 'all' || reportMode === 'reading') && <div>{renderReadingSection()}</div>}
    </div>
  );
}