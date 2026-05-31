import path from 'path';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

function parsePort(value: string | undefined, fallback: number) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 ? port : fallback;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const devPort = parsePort(env.VITE_DEV_PORT, 5173);
  const previewPort = parsePort(env.VITE_PREVIEW_PORT, 4173);

  return {
    plugins: [react()],
    preview: {
      host: '127.0.0.1',
      port: previewPort,
      strictPort: true,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      host: '127.0.0.1',
      port: devPort,
      strictPort: true,
    },
    test: {
      environment: 'jsdom',
      globals: false,
      setupFiles: ['./src/test/setup.ts'],
    },
  };
});
