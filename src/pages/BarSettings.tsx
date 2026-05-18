import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../lib/db';

type NavItem = {
  id: string;
  name: string;
  path: string;
  location: 'bar' | 'more';
};

const DEFAULT_NAV_SETTINGS: NavItem[] = [
  { id: 'dashboard', name: 'Dashboard', path: '', location: 'bar' },
  { id: 'flashcards', name: 'Flashcards', path: '/flashcards', location: 'bar' },
  { id: 'practice', name: 'Retrieval', path: '/practice', location: 'bar' },
  { id: 'reading', name: 'Reading', path: '/reading', location: 'bar' },
  { id: 'writing', name: 'Writing', path: '/writing', location: 'bar' },
  { id: 'tone', name: 'Tone', path: '/tone-practice', location: 'more' },
  { id: 'exercises', name: 'Exercises', path: '/exercises', location: 'more' },
  { id: 'report', name: 'Report', path: '/report', location: 'more' }
];

export default function BarSettings() {
  const navigate = useNavigate();
  const studentId = db.getCurrentUserId();
  const [items, setItems] = useState<NavItem[]>([]);

  useEffect(() => {
    if (studentId) {
      const saved = localStorage.getItem(`navbar_settings_${studentId}`);
      setItems(saved ? JSON.parse(saved) : DEFAULT_NAV_SETTINGS);
    }
  }, [studentId]);

  const saveSettings = (newItems: NavItem[]) => {
    setItems(newItems);
    if (studentId) {
      localStorage.setItem(`navbar_settings_${studentId}`, JSON.stringify(newItems));
    }
  };

  const handleToggleLocation = (id: string) => {
    if (id === 'dashboard') return; // Dashboard must stay on bar
    
    const newItems = items.map(item => {
      if (item.id === id) {
        return { ...item, location: item.location === 'bar' ? 'more' : 'bar' } as NavItem;
      }
      return item;
    });
    saveSettings(newItems);
  };

  const handleMove = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= items.length) return;

    const newItems = [...items];
    const temp = newItems[index];
    newItems[index] = newItems[newIndex];
    newItems[newIndex] = temp;
    
    saveSettings(newItems);
  };

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '1rem' }}>
      <header style={{ marginBottom: '2rem' }}>
        <button 
          style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', padding: 0, marginBottom: '0.5rem', fontSize: '0.9rem' }}
          onClick={() => navigate(`/student/${studentId}`)}
        >
          ← 返回 Dashboard
        </button>
        <h1 style={{ margin: 0 }}>Bar Settings</h1>
        <p style={{ margin: 0, color: 'var(--text-muted)' }}>自訂您的導覽列項目與順序 ✨</p>
      </header>

      <div className="card">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {items.map((item, index) => (
            <div 
              key={item.id} 
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '1rem', borderRadius: '8px', border: '1px solid var(--border)',
                background: '#fff'
              }}
            >
              <div>
                <span style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{item.name}</span>
                <span style={{ 
                  marginLeft: '0.5rem', fontSize: '0.8rem', padding: '0.2rem 0.5rem', 
                  borderRadius: '4px', background: item.location === 'bar' ? '#e0f2fe' : '#f1f5f9',
                  color: item.location === 'bar' ? '#0369a1' : '#475569'
                }}>
                  {item.location === 'bar' ? 'Show on Bar' : 'In More'}
                </span>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                {/* Location Toggle */}
                <button 
                  className="btn btn-outline"
                  style={{ fontSize: '0.85rem', padding: '0.4rem 0.75rem', borderColor: item.id === 'dashboard' ? '#e2e8f0' : 'var(--border)' }}
                  onClick={() => handleToggleLocation(item.id)}
                  disabled={item.id === 'dashboard'}
                >
                  {item.location === 'bar' ? 'Move to More' : 'Move to Bar'}
                </button>

                {/* Reorder Buttons */}
                <button 
                  className="btn btn-outline"
                  style={{ fontSize: '0.85rem', padding: '0.4rem 0.6rem' }}
                  onClick={() => handleMove(index, 'up')}
                  disabled={index === 0}
                >
                  ▲
                </button>
                <button 
                  className="btn btn-outline"
                  style={{ fontSize: '0.85rem', padding: '0.4rem 0.6rem' }}
                  onClick={() => handleMove(index, 'down')}
                  disabled={index === items.length - 1}
                >
                  ▼
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
