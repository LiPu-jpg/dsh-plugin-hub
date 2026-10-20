import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundleIncludes } from '../src/server/services/profile/profile.ts'

function withProfile(pkg: string): string {
  const home = mkdtempSync(join(tmpdir(), 'dsh-home-'))
  const dir = join(home, 'profiles', 'web')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), pkg)
  process.env.DSH_HOME = home
  return dir
}

test('bundleIncludes: tells whether dsh-plugin is still in dsh.profile.bundles', () => {
  const previous = process.env.DSH_HOME
  try {
    withProfile(JSON.stringify({ dsh: { profile: { bundles: ['dsh-plugin', 'other'] } } }))
    assert.equal(bundleIncludes('web', 'dsh-plugin'), true)
    withProfile(JSON.stringify({ dsh: { profile: { bundles: ['other'] } } }))
    assert.equal(bundleIncludes('web', 'dsh-plugin'), false)
    withProfile(JSON.stringify({ dependencies: {} }))
    assert.equal(bundleIncludes('web', 'dsh-plugin'), true, 'no bundle list means we do not judge')
    withProfile('not json')
    assert.equal(bundleIncludes('web', 'dsh-plugin'), true, 'unreadable profile must not raise a false alarm')
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})
