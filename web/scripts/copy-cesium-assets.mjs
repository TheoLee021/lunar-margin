import { cpSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'node_modules/cesium/Build/Cesium')
const target = join(root, 'public/cesium')
mkdirSync(target, { recursive: true })
for (const name of ['Workers', 'Assets', 'ThirdParty', 'Widgets']) {
  cpSync(join(source, name), join(target, name), { recursive: true })
}
