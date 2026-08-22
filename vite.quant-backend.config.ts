import { defineConfig } from 'vite';

export default defineConfig({
  build:{
    target:'node20',outDir:'dist',emptyOutDir:false,minify:false,sourcemap:false,
    lib:{entry:'src/quantBackendEntry.ts',formats:['cjs'],fileName:()=> 'quant-backend.cjs'},
    rollupOptions:{output:{exports:'named'}},
  },
});
