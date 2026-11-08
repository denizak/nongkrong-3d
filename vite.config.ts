import { defineConfig } from 'vite';

// GitHub Pages serves the game from /nongkrong-3d/. Dev and plain builds stay at '/'.
const githubPages = process.env.GITHUB_PAGES === 'true';

export default defineConfig({
  base: githubPages ? '/nongkrong-3d/' : '/',
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
