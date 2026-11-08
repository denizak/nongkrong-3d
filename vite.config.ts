import { defineConfig } from 'vite';

// Build for GitHub Pages, the self-hosted site, or the root by default.
const githubPages = process.env.GITHUB_PAGES === 'true';
const selfHosted = process.env.SELF_HOSTED === 'true';

export default defineConfig({
  base: selfHosted ? '/nongkrong/' : githubPages ? '/nongkrong-3d/' : '/',
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
