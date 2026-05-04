import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { initializeDB } from './lib/db'

// Initialize DB before rendering to avoid race conditions with non-reactive components
initializeDB();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
