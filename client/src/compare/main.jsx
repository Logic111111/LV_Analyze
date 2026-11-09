import React from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider } from '../context/ThemeContext.jsx';
import CompareApp from './CompareApp.jsx';
import '../styles.css';

// The comparison app (compare.html): its own page, sharing the main app's sign-in, styles and theme.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <CompareApp />
    </ThemeProvider>
  </React.StrictMode>
);
