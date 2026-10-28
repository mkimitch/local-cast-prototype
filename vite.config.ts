import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  const apiTarget = process.env.LOCALCAST_VITE_API_TARGET || 'http://127.0.0.1:8787';
  return {
    plugins: [react()],
    envDir: process.env.LOCALCAST_VITE_ENV_DIR || undefined,
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      proxy: {
        '/api': apiTarget,
        '/media': apiTarget,
      },
    },
  };
});
