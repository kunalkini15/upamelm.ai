import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AboutPage } from './components/about/AboutPage';
import './index.css';

const isAboutRoute = window.location.pathname.replace(/\/+$/, '') === '/about';
if (isAboutRoute) {
  document.title = 'Our Story · Upamelm.ai';
  document.body.classList.remove('overflow-hidden');
  document.getElementById('root')?.classList.remove('h-screen', 'w-screen', 'overflow-hidden');
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isAboutRoute ? <AboutPage /> : <App />}
  </React.StrictMode>
);
