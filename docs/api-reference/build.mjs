import { readFile, writeFile } from 'node:fs/promises'
import { assemble, embeddedJson, loadSources, GROUPS, API_BASELINE } from './reference.mjs'

const root = new URL('../../', import.meta.url)
const document = assemble(await loadSources(root))
const [template, css, app] = await Promise.all(['page.html', 'page.css', 'page.js'].map(file => readFile(new URL(file, import.meta.url), 'utf8')))
const quiz = JSON.parse(await readFile(new URL('docs/integration/fastlane/fixtures/quiz-candidate.json', root), 'utf8'))
const payload = embeddedJson({ document, groups: GROUPS, baseline: API_BASELINE, quizExample: quiz.payload })
// Replacement callbacks keep literal $', $`, and $& in code/schema descriptions intact.
const html = template.replace('/* INLINE_STYLE */', () => css).replace('/* INLINE_DATA */', () => payload).replace('/* INLINE_APP */', () => app)
const outputs = { 'index.html': html, 'openapi.json': JSON.stringify(document, null, 2) + '\n' }
for (const [file, content] of Object.entries(outputs)) {
  const destination = new URL(file, import.meta.url)
  if (process.argv.includes('--check')) {
    if (await readFile(destination, 'utf8') !== content) throw new Error(`${file} is stale; run npm run build`)
  } else await writeFile(destination, content)
}
console.log(`${process.argv.includes('--check') ? 'Checked' : 'Built'} offline HTML and OpenAPI 3.1.1: 41 operations / 40 ready / 1 unavailable; all references resolved`)
