import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './live/LiveApp';
import './original.css';
import './styles.css';
import './theme.css';
import './live/workspace.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
