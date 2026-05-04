import { useState, useEffect } from 'react';
import { db } from '../lib/db';
import { LearningItem, ChunkItem } from '../lib/types';

export default function TeacherContentBank() {
  const [items, setItems] = useState<LearningItem[]>([]);
  const [editingItem, setEditingItem] = useState<Partial<LearningItem> | null>(null);

  // Bulk Import State
  const [showBulk, setShowBulk] = useState(false);
  const [bulkInput, setBulkInput] = useState('');
  const [importStep, setImportStep] = useState<'idle' | 'preview'>('idle');
  const [parsedItems, setParsedItems] = useState<Partial<LearningItem>[]>([]);

  useEffect(() => {
    setItems(db.getLearningItems());
  }, []);

  const handleSave = () => {
    if (editingItem && (editingItem as any).chunk && (editingItem as any).chunkTranslation) {
      if (editingItem.id) {
        db.updateLearningItem(editingItem as LearningItem);
      } else {
        db.createLearningItem({
          ...editingItem,
          itemType: 'chunk',
          createdBy: 'teacher',
          assignedByTeacher: true,
          assignedToAll: true,
          teacherConnections: (editingItem as any).teacherConnections || {}
        } as any);
      }
      setItems(db.getLearningItems());
      setEditingItem(null);
    }
  };

  const handleDelete = (id: string) => {
    if (window.confirm('Are you sure you want to delete this content item?')) {
      db.deleteLearningItem(id);
      setItems(db.getLearningItems());
    }
  };

  const handleParse = () => {
    const blocks = bulkInput.split('---').map(b => b.trim()).filter(b => b.length > 0);

    const newParsed: Partial<LearningItem>[] = blocks.map((block) => {
      const lines = block.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      const item: any = {
        topic: 'General',
        difficulty: 'beginner',
        teacherConnections: {},
        createdBy: 'teacher',
        assignedByTeacher: true,
        assignedToAll: true
      };

      lines.forEach(line => {
        const separatorIndex = line.indexOf(':');
        if (separatorIndex !== -1) {
          const key = line.substring(0, separatorIndex).trim().toLowerCase();
          const value = line.substring(separatorIndex + 1).trim();

          switch (key) {
            case 'chunk': item.chunk = value; break;
            case 'translation':
            case 'chunktranslation': item.chunkTranslation = value; break;
            case 'focus':
            case 'focusexpression': item.focusExpression = value; break;
            case 'topic': item.topic = value; break;
            case 'difficulty': item.difficulty = value; break;
          }
        }
      });
      return item;
    });

    setParsedItems(newParsed);
    setImportStep('preview');
  };

  const handleConfirmImport = () => {
    parsedItems.forEach(item => db.createLearningItem(item));
    setItems(db.getLearningItems());
    setBulkInput('');
    setParsedItems([]);
    setImportStep('idle');
    setShowBulk(false);
  };

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '1rem' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1>Content Bank Management</h1>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-outline" onClick={() => setShowBulk(!showBulk)}>Bulk Import</button>
          <button className="btn btn-primary" onClick={() => setEditingItem({ teacherConnections: {} })}>+ Add New Content</button>
        </div>
      </header>

      {showBulk && (
        <div className="card" style={{ marginBottom: '2rem', border: '2px solid var(--primary)' }}>
          <h3>Bulk Import (Step {importStep === 'preview' ? '2: Preview' : '1: Paste'})</h3>

          {importStep === 'idle' ? (
            <div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Format: Use <code>---</code> to separate records. Inside each block, use <code>key: value</code> pairs.</p>
              <pre style={{ fontSize: '0.75rem', background: '#f8fafc', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border)' }}>
                {`---
chunk: Hello world.
translation: 你好世界。
focus: world
topic: Greetings
---`}
              </pre>
              <textarea
                style={{ width: '100%', height: '200px', marginTop: '0.5rem', fontFamily: 'monospace' }}
                value={bulkInput}
                onChange={e => setBulkInput(e.target.value)}
                placeholder="Paste your content blocks here..."
              />
              <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={handleParse} disabled={!bulkInput.trim()}>Parse & Preview</button>
            </div>
          ) : (
            <div>
              <div style={{ maxHeight: '300px', overflowY: 'auto', marginBottom: '1rem' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                      <th>Chunk</th><th>Translation</th><th>Topic</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedItems.map((item, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                        <td style={{ padding: '0.25rem' }}>{(item as any).chunk}</td>
                        <td style={{ padding: '0.25rem' }}>{(item as any).chunkTranslation}</td>
                        <td style={{ padding: '0.25rem' }}>{item.topic}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="btn btn-primary" onClick={handleConfirmImport}>Confirm & Save {parsedItems.length} items</button>
                <button className="btn btn-outline" onClick={() => setImportStep('idle')}>Back to Paste</button>
              </div>
            </div>
          )}
        </div>
      )}

      {editingItem && (
        <div className="card" style={{ marginBottom: '2rem', border: '2px solid var(--primary)' }}>
          <h3>{editingItem.id ? 'Edit Content' : 'New Content'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
            <div style={{ gridColumn: 'span 2' }}>
              <label>Context Chunk (Full Sentence or Phrase)</label>
              <input
                type="text"
                value={(editingItem as any).chunk || ''}
                onChange={e => setEditingItem({ ...editingItem, chunk: e.target.value } as any)}
                placeholder="e.g. My name is Heidi."
              />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label>Chunk Translation</label>
              <input
                type="text"
                value={(editingItem as any).chunkTranslation || ''}
                onChange={e => setEditingItem({ ...editingItem, chunkTranslation: e.target.value } as any)}
                placeholder="e.g. 我的名字是 Heidi。"
              />
            </div>
            <div>
              <label>Focus Expression (The unit being learned)</label>
              <input
                type="text"
                value={(editingItem as any).focusExpression || ''}
                onChange={e => setEditingItem({ ...editingItem, focusExpression: e.target.value } as any)}
                placeholder="e.g. Heidi"
              />
            </div>
            <div>
              <label>Topic</label>
              <input
                type="text"
                value={editingItem.topic || ''}
                onChange={e => setEditingItem({ ...editingItem, topic: e.target.value })}
              />
            </div>
            <div>
              <label>Difficulty</label>
              <select
                value={editingItem.difficulty || 'beginner'}
                onChange={e => setEditingItem({ ...editingItem, difficulty: e.target.value as any })}
              >
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-primary" onClick={handleSave}>Save</button>
            <button className="btn btn-outline" onClick={() => setEditingItem(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="card">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border)' }}>
              <th style={{ textAlign: 'left', padding: '0.5rem' }}>Chunk</th>
              <th style={{ textAlign: 'left', padding: '0.5rem' }}>Translation</th>
              <th style={{ textAlign: 'left', padding: '0.5rem' }}>Focus</th>
              <th style={{ textAlign: 'left', padding: '0.5rem' }}>Topic</th>
              <th style={{ textAlign: 'right', padding: '0.5rem' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => {
              const isChunk = item.itemType !== 'reading';
              const chunkItem = item as ChunkItem;
              return (
                <tr key={item.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '0.5rem' }}>{isChunk ? chunkItem.chunk : '(Reading Article)'}</td>
                  <td style={{ padding: '0.5rem' }}>{isChunk ? chunkItem.chunkTranslation : '(N/A)'}</td>
                  <td style={{ padding: '0.5rem' }}>{isChunk ? chunkItem.focusExpression : '(N/A)'}</td>
                  <td style={{ padding: '0.5rem' }}>{item.topic}</td>
                  <td style={{ padding: '0.5rem', textAlign: 'right' }}>
                    <button className="btn btn-outline" style={{ marginRight: '0.5rem' }} onClick={() => setEditingItem(item)}>Edit</button>
                    <button className="btn btn-outline" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => handleDelete(item.id)}>Delete</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
