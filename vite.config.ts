import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

const productionCsp: Plugin = {
  name:'sentinel-production-csp',
  transformIndexHtml:{
    order:'pre',
    handler:() => [{
      tag:'meta',
      attrs:{
        'http-equiv':'Content-Security-Policy',
        content:"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'",
      },
      injectTo:'head-prepend',
    }],
  },
};

export default defineConfig(({ command }) => ({
  plugins: [react(), ...(command === 'build' ? [productionCsp] : [])],
  base: './',
  test: {
    exclude: [
      'integrations/cloudflare-tradingview/**',
      '**/node_modules/**',
      '**/dist/**',
      '**/release/**',
    ],
  },
}));
