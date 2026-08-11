#!/usr/bin/env node
/**
 * Concatenates every migration and seed file into two single-paste files:
 *
 *   supabase/setup.sql   schema, security rules and functions
 *   supabase/seed.sql    districts, upazilas, hospitals, settings
 *
 * Run it with:  node scripts/build-setup-sql.mjs
 *
 * Why both this and the CLI
 * -------------------------
 * `supabase db push` is the right way and it needs the CLI installed. Not
 * every volunteer who wants to stand this up has a terminal they can install
 * things on. These two files can be pasted into the SQL editor in a browser,
 * in order, and produce exactly the same database.
 *
 * Generated. Edit the migrations, then re-run this.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const migrationsDir = join(root, 'supabase', 'migrations')
const seedDir = join(root, 'supabase', 'seed')

function bundle(dir, files, title, note) {
  const parts = [
    `-- ${title}`,
    '--',
    '-- GENERATED FILE. Do not edit by hand.',
    '-- Regenerate with:  node scripts/build-setup-sql.mjs',
    '--',
    ...note.split('\n').map((line) => `-- ${line}`),
    '',
    'begin;',
    '',
  ]

  for (const file of files) {
    parts.push(
      '-- ' + '='.repeat(74),
      `-- ${file}`,
      '-- ' + '='.repeat(74),
      '',
      readFileSync(join(dir, file), 'utf8').trimEnd(),
      '',
    )
  }

  parts.push('commit;', '')
  return parts.join('\n')
}

const migrations = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()

const seeds = readdirSync(seedDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()

writeFileSync(
  join(root, 'supabase', 'setup.sql'),
  bundle(
    migrationsDir,
    migrations,
    'Roktolagbe: complete database setup',
    [
      'Paste this whole file into the Supabase SQL editor and run it. It creates',
      'every table, view, function and security policy the site needs.',
      '',
      'It runs in one transaction, so either the whole database is created or',
      'nothing is. Safe to run more than once.',
      '',
      'Then run supabase/seed.sql for the districts, upazilas and hospitals.',
      '',
      'After running both, check the privacy rules took effect. This must return',
      'zero rows:',
      '',
      "  select tablename from pg_tables t where schemaname = 'public'",
      '    and not exists (select 1 from pg_class c',
      '                    where c.relname = t.tablename and c.relrowsecurity);',
    ].join('\n'),
  ),
)

writeFileSync(
  join(root, 'supabase', 'seed.sql'),
  bundle(
    seedDir,
    seeds,
    'Roktolagbe: seed data',
    [
      'Run this after setup.sql. Safe to run more than once.',
      '',
      'Geography is derived from OpenStreetMap and is licensed ODbL.',
      'See supabase/seed/README.md.',
    ].join('\n'),
  ),
)

const size = (p) => (readFileSync(join(root, p), 'utf8').length / 1024).toFixed(0)
console.log(`wrote supabase/setup.sql (${migrations.length} migrations, ${size('supabase/setup.sql')}kb)`)
console.log(`wrote supabase/seed.sql (${seeds.length} files, ${size('supabase/seed.sql')}kb)`)
