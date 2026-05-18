import { Link, useLocation, useNavigate } from 'react-router-dom';
import { db } from '../lib/db';
import { useEffect, useState } from 'react';

const DEFAULT_NAV_SETTINGS = [
  { id: 'dashboard', name: 'Dashboard', path: '', location: 'bar' },
  { id: 'flashcards', name: 'Flashcards', path: '/flashcards', location: 'bar' },
  { id: 'practice', name: 'Retrieval', path: '/practice', location: 'bar' },
  { id: 'reading', name: 'Reading', path: '/reading', location: 'bar' },
  { id: 'writing', name: 'Writing', path: '/writing', location: 'bar' },
  { id: 'tone', name: 'Tone', path: '/tone-practice', location: 'more' },
  { id: 'exercises', name: 'Exercises', path: '/exercises', location: 'more' },
  { id: 'report', name: 'Report', path: '/report', location: 'more' }
];

export default function Navbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);

  // Directly read from DB during render for "true" reactivity when location changes
  const user = db.getLoggedUser();
  const activeRole = db.getCurrentRole();

  // Parse studentId from URL as backup for broken links on initial load
  const studentIdFromPath = location.pathname.startsWith('/student/') 
    ? location.pathname.split('/')[2] 
    : null;
  const effectiveStudentId = db.getCurrentUserId() || studentIdFromPath;

  // Read nav settings from localStorage
  const savedSettingsStr = effectiveStudentId ? localStorage.getItem(`navbar_settings_${effectiveStudentId}`) : null;
  const navSettings = savedSettingsStr ? JSON.parse(savedSettingsStr) : DEFAULT_NAV_SETTINGS;

  const barItems = navSettings.filter((item: any) => item.location === 'bar');
  const moreItems = navSettings.filter((item: any) => item.location === 'more');

  // Redirect if visiting a path that doesn't match the active role
  useEffect(() => {
    if (location.pathname === '/') return; // Don't redirect on login page

    // Role-based path guarding
    const isTeacherPath = location.pathname.startsWith('/teacher');
    const isStudentPath = location.pathname.startsWith('/student');

    if (!user) {
      // For student workspace paths, we don't redirect to / because 
      // StudentRouteHandler will initialize the session from the URL.
      if (isStudentPath) return;

      navigate('/');
      return;
    }

    if (activeRole === 'student' && isTeacherPath) {
      navigate('/student');
    } else if (activeRole === 'teacher' && isStudentPath) {
      navigate('/teacher');
    }
  }, [location.pathname, activeRole, !!user]);

  // HIDE Navbar on Profile Selection page or if no user is logged in
  if (location.pathname === '/' || !user) return null;

  const handleRoleSwitch = (role: 'teacher' | 'student') => {
    db.setCurrentRole(role);
    if (role === 'teacher') navigate('/teacher');
    else navigate('/student');
  };

  const isTeacherAccount = user.role === 'teacher';

  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 100, background: '#fff', borderBottom: '1px solid var(--border)', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
      {/* Top Banner: Mode Indicator & Switch Account */}
      <div style={{ padding: '0.5rem 1rem', background: activeRole === 'teacher' ? '#f1f5f9' : '#f0fdf4', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
        {(activeRole === 'teacher' && !location.pathname.startsWith('/student/')) ? (
          <Link to="/" className="btn btn-outline" style={{ fontSize: '0.8rem', padding: '0.25rem 0.75rem', border: '1px solid #cbd5e1', background: '#fff' }}>
            ↩ Switch Account ({user.name})
          </Link>
        ) : (
          <div /> // Empty placeholder to maintain flex layout
        )}

        {isTeacherAccount && (
          <div style={{ display: 'flex', background: '#fff', padding: '2px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
            <button
              onClick={() => handleRoleSwitch('teacher')}
              style={{
                padding: '0.3rem 0.75rem', fontSize: '0.85rem', borderRadius: '4px', border: 'none', cursor: 'pointer',
                background: activeRole === 'teacher' ? 'var(--primary)' : 'transparent',
                color: activeRole === 'teacher' ? '#fff' : 'var(--text-muted)',
                fontWeight: activeRole === 'teacher' ? 'bold' : 'normal'
              }}
            >
              Teacher Mode
            </button>
            <button
              onClick={() => handleRoleSwitch('student')}
              style={{
                padding: '0.3rem 0.75rem', fontSize: '0.85rem', borderRadius: '4px', border: 'none', cursor: 'pointer',
                background: activeRole === 'student' ? 'var(--success)' : 'transparent',
                color: activeRole === 'student' ? '#fff' : 'var(--text-muted)',
                fontWeight: activeRole === 'student' ? 'bold' : 'normal'
              }}
            >
              Student Mode
            </button>
          </div>
        )}

        {!isTeacherAccount && (
          <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--success)' }}>
            Student Workspace
          </span>
        )}
      </div>

      {/* Main Navigation Row */}
      <nav style={{ display: 'flex', gap: '1rem', maxWidth: '1000px', margin: '0 auto', padding: '0.5rem 1rem' }}>
        {activeRole === 'teacher' ? (
          <>
            <NavLink to="/teacher" current={location.pathname}>Dashboard</NavLink>
            <NavLink to="/teacher/content-bank" current={location.pathname}>Content Bank</NavLink>
            <NavLink to="/teacher/template-bank" current={location.pathname}>Template Bank</NavLink>
            <NavLink to="/teacher/assignments" current={location.pathname}>Student Assignments</NavLink>
            <NavLink to="/teacher/students" current={location.pathname}>Student Manager</NavLink>
          </>
        ) : (
          <>
            {barItems.map((item: any) => (
              <NavLink key={item.id} to={`/student/${effectiveStudentId}${item.path}`} current={location.pathname}>
                {item.name}
              </NavLink>
            ))}
            
            {/* More Dropdown */}
            <div style={{ position: 'relative' }}>
              <button 
                onClick={() => setMoreOpen(!moreOpen)}
                style={{
                  padding: '0.5rem 0.25rem', background: 'none', border: 'none', fontSize: '0.95rem',
                  color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem'
                }}
              >
                More ▾
              </button>
              {moreOpen && (
                <div style={{
                  position: 'absolute', top: '100%', right: 0, background: '#fff', border: '1px solid var(--border)',
                  borderRadius: '4px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', minWidth: '150px', zIndex: 101,
                  display: 'flex', flexDirection: 'column', padding: '0.5rem 0'
                }}>
                  {moreItems.map((item: any) => (
                    <DropdownLink key={item.id} to={`/student/${effectiveStudentId}${item.path}`} onClick={() => setMoreOpen(false)}>
                      {item.name}
                    </DropdownLink>
                  ))}
                  <DropdownLink to={`/student/${effectiveStudentId}/bar-settings`} onClick={() => setMoreOpen(false)}>
                    ⚙️ Bar Settings
                  </DropdownLink>
                </div>
              )}
            </div>
          </>
        )}
      </nav>

    </div>
  );
}

function DropdownLink({ to, children, onClick }: { to: string; children: React.ReactNode; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <Link
      to={to}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: '0.5rem 1rem',
        textDecoration: 'none',
        fontSize: '0.95rem',
        color: 'var(--text-muted)',
        background: hover ? '#f8fafc' : 'transparent',
        transition: 'background 0.2s'
      }}
    >
      {children}
    </Link>
  );
}

function NavLink({ to, children, current }: { to: string; children: React.ReactNode; current: string }) {
  const isActive = current === to || (to !== '/' && current.startsWith(to));
  return (
    <Link
      to={to}
      style={{
        padding: '0.5rem 0.25rem', textDecoration: 'none', fontSize: '0.95rem',
        color: isActive ? 'var(--primary)' : 'var(--text-muted)',
        fontWeight: isActive ? 'bold' : 'normal',
        borderBottom: isActive ? '2px solid var(--primary)' : '2px solid transparent',
        transition: 'all 0.2s'
      }}
    >
      {children}
    </Link>
  );
}
