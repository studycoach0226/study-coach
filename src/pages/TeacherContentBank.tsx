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
    const lines = bulkInput.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    const newParsed: Partial<LearningItem>[] = lines.map((line) => {
      const parts = line.split('|').map(p => p.trim());
      const item: any = {
        topic: 'General',
        difficulty: 'beginner',
        teacherConnections: {},
        createdBy: 'teacher',
        assignedByTeacher: true,
        assignedToAll: true,
        itemType: 'chunk'
      };

      if (parts.length === 6) {
        // Chinese Format: targetExpression | targetText | meaning | context | contextText | contextMeaning
        item.languageDirection = 'zh-en';
        item.focusExpression = parts[0];
        item.targetText = parts[1];
        item.chunkTranslation = parts[2];
        item.chunk = parts[3];
        item.contextText = parts[4];
        item.sentenceMeaning = parts[5];
      } else if (parts.length >= 4) {
        // English Format: targetExpression | meaning | context | contextMeaning
        item.languageDirection = 'en-zh';
        item.focusExpression = parts[0];
        item.chunkTranslation = parts[1];
        item.chunk = parts[2];
        item.sentenceMeaning = parts[3];
        // Handle optional columns if any
      }

      return item;
    }).filter(item => item.focusExpression && item.chunk);

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
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                <strong>Format:</strong> One record per line, fields separated by <code>|</code> (pipe).<br/>
                - <strong>English (4 cols):</strong> <code>targetExpression | meaning | context | contextMeaning</code><br/>
                - <strong>Chinese (6 cols):</strong> <code>targetExpression | targetText | meaning | context | contextText | contextMeaning</code>
              </p>
              <div style={{ fontSize: '0.75rem', background: '#f8fafc', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border)', marginBottom: '1rem' }}>
                <strong>Example Chinese:</strong><br/>
                <code>deng3 gong1che1 | 等公車 | waiting for a bus | wo3 zai4 deng3 gong1che1 | 我在等公車。 | I am waiting for a bus.</code>
              </div>
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
                      <th>Mode</th><th>Target</th><th>Meaning</th><th>Context</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedItems.map((item, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                        <td style={{ padding: '0.25rem', fontSize: '0.8rem' }}>{item.languageDirection === 'zh-en' ? '🇨🇳 ZH' : '🇺🇸 EN'}</td>
                        <td style={{ padding: '0.25rem' }}>
                          <div style={{ fontWeight: 'bold' }}>{(item as any).focusExpression}</div>
                          {item.languageDirection === 'zh-en' && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{(item as any).targetText}</div>}
                        </td>
                        <td style={{ padding: '0.25rem' }}>{(item as any).chunkTranslation}</td>
                        <td style={{ padding: '0.25rem', fontSize: '0.85rem' }}>
                          <div>{(item as any).chunk}</div>
                          {item.languageDirection === 'zh-en' && <div style={{ color: 'var(--text-muted)' }}>{(item as any).contextText}</div>}
                        </td>
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
          <div style={{ marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border)' }}>
            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.5rem' }}>Learning Mode / Language Direction</label>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="languageDirection"
                  checked={editingItem.languageDirection !== 'zh-en'}
                  onChange={() => setEditingItem({ ...editingItem, languageDirection: 'en-zh' })}
                />
                English Learner (EN &rarr; ZH)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="languageDirection"
                  checked={editingItem.languageDirection === 'zh-en'}
                  onChange={() => setEditingItem({ ...editingItem, languageDirection: 'zh-en' })}
                />
                Chinese Learner (ZH &rarr; EN)
              </label>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
            {/* Target Section */}
            <div style={{ gridColumn: editingItem.languageDirection === 'zh-en' ? 'span 2' : 'span 2', display: 'grid', gridTemplateColumns: editingItem.languageDirection === 'zh-en' ? '1fr 1fr' : '1fr', gap: '1rem' }}>
              <div>
                <label style={{ fontWeight: 'bold' }}>Target Expression {editingItem.languageDirection === 'zh-en' && '(Pinyin / Readable)'}</label>
                <input
                  type="text"
                  className="input-field"
                  value={(editingItem as any).focusExpression || ''}
                  onChange={e => setEditingItem({ ...editingItem, focusExpression: e.target.value } as any)}
                  placeholder={editingItem.languageDirection === 'zh-en' ? 'e.g. deng3 gong1che1' : 'e.g. apple'}
                />
              </div>
              {editingItem.languageDirection === 'zh-en' && (
                <div>
                  <label style={{ fontWeight: 'bold' }}>Chinese Characters (Optional)</label>
                  <input
                    type="text"
                    className="input-field"
                    value={(editingItem as any).targetText || ''}
                    onChange={e => setEditingItem({ ...editingItem, targetText: e.target.value } as any)}
                    placeholder="e.g. 等公車"
                  />
                </div>
              )}
            </div>

            {/* Meaning Section */}
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontWeight: 'bold' }}>Meaning {editingItem.languageDirection === 'zh-en' ? '(English)' : '(Chinese)'}</label>
              <input
                type="text"
                className="input-field"
                value={(editingItem as any).chunkTranslation || ''}
                onChange={e => setEditingItem({ ...editingItem, chunkTranslation: e.target.value } as any)}
                placeholder={editingItem.languageDirection === 'zh-en' ? 'e.g. waiting for a bus' : 'e.g. 蘋果'}
              />
            </div>

            {/* Context Section */}
            <div style={{ gridColumn: 'span 2', display: 'grid', gridTemplateColumns: editingItem.languageDirection === 'zh-en' ? '1fr 1fr' : '1fr', gap: '1rem' }}>
              <div>
                <label style={{ fontWeight: 'bold' }}>Sentence / Context {editingItem.languageDirection === 'zh-en' && '(Pinyin)'}</label>
                <input
                  type="text"
                  className="input-field"
                  value={(editingItem as any).chunk || ''}
                  onChange={e => setEditingItem({ ...editingItem, chunk: e.target.value } as any)}
                  placeholder={editingItem.languageDirection === 'zh-en' ? 'e.g. wo3 zai4 deng3 gong1che1' : 'e.g. I am eating an apple.'}
                />
              </div>
              {editingItem.languageDirection === 'zh-en' && (
                <div>
                  <label style={{ fontWeight: 'bold' }}>Chinese Sentence (Optional)</label>
                  <input
                    type="text"
                    className="input-field"
                    value={(editingItem as any).contextText || ''}
                    onChange={e => setEditingItem({ ...editingItem, contextText: e.target.value } as any)}
                    placeholder="e.g. 我在等公車。"
                  />
                </div>
              )}
            </div>

            {/* Sentence Meaning Section */}
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontWeight: 'bold' }}>Sentence Meaning {editingItem.languageDirection === 'zh-en' ? '(English)' : '(Chinese)'}</label>
              <input
                type="text"
                className="input-field"
                value={(editingItem as any).sentenceMeaning || ''}
                onChange={e => setEditingItem({ ...editingItem, sentenceMeaning: e.target.value } as any)}
                placeholder={editingItem.languageDirection === 'zh-en' ? 'e.g. I am waiting for a bus.' : 'e.g. 我在吃蘋果。'}
              />
            </div>

            <div>
              <label style={{ fontWeight: 'bold' }}>Topic</label>
              <input
                type="text"
                className="input-field"
                value={editingItem.topic || ''}
                onChange={e => setEditingItem({ ...editingItem, topic: e.target.value })}
              />
            </div>
            <div>
              <label style={{ fontWeight: 'bold' }}>Difficulty</label>
              <select
                className="input-field"
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
                  <td style={{ padding: '0.5rem' }}>
                    <div>{isChunk ? chunkItem.chunk : '(Reading Article)'}</div>
                    {isChunk && chunkItem.contextText && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{chunkItem.contextText}</div>}
                  </td>
                  <td style={{ padding: '0.5rem' }}>{isChunk ? chunkItem.chunkTranslation : '(N/A)'}</td>
                  <td style={{ padding: '0.5rem' }}>
                    <div style={{ fontWeight: 'bold' }}>{isChunk ? chunkItem.focusExpression : '(N/A)'}</div>
                    {isChunk && chunkItem.targetText && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{chunkItem.targetText}</div>}
                  </td>
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
