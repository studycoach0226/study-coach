import { useState, useEffect } from 'react';
import { templateBank } from '../lib/retrievable/templateBank';
import { TaskTemplate } from '../lib/retrievable/types';

export default function TeacherTemplateBank() {
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [editingTemplate, setEditingTemplate] = useState<Partial<TaskTemplate> | null>(null);
  
  // Bulk Import State
  const [showBulk, setShowBulk] = useState(false);
  const [bulkInput, setBulkInput] = useState('');
  const [importStep, setImportStep] = useState<'idle' | 'preview'>('idle');
  const [parsedTemplates, setParsedTemplates] = useState<TaskTemplate[]>([]);

  useEffect(() => {
    setTemplates(templateBank.getAll());
  }, []);

  const handleSaveDraft = () => {
    // Persist current local template list to the Draft store
    localStorage.setItem('retrievable_template_bank', JSON.stringify(templates));
    alert('Changes saved to Draft Library.');
  };

  const handleSync = () => {
    // 1. Ensure Draft is saved first (or just sync whatever is in Draft)
    // The user wants a separate step, so we assume they saved to Draft already.
    templateBank.syncToStudents();
    setTemplates(templateBank.getAll());
    alert('Draft Library published to students!');
  };

  const hasUnsynced = templateBank.hasUnsyncedChanges();
  const lastSynced = templateBank.getLastSynced();

  const handleSaveTemplate = () => {
    if (editingTemplate && editingTemplate.template_name && editingTemplate.mode_code) {
      const newTemplate: TaskTemplate = {
        template_id: editingTemplate.template_id || `t_${Date.now()}`,
        template_name: editingTemplate.template_name,
        mode_code: editingTemplate.mode_code as any,
        description: editingTemplate.description || '',
        input_fields_needed: editingTemplate.input_fields_needed || [],
        prompt_rule: editingTemplate.prompt_rule || '',
        output_type: editingTemplate.output_type || 'text',
        hint_rule: editingTemplate.hint_rule || '',
        scoring_rule: editingTemplate.scoring_rule || '',
        feedback_rule: editingTemplate.feedback_rule || '',
        enabled: editingTemplate.enabled !== undefined ? editingTemplate.enabled : true,
      };
      
      const updated = [...templates];
      const index = updated.findIndex(t => t.template_id === newTemplate.template_id);
      if (index >= 0) updated[index] = newTemplate;
      else updated.push(newTemplate);
      
      setTemplates(updated);
      setEditingTemplate(null);
    }
  };

  const handleDelete = (id: string) => {
    if (window.confirm('Delete this template?')) {
      setTemplates(templates.filter(t => t.template_id !== id));
    }
  };

  const handleDuplicate = (id: string) => {
    const t = templates.find(item => item.template_id === id);
    if (t) {
      const copy = { ...t, template_id: `t_${Date.now()}`, template_name: `${t.template_name} (Copy)` };
      setTemplates([...templates, copy]);
    }
  };

  const toggleEnabled = (id: string) => {
    setTemplates(templates.map(t => t.template_id === id ? { ...t, enabled: !t.enabled } : t));
  };

  const handleParse = () => {
    try {
      const data = JSON.parse(bulkInput);
      const items = Array.isArray(data) ? data : [data];
      const processed = items.map((item, index) => ({
        ...item,
        template_id: `tbulk_${Date.now()}_${index}`,
        enabled: item.enabled !== undefined ? item.enabled : true
      })) as TaskTemplate[];
      setParsedTemplates(processed);
      setImportStep('preview');
    } catch (e) {
      alert('Invalid JSON format');
    }
  };

  const handleConfirmImport = () => {
    setTemplates([...templates, ...parsedTemplates]);
    setBulkInput('');
    setParsedTemplates([]);
    setImportStep('idle');
    setShowBulk(false);
  };

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '1rem' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>Task Template Management</h1>
          <p style={{ color: 'var(--text-muted)', margin: '0.25rem 0 0 0' }}>Manage retrieval patterns and activity rules.</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          {hasUnsynced && (
            <span style={{ background: '#fef3c7', color: '#92400e', padding: '0.2rem 0.6rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold' }}>
              ⚠️ Unsynced
            </span>
          )}
          {lastSynced && (
            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
              Last Sync: {new Date(lastSynced).toLocaleString()}
            </span>
          )}
          <button className="btn btn-primary" style={{ padding: '0.5rem 1rem' }} onClick={handleSaveDraft}>Save Draft</button>
          <button className="btn btn-success" style={{ padding: '0.5rem 1rem' }} onClick={handleSync} disabled={!hasUnsynced}>Sync to Students</button>
          <button className="btn btn-outline" style={{ background: '#fff' }} onClick={() => setShowBulk(!showBulk)}>Bulk</button>
          <button className="btn btn-primary" onClick={() => setEditingTemplate({})}>+ Template</button>
        </div>
      </header>

      {/* Bulk Import UI */}
      {showBulk && (
        <div className="card" style={{ marginBottom: '2rem', border: '2px solid var(--primary)' }}>
          <h3>Bulk Import Templates (Step {importStep === 'preview' ? '2: Preview' : '1: Paste JSON'})</h3>
          {importStep === 'idle' ? (
            <div>
              <textarea 
                style={{ width: '100%', height: '150px', fontFamily: 'monospace', fontSize: '0.8rem' }} 
                value={bulkInput} 
                onChange={e => setBulkInput(e.target.value)}
                placeholder='[{"template_name": "New Pattern", "mode_code": "C", ...}]'
              />
              <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={handleParse} disabled={!bulkInput.trim()}>Parse & Preview</button>
            </div>
          ) : (
            <div>
              <div style={{ maxHeight: '200px', overflowY: 'auto', background: '#f8fafc', padding: '1rem', borderRadius: '4px', marginBottom: '1rem' }}>
                {parsedTemplates.map((t, i) => <div key={i}>{t.template_name} (Mode {t.mode_code})</div>)}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="btn btn-primary" onClick={handleConfirmImport}>Confirm Import {parsedTemplates.length} templates</button>
                <button className="btn btn-outline" onClick={() => setImportStep('idle')}>Back</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Edit Form */}
      {editingTemplate && (
        <div className="card" style={{ marginBottom: '2rem', border: '2px solid var(--primary)' }}>
          <h3>{editingTemplate.template_id ? 'Edit Template' : 'New Template'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
            <div>
              <label>Template Name</label>
              <input type="text" value={editingTemplate.template_name || ''} onChange={e => setEditingTemplate({...editingTemplate, template_name: e.target.value})} />
            </div>
            <div>
              <label>Mode Code (A-G)</label>
              <select value={editingTemplate.mode_code || 'A'} onChange={e => setEditingTemplate({...editingTemplate, mode_code: e.target.value as any})}>
                {['A','B','C', 'D', 'E', 'F', 'G'].map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label>Description</label>
              <input type="text" value={editingTemplate.description || ''} onChange={e => setEditingTemplate({...editingTemplate, description: e.target.value})} />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label>Prompt Rule</label>
              <textarea style={{ width: '100%', height: '60px' }} value={editingTemplate.prompt_rule || ''} onChange={e => setEditingTemplate({...editingTemplate, prompt_rule: e.target.value})} placeholder="e.g. Translate: {{english_text}}" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-primary" onClick={handleSaveTemplate}>Save Template</button>
            <button className="btn btn-outline" onClick={() => setEditingTemplate(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem' }}>
        {templates.map(t => (
          <div key={t.template_id} className="card" style={{ opacity: t.enabled ? 1 : 0.7, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <div>
                <h3 style={{ margin: 0 }}>{t.template_name}</h3>
                <span className="status-badge" style={{ marginTop: '0.25rem' }}>Mode {t.mode_code}</span>
              </div>
              <div 
                style={{ 
                  width: '40px', height: '24px', background: t.enabled ? 'var(--success)' : '#ccc', borderRadius: '12px', 
                  position: 'relative', cursor: 'pointer' 
                }}
                onClick={() => toggleEnabled(t.template_id)}
              >
                <div style={{ 
                  width: '18px', height: '18px', background: '#fff', borderRadius: '50%', 
                  position: 'absolute', top: '3px', left: t.enabled ? '19px' : '3px', transition: 'left 0.2s'
                }}></div>
              </div>
            </div>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '1rem', flex: 1 }}>{t.description}</p>
            
            <div style={{ fontSize: '0.85rem', marginBottom: '1.5rem' }}>
              <strong>Prompt Rule:</strong>
              <code style={{ display: 'block', padding: '0.5rem', background: '#f1f5f9', marginTop: '0.25rem', borderRadius: '4px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {t.prompt_rule}
              </code>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
              <button className="btn btn-outline" style={{ flex: 1, padding: '0.25rem' }} onClick={() => setEditingTemplate(t)}>Edit</button>
              <button className="btn btn-outline" style={{ flex: 1, padding: '0.25rem' }} onClick={() => handleDuplicate(t.template_id)}>Copy</button>
              <button className="btn btn-outline" style={{ flex: 1, padding: '0.25rem', color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => handleDelete(t.template_id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
