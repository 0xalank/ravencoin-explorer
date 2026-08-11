import 'dotenv/config'
import { closePool, migrate } from './db.mjs'

try {
  await migrate()
  console.log('Ravencoin explorer database is ready.')
} catch (error) {
  console.error('Database migration failed:', error)
  process.exitCode = 1
} finally {
  await closePool()
}
