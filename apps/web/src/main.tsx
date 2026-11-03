import { createRoot } from 'react-dom/client';
import { t } from '@yapesa/i18n';
import { tokens } from '@yapesa/ui-tokens';
import './style.css';
const root = document.getElementById('root');
if (!root) throw new Error('Application root is missing');
createRoot(root).render(
  <main style={{ color: tokens.color.ink }}>
    <p className="eyebrow">{t('phase')}</p>
    <h1>{t('appName')}</h1>
    <p className="tagline">{t('tagline')}</p>
    <section>
      <h2>{t('status')}</h2>
      <p>{t('next')}</p>
    </section>
  </main>,
);
