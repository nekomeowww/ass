import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer as createHttpsServer, get } from 'node:https'
import { connect as connectTcp } from 'node:net'
import { connect, createServer as createTlsServer } from 'node:tls'

const ca = `-----BEGIN CERTIFICATE-----
MIIDDTCCAfWgAwIBAgIUAwdlrcissYMcCw95H/z5brRlrn0wDQYJKoZIhvcNAQEL
BQAwFjEUMBIGA1UEAwwLYXNzLXRlc3QtY2EwHhcNMjYwODA0MTgzOTQyWhcNMzYw
ODAxMTgzOTQyWjAWMRQwEgYDVQQDDAthc3MtdGVzdC1jYTCCASIwDQYJKoZIhvcN
AQEBBQADggEPADCCAQoCggEBALkTQBrZ5Qef41nRL782BYhznz25ot0LsP0FF7U0
UpFl2SgXAB7i11R4qrrhEQH0axuFHt/imEXXfpKbArWXYI80V1Wo26jMD7XCPxXf
/BGVybRuDTYtHY9kStWQi74gB6lnMZ44MTMWYEUhIi3Gu9Gd7uzk689nUn17ZlQY
8fLjONola4zz7+iBlfSTjkELhg80kxEhYEoRmAOKti0jvThZADVoNRcOFBG7YFt7
qdanBiCBsxQcvMK/VtT5q1hHsRsrnlltdcbLGSgE5nhG6nhBP2gQJ2NFTr9gDOlq
5qHqafTzv9J/CrN3g/HuLqsaBugfbUpT5lItHHWOHT5gCb0CAwEAAaNTMFEwHQYD
VR0OBBYEFOJgYd+mUeNvUI7kbG53U44NJB0zMB8GA1UdIwQYMBaAFOJgYd+mUeNv
UI7kbG53U44NJB0zMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEB
ACKmn8mvYtrmezaA6I7VMPSb0N2ZIjqnO9/bCll4lF5LJFt+qUuV32mn+AnK131p
aPnRNJq8U3SmciBb632Uoh2+eXbPLA2DEydcC/4qVKNay8xbIS001i3VciqxxxEH
a6LVTVmqZROFFy3sTW6Czh+bH1U/2I1vkFLVbvq1ezMT8T463L0g8Pk2ysoVjUst
PQhjvpDgPL8wNpGQ35cEGv35GYV8Nll5EbiHIg4509NGOPJedWDRP3HWnTK6K1a2
I++mws/zsQXjidPgzqU1Ffl9BCTeO3I21fiDdqzIIKO58pO43wXF/ToGWfcJZkYl
2ZT6sGtHTd1Ezt23yTA9CrA=
-----END CERTIFICATE-----`

