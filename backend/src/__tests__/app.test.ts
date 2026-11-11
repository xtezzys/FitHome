import { describe, it, expect, afterAll } from 'vitest';
import { createApp } from '../app.js';
import type { Server } from 'node:http';

const app = createApp();

let server: Server | undefined;
let baseUrl = '';

/** Поднимает приложение на свободном порту — без зависимости от supertest. */
function listen(): Promise<void> {
  return new Promise((resolve) => {
    server = app.listen(0, () => {
      const address = server!.address();
      if (typeof address === 'object' && address) {
        baseUrl = `http://127.0.0.1:${address.port}`;
      }
      resolve();
    });
  });
}

afterAll(() => {
  server?.close();
});

describe('GET /api/health', () => {
  it('отвечает 200 и JSON в формате из docs/api.md §8', async () => {
    await listen();

    const response = await fetch(`${baseUrl}/api/health`);
    const body = (await response.json()) as { status: string; timestamp: string };

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeTruthy();
  });

  it('неизвестный маршрут отвечает 404 в едином формате ошибок', async () => {
    await listen();

    const response = await fetch(`${baseUrl}/api/unknown`);
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});
