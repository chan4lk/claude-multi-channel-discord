#!/usr/bin/env node
// npx mcd-setup — delegates to the platform installer
import { execSync } from 'child_process'
import { platform } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

if (platform() === 'win32') {
  execSync(`powershell -ExecutionPolicy Bypass -File "${join(__dirname, 'install.ps1')}"`, { stdio: 'inherit' })
} else {
  execSync(`bash "${join(__dirname, 'install.sh')}"`, { stdio: 'inherit' })
}
