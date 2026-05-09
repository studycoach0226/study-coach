import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { db } from '../lib/db';
import { assignmentStore } from '../lib/retrievable/assignmentStore';
import { LearningItem, ChunkItem, ChunkRecord } from '../lib/types';
import { saveFlashcard } from '../lib/firebaseDb';

export default function StudentAssignments() {
  const navigate = useNavigate();
  const [assignedItems, setAssignedItems] = useState<LearningItem[]>([]);
  const [sId, setSId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [addedCount, setAddedCount] = useState<number | null>(null);

  useEffect(() => {
    const currentId = db.getCurrentUserId();
    setSId(currentId);
    if (!currentId) return;

    loadAssignments(currentId);
  }, []);

  const loadAssignments = (studentId: string) => {
    const assignment = assignmentStore.getByStudentId(studentId);
    if (assignment && Array.isArray(assignment.learning_item_ids) && assignment.learning_item_ids.length > 0) {
      const allItems = db.getLearningItems();
      const assigned = assignment.learning_item_ids
        .map(id => allItems.find(i => i.id === id))
        .filter((i): i is LearningItem => !!i);
      setAssignedItems(assigned);
    } else {
      setAssignedItems([]);
    }
  };

  const handleToggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleSelectAll = () => {
    setSelectedIds(new Set(assignedItems.map(i => i.id)));
  };

  const handleClearSelection = () => {
    setSelectedIds(new Set());
  };

  const handleAddSelected = () => {
    if (!sId || selectedIds.size === 0) return;

    const count = selectedIds.size;
    selectedIds.forEach(id => {
      // Safety Requirement: Preserve existing records and only create missing ones
      const existing = db.getLearningRecord(sId, id);
      if (existing) {
        console.log(`[DEBUG] Record already exists for item ${id}, skipping creation.`);
        assignmentStore.removeContent(sId, id);
        return;
      }

      const item = assignedItems.find(i => i.id === id);
      if (!item) return;

      // Create student learning record
      const record: ChunkRecord = {
        id: 'lr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        studentId: sId,
        learningItemId: id,
        studentConnections: {},
        audioUrls: {},
        status: 'new',
        encodingCompleted: false,
        encodingStatus: 'pending',
        isConnectionBuilt: false,
        savedToLibrary: true,
        startedAt: Date.now(),
        updatedAt: Date.now()
      };

      db.saveLearningRecord(record);
      
      // Immediate cloud sync
      saveFlashcard(record, item as ChunkItem).catch(err => {
        console.warn('[DEBUG] Firebase sync failed on assignment collection:', err);
      });

      // Consume assignment
      assignmentStore.removeContent(sId, id);
    });

    setAddedCount(count);
    setSelectedIds(new Set());
    loadAssignments(sId);
  };

  if (!sId) return <div style={{ padding: '2rem' }}>Please log in to view assignments.</div>;

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '1rem' }}>
      <header style={{ marginBottom: '2rem' }}>
        <h1 style={{ marginBottom: '0.5rem' }}>Assigned from Teacher</h1>
        <p style={{ color: 'var(--text-muted)' }}>Select items to add to your My Flashcards.</p>
      </header>

      {addedCount !== null && (
        <div className="card" style={{ marginBottom: '2rem', background: '#ecfdf5', borderColor: '#10b981', textAlign: 'center' }}>
          <h3 style={{ color: '#065f46', marginTop: 0 }}>✅ {addedCount} {addedCount === 1 ? 'item' : 'items'} added!</h3>
          <p style={{ marginBottom: '1.5rem' }}>You can start encoding missions for these now.</p>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
            <button className="btn btn-primary" onClick={() => navigate(`/student/${db.getCurrentUserId()}/builder`)}>Start Encoding Now</button>
            <Link to={`/student/${db.getCurrentUserId()}`} className="btn btn-outline" style={{ background: '#fff' }}>Go to My Flashcards</Link>
            <button className="btn btn-outline" style={{ background: '#fff' }} onClick={() => setAddedCount(null)}>Later</button>
          </div>
        </div>
      )}

      {assignedItems.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🎉</div>
          <h3>All Caught Up!</h3>
          <p style={{ color: 'var(--text-muted)' }}>No new assignments from your teacher.</p>
          <Link to={`/student/${db.getCurrentUserId()}`} className="btn btn-primary" style={{ marginTop: '1rem' }}>Back to My Flashcards</Link>
        </div>
      ) : (
        <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
          <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc' }}>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button className="btn btn-outline" style={{ background: '#fff', fontSize: '0.9rem', padding: '0.4rem 0.8rem' }} onClick={handleSelectAll}>Select All</button>
              <button className="btn btn-outline" style={{ background: '#fff', fontSize: '0.9rem', padding: '0.4rem 0.8rem' }} onClick={handleClearSelection}>Clear</button>
            </div>
            <button
              className="btn btn-primary"
              onClick={handleAddSelected}
              disabled={selectedIds.size === 0}
              style={{ padding: '0.5rem 1.5rem' }}
            >
              Add Selected ({selectedIds.size}) to My Flashcards
            </button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: '#f1f5f9', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '0.75rem 1rem', width: '40px' }}></th>
                  <th style={{ padding: '0.75rem 1rem' }}>Focus Expression</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Chunk Translation</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Topic</th>
                </tr>
              </thead>
              <tbody>
                {assignedItems.filter(i => i.itemType !== 'reading').map(item => {
                  const chunkItem = item as ChunkItem;
                  return (
                    <tr
                      key={item.id}
                      style={{
                        borderBottom: '1px solid var(--border)',
                        background: selectedIds.has(item.id) ? '#f0f9ff' : 'transparent',
                        cursor: 'pointer'
                      }}
                      onClick={() => handleToggleSelect(item.id)}
                    >
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(item.id)}
                          onChange={() => { }} // Controlled via row click
                          style={{ cursor: 'pointer' }}
                        />
                      </td>
                      <td style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>{chunkItem.focusExpression}</td>
                      <td style={{ padding: '0.75rem 1rem', color: 'var(--text-muted)' }}>{chunkItem.chunkTranslation}</td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <span className="status-badge" style={{ fontSize: '0.75rem', background: '#fef3c7', color: '#92400e' }}>
                          {item.topic || 'General'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
