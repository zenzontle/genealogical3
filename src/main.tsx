import React from 'react';
import { createRoot } from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import '@xyflow/react/dist/style.css';
import './styles/styles.css';
import App from './app/App';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <Analytics mode={import.meta.env.DEV ? 'development' : 'production'} />
    <SpeedInsights />
  </React.StrictMode>,
);
