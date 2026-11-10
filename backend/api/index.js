/**
 * Vercel serverless entry point. `npm run build` compiles src/ to dist/ first;
 * Vercel routes every request here (see vercel.json) and Express does the routing.
 */
import { createApp } from '../dist/app.js';
import { loadEnv } from '../dist/config/env.js';

const app = createApp({ env: loadEnv() });

export default app;
