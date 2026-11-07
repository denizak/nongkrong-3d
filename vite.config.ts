import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'esnext',
    rolldownOptions: {
      output: {
        // Three.js gets its own chunk. Rapier is split out by the dynamic import in core/Physics.ts.
        codeSplitting: {
          groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]/, priority: 20 }],
        },
      },
    },
  },
});