const cert = `-----BEGIN CERTIFICATE-----
MIIDSzCCAjOgAwIBAgIUZfz1duO1YxKWoWuI2QkQkM8k3VgwDQYJKoZIhvcNAQEL
BQAwFjEUMBIGA1UEAwwLYXNzLXRlc3QtY2EwHhcNMjYwODA0MTgzOTQyWhcNMzYw
ODAxMTgzOTQyWjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwggEiMA0GCSqGSIb3DQEB
AQUAA4IBDwAwggEKAoIBAQCFWk/Hbwy8i2KGEQsTn0B1ivvIllUm9CjjSynBJ8bj
dDxJYt88HIUat6/+WVx9KuTiPMMWFAqlYyo+6dfC2fr7gFlBYOqdZ2IVKNaPC9Eb
aX84xnSyTR6dtfozSxqTBaBhyLVQYx7LIzgp77V6tFhrWNUDCey/Kp1wL6S1H5lr
KW5gyGln0i7mcnV1ePOzQJG+qoIIuSVvrH96JRezOrBhgiQFCE8WH+7ynhLWBnlG
AgMFm7ACz+iUy61k51rRZca0/8xkYc9oTL11lLq9Qdbg12c/myJgaODESjKtXFXd
Q3AsOj/conPwMivdoPs6nt0kSnHuaQltz0PC4149KOMjAgMBAAGjgZIwgY8wDAYD
VR0TAQH/BAIwADAOBgNVHQ8BAf8EBAMCBaAwEwYDVR0lBAwwCgYIKwYBBQUHAwEw
GgYDVR0RBBMwEYIJbG9jYWxob3N0hwR/AAABMB0GA1UdDgQWBBQ8kiReoOOpdAv/
GLAlD25VBkF1uDAfBgNVHSMEGDAWgBTiYGHfplHjb1CO5Gxud1OODSQdMzANBgkq
hkiG9w0BAQsFAAOCAQEAJ2qXdZtkEF+em1d1mjiA6S829p8ZjKLm/L8ZiCB5r9yO
krJFW8rYpphIeysufm9sAMbJknJwQQO02vg/Zxu32fIY9DIRLplpPx/qi/suPgIC
/0hxQcHBBVzSSUGQErI9DAEpBI9OBHQC9LbOug+lFxnv5hS0CfqvPHTTlU1Ejoky
PDvUgrFHYJNTNdNBLLlYc6KUbQ01JBJ44bBdKO8iiiBmQ+11q77B8xX6zgnspmwQ
2EcCmL4EaV1mrJMHzkycIYROs60joWyLsai+pzzdu8btW/GWsjLN0lVmzgG1J/Np
eS60+hk7WYoC2qKtkqGkyZ8yQdyNqPLklEh0RDL2rQ==
-----END CERTIFICATE-----`

