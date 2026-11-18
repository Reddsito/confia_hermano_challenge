// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Temporary: replace every built page with the strike page. Revert to restore the site.
const strike = {
  name: 'strike-page',
  hooks: {
    'astro:build:done': ({ dir }) => {
      const out = fileURLToPath(dir);
      const page = readFileSync(new URL('../../deploy/strike/index.html', import.meta.url));
      const walk = (d) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          const p = join(d, e.name);
          if (e.isDirectory()) walk(p);
          else if (e.name.endsWith('.html')) writeFileSync(p, page);
        }
      };
      walk(out);
      writeFileSync(join(out, '404.html'), page);
    },
  },
};

export default defineConfig({
  integrations: [react(), strike],
  vite: {
    plugins: [tailwindcss()],
  },
});
