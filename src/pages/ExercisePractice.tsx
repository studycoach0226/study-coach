import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '../lib/db';
import { generateMeaningFromContext } from '../lib/aiService';
import { playUnifiedAudio } from '../lib/audioUtils';
import { fetchExerciseById, SheetExerciseQuestion } from '../lib/exerciseContent';

type MarkedWord = {
  word: string;
  meaningStr: string;
  selectedForFlashcard: boolean;
};

export default function ExercisePractice() {
  const { itemId } = useParams<{ itemId: string }>();
  const navigate = useNavigate();
  const studentId = db.getCurrentUserId();

  const [exercise, setExercise] = useState<SheetExerciseQuestion | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // State for MCQ
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);

  // State for Highlighting (Universal Clickability)
  const [markedWords, setMarkedWords] = useState<MarkedWord[]>([]);
  const [isAiLoading, setIsAiLoading] = useState<Record<string, boolean>>({});
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (!itemId) return;

    fetchExerciseById(itemId)
      .then((data) => {
        if (data) {
          setExercise(data);
        } else {
          setError('Exercise not found.');
        }
      })
      .catch((err) => {
        console.error('❌ Failed to fetch exercise:', err);
        setError('Failed to load exercise.');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [itemId]);

  // Construct unified text for highlighting
  const unifiedText = useMemo(() => {
    if (!exercise) return '';
    let text = exercise.questionText + '\n\n';
    text += `(A) ${exercise.optionA}\n`;
    text += `(B) ${exercise.optionB}\n`;
    text += `(C) ${exercise.optionC}\n`;
    text += `(D) ${exercise.optionD}\n`;
    return text;
  }, [exercise]);

  const tokens = useMemo(() => {
    return unifiedText.split(/(\s+)/);
  }, [unifiedText]);

  const normalizeWord = (word: string) => {
    return word
      .trim()
      .toLowerCase()
      .replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, '');
  };

  const isSelectableToken = (token: string) => normalizeWord(token).length > 0;

  const getMarkedWord = (token: string) => {
    const normalized = normalizeWord(token);
    return markedWords.find((item) => item.word === normalized);
  };

  const handleTokenClick = async (token: string) => {
    const normalized = normalizeWord(token);
    if (!normalized) return;

    const existing = markedWords.find((item) => item.word === normalized);
    if (existing) {
      setMarkedWords(prev => prev.filter((item) => item.word !== normalized));
    } else {
      const newWord: MarkedWord = {
        word: normalized,
        meaningStr: '',
        selectedForFlashcard: true
      };
      setMarkedWords(prev => [...prev, newWord]);
      fetchAiMeaning(normalized);
    }
  };

  const fetchAiMeaning = async (word: string) => {
    setIsAiLoading(prev => ({ ...prev, [word]: true }));
    try {
      const meaning = await generateMeaningFromContext(word, unifiedText);
      setMarkedWords(prev => 
        prev.map(item => item.word === word ? { ...item, meaningStr: meaning } : item)
      );
    } catch (error) {
      console.error('Failed to fetch AI meaning:', error);
    } finally {
      setIsAiLoading(prev => ({ ...prev, [word]: false }));
    }
  };

  const handleToggleFlashcard = (word: string) => {
    setMarkedWords(prev => prev.map(item => 
      item.word === word ? { ...item, selectedForFlashcard: !item.selectedForFlashcard } : item
    ));
  };

  const handleMeaningChange = (word: string, val: string) => {
    setMarkedWords(prev => prev.map(item => 
      item.word === word ? { ...item, meaningStr: val } : item
    ));
  };

  const handleSaveToFlashcards = () => {
    const selected = markedWords.filter(i => i.selectedForFlashcard);
    if (selected.length === 0) return;

    const missingMeanings = selected.filter(i => !i.meaningStr.trim());
    if (missingMeanings.length > 0) {
      alert("Please provide a meaning for all selected words before saving.");
      return;
    }

    selected.forEach(item => {
      const existingItems = db.getLearningItems();
      const existingItem = existingItems.find(i =>
        (i.focusExpression && i.focusExpression.toLowerCase() === item.word.toLowerCase()) ||
        (i.chunk && i.chunk.toLowerCase() === item.word.toLowerCase())
      );

      const sId = db.getCurrentUserId();
      if (existingItem) {
        if (!existingItem.chunkTranslation || existingItem.chunkTranslation.trim() === '' || existingItem.chunkTranslation === '-') {
          db.updateLearningItem({
            ...existingItem,
            chunkTranslation: item.meaningStr
          });
        }
        if (sId) {
          const existingRecord = db.getLearningRecord(sId, existingItem.id);
          if (!existingRecord) {
            db.saveLearningRecord({
              id: 'lr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
              studentId: sId,
              learningItemId: existingItem.id,
              studentConnections: {},
              audioUrls: {},
              status: 'new',
              encodingCompleted: false,
              savedToLibrary: true,
              startedAt: Date.now(),
              updatedAt: Date.now()
            });
          }
        }
      } else {
        db.createLearningItem({
          itemType: 'chunk',
          chunk: item.word,
          chunkTranslation: item.meaningStr,
          focusExpression: item.word,
          languageDirection: 'en-zh',
          createdBy: 'student',
          assignedByTeacher: false,
          assignedToAll: false,
        });
      }
    });

    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  if (loading) {
    return (
      <div style={{ maxWidth: '800px', margin: '2rem auto', padding: '1rem', textAlign: 'center' }}>
        <p>載入練習題中...</p>
      </div>
    );
  }

  if (error || !exercise) {
    return (
      <div style={{ maxWidth: '800px', margin: '2rem auto', padding: '1rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--danger)' }}>{error || 'Exercise not found.'}</p>
        <button onClick={() => navigate(`/student/${studentId}/exercises`)} className="btn btn-outline">
          返回練習列表
        </button>
      </div>
    );
  }

  const isCorrect = selectedOption === exercise.correctAnswer;

  return (
    <div style={{ maxWidth: '900px', margin: '2rem auto', padding: '0 1rem' }}>
      <button 
        onClick={() => navigate(`/student/${studentId}/exercises`)} 
        className="btn btn-outline" 
        style={{ marginBottom: '1.5rem', background: '#fff' }}
      >
        &larr; Back to Exercises
      </button>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        {/* MCQ Passage-Style Card */}
        <div className="card" style={{ padding: '2.5rem' }}>
          <h2 style={{ marginTop: 0, marginBottom: '1.5rem', borderBottom: '2px solid var(--border)', paddingBottom: '0.5rem' }}>
            Exercise {exercise.exerciseCode}
          </h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', fontSize: '0.95rem' }}>
            Click any unknown word to mark it.
          </p>

          <div style={{ 
            fontSize: '1.25rem', 
            lineHeight: '1.8', 
            whiteSpace: 'pre-wrap', 
            color: 'var(--text-main)',
            background: '#f8fafc',
            padding: '2rem',
            borderRadius: '12px',
            border: '1px solid var(--border)'
          }}>
            {tokens.map((token, idx) => {
              if (/^\s+$/.test(token)) return <span key={idx}>{token}</span>;
              if (!isSelectableToken(token)) return <span key={idx}>{token}</span>;

              const isMarked = !!getMarkedWord(token);

              return (
                <span
                  key={idx}
                  onClick={() => handleTokenClick(token)}
                  style={{
                    backgroundColor: isMarked ? '#bfdbfe' : 'transparent',
                    cursor: 'pointer',
                    borderRadius: '4px',
                    padding: '0 2px',
                    transition: 'all 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    if (!isMarked) e.currentTarget.style.backgroundColor = '#dbeafe';
                  }}
                  onMouseLeave={(e) => {
                    if (!isMarked) e.currentTarget.style.backgroundColor = 'transparent';
                    else e.currentTarget.style.backgroundColor = '#bfdbfe';
                  }}
                >
                  {token}
                </span>
              );
            })}
          </div>
        </div>

        {/* Answer Selection Area */}
        <div className="card" style={{ padding: '2rem', border: '2px solid var(--primary)', background: '#f0f9ff' }}>
          <h3 style={{ marginTop: 0, marginBottom: '1.5rem' }}>🎯 Choose Your Answer</h3>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
            {['A', 'B', 'C', 'D'].map((label) => (
              <button
                key={label}
                onClick={() => {
                  setSelectedOption(label);
                  setShowFeedback(false);
                }}
                style={{
                  width: '60px',
                  height: '60px',
                  borderRadius: '12px',
                  border: '2px solid',
                  borderColor: selectedOption === label ? 'var(--primary)' : 'var(--border)',
                  background: selectedOption === label ? 'var(--primary)' : '#fff',
                  color: selectedOption === label ? '#fff' : 'var(--text-main)',
                  fontSize: '1.2rem',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
            <button
              className="btn btn-primary"
              style={{ padding: '0.75rem 2.5rem', fontSize: '1.1rem' }}
              onClick={() => setShowFeedback(true)}
              disabled={!selectedOption}
            >
              Check Answer
            </button>

            {showFeedback && (
              <div style={{ 
                fontSize: '1.2rem', 
                fontWeight: 'bold', 
                color: isCorrect ? 'var(--success)' : 'var(--danger)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                {isCorrect ? '✅ Correct!' : '❌ Incorrect. Try again!'}
              </div>
            )}
          </div>
        </div>

        {/* Simplified Unknown Words List */}
        {markedWords.length > 0 && (
          <div className="card" style={{ padding: '1.5rem', background: '#fff', border: '1px solid var(--border)' }}>
            <h3 style={{ marginTop: 0, marginBottom: '1.25rem', color: 'var(--text-main)' }}>📖 Marked Unknown Words</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {markedWords.map((item) => (
                <div 
                  key={item.word}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.85rem 1rem',
                    borderRadius: '10px',
                    background: '#f8fafc',
                    border: '1px solid var(--border)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: 1 }}>
                    <input
                      type="checkbox"
                      checked={item.selectedForFlashcard}
                      onChange={() => handleToggleFlashcard(item.word)}
                      style={{ width: '1.2rem', height: '1.2rem', cursor: 'pointer' }}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>{item.word}</span>
                        <button 
                          onClick={() => playUnifiedAudio(item.word)}
                          className="btn btn-outline"
                          style={{ 
                            padding: '0.2rem 0.5rem', 
                            fontSize: '1rem', 
                            borderRadius: '50%',
                            width: '32px',
                            height: '32px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            border: 'none',
                            background: '#e2e8f0'
                          }}
                        >
                          🔊
                        </button>
                      </div>
                      <input
                        type="text"
                        value={item.meaningStr}
                        onChange={(e) => handleMeaningChange(item.word, e.target.value)}
                        placeholder={isAiLoading[item.word] ? "Fetching AI meaning..." : "Enter meaning..."}
                        style={{
                          marginTop: '0.35rem',
                          fontSize: '0.9rem',
                          padding: '0.4rem 0.75rem',
                          border: '1px solid var(--border)',
                          borderRadius: '6px',
                          outline: 'none',
                          background: '#fff',
                          width: '100%',
                          maxWidth: '400px'
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: '1.5rem', borderTop: '1px solid var(--border)', paddingTop: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <button
                className="btn btn-primary"
                onClick={handleSaveToFlashcards}
                disabled={markedWords.filter(i => i.selectedForFlashcard).length === 0}
              >
                ➕ Add Selected to Flashcards
              </button>
              {saveSuccess && (
                <span style={{ color: 'var(--success)', fontWeight: 600 }}>✅ Saved to Library!</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
