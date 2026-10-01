const base = 36
const damp = 700
const delimiter = '-'
const initialBias = 72
const initialN = 128
const skew = 38
const tMax = 26
const tMin = 1

const error = (type) => { throw new RangeError(`Invalid input: ${type}`) }
const mapDomain = (value, callback) => String(value).split('@').map((part, index, parts) => index + 1 === parts.length ? part.replace(/[.\u3002\uFF0E\uFF61]/g, '.').split('.').map(callback).join('.') : part).join('@')
const basicToDigit = (codePoint) => {
  if (codePoint - 48 < 10)
    return codePoint - 22
  if (codePoint - 65 < 26)
    return codePoint - 65
  if (codePoint - 97 < 26)
    return codePoint - 97
  return base
}
const digitToBasic = digit => String.fromCharCode(digit + 22 + (digit < 26 ? 75 : 0))
const adapt = (delta, points, first) => {
  delta = first ? Math.floor(delta / damp) : delta >> 1
  delta += Math.floor(delta / points)
  let k = 0
  while (delta > ((base - tMin) * tMax) >> 1) {
    delta = Math.floor(delta / (base - tMin))
    k += base
  }
  return k + Math.floor((base - tMin + 1) * delta / (delta + skew))
}

export const ucs2 = {
  decode(value) {
    const output: number[] = []
    for (let index = 0; index < value.length; index++) {
      const first = value.charCodeAt(index)
      if (first >= 0xD800 && first <= 0xDBFF && index + 1 < value.length) {
        const second = value.charCodeAt(index + 1)
        if ((second & 0xFC00) === 0xDC00) {
          output.push(((first & 0x3FF) << 10) + (second & 0x3FF) + 0x10000)
          index++
          continue
        }
      }
      output.push(first)
    }
    return output
  },
  encode: codePoints => String.fromCodePoint(...codePoints),
}

export const decode = (input) => {
  const output: number[] = []
  let bias = initialBias
  let index = 0
  let n = initialN
  const basic = input.lastIndexOf(delimiter)
  if (basic >= 0) {
    for (let cursor = 0; cursor < basic; cursor++) {
      const codePoint = input.charCodeAt(cursor)
      if (codePoint >= 0x80)
        error('not-basic')
      output.push(codePoint)
    }
    index = basic + 1
  }
  let i = 0
  while (index < input.length) {
    const oldI = i
    let weight = 1
    for (let k = base; ; k += base) {
      if (index >= input.length)
        error('invalid-input')
      const digit = basicToDigit(input.charCodeAt(index++))
      if (digit >= base || digit > Math.floor((Number.MAX_SAFE_INTEGER - i) / weight))
        error('overflow')
      i += digit * weight
      const threshold = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias
      if (digit < threshold)
        break
      const baseMinusThreshold = base - threshold
      if (weight > Math.floor(Number.MAX_SAFE_INTEGER / baseMinusThreshold))
        error('overflow')
      weight *= baseMinusThreshold
    }
    const outputLength = output.length + 1
    bias = adapt(i - oldI, outputLength, oldI === 0)
    if (Math.floor(i / outputLength) > Number.MAX_SAFE_INTEGER - n)
      error('overflow')
    n += Math.floor(i / outputLength)
    i %= outputLength
    output.splice(i++, 0, n)
  }
  return ucs2.encode(output)
}

export const encode = (input) => {
  const codePoints = ucs2.decode(input)
  const output = codePoints.filter(codePoint => codePoint < 0x80).map(codePoint => String.fromCharCode(codePoint))
  let handled = output.length
  const basicLength = handled
  if (basicLength)
    output.push(delimiter)
  let bias = initialBias
  let delta = 0
  let n = initialN
  while (handled < codePoints.length) {
    const m = Math.min(...codePoints.filter(codePoint => codePoint >= n))
    const handledPlusOne = handled + 1
    if (m - n > Math.floor((Number.MAX_SAFE_INTEGER - delta) / handledPlusOne))
      error('overflow')
    delta += (m - n) * handledPlusOne
    n = m
    for (const codePoint of codePoints) {
      if (codePoint < n && ++delta > Number.MAX_SAFE_INTEGER)
        error('overflow')
      if (codePoint !== n)
        continue
      let q = delta
      for (let k = base; ; k += base) {
        const threshold = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias
        if (q < threshold)
          break
        output.push(digitToBasic(threshold + (q - threshold) % (base - threshold)))
        q = Math.floor((q - threshold) / (base - threshold))
      }
      output.push(digitToBasic(q))
      bias = adapt(delta, handledPlusOne, handled === basicLength)
      delta = 0
      handled++
    }
    delta++
    n++
  }
  return output.join('')
}

export const toASCII = value => mapDomain(value, label => /[^\0-\x7E]/.test(label) ? `xn--${encode(label)}` : label)
export const toUnicode = value => mapDomain(value, label => /^xn--/i.test(label) ? decode(label.slice(4).toLowerCase()) : label)
export const version = '2.1.0'
export default { decode, encode, toASCII, toUnicode, ucs2, version }
