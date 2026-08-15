import { defineConfig } from 'drizzle-kit';

// drizzle-kit config files run outside the app's normal env loading, so a
// sensible default file path is hardcoded here rather than assuming
// DATABASE_URL is set at config-load time.
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'file:./data/app.db',
  },
});
