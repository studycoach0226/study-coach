import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../lib/db';
import {
  getWritingTasks,
  saveWritingTask,
  deleteWritingTask
} from '../lib/firebaseDb';
import { WritingTask } from '../lib/types';

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
  const [newImages, setNewImages] = useState<string[]>([]);
  const [newWordCount, setNewWordCount] = useState('');

  useEffect(() => {
    if (!studentId) {
      setLoading(false);
      return;
    }
    
    getWritingTasks(studentId)
      .then(tasks => {
        setWritingItems(tasks);
      })
      .catch(err => {
        console.error('Failed to load writing tasks:', err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [studentId]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach(file => {
      // Check file size (1MB = 1024 * 1024 bytes)
      if (file.size > 1024 * 1024) {
        alert(`檔案 ${file.name} 太大了！請上傳小於 1MB 的圖片。`);
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        setNewImages(prev => [...prev, reader.result as string]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = ''; // Reset input
  };

  const handleDeleteNewImage = (idxToDelete: number) => {
    setNewImages(prev => prev.filter((_, idx) => idx !== idxToDelete));
  };

  const handleCreateTask = async () => {
    if (!newId || !newTitle || !newPromptText) {
      alert('Please fill in Task ID, Title, and Prompt Text!');
      return;
    }
    if (!studentId) return;

    // Check if ID already exists
    if (writingItems.some(t => t.id === newId)) {
      alert('Task ID already exists! Please use a unique ID.');
      return;
    }

    const newTask: WritingTask = {
      id: newId,
      title: newTitle,
      promptText: newPromptText,
      images: newImages,
      suggestedWordCount: newWordCount ? parseInt(newWordCount) : undefined,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    try {
      setLoading(true);
      await saveWritingTask(studentId, newTask);
      const updated = await getWritingTasks(studentId);
      setWritingItems(updated);
      
      // Reset form
      setShowForm(false);
      setNewId('');
      setNewTitle('');
      setNewPromptText('');
      setNewImages([]);
      setNewWordCount('');
    } catch (err) {
      alert('Failed to save writing task: ' + err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteTask = async (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Stop navigation to practice page
    
    if (!window.confirm('Are you sure you want to delete this writing task?')) {
      return;
    }
    if (!studentId) return;

    // Check if it is a sample task
    const isSample = ['w1', 'w2', 'w3'].includes(taskId);

    try {
      setLoading(true);
      await deleteWritingTask(studentId, taskId, isSample);
      const updated = await getWritingTasks(studentId);
      setWritingItems(updated);
    } catch (err) {
      alert('Failed to delete task: ' + err);
    } finally {
      setLoading(false);
    }
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
              <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>Upload Images (Optional)</label>
              <input type="file" accept="image/png, image/jpeg, image/jpg, image/webp" multiple onChange={handleFileChange} />
              {newImages.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem' }}>
                  {newImages.map((img, idx) => (
                    <div key={idx} style={{ position: 'relative', display: 'inline-block' }}>
                      <img src={img} alt="Preview" style={{ maxWidth: '60px', maxHeight: '60px', borderRadius: '4px', border: '1px solid var(--border)' }} />
                      <button
                        onClick={() => handleDeleteNewImage(idx)}
                        type="button"
                        style={{
                          position: 'absolute',
                          top: '-5px',
                          right: '-5px',
                          background: '#dc2626',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '50%',
                          width: '18px',
                          height: '18px',
                          fontSize: '0.65rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
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
                style={{ position: 'relative', paddingRight: '2.5rem' }}
                onClick={() => navigate(`/student/${studentId}/writing/${item.id}`)}
              >
                <button
                  onClick={(e) => handleDeleteTask(item.id, e)}
                  style={{
                    position: 'absolute',
                    top: '12px',
                    right: '12px',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#ef4444',
                    fontSize: '1rem',
                    padding: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '4px',
                    transition: 'background-color 0.2s',
                    zIndex: 2
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#fee2e2'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  title="Delete task"
                >
                  🗑️
                </button>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontWeight: 600 }}>
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
