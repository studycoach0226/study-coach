import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { playUnifiedAudio } from '../lib/audioUtils';

type Step = 'source' | 'mode' | 'setup' | 'practice' | 'summary';
type Source = 'flashcards' | 'reading' | 'mixed';
type Mode = 'zh-en' | 'en-zh' | 'qa' | 'transformation';

export default function ListenSpeak() {
  const { studentId } = useParams<{ studentId: string }>();
  const navigate = useNavigate();

  // Navigation state
  const [step, setStep] = useState<Step>('source');
  const [source, setSource] = useState<Source>('flashcards');
  const [mode, setMode] = useState<Mode>('zh-en');
  const [questionCount, setQuestionCount] = useState<number>(5);

  // Practice state
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);

  // Mock data for initial version
  const mockQuestions = [
    { text: "How do you say '等待' in the sentence 'I am waiting for a bus'?", target: "waiting for" },
    { text: "Transform this sentence into a question: 'Jimmy is waiting for a bus.'", target: "Is Jimmy waiting for a bus?" },
    { text: "What was the main topic of your last reading assignment?", target: "The mock topic" }
  ];

  const currentQuestion = mockQuestions[currentQuestionIndex % mockQuestions.length];

  const startPractice = () => {
    setStep('practice');
    setCurrentQuestionIndex(0);
    setFeedback(null);
    setIsSubmitted(false);
  };

  const handleNext = () => {
    if (currentQuestionIndex + 1 < questionCount) {
      setCurrentQuestionIndex(prev => prev + 1);
      setFeedback(null);
      setIsSubmitted(false);
    } else {
      setStep('summary');
    }
  };

  const submitAnswer = () => {
    setIsSubmitted(true);
    setFeedback("Great job! Your pronunciation was clear and you used the correct vocabulary. Try to speak a bit faster next time.");
  };

  const renderSourceSelection = () => (
    <div className="card animate-in">
      <h3>1. Choose Practice Source</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem', marginTop: '1.5rem' }}>
        <button 
          className={`btn ${source === 'flashcards' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setSource('flashcards')}
        >
          🎴 My Flashcards
        </button>
        <button 
          className={`btn ${source === 'reading' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setSource('reading')}
        >
          📖 My Reading
        </button>
        <button 
          className={`btn ${source === 'mixed' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setSource('mixed')}
        >
          ✨ Mixed Review
        </button>
      </div>
      <div style={{ marginTop: '2rem', textAlign: 'right' }}>
        <button className="btn btn-primary" onClick={() => setStep('mode')}>Next &rarr;</button>
      </div>
    </div>
  );

  const renderModeSelection = () => (
    <div className="card animate-in">
      <h3>2. Choose Practice Mode</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1.5rem' }}>
        <button 
          className={`btn ${mode === 'zh-en' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setMode('zh-en')}
        >
          中 → 英 Translation
        </button>
        <button 
          className={`btn ${mode === 'en-zh' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setMode('en-zh')}
        >
          英 → 中 Explanation
        </button>
        <button 
          className={`btn ${mode === 'qa' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setMode('qa')}
        >
          English Q&A
        </button>
        <button 
          className={`btn ${mode === 'transformation' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setMode('transformation')}
        >
          Sentence Transformation
        </button>
      </div>
      <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'space-between' }}>
        <button className="btn btn-outline" onClick={() => setStep('source')}>&larr; Back</button>
        <button className="btn btn-primary" onClick={() => setStep('setup')}>Next &rarr;</button>
      </div>
    </div>
  );

  const renderSetup = () => (
    <div className="card animate-in">
      <h3>3. Practice Setup</h3>
      <div style={{ marginTop: '1.5rem' }}>
        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>Number of questions:</label>
        <div style={{ display: 'flex', gap: '1rem' }}>
          {[5, 10, 15].map(n => (
            <button 
              key={n}
              className={`btn ${questionCount === n ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setQuestionCount(n)}
              style={{ flex: 1 }}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
      <div style={{ marginTop: '3rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <button className="btn btn-primary" style={{ padding: '1rem', fontSize: '1.2rem' }} onClick={startPractice}>
          🚀 Start AI Oral Practice
        </button>
        <button className="btn btn-outline" onClick={() => setStep('mode')}>&larr; Back</button>
      </div>
    </div>
  );

  const renderPractice = () => (
    <div className="card animate-in" style={{ textAlign: 'center', padding: '3rem 2rem' }}>
      <div style={{ marginBottom: '1rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
        Question {currentQuestionIndex + 1} of {questionCount}
      </div>
      
      <h2 style={{ marginBottom: '2rem' }}>{currentQuestion.text}</h2>
      
      <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginBottom: '2rem' }}>
        <button 
          className="btn btn-outline" 
          onClick={() => playUnifiedAudio(currentQuestion.text)}
          style={{ borderRadius: '50%', width: '60px', height: '60px', fontSize: '1.5rem', padding: 0 }}
        >
          🔊
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center' }}>
        {!isRecording ? (
          <button 
            className="btn btn-primary" 
            style={{ width: '200px', height: '200px', borderRadius: '50%', fontSize: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', justifyContent: 'center' }}
            onClick={() => setIsRecording(true)}
          >
            <span style={{ fontSize: '3rem' }}>🎤</span>
            Record Answer
          </button>
        ) : (
          <button 
            className="btn btn-danger pulse" 
            style={{ width: '200px', height: '200px', borderRadius: '50%', fontSize: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', justifyContent: 'center' }}
            onClick={() => setIsRecording(false)}
          >
            <span style={{ fontSize: '3rem' }}>⏹️</span>
            Stop
          </button>
        )}

        {isSubmitted ? (
          <div className="animate-in" style={{ marginTop: '2rem', textAlign: 'left', width: '100%', padding: '1.5rem', background: '#f8fafc', borderRadius: '12px', border: '1px solid var(--border)' }}>
            <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--primary)' }}>AI Feedback:</h4>
            <p style={{ margin: 0, lineHeight: 1.6 }}>{feedback}</p>
            <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
              <button className="btn btn-primary" onClick={handleNext}>
                {currentQuestionIndex + 1 === questionCount ? 'Finish Practice' : 'Next Question &rarr;'}
              </button>
            </div>
          </div>
        ) : (
          !isRecording && (
            <button 
              className="btn btn-success" 
              style={{ marginTop: '2rem', padding: '0.75rem 2.5rem' }} 
              onClick={submitAnswer}
            >
              Submit Answer
            </button>
          )
        )}
      </div>
    </div>
  );

  const renderSummary = () => (
    <div className="card animate-in" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
      <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>🎉</div>
      <h2>Practice Complete!</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: '3rem' }}>You've finished your oral practice session. Keep it up!</p>
      <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
        <button className="btn btn-primary" onClick={() => setStep('source')}>Practice Again</button>
        <button className="btn btn-outline" onClick={() => navigate(`/student/${studentId}`)}>Back to Dashboard</button>
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '1rem' }}>
      <header style={{ marginBottom: '2rem' }}>
        <button onClick={() => navigate(`/student/${studentId}`)} className="btn btn-outline" style={{ marginBottom: '1.5rem', background: '#fff' }}>&larr; Back to Dashboard</button>
        <h1 style={{ margin: 0, color: 'var(--primary)' }}>Listen & Speak</h1>
        <p style={{ margin: '0.5rem 0 0 0', color: 'var(--text-muted)', fontSize: '1.1rem' }}>
          Practice listening and speaking with an AI oral coach.
        </p>
      </header>

      {step === 'source' && renderSourceSelection()}
      {step === 'mode' && renderModeSelection()}
      {step === 'setup' && renderSetup()}
      {step === 'practice' && renderPractice()}
      {step === 'summary' && renderSummary()}
    </div>
  );
}
