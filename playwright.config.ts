import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests', workers: 1, webServer: { command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: true }, use: { channel: 'msedge', headless: true, baseURL: 'http://127.0.0.1:5173', viewport: { width: 1150, height: 800 } }, reporter: 'list' });
