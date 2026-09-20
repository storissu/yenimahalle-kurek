import './index.css';
import { renderConfigError } from './ConfigError';
import { envResult } from './lib/env';
import { initInstallPrompt } from './lib/install';
import { initTheme } from './lib/theme';

initTheme(); // the saved light / dark choice (public/theme-init.js already applied it before the first paint)
initInstallPrompt();

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');

if (envResult.ok) {
  // Loaded lazily: the Supabase client can only be created once the environment is valid.
  const { mountApp } = await import('./mountApp');
  mountApp(container);
} else {
  renderConfigError(container, envResult.issues);
}
