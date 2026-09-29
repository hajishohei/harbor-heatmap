import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
const src = readFileSync(new URL('../tracker/t.src.js', import.meta.url), 'utf8')
  .replace('__SUPABASE_URL__', 'https://didhhgjaxdnwtwnbrrkk.supabase.co')
  .replace('__SUPABASE_KEY__', 'sb_publishable_5eAOWsn3yXNPPYZWtRldTg_vNnVWzoQ');
writeFileSync('dist/t.src.js', src);
await build({ entryPoints: ['dist/t.src.js'], outfile: 'dist/t.js', minify: true, target: 'es2017', bundle: false, legalComments: 'none' });
import('node:fs').then(fs => { fs.unlinkSync('dist/t.src.js'); console.log('tracker', fs.statSync('dist/t.js').size, 'bytes'); });
