// Invisible / directional formatting characters WhatsApp inserts
const _INVISIBLE = /[‎‏‪‫‬‭‮⁦⁧⁨⁩⁠﻿]/g

// Keycap emoji: digit + optional variation-selector-16 + combining enclosing keycap
const _KEYCAP = /([0-9])️?⃣/g

// Media placeholder appended at end of message lines
const _MEDIA_OMIT = /\s*‎?\s*(?:image|video|audio|sticker|GIF|document|Contact card|<Media) omitted\s*$/gi

export function cleanText(body) {
  let text = body.replace(_INVISIBLE, '')
  text = text.replace(_KEYCAP, '$1')
  const lines = text.split('\n').map(ln => {
    ln = ln.replace(_MEDIA_OMIT, '')
    return ln.replace(/\s+/g, ' ').trim()
  })
  return lines.filter(ln => ln).join('\n').trim()
}

// ── System-message detection ─────────────────────────────────────────────────

const _SYSTEM_SENDERS = new Set(['Luxury Watch Consortium', 'WhatsApp'])

const _SYSTEM_BODY = /\b(was added|was removed|changed the subject|changed this group|added you|security code changed|turned on disappearing|turned off disappearing|end-to-end encrypted|Messages and calls)\b/i

export function isSystem(sender, cleanBody) {
  return _SYSTEM_SENDERS.has(sender) || _SYSTEM_BODY.test(cleanBody)
}

// ── Intent classification ────────────────────────────────────────────────────

const _INTENT_RULES = [
  ['SOLD_ORDER', /\bsold[\s_-]*order\b/i],
  ['WTB', /\b(wtb|w\.t\.b\.?|want\s+to\s+buy|looking\s+to\s+buy|ltb|l\.t\.b\.?|wtb\/ntq|wtb\/iso)\b/i],
  ['ISO', /\b(iso|i\.s\.o\.?|in\s+search\s+of|looking\s+for|need\s+asap|iso\/ntq|ntq\/iso)\b/i],
  ['NTQ', /\b(ntq|n\.t\.q\.?|need\s+to\s+quote|needed\s+to\s+quote)\b/i],
  ['WTT', /\b(wtt|w\.t\.t\.?|want\s+to\s+trade|for\s+trade|will\s+trade|open\s+to\s+trade|swap)\b/i],
]

const _BRANDS = /\b(rolex|rlx|submariner|daytona|datejust|gmt.master|sky.dweller|sea.dweller|oyster.perpetual|day.date|yacht.master|milgauss|air.king|explorer|ap|audemars\s*piguet|audemars|royal\s*oak|patek|pp|nautilus|aquanaut|calatrava|cubitus|vacheron|vc|overseas|cartier|santos|omega|seamaster|speedmaster|tudor|hublot|iwc|breitling|navitimer|panerai|luminor|lange|richard\s*mille|rm|tag\s*heuer|zenith|breguet|jaeger|jlc|chopard|girard.perregaux|piaget|franck\s*muller|ulysse\s*nardin|f\.?\s*p\.?\s*journe|fp\s*journe)\b/i

const _CONDITIONS = [
  ['BNIB',         /\b(bnib|brand\s+new\s+in\s+box)\b/i],
  ['unworn',       /\b(brand\s+new\s+unworn|true\s+new|unworn)\b/i],
  ['NOS',          /\bnos\b|new\s+old\s+stock/i],
  ['slider',       /\bslider\b/i],
  ['new',          /\b(brand\s+new|new)\b/i],
  ['retail_ready', /\bretail\s+ready\b/i],
  ['mint',         /\bmint\b/i],
  ['NFC',          /\bnfc\b/i],
  ['light_wear',   /\blight\s+(?:wear|touch)\b/i],
  ['used',         /\bused\b/i],
  ['preowned',     /\b(preowned|pre-owned|pre\s+owned)\b/i],
]

const _PRICE_DETECT = /\$\s*[0-9][0-9,.]*[0-9]|[0-9]{1,3}(?:,[0-9]{3})+|\b[0-9]{1,4}(?:\.[0-9]{1,2})?k\b/i

// Ref pattern — created fresh per call to avoid lastIndex state on global regex
const _REF_SRC = String.raw`(?:ref\.?\s*#?\s*)?\b([A-Z]{0,3}[0-9]{5,6}[A-Z0-9]{0,8}|[0-9]{4}\/[0-9A-Z\-]+|[0-9]{4}[A-Z][A-Z0-9\-]{0,8})\b`

function _hasPrice(text) { return _PRICE_DETECT.test(text) }

function _hasRef(text) {
  for (const m of text.matchAll(new RegExp(_REF_SRC, 'gi'))) {
    if (/[0-9]{4,}/.test(m[1])) return true
  }
  return false
}

function _hasBrand(text) { return _BRANDS.test(text) }

function _hasCondition(text) {
  return _CONDITIONS.some(([, pat]) => pat.test(text))
}

export function classify(cleanBody) {
  for (const [intent, pat] of _INTENT_RULES) {
    const m = cleanBody.match(pat)
    if (m) return [intent, 1.0, m[0].trim()]
  }

  const price = _hasPrice(cleanBody)
  const ref   = _hasRef(cleanBody)
  const brand = _hasBrand(cleanBody)
  const cond  = _hasCondition(cleanBody)

  if (price && ref)   return ['WTS', 0.92, 'inferred:price+ref']
  if (price && brand) return ['WTS', 0.80, 'inferred:price+brand']
  if (ref   && cond)  return ['WTS', 0.70, 'inferred:ref+condition']
  if (ref   && brand) return ['WTS', 0.60, 'inferred:ref+brand']

  return ['SKIP', 0.50, '']
}

// ── Field extractors ─────────────────────────────────────────────────────────

const _DOLLAR_PRICE = /\$\s*([0-9][0-9,.]*[0-9])/
const _K_PRICE      = /\b([0-9]{1,4}(?:\.[0-9]{1,2})?)[kK]\b/
const _COMMA_PRICE  = /\b([0-9]{1,3}(?:,[0-9]{3})+)\b/

export function extractPrice(cleanBody) {
  let m = cleanBody.match(_DOLLAR_PRICE)
  if (m) {
    const n = parseFloat(m[1].replace(/,/g, ''))
    if (!isNaN(n)) return n
  }
  m = cleanBody.match(_K_PRICE)
  if (m) {
    const n = parseFloat(m[1]) * 1000
    if (!isNaN(n)) return n
  }
  m = cleanBody.match(_COMMA_PRICE)
  if (m) {
    const n = parseFloat(m[1].replace(/,/g, ''))
    if (!isNaN(n)) return n
  }
  return null
}

export function extractRef(cleanBody) {
  for (const m of cleanBody.matchAll(new RegExp(_REF_SRC, 'gi'))) {
    if (/[0-9]{4,}/.test(m[1])) return m[1]
  }
  return null
}

export function extractCondition(cleanBody) {
  for (const [name, pat] of _CONDITIONS) {
    if (pat.test(cleanBody)) return name
  }
  return null
}
