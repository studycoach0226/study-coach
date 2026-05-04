import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';

import RoleSwitcher from './pages/RoleSwitcher';
import ConnectionBuilder from './pages/ConnectionBuilder';
import RetrievalPractice from './pages/RetrievalPractice';
import ReportCard from './pages/ReportCard';
import TeacherDashboard from './pages/TeacherDashboard';
import StudentDetailReport from './pages/StudentDetailReport';
import WordCard from './pages/WordCard';
import FlashcardLibrary from './pages/FlashcardLibrary';
import TeacherContentBank from './pages/TeacherContentBank';
import TeacherTemplateBank from './pages/TeacherTemplateBank';
import TeacherStudentAssignment from './pages/TeacherStudentAssignment';
import StudentAssignments from './pages/StudentAssignments';
import ReadingPractice from './pages/ReadingPractice';
import TeacherStudentManager from './pages/TeacherStudentManager';
import ListenSpeak from './pages/ListenSpeak';

import Navbar from './components/Navbar';
import StudentRouteHandler from './components/StudentRouteHandler';

export default function App() {
  return (
    <Router>
      <Navbar />

      <div style={{ padding: '0rem' }}>
        <Routes>
          <Route path="/" element={<RoleSwitcher />} />

          <Route path="/student" element={<Navigate to="/student/u0" replace />} />
          <Route path="/student/:studentId" element={<StudentRouteHandler />} />
          
          {/* Compatibility Routes with studentId prefix */}
          <Route path="/student/:studentId/builder" element={<ConnectionBuilder />} />
          <Route path="/student/:studentId/word/:id" element={<WordCard />} />
          <Route path="/student/:studentId/flashcards" element={<FlashcardLibrary />} />
          <Route path="/student/:studentId/practice" element={<RetrievalPractice />} />
          <Route path="/student/:studentId/report" element={<ReportCard />} />
          <Route path="/student/:studentId/assignments" element={<StudentAssignments />} />
          <Route path="/student/:studentId/reading-practice/:itemId" element={<ReadingPractice />} />
          <Route path="/student/:studentId/listen-speak" element={<ListenSpeak />} />

          {/* Fallback Legacy Routes */}
          <Route path="/student/builder" element={<ConnectionBuilder />} />
          <Route path="/student/word/:id" element={<WordCard />} />
          <Route path="/student/flashcards" element={<FlashcardLibrary />} />
          <Route path="/student/practice" element={<RetrievalPractice />} />
          <Route path="/student/report" element={<ReportCard />} />
          <Route path="/student/assignments" element={<StudentAssignments />} />
          <Route path="/student/reading-practice/:itemId" element={<ReadingPractice />} />


          <Route path="/teacher" element={<TeacherDashboard />} />
          <Route path="/teacher/student/:id" element={<StudentDetailReport />} />
          <Route path="/teacher/content-bank" element={<TeacherContentBank />} />
          <Route path="/teacher/template-bank" element={<TeacherTemplateBank />} />
          <Route path="/teacher/assignments" element={<TeacherStudentAssignment />} />
          <Route path="/teacher/students" element={<TeacherStudentManager />} />
        </Routes>
      </div>
    </Router>
  );
}
