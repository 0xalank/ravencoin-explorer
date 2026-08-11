let input = ''
for await (const chunk of process.stdin) input += chunk
const text = input.trim()
let url
try {
  url = new URL(text)
} catch {
  throw new Error('Database URL must be a PostgreSQL connection URL.')
}
if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Database URL must use postgres:// or postgresql://.')
const authorityPassword = url.password ? decodeURIComponent(url.password) : ''
const parameterPassword = url.searchParams.get('password') ?? ''
if (url.searchParams.has('sslpassword')) throw new Error('Put the TLS key passphrase in a protected client configuration; sslpassword is not accepted in a database URL.')
if (url.hash) throw new Error('Database URL must not contain a fragment.')
if (authorityPassword && parameterPassword && authorityPassword !== parameterPassword) {
  throw new Error('Database URL contains conflicting passwords.')
}
url.password = ''
url.searchParams.delete('password')
process.stdout.write(`${url.toString()}\0${authorityPassword || parameterPassword}\0`)
