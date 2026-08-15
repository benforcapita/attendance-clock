import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/attendance-clock/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        navigateFallback: '/attendance-clock/index.html',
      },
      manifest: {
        name: 'Attendance Clock',
        short_name: 'Clock',
        display: 'standalone',
        start_url: '/attendance-clock/',
        icons: [
          {
            src: '/attendance-clock/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/attendance-clock/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
