#!/usr/bin/env node
import { startHttpServer } from './http.js'

async function main() {
  startHttpServer()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
