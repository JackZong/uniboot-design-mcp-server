#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const errors = []

function mustExist(rel) {
  if (!existsSync(join(root, rel))) errors.push(`missing ${rel}`)
}

function mustJson(rel, check) {
  mustExist(rel)
  try {
    const json = JSON.parse(readFileSync(join(root, rel), 'utf8'))
    check?.(json)
  } catch (err) {
    errors.push(`${rel}: ${err instanceof Error ? err.message : err}`)
  }
}

mustJson('.cursor-plugin/plugin.json', (j) => {
  if (j.name !== 'uniboot-design') errors.push('plugin name must be uniboot-design')
  if (!j.logo) errors.push('plugin logo required')
  if (!j.mcpServers) errors.push('plugin mcpServers required')
})
mustJson('.mcp.json', (j) => {
  const url = j.mcpServers?.['uniboot-design']?.url
  if (!url || !url.startsWith('https://')) errors.push('.mcp.json must use https remote MCP url')
  if (j.mcpServers?.['uniboot-design']?.headers) {
    errors.push('.mcp.json must not ship PAT headers (OAuth only)')
  }
})
mustJson('mcp.json')
mustJson('plugin.json')
mustJson('server.json')
mustExist('assets/logo.svg')
mustExist('skills/uniboot-design/SKILL.md')
mustExist('rules/open-delivery.mdc')
mustExist('commands/open-delivery.md')
mustExist('README.md')

if (errors.length) {
  console.error(errors.map((e) => `✖ ${e}`).join('\n'))
  process.exit(1)
}
console.log('plugin package ok')
