import React from 'react';
import { createRoot } from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import '@xyflow/react/dist/style.css';
import './styles.css';
import App from './App';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <Analytics mode={import.meta.env.DEV ? 'development' : 'production'} />
  </React.StrictMode>,
);
