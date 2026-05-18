import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '../lib/db';

type WritingTask = {
  id: string;
  title: string;
  promptText: string;
  imageUrl?: string;
  imageDataUrl?: string;
  suggestedWordCount?: number;
};

const sampleWritingTasks: Record<string, WritingTask> = {
  'w1': { id: 'w1', title: 'My Weekend', promptText: 'Write about what you did last weekend. Use at least 5 past tense verbs.' },
  'w2': { id: 'w2', title: 'My Favorite Food', promptText: 'Describe your favorite food and why you like it.', imageUrl: 'https://picsum.photos/400/300?random=1' },
  'w3': { id: 'w3', title: 'A Letter to My Future Self', promptText: 'Write a letter to yourself 5 years from now. What are your hopes and dreams?' }
};

export default function WritingPractice() {
  const { writingId } = useParams<{ writingId: string }>();
  const navigate = useNavigate();
  const studentId = db.getCurrentUserId();
  
  const [task, setTask] = useState<WritingTask | null>(null);
  const [text, setText] = useState('');
  const [aiFeedback, setAiFeedback] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (writingId) {
      if (sampleWritingTasks[writingId]) {
        setTask(sampleWritingTasks[writingId]);
      } else {
        // Check localStorage for custom tasks
        const saved = localStorage.getItem('custom_writing_tasks');
        const customTasks: WritingTask[] = saved ? JSON.parse(saved) : [];
        const found = customTasks.find(t => t.id === writingId);
        if (found) {
          setTask(found);
        }
      }
    }
    setLoading(false);
  }, [writingId]);

  const handleSaveDraft = () => {
    alert('Draft saved! (Mock)');
  };

  const handleSubmit = () => {
    alert('Submitted! (Mock)');
  };

  const handleAiAssistance = (type: 'ideas' | 'sentence' | 'check') => {
    setAiFeedback('AI is thinking...');
    setTimeout(() => {
      if (type === 'ideas') {
        setAiFeedback('💡 AI Ideas:\n1. Start by describing the weather.\n2. Mention who you were with.\n3. Talk about your favorite part of the day.');
      } else if (type === 'sentence') {
        setAiFeedback('✍️ AI Suggestion:\nTry combining short sentences to make your writing flow better. For example: "I went to the park. I played basketball." -> "I went to the park and played basketball."');
      } else if (type === 'check') {
        setAiFeedback('🔍 AI Check:\nYour writing looks good! Make sure to check your spelling and punctuation.');
      }
    }, 1000);
  };

  if (loading) {
    return (
      <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '2rem', textAlign: 'center' }}>
        <p>載入中...</p>
      </div>
    );
  }

  if (!task) {
    return (
      <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '2rem', textAlign: 'center' }}>
        <p>找不到該寫作作業。</p>
        <button className="btn btn-primary" onClick={() => navigate(`/student/${studentId}/writing`)}>
          返回列表
        </button>
      </div>
    );
  }

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '1rem' }}>
      <header style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <button 
            style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', padding: 0, marginBottom: '0.5rem', fontSize: '0.9rem' }}
            onClick={() => navigate(`/student/${studentId}/writing`)}
          >
            ← 返回列表
          </button>
          <h1 style={{ margin: 0 }}>{task.title}</h1>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-outline" onClick={handleSaveDraft}>
            Save Draft
          </button>
          <button className="btn btn-primary" onClick={handleSubmit}>
            Submit
          </button>
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.5rem' }}>
        {/* Left Column: Editor */}
        <div>
          <div className="card" style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ marginTop: 0, fontSize: '1rem', color: 'var(--text-muted)' }}>Prompt</h3>
            <p style={{ margin: task.imageUrl ? '0 0 1rem 0' : 0, fontSize: '1.1rem' }}>{task.promptText}</p>
            {task.suggestedWordCount && (
              <p style={{ margin: '0.5rem 0 1rem 0', fontSize: '0.9rem', color: 'var(--primary)', fontWeight: 600 }}>
                Target: {task.suggestedWordCount} words
              </p>
            )}
            {(task.imageDataUrl || task.imageUrl) && (
              <div style={{ textAlign: 'center' }}>
                <img src={task.imageDataUrl || task.imageUrl} alt="Writing Prompt" style={{ maxWidth: '100%', borderRadius: '8px' }} />
              </div>
            )}
          </div>

          <div className="card">
            <textarea
              style={{
                width: '100%',
                minHeight: '400px',
                padding: '1rem',
                borderRadius: '8px',
                border: '1px solid var(--border)',
                fontFamily: 'inherit',
                fontSize: '1.1rem',
                lineHeight: '1.6',
                resize: 'vertical',
                boxSizing: 'border-box'
              }}
              placeholder="在這裡開始寫你的文章..."
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div style={{ marginTop: '0.5rem', fontSize: '0.9rem', color: 'var(--text-muted)', textAlign: 'right' }}>
              Word Count: {wordCount}
            </div>
          </div>
        </div>

        {/* Right Column: AI Assistance */}
        <div>
          <div className="card" style={{ position: 'sticky', top: '80px' }}>
            <h3 style={{ marginTop: 0 }}>AI Assistance</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
              AI 可以協助您，但不會幫您寫完整篇作文喔。
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem' }}>
              <button className="btn btn-outline" style={{ justifyContent: 'center' }} onClick={() => handleAiAssistance('ideas')}>
                💡 Give me ideas
              </button>
              <button className="btn btn-outline" style={{ justifyContent: 'center' }} onClick={() => handleAiAssistance('sentence')}>
                ✍️ Help this sentence
              </button>
              <button className="btn btn-outline" style={{ justifyContent: 'center' }} onClick={() => handleAiAssistance('check')}>
                🔍 Check my writing
              </button>
            </div>

            {aiFeedback && (
              <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <pre style={{ margin: 0, fontFamily: 'inherit', fontSize: '0.95rem', whiteSpace: 'pre-wrap' }}>
                  {aiFeedback}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
