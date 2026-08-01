import React from 'react';
import ReactDOM from 'react-dom/client';
import MagicPortal from './MagicPortal';
import { registerServiceWorker } from './push';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <MagicPortal />
  </React.StrictMode>
);

// Service worker do PWA — sem ele o aparelho não recebe push. Registrado
// depois do load para não competir com o primeiro render.
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => { registerServiceWorker(); });
}
