import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '../lib/db';
import {
  getWritingTasks,
  saveWritingTask,
  getStudentWriting,
  saveStudentWriting
} from '../lib/firebaseDb';
import { WritingTask } from '../lib/types';

export default function WritingPractice() {
  const { writingId } = useParams<{ writingId: string }>();
  const navigate = useNavigate();
  const studentId = db.getCurrentUserId();
  
  const [task, setTask] = useState<WritingTask | null>(null);
  const [text, setText] = useState('');
  const [aiFeedback, setAiFeedback] = useState('');
  const [loading, setLoading] = useState(true);

  // Editing state
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editPromptText, setEditPromptText] = useState('');
  const [editWordCount, setEditWordCount] = useState('');
  const [editImages, setEditImages] = useState<string[]>([]);

  // Collapsible chat states
  const [showChat, setShowChat] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<{ sender: 'user' | 'ai'; text: string }[]>([]);

  const getTaskImages = (t: WritingTask | null): string[] => {
    if (!t) return [];
    if (t.images && t.images.length > 0) return t.images;
    return [];
  };

  const handleSendChatMessage = () => {
    if (!chatInput.trim()) return;
    const userMsg = { sender: 'user' as const, text: chatInput };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput('');

    // Simulate AI response
    setTimeout(() => {
      setChatMessages(prev => [...prev, {
        sender: 'ai',
        text: `I received your message: "${userMsg.text}". Let's focus on refining your essay logic and vocabulary usage!`
      }]);
    }, 1000);
  };

  const handleEditImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach(file => {
      if (file.size > 1024 * 1024) {
        alert(`File ${file.name} is too large! Please upload images smaller than 1MB.`);
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        setEditImages(prev => [...prev, reader.result as string]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = ''; // reset input
  };

  const handleReplaceEditImage = (idxToReplace: number, file: File) => {
    if (file.size > 1024 * 1024) {
      alert('File is too large! Please upload images smaller than 1MB.');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      setEditImages(prev => prev.map((img, idx) => idx === idxToReplace ? (reader.result as string) : img));
    };
    reader.readAsDataURL(file);
  };

  const handleDeleteEditImage = (idxToDelete: number) => {
    setEditImages(prev => prev.filter((_, idx) => idx !== idxToDelete));
  };

  const handleSaveChanges = async () => {
    if (!task || !studentId) return;
    if (!editTitle.trim() || !editPromptText.trim()) {
      alert('Please fill in Task Title and Prompt Text!');
      return;
    }

    const updatedTask: WritingTask = {
      ...task,
      title: editTitle,
      promptText: editPromptText,
      suggestedWordCount: editWordCount ? parseInt(editWordCount) : undefined,
      images: editImages
    };

    try {
      setLoading(true);
      await saveWritingTask(studentId, updatedTask);
      setTask(updatedTask);
      setIsEditing(false);
    } catch (err) {
      alert('Failed to save changes: ' + err);
    } finally {
      setLoading(false);
    }
  };

  // Load task and student writing draft/submission
  useEffect(() => {
    if (!writingId || !studentId) {
      setLoading(false);
      return;
    }

    const loadAll = async () => {
      try {
        const tasks = await getWritingTasks(studentId);
        const foundTask = tasks.find(t => t.id === writingId);
        if (foundTask) {
          setTask(foundTask);
        }

        const draft = await getStudentWriting(studentId, writingId);
        if (draft) {
          setText(draft.draftText || draft.submittedText || '');
          setAiFeedback(draft.aiFeedback || '');
        }
      } catch (err) {
        console.error('Failed to load writing practice content:', err);
      } finally {
        setLoading(false);
      }
    };

    loadAll();
  }, [writingId, studentId]);

  // Auto-Save draft after 3 seconds of typing inactivity
  useEffect(() => {
    if (!studentId || !writingId || loading || !task) return;
    
    const delayDebounceFn = setTimeout(async () => {
      try {
        await saveStudentWriting(studentId, writingId, {
          studentId,
          taskId: writingId,
          draftText: text,
          status: 'drafting'
        });
        console.log('[DEBUG] Writing draft auto-saved to Firestore');
      } catch (err) {
        console.warn('[DEBUG] Auto-save draft failed:', err);
      }
    }, 3000);

    return () => clearTimeout(delayDebounceFn);
  }, [text, studentId, writingId, loading, task]);

  const handleSaveDraft = async () => {
    if (!studentId || !writingId) return;
    try {
      await saveStudentWriting(studentId, writingId, {
        studentId,
        taskId: writingId,
        draftText: text,
        status: 'drafting'
      });
      alert('Draft saved successfully!');
    } catch (err) {
      alert('Failed to save draft: ' + err);
    }
  };

  const handleSubmit = async () => {
    if (!studentId || !writingId) return;
    if (!text.trim()) {
      alert('Cannot submit an empty draft!');
      return;
    }
    
    if (!window.confirm('Are you sure you want to submit your final writing?')) {
      return;
    }

    try {
      await saveStudentWriting(studentId, writingId, {
        studentId,
        taskId: writingId,
        submittedText: text,
        draftText: text,
        status: 'submitted'
      });
      alert('Submitted successfully!');
      navigate(`/student/${studentId}/writing`);
    } catch (err) {
      alert('Failed to submit writing: ' + err);
    }
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
      <div style={{ maxWidth: '850px', margin: '0 auto', padding: '2rem', textAlign: 'center' }}>
        <p>載入中...</p>
      </div>
    );
  }

  if (!task) {
    return (
      <div style={{ maxWidth: '850px', margin: '0 auto', padding: '2rem', textAlign: 'center' }}>
        <p>找不到該寫作作業。</p>
        <button className="btn btn-primary" onClick={() => navigate(`/student/${studentId}/writing`)}>
          返回列表
        </button>
      </div>
    );
  }

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const currentImages = getTaskImages(task);

  const renderEditForm = () => {
    return (
      <div className="card" style={{ background: '#f8fafc', padding: '2rem', borderRadius: '12px', border: '1px solid var(--border)' }}>
        <h2 style={{ marginTop: 0, marginBottom: '1.5rem', color: 'var(--text-main)' }}>Edit Writing Task</h2>
        <div style={{ display: 'grid', gap: '1.25rem' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.35rem', fontWeight: 600, color: 'var(--text-main)' }}>Task Title</label>
            <input
              type="text"
              className="input-field"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="e.g. My Favorite Sport"
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '0.35rem', fontWeight: 600, color: 'var(--text-main)' }}>Prompt / Instructions</label>
            <textarea
              className="input-field"
              style={{ minHeight: '120px', resize: 'vertical' }}
              value={editPromptText}
              onChange={(e) => setEditPromptText(e.target.value)}
              placeholder="Describe the task instructions here..."
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '0.35rem', fontWeight: 600, color: 'var(--text-main)' }}>Suggested Word Count (Optional)</label>
            <input
              type="number"
              className="input-field"
              value={editWordCount}
              onChange={(e) => setEditWordCount(e.target.value)}
              placeholder="e.g. 150"
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: 'var(--text-main)' }}>Task Images</label>
            
            {editImages.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
                {editImages.map((imgSrc, idx) => (
                  <div key={idx} style={{ position: 'relative', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.25rem', background: '#fff', textAlign: 'center', width: '130px' }}>
                    <img src={imgSrc} alt={`Preview ${idx + 1}`} style={{ width: '100%', height: '90px', objectFit: 'contain', borderRadius: '4px' }} />
                    <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.25rem', justifyContent: 'center' }}>
                      <label style={{
                        padding: '0.2rem 0.5rem',
                        fontSize: '0.7rem',
                        background: 'var(--primary)',
                        color: '#fff',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontWeight: 600
                      }}>
                        Replace
                        <input
                          type="file"
                          accept="image/*"
                          style={{ display: 'none' }}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleReplaceEditImage(idx, file);
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        className="btn btn-outline"
                        style={{ padding: '0.2rem 0.4rem', fontSize: '0.7rem', color: '#dc2626', borderColor: '#fca5a5', background: '#fff' }}
                        onClick={() => handleDeleteEditImage(idx)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ border: '2px dashed var(--border)', borderRadius: '8px', padding: '1.25rem', textAlign: 'center', background: '#fff' }}>
              <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Upload one or more images for this task</p>
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={handleEditImageUpload}
                style={{ fontSize: '0.9rem' }}
              />
            </div>
          </div>
        </div>

        <div style={{ marginTop: '1.75rem', display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
          <button className="btn btn-outline" onClick={() => setIsEditing(false)}>Cancel</button>
          <button className="btn btn-success" onClick={handleSaveChanges}>Save Changes</button>
        </div>
      </div>
    );
  };

  return (
    <div style={{ maxWidth: '850px', margin: '2rem auto', padding: '0 1.5rem', boxSizing: 'border-box' }}>
      <header style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <button 
            style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', padding: 0, marginBottom: '0.5rem', fontSize: '0.95rem', fontWeight: 600 }}
            onClick={() => navigate(`/student/${studentId}/writing`)}
          >
            ← Back to List
          </button>
          <h1 style={{ margin: 0, fontSize: '2rem', fontWeight: 700, color: 'var(--text-main)' }}>{task.title}</h1>
        </div>
        {!isEditing && (
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              className="btn btn-outline"
              onClick={() => {
                setEditTitle(task.title);
                setEditPromptText(task.promptText);
                setEditWordCount(task.suggestedWordCount ? task.suggestedWordCount.toString() : '');
                setEditImages(currentImages);
                setIsEditing(true);
              }}
            >
              ✏️ Edit Task
            </button>
            <button className="btn btn-outline" onClick={handleSaveDraft}>
              Save Draft
            </button>
            <button className="btn btn-primary" onClick={handleSubmit}>
              Submit
            </button>
          </div>
        )}
      </header>

      {isEditing ? (
        renderEditForm()
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Prompt / Instructions Card */}
          <div className="card" style={{ padding: '1.5rem', borderRadius: '12px' }}>
            <h3 style={{ marginTop: 0, fontSize: '0.9rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Instructions</h3>
            <p style={{ margin: '0.5rem 0 1rem 0', fontSize: '1.15rem', lineHeight: '1.6', color: 'var(--text-main)' }}>{task.promptText}</p>
            {task.suggestedWordCount && (
              <div style={{ display: 'inline-block', padding: '0.25rem 0.75rem', background: '#eff6ff', color: 'var(--primary)', borderRadius: '12px', fontSize: '0.85rem', fontWeight: 600, marginBottom: '1rem' }}>
                Target: {task.suggestedWordCount} words
              </div>
            )}
            
            {/* Multiple Images Display Grid */}
            {currentImages.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'center', marginTop: '1rem' }}>
                {currentImages.map((imgSrc, idx) => (
                  <img
                    key={idx}
                    src={imgSrc}
                    alt={`Task prompt visual ${idx + 1}`}
                    style={{
                      maxWidth: '100%',
                      maxHeight: '240px',
                      borderRadius: '8px',
                      objectFit: 'contain',
                      border: '1px solid var(--border)',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Main Writing Editor Card - priority visual centerpiece */}
          <div className="card" style={{ padding: '1.5rem', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
            <textarea
              style={{
                width: '100%',
                minHeight: '360px',
                padding: '1.25rem',
                borderRadius: '8px',
                border: '1px solid var(--border)',
                fontFamily: 'inherit',
                fontSize: '1.15rem',
                lineHeight: '1.65',
                resize: 'vertical',
                boxSizing: 'border-box',
                outline: 'none',
                background: '#fafafa',
                transition: 'border-color 0.2s, background-color 0.2s',
              }}
              onFocus={(e) => {
                e.target.style.borderColor = 'var(--primary)';
                e.target.style.backgroundColor = '#fff';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = 'var(--border)';
                e.target.style.backgroundColor = '#fafafa';
              }}
              placeholder="Start your writing here..."
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div style={{ marginTop: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              <span>
                {task.suggestedWordCount ? `Progress: ${Math.min(100, Math.round((wordCount / task.suggestedWordCount) * 100))}%` : ''}
              </span>
              <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                Word Count: {wordCount} {task.suggestedWordCount ? `/ ${task.suggestedWordCount}` : ''}
              </span>
            </div>
          </div>

          {/* AI Quick Help Bar (Secondary, below editor) */}
          <div className="card" style={{ padding: '1.5rem', borderRadius: '12px', background: '#f8fafc', border: '1px solid #e2e8f0' }}>
            <h3 style={{ marginTop: 0, marginBottom: '0.75rem', fontSize: '0.95rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>AI Quick Help</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
              <button className="btn btn-outline" style={{ background: '#fff' }} onClick={() => handleAiAssistance('ideas')}>
                💡 Give me ideas
              </button>
              <button className="btn btn-outline" style={{ background: '#fff' }} onClick={() => handleAiAssistance('sentence')}>
                ✍️ Help this sentence
              </button>
              <button className="btn btn-outline" style={{ background: '#fff' }} onClick={() => handleAiAssistance('check')}>
                🔍 Check my writing
              </button>
            </div>

            {aiFeedback && (
              <div style={{ marginTop: '1rem', background: '#fff', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border)', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                <pre style={{ margin: 0, fontFamily: 'inherit', fontSize: '0.95rem', whiteSpace: 'pre-wrap', color: 'var(--text-main)', lineHeight: '1.5' }}>
                  {aiFeedback}
                </pre>
              </div>
            )}
          </div>

          {/* AI Discussion Drawer (Collapsible) */}
          <div className="card" style={{ padding: '1rem 1.5rem', borderRadius: '12px', background: '#f8fafc', border: '1px solid #e2e8f0' }}>
            <div
              onClick={() => setShowChat(!showChat)}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}
            >
              <h3 style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                💬 AI Discussion & Chat (Optional)
              </h3>
              <span style={{ fontSize: '0.85rem', color: 'var(--primary)', fontWeight: 600 }}>{showChat ? '▲ Collapse' : '▼ Expand'}</span>
            </div>

            {showChat && (
              <div style={{ marginTop: '1.25rem', borderTop: '1px solid #e2e8f0', paddingTop: '1.25rem' }}>
                <div style={{
                  maxHeight: '220px',
                  overflowY: 'auto',
                  background: '#fff',
                  borderRadius: '8px',
                  padding: '1rem',
                  border: '1px solid var(--border)',
                  marginBottom: '0.75rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem'
                }}>
                  {chatMessages.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '0.95rem', textAlign: 'center', padding: '1rem 0' }}>
                      Ask questions, ask for vocabulary alternatives, or brainstorm structures with the assistant.
                    </p>
                  ) : (
                    chatMessages.map((msg, idx) => (
                      <div key={idx} style={{ display: 'flex', justifyContent: msg.sender === 'user' ? 'flex-end' : 'flex-start' }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '0.6rem 0.9rem',
                          borderRadius: msg.sender === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                          fontSize: '0.95rem',
                          lineHeight: '1.4',
                          background: msg.sender === 'user' ? 'var(--primary)' : '#f1f5f9',
                          color: msg.sender === 'user' ? '#fff' : 'var(--text-main)',
                          maxWidth: '80%',
                          boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                        }}>
                          {msg.text}
                        </span>
                      </div>
                    ))
                  )}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="text"
                    className="input-field"
                    style={{ background: '#fff' }}
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Type your question..."
                    onKeyDown={(e) => e.key === 'Enter' && handleSendChatMessage()}
                  />
                  <button className="btn btn-primary" onClick={handleSendChatMessage}>Send</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
