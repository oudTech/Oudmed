#!/usr/bin/env node
/**
 * Fails if a Unicode dash or minus sign appears anywhere in source or copy:
 * U+2010 to U+2015 (hyphen, non-breaking hyphen, figure dash, en dash, em dash,
 * horizontal bar) and U+2212 (minus sign). ASCII hyphen-minus is fine, and so
 * is U+2500 (box drawing) used in comment dividers; neither is matched.
 *
 * Run: `node scripts/check-dashes.mjs` (also runs in CI).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT_DIRS = ['apps', 'packages', 'docs', 'scripts']
const ROOT_FILES = ['README.md', 'BUILD_GUIDE.md', 'render.yaml']
const SKIP_DIRS = new Set([
  'node_modules', '.next', 'dist', 'build', '.turbo', 'coverage', '.git',
])
const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|mdx|css|scss|html|yml|yaml|prisma|sql|sh|ps1)$/

// Code points assembled at runtime so this file contains no forbidden character
// itself: U+2010..U+2015 dashes, plus U+2212 minus.
const FORBIDDEN_CODES = [0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212]
const FORBIDDEN = new Set(FORBIDDEN_CODES)

const hits = []

function walk(dir) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    let s
    try {
      s = statSync(p)
    } catch {
      continue
    }
    if (s.isDirectory()) walk(p)
    else if (EXT.test(name)) scan(p)
  }
}

function scan(file) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return
  }
  text.split('\n').forEach((line, i) => {
    for (const ch of line) {
      if (FORBIDDEN.has(ch.codePointAt(0))) {
        hits.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`)
        return
      }
    }
  })
}

for (const d of ROOT_DIRS) walk(d)
for (const f of ROOT_FILES) scan(f)

if (hits.length) {
  console.error('Forbidden dash / minus characters found (em-dash, en-dash, U+2212 minus, ...):')
  for (const h of hits) console.error('  ' + h)
  console.error(`\n${hits.length} line(s). Use an ASCII hyphen-minus, or U+2500 for box-drawing dividers.`)
  process.exit(1)
}

console.log('dash scan clean')
