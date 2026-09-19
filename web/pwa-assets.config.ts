import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// `npm run icons` regenerates public/pwa-*.png, the maskable icon, apple-touch-icon and favicon
// from public/icon.svg. To brand the app: replace icon.svg with the club logo, adjust BACKGROUND
// to the logo's background colour, and re-run. (Maskable/Apple icons must be full-bleed.)
const BACKGROUND = '#0b5f8e';

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    transparent: { ...minimal2023Preset.transparent, padding: 0 },
    maskable: { ...minimal2023Preset.maskable, padding: 0.12, resizeOptions: { background: BACKGROUND } },
    apple: { ...minimal2023Preset.apple, padding: 0.08, resizeOptions: { background: BACKGROUND } },
  },
  images: ['public/icon.svg'],
});