const key = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCFWk/Hbwy8i2KG
EQsTn0B1ivvIllUm9CjjSynBJ8bjdDxJYt88HIUat6/+WVx9KuTiPMMWFAqlYyo+
6dfC2fr7gFlBYOqdZ2IVKNaPC9EbaX84xnSyTR6dtfozSxqTBaBhyLVQYx7LIzgp
77V6tFhrWNUDCey/Kp1wL6S1H5lrKW5gyGln0i7mcnV1ePOzQJG+qoIIuSVvrH96
JRezOrBhgiQFCE8WH+7ynhLWBnlGAgMFm7ACz+iUy61k51rRZca0/8xkYc9oTL11
lLq9Qdbg12c/myJgaODESjKtXFXdQ3AsOj/conPwMivdoPs6nt0kSnHuaQltz0PC
4149KOMjAgMBAAECggEAAJVQCd97QUeSgPV3siY0F+ZgXNS8EVMMfU4CyKuQOaG9
lp6VBBaBRj7/kkaUfw0VDHv7sZj0s0AOJFGWg8kEbhQs/XpJHGmP/QvYwGT9DRO2
sM7PHf+rWhyFuET/wK9L1FrNToAz6aJBKI+DDjCxmXO9XsT1/Hs0l4GqaUHSMi0A
PcEZDLESyVgcVyNy2fLPRzSJH42NjjeY5MBm1KTxxtVVoUtLRgo5zZCWiL7YKdUE
famaySV7fUrP/Ew+E4DOpj/9O9er8OvfwcXP0djHBZrq532PVmz1wlWPdI740NiO
VT1oc3Vg9vSTLYZiFa+l1v+INZp4KZBZo/5ZYkcVJQKBgQC4zPS3aN1vamtwjF1L
Tvt0dWspBXXpEU0r+Wj0t6h7nQiG/W2FGIHzSdurcfBcv4iS4ykchsqofduW0NUV
QzvwwTxt7GoUxJnfY54eCaEhrH0WrFdZ486sQoP1G5vwGY3J05DIaWKZMNyBzKL6
LufCuNMsbvBfzlfj9o35AoO7ZwKBgQC4uwMDZFciwXY8gbJ5BZXdapYA9qprVX8P
UOHDw1DC9+uUbi/wisp1kAqXs//diCmp9hcUcL6zsRw9ZLmVtvefS2sH3GXmoxko
xJXR5AYAEwsTapjYQaW20+i/ulMrTTvGCs+isXjDKibptMHgk8TLog8q939ARYHo
pTzhgvPA5QKBgQCFPaEjrEQb1MrqNwn9BlFewlolFX7SMFtH3WfDKbgciDhhu89/
KxBm7VWo41m+RYqe/ZHis3zixvvQXXmE/xj0mR6M0uwZVTbsTdLvLVo0AT2fX1sL
wKh+ouapjuJ71rDYV+YH2ZPxh701COppH/CSANihLMu7B/dusZHje+Cm+QKBgDyg
A0klsQMTAr6wweW904Uq6be/PAaltGFOZgldHDAgNQwtbUZABlm2wAMxa5NEkIfa
35AxwCQwx9fOKqnbtkBs+99EkZyzghpDCfgsIVv84/GnVioCwWPS/9uMRqc7XZaN
Db+TBtLmDoc8bzRIypkZwmiTeQuaxBuZvvUziNORAoGAbivnoL7fSxUL425+Ul5S
pdYklhcm7Dvdjwtw8az3vkXiXOrxqt/QeD7fmj3sil4Gh0+Hi2qEP2UJI4wJY9zU
GOO2rltr0jTXZFfF1wOfTY1C28m0VUOLeuoStJ5O56DYTn2miAQXyrm3SUEbEyEy
AJOgckq14jz9XUnmvsUVmxw=
-----END PRIVATE KEY-----`

const tlsServer = createTlsServer({ cert, key }, socket => socket.on('data', data => socket.end(data)))
await new Promise((resolve, reject) => tlsServer.once('error', reject).listen(0, '127.0.0.1', resolve))
const tlsAddress = tlsServer.address()
tlsServer.on('tlsClientError', () => {})
const slowClients = Array.from({ length: 16 }, () => connectTcp({ host: '127.0.0.1', port: tlsAddress.port }))
await Promise.all(slowClients.map(client => new Promise((resolve, reject) => {
  client.once('connect', resolve)
  client.once('error', reject)
})))
await Promise.race([
  readFile('package.json'),
  new Promise((_, reject) => setTimeout(() => reject(new Error('fs starved behind TLS handshakes')), 1_000)),
])
for (const client of slowClients)
  client.destroy()
const rejectedBadClient = new Promise(resolve => tlsServer.once('tlsClientError', resolve))
const badClient = connectTcp({ host: '127.0.0.1', port: tlsAddress.port }, () => badClient.end('not tls'))
await rejectedBadClient
const tlsClient = connect({ ca, host: '127.0.0.1', port: tlsAddress.port, servername: 'localhost' })
const tlsBody = await new Promise((resolve, reject) => {
  tlsClient.once('error', reject)
  tlsClient.once('secureConnect', () => tlsClient.end('secure ping'))
  tlsClient.once('data', data => resolve(String(data)))
})
assert.equal(tlsBody, 'secure ping')
tlsClient.destroy()
await new Promise((resolve, reject) => tlsServer.once('error', reject).close(resolve))

const httpsServer = createHttpsServer({ cert, key }, (request, response) => {
  assert.equal(request.url, '/secure')
  response.end('hello https')
})
await new Promise((resolve, reject) => httpsServer.once('error', reject).listen(0, '127.0.0.1', resolve))
const httpsAddress = httpsServer.address()
const httpsBody = await new Promise((resolve, reject) => {
  get({ ca, host: '127.0.0.1', path: '/secure', port: httpsAddress.port, servername: 'localhost' }, (response) => {
    let value = ''
    response.on('data', chunk => value += String(chunk))
    response.on('end', () => resolve(value))
  }).once('error', reject)
})
assert.equal(httpsBody, 'hello https')
await new Promise((resolve, reject) => httpsServer.once('error', reject).close(resolve))

console.log('tls and https resources ok')
