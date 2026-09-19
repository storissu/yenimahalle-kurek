import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const appVersion = process.env.npm_package_version ?? '0.0.0';

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // We own the service worker (src/sw.ts) because it handles Web Push.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false, // registered explicitly in src/pwa.ts
      manifest: {
        id: '/',
        name: 'Yeni Mahalle Kürek Kulübü',
        short_name: 'Kürek',
        description: 'Kdz. Ereğli Yeni Mahalle Kürek Kulübü antrenman yönetimi',
        lang: 'tr',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#0b6a9c',
        background_color: '#f3f8fb',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        // Precache the app shell only. API traffic (Supabase) is never cached by the service worker.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
