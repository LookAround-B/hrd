import { defineConfig } from '@playwright/test';
const database=process.env.HRD_TEST_DATABASE_URL;
if(!database||new URL(database).pathname!=='/hrd_test')throw new Error('Browser tests require HRD_TEST_DATABASE_URL pointing to an isolated database named hrd_test.');
export default defineConfig({
  testDir:'tests/e2e',workers:1,timeout:30000,reporter:'list',
  use:{baseURL:'http://localhost:8001',trace:'retain-on-failure',screenshot:'only-on-failure',launchOptions:process.env.HRD_CHROMIUM_EXECUTABLE?{executablePath:process.env.HRD_CHROMIUM_EXECUTABLE}:{}},
  webServer:{command:'npm run dev',url:'http://localhost:8001',reuseExistingServer:false,timeout:90000,
    env:{DATABASE_URL:database,TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,9).toString('base64'),ADMIN_EMAILS:'admin@example.com',APP_ORIGIN:'http://localhost:8001',EFM_ALLOWED_HOSTS:'efm.example.com',GOOGLE_CLIENT_ID:''}}
});
