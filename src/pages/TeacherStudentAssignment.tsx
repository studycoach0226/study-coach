import { useState, useEffect } from 'react';
import { db } from '../lib/db';
import { templateBank } from '../lib/retrievable/templateBank';
import { assignmentStore } from '../lib/retrievable/assignmentStore';
import { TaskTemplate, StudentAssignment } from '../lib/retrievable/types';
import { User as GlobalUser, LearningItem } from '../lib/types';

export default function TeacherStudentAssignment() {
  const [students, setStudents] = useState<GlobalUser[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<GlobalUser | null>(null);
  const [items, setItems] = useState<LearningItem[]>([]);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [assignment, setAssignment] = useState<StudentAssignment | null>(null);

  useEffect(() => {
    setStudents(db.getUsers().filter(u => u.role === 'student'));
    setItems(db.getLearningItems());
    setTemplates(templateBank.getAll());
  }, []);

  useEffect(() => {
    if (selectedStudent) {
      setAssignment(assignmentStore.getOrCreate(selectedStudent.id));
    } else {
      setAssignment(null);
    }
  }, [selectedStudent]);

  const handleSyncAll = () => {
    assignmentStore.syncAllToStudents();
    setAssignment(selectedStudent ? assignmentStore.getOrCreate(selectedStudent.id) : null);
  };

  const handleSyncStudent = () => {
    if (selectedStudent) {
      assignmentStore.syncToStudents(selectedStudent.id);
      setAssignment(assignmentStore.getByStudentId(selectedStudent.id) || null);
    }
  };

  const hasUnsynced = selectedStudent ? assignmentStore.hasUnsyncedChanges(selectedStudent.id) : false;
  const lastSynced = assignmentStore.getLastSynced();

  const toggleItem = (id: string) => {
    if (!assignment) return;
    const currentIds = Array.isArray(assignment.learning_item_ids) ? assignment.learning_item_ids : [];
    const current = [...currentIds];
    const index = current.indexOf(id);
    if (index >= 0) current.splice(index, 1);
    else current.push(id);
    
    const updated = { ...assignment, learning_item_ids: current, updated_at: new Date().toISOString() };
    assignmentStore.save(updated);
    setAssignment(updated);
  };

  const toggleTemplate = (id: string) => {
    if (!assignment) return;
    const current = [...assignment.template_ids];
    const index = current.indexOf(id);
    if (index >= 0) current.splice(index, 1);
    else current.push(id);
    
    const updated = { ...assignment, template_ids: current, updated_at: new Date().toISOString() };
    assignmentStore.save(updated);
    setAssignment(updated);
  };

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '1rem' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 style={{ margin: 0 }}>Student Assignment Management</h1>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {lastSynced && (
            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              Last Global Sync: {new Date(lastSynced).toLocaleString()}
            </span>
          )}
          <button className="btn btn-success" onClick={handleSyncAll}>Sync All to Students</button>
        </div>
      </header>
      
      <div className="card" style={{ marginBottom: '2rem' }}>
        <label>Select Student</label>
        <select 
          style={{ width: '100%', padding: '0.75rem' }}
          onChange={(e) => setSelectedStudent(students.find(s => s.id === e.target.value) || null)}
          value={selectedStudent?.id || ''}
        >
          <option value="">-- Choose a student --</option>
          {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {selectedStudent && assignment && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
          <div className="card">
            <h3>Assigned Content Units</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '500px', overflowY: 'auto', paddingRight: '0.5rem' }}>
              {items.map(item => (
                <label key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', padding: '0.75rem', border: '1px solid var(--border)', borderRadius: '8px' }}>
                  <input 
                    type="checkbox" 
                    checked={Array.isArray(assignment.learning_item_ids) && assignment.learning_item_ids.includes(item.id)}
                    onChange={() => toggleItem(item.id)}
                    style={{ width: '18px', height: '18px' }}
                  />
                  <div>
                    <div style={{ fontWeight: 'bold', fontSize: '1.05rem' }}>{item.focusExpression}</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{item.chunk}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>Topic: {item.topic}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 style={{ margin: 0 }}>Enabled Templates</h3>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                {hasUnsynced && <span style={{ background: '#fef3c7', color: '#92400e', padding: '0.2rem 0.4rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold' }}>⚠️ Unsynced</span>}
                <button className="btn btn-primary" style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }} onClick={handleSyncStudent} disabled={!hasUnsynced}>Sync Student</button>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {templates.map(t => {
                const isGloballyDisabled = !t.enabled;
                return (
                  <label key={t.template_id} style={{ 
                    display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem', 
                    border: '1px solid var(--border)', borderRadius: '4px',
                    background: isGloballyDisabled ? '#f1f5f9' : 'transparent',
                    opacity: isGloballyDisabled ? 0.6 : 1,
                    cursor: isGloballyDisabled ? 'not-allowed' : 'pointer'
                  }}>
                    <input 
                      type="checkbox" 
                      checked={assignment.template_ids.includes(t.template_id)}
                      onChange={() => !isGloballyDisabled && toggleTemplate(t.template_id)}
                      disabled={isGloballyDisabled}
                    />
                    <div>
                      <div style={{ fontWeight: 'bold' }}>{t.template_name} {isGloballyDisabled && <span style={{ color: 'var(--danger)', fontSize: '0.7rem' }}>(Disabled in Library)</span>}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Mode {t.mode_code}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
