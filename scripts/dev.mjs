import { spawn } from 'node:child_process'

const children = [
  spawn(process.execPath, ['--watch', 'server/index.mjs'], {
    stdio: 'inherit',
    env: { ...process.env, PORT: '8787', NODE_ENV: 'development' },
  }),
  spawn('pnpm', ['exec', 'vite'], { stdio: 'inherit', shell: process.platform === 'win32' }),
]

const stop = () => children.forEach((child) => child.kill('SIGTERM'))
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
children.forEach((child) => child.on('exit', (code) => {
  if (typeof code === 'number' && code !== 0) process.exitCode = code
}))
