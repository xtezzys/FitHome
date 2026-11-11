import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Конфигурация Vite (docs/architecture.md §2).
 * Порт 5173 по умолчанию; базовый URL API задаётся через VITE_API_BASE_URL.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});
