import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../lib/db';

type WritingTask = {
  id: string;
  title: string;
  promptText: string;
  imageUrl?: string;
  imageDataUrl?: string;
  suggestedWordCount?: number;
};

const sampleWritingTasks: WritingTask[] = [
  { 
    id: 'w1', 
    title: 'My Weekend', 
    promptText: 'Write about what you did last weekend. Use at least 5 past tense verbs.' 
  },
  { 
    id: 'w2', 
    title: 'My Favorite Food', 
    promptText: 'Describe your favorite food and why you like it.',
    imageUrl: 'https://picsum.photos/400/300?random=1'
  },
  { 
    id: 'w3', 
    title: 'A Letter to My Future Self', 
    promptText: 'Write a letter to yourself 5 years from now. What are your hopes and dreams?' 
  }
];

export default function StudentWriting() {
  const navigate = useNavigate();
  const studentId = db.getCurrentUserId();
  const [writingItems, setWritingItems] = useState<WritingTask[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Form state
  const [showForm, setShowForm] = useState(false);
  const [newId, setNewId] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newPromptText, setNewPromptText] = useState('');
  const [newImageDataUrl, setNewImageDataUrl] = useState('');
  const [newWordCount, setNewWordCount] = useState('');

  useEffect(() => {
    // Load defaults + custom
    const loadTasks = () => {
      const saved = localStorage.getItem('custom_writing_tasks');
      const customTasks: WritingTask[] = saved ? JSON.parse(saved) : [];
      setWritingItems([...sampleWritingTasks, ...customTasks]);
      setLoading(false);
    };
    
    // Simulate API load
    setTimeout(loadTasks, 500);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check file size (1MB = 1024 * 1024 bytes)
    if (file.size > 1024 * 1024) {
      alert('檔案太大了！請上傳小於 1MB 的圖片。');
      e.target.value = ''; // Reset input
      setNewImageDataUrl('');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setNewImageDataUrl(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleCreateTask = () => {
    if (!newId || !newTitle || !newPromptText) {
      alert('Please fill in Task ID, Title, and Prompt Text!');
      return;
    }

    const newTask: WritingTask = {
      id: newId,
      title: newTitle,
      promptText: newPromptText,
      imageDataUrl: newImageDataUrl || undefined,
      suggestedWordCount: newWordCount ? parseInt(newWordCount) : undefined
    };

    const saved = localStorage.getItem('custom_writing_tasks');
    const customTasks: WritingTask[] = saved ? JSON.parse(saved) : [];
    
    // Check if ID already exists
    if (sampleWritingTasks.some(t => t.id === newId) || customTasks.some(t => t.id === newId)) {
      alert('Task ID already exists! Please use a unique ID.');
      return;
    }

    const updatedCustom = [...customTasks, newTask];
    localStorage.setItem('custom_writing_tasks', JSON.stringify(updatedCustom));
    
    setWritingItems([...sampleWritingTasks, ...updatedCustom]);
    
    // Reset form
    setShowForm(false);
    setNewId('');
    setNewTitle('');
    setNewPromptText('');
    setNewImageDataUrl('');
    setNewWordCount('');
  };

  if (loading) {
    return (
      <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '2rem', textAlign: 'center' }}>
        <p>載入寫作作業中...</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '1rem' }}>
      <header style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0 }}>My Writing</h1>
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>您的老師為您安排的寫作練習 ✨</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? '取消新增' : '➕ Add Writing Task'}
        </button>
      </header>

      {/* Add Task Form */}
      {showForm && (
        <div className="card" style={{ marginBottom: '2rem', background: '#f8fafc' }}>
          <h3 style={{ marginTop: 0 }}>新增寫作任務</h3>
          <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: '1fr 1fr' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>Task ID *</label>
              <input type="text" className="input-field" value={newId} onChange={(e) => setNewId(e.target.value)} placeholder="例如: w4" />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>Title *</label>
              <input type="text" className="input-field" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="任務標題" />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>Prompt Text *</label>
              <textarea className="input-field" style={{ minHeight: '100px', resize: 'vertical' }} value={newPromptText} onChange={(e) => setNewPromptText(e.target.value)} placeholder="寫作題目與要求..." />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>Upload Image (Optional)</label>
              <input type="file" accept="image/png, image/jpeg, image/jpg, image/webp" onChange={handleFileChange} />
              {newImageDataUrl && (
                <div style={{ marginTop: '0.5rem' }}>
                  <img src={newImageDataUrl} alt="Preview" style={{ maxWidth: '100px', borderRadius: '4px' }} />
                </div>
              )}
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>Suggested Word Count (Optional)</label>
              <input type="number" className="input-field" value={newWordCount} onChange={(e) => setNewWordCount(e.target.value)} placeholder="例如: 100" />
            </div>
          </div>
          <div style={{ marginTop: '1rem', textAlign: 'right' }}>
            <button className="btn btn-success" onClick={handleCreateTask}>
              Create Task
            </button>
          </div>
        </div>
      )}

      <div className="card">
        {writingItems.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>
            目前還沒有寫作作業喔。
          </p>
        ) : (
          <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
            {writingItems.map((item) => (
              <div
                key={item.id}
                className="clickable-card"
                onClick={() => navigate(`/student/${studentId}/writing/${item.id}`)}
              >
                <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 600 }}>
                  Task {item.id.toUpperCase()}
                </div>
                <h3 style={{ margin: '0.25rem 0', fontSize: '1.2rem' }}>
                  {item.title}
                </h3>
                <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                  {item.promptText}
                </p>
                {item.suggestedWordCount && (
                  <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--primary)', fontWeight: 600 }}>
                    Target: {item.suggestedWordCount} words
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
