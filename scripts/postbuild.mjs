// GitHub Pages has no server-side rewrites. A deep link like
// /find or /respond/<token> would 404 before React Router ever runs.
//
// The fix is to hand GitHub Pages a 404.html that IS the app. Pages serves it
// for any unmatched path while leaving the URL in the address bar untouched,
// so React Router boots and reads the correct pathname with no redirect dance
// and no flash of a wrong page.
//
// The one trade-off: those responses carry an HTTP 404 status. Humans never
// notice; crawlers might. Every link we actually publish (tokenised email
// links included) is a real path the router handles, so this only affects
// genuine typos.
import { copyFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dist = join(process.cwd(), 'dist')
const index = join(dist, 'index.html')

if (!existsSync(index)) {
  console.error('postbuild: dist/index.html is missing. Did vite build run?')
  process.exit(1)
}

copyFileSync(index, join(dist, '404.html'))
console.log('postbuild: wrote dist/404.html')

// Pages will not serve a Jekyll-processed directory the way we expect, and
// Jekyll silently drops files that begin with an underscore.
writeFileSync(join(dist, '.nojekyll'), '')
console.log('postbuild: wrote dist/.nojekyll')
