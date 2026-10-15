import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

/**
 * Localization gates for the map page and the injected switch: the zh/en
 * dictionaries stay key-identical, every literal `t()` key resolves against
 * its dictionary, and no hardcoded CJK interface copy survives outside the
 * exempted i18n block (stored-data mappings and quick-phrase seed values).
 */

/** Evaluate an object literal in an isolated realm and return it here. */
const evaluate = literal => vm.runInNewContext(`(${literal})`)

const extractAppCopy = source => {
  const start = source.indexOf('const COPY = ') + 'const COPY = '.length
  const end = source.indexOf('\n// Stored fragments', start)
  return evaluate(source.slice(start, end).trim())
}

const extractClientCopy = source => {
  const anchor = "ctx.locale.register('dsh-synapse', "
  const start = source.indexOf(anchor) + anchor.length
  const end = source.indexOf("}), 'dsh-synapse: dictionaries')", start)
  return evaluate(source.slice(start, end + 1))
}

const sources = async () => ({
  app: await readFile(new URL('../app.js', import.meta.url), 'utf8'),
  client: await readFile(new URL('../client.js', import.meta.url), 'utf8'),
})

test('keeps the zh and en dictionaries key-identical', async () => {
  const { app, client } = await sources()

  for (const copy of [extractAppCopy(app), extractClientCopy(client)]) {
    assert.ok(Object.keys(copy.zh).length > 0)
    assert.deepEqual(Object.keys(copy.zh).sort(), Object.keys(copy.en).sort())
  }
})

test('resolves every literal t() key against its dictionary', async () => {
  const { app, client } = await sources()

  for (const [source, copy] of [[app, extractAppCopy(app)], [client, extractClientCopy(client)]]) {
    for (const match of source.matchAll(/\bt\('([\w.]+)'/g)) {
      const key = match[1]
      assert.ok(Object.hasOwn(copy.zh, key), `missing key ${key}`)
      assert.ok(Object.hasOwn(copy.en, key), `missing key ${key}`)
    }
  }
})

test('keeps hardcoded CJK copy out of the map page outside the i18n block', async () => {
  const { app } = await sources()
  const lines = app.split('\n')
  let inI18nBlock = false

  lines.forEach((line, index) => {
    if (line.includes('// i18n-copy-start')) {
      inI18nBlock = true
      return
    }
    if (line.includes('// i18n-copy-end')) {
      inI18nBlock = false
      return
    }
    if (inI18nBlock) return
    // Quick-phrase seed values are per-browser user data, not interface copy.
    if (line.includes('DEFAULT_QUICK_PHRASES')) return
    assert.doesNotMatch(line, /[\u4e00-\u9fa5]/, `hardcoded copy on line ${index + 1}: ${line.trim()}`)
  })
})

test('applies the parent language message and re-renders the map page', async () => {
  const { app } = await sources()
  const handler = app.slice(
    app.indexOf("data.type === 'synapse:locale'"),
    app.indexOf("data.type === 'synapse:workspaces'"),
  )

  assert.match(handler, /Object\.hasOwn\(COPY, data\.locale\)/)
  assert.match(handler, /document\.documentElement\.lang = locale/)
  assert.match(handler, /render\(\)/)
})
