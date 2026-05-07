import { Link, useLocation, useNavigate } from 'react-router-dom';
import { db } from '../lib/db';
import { useEffect } from 'react';

export default function Navbar() {
  const location = useLocation();
  const navigate = useNavigate();

  // Directly read from DB during render for "true" reactivity when location changes
  const user = db.getLoggedUser();
  const activeRole = db.getCurrentRole();

  // Parse studentId from URL as backup for broken links on initial load
  const studentIdFromPath = location.pathname.startsWith('/student/') 
    ? location.pathname.split('/')[2] 
    : null;
  const effectiveStudentId = db.getCurrentUserId() || studentIdFromPath;

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
            <NavLink to={`/student/${effectiveStudentId}`} current={location.pathname}>Dashboard</NavLink>
            <NavLink to={`/student/${effectiveStudentId}/flashcards`} current={location.pathname}>My Flashcards</NavLink>
            <NavLink to={`/student/${effectiveStudentId}/practice`} current={location.pathname}>Retrieval Practice</NavLink>
            <NavLink to={`/student/${effectiveStudentId}/reading`} current={location.pathname}>My Reading</NavLink>
            <NavLink to={`/student/${effectiveStudentId}/report`} current={location.pathname}>View Report</NavLink>
            <NavLink to={`/student/${effectiveStudentId}/listen-speak`} current={location.pathname}>Listen & Speak</NavLink>
          </>
        )}
      </nav>

    </div>
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
