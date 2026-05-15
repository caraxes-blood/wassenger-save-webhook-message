import { describe, it, expect } from 'vitest'
import {
  cleanText, isSystem, classify,
  extractPrice, extractRef, extractCondition,
} from '../../src/cleaning/pipeline.js'

describe('cleanText', () => {
  it('decodes keycap emoji digits', () => {
    // 3️⃣7️⃣0️⃣0️⃣ → 3700
    expect(cleanText('3️⃣7️⃣0️⃣0️⃣')).toBe('3700')
  })
  it('strips invisible unicode chars', () => {
    expect(cleanText('‎Hello‏ world')).toBe('Hello world')
  })
  it('removes media placeholder suffix', () => {
    expect(cleanText('Check this image omitted')).toBe('Check this')
  })
  it('collapses multiple spaces', () => {
    expect(cleanText('WTS  Rolex   Daytona')).toBe('WTS Rolex Daytona')
  })
  it('returns empty string for body containing only invisible chars', () => {
    expect(cleanText('‎‏')).toBe('')
  })
  it('strips GIF omitted placeholder', () => {
    expect(cleanText('lol GIF omitted')).toBe('lol')
  })
})

describe('isSystem', () => {
  it('returns true for WhatsApp sender', () => {
    expect(isSystem('WhatsApp', 'Your messages are secure')).toBe(true)
  })
  it('returns true for Luxury Watch Consortium sender', () => {
    expect(isSystem('Luxury Watch Consortium', 'Welcome')).toBe(true)
  })
  it('returns true when body contains "was added"', () => {
    expect(isSystem('John', 'John was added')).toBe(true)
  })
  it('returns true when body contains "security code changed"', () => {
    expect(isSystem('Jane', 'Your security code changed')).toBe(true)
  })
  it('returns true for "Messages and calls" phrase', () => {
    expect(isSystem('System', 'Messages and calls are end-to-end encrypted')).toBe(true)
  })
  it('returns false for regular dealer message', () => {
    expect(isSystem('John Doe', 'WTS Rolex Daytona $14k')).toBe(false)
  })
})

describe('classify', () => {
  it('returns WTB for "wtb" keyword', () => {
    const [intent, conf, signal] = classify('WTB Rolex Sub')
    expect(intent).toBe('WTB')
    expect(conf).toBe(1.0)
    expect(signal.toLowerCase()).toContain('wtb')
  })
  it('returns WTB for "want to buy"', () => {
    const [intent] = classify('want to buy a Daytona')
    expect(intent).toBe('WTB')
  })
  it('returns ISO for "looking for"', () => {
    const [intent] = classify('looking for a Daytona')
    expect(intent).toBe('ISO')
  })
  it('returns ISO for "in search of"', () => {
    const [intent] = classify('In search of 126710BLNR')
    expect(intent).toBe('ISO')
  })
  it('returns NTQ for "need to quote"', () => {
    const [intent] = classify('need to quote 126710 for client')
    expect(intent).toBe('NTQ')
  })
  it('returns WTT for "swap"', () => {
    const [intent] = classify('open to swap Submariner')
    expect(intent).toBe('WTT')
  })
  it('returns WTT for "want to trade"', () => {
    const [intent] = classify('want to trade my Daytona')
    expect(intent).toBe('WTT')
  })
  it('returns SOLD_ORDER for "sold order"', () => {
    const [intent] = classify('sold order 126710BLNR needed asap')
    expect(intent).toBe('SOLD_ORDER')
  })
  it('infers WTS at 0.92 from price + ref', () => {
    const [intent, conf, signal] = classify('126710BLNR $14,000')
    expect(intent).toBe('WTS')
    expect(conf).toBe(0.92)
    expect(signal).toBe('inferred:price+ref')
  })
  it('infers WTS at 0.80 from price + brand', () => {
    const [intent, conf, signal] = classify('Rolex available $14k')
    expect(intent).toBe('WTS')
    expect(conf).toBe(0.80)
    expect(signal).toBe('inferred:price+brand')
  })
  it('infers WTS at 0.70 from ref + condition', () => {
    const [intent, conf, signal] = classify('126710BLNR BNIB')
    expect(intent).toBe('WTS')
    expect(conf).toBe(0.70)
    expect(signal).toBe('inferred:ref+condition')
  })
  it('infers WTS at 0.60 from ref + brand', () => {
    const [intent, conf, signal] = classify('Rolex 126710BLNR')
    expect(intent).toBe('WTS')
    expect(conf).toBe(0.60)
    expect(signal).toBe('inferred:ref+brand')
  })
  it('returns SKIP for unclassifiable greeting', () => {
    const [intent, conf] = classify('Good morning everyone!')
    expect(intent).toBe('SKIP')
    expect(conf).toBe(0.50)
  })
})

describe('extractPrice', () => {
  it('extracts dollar sign amount', () => {
    expect(extractPrice('asking $14,750')).toBe(14750)
  })
  it('extracts dollar with space', () => {
    expect(extractPrice('$ 8,100 firm')).toBe(8100)
  })
  it('extracts k-suffix', () => {
    expect(extractPrice('price 14.5k')).toBe(14500)
  })
  it('extracts whole k-suffix', () => {
    expect(extractPrice('200k')).toBe(200000)
  })
  it('extracts comma-formatted number without dollar sign', () => {
    expect(extractPrice('117,500 firm')).toBe(117500)
  })
  it('returns null when no price found', () => {
    expect(extractPrice('WTB Rolex Sub')).toBeNull()
  })
  it('prefers dollar-sign price over k-suffix when both present', () => {
    expect(extractPrice('$14,000 or 14k')).toBe(14000)
  })
})

describe('extractRef', () => {
  it('extracts 6-digit Rolex ref', () => {
    expect(extractRef('WTS 126710BLNR')).toBe('126710BLNR')
  })
  it('extracts Panerai PAM ref', () => {
    expect(extractRef('WTS PAM00512 BNIB')).toBe('PAM00512')
  })
  it('extracts Patek slash ref', () => {
    expect(extractRef('WTS 5712/1A')).toBe('5712/1A')
  })
  it('extracts Patek 4-digit + letter ref', () => {
    expect(extractRef('WTS 5164R')).toBe('5164R')
  })
  it('returns null for plain text with no ref', () => {
    expect(extractRef('WTB Rolex please')).toBeNull()
  })
  it('returns null for 3-digit numbers', () => {
    expect(extractRef('WTS watch for 500')).toBeNull()
  })
})

describe('extractCondition', () => {
  it('returns BNIB for "brand new in box"', () => {
    expect(extractCondition('WTS 126710 brand new in box')).toBe('BNIB')
  })
  it('returns BNIB for "bnib"', () => {
    expect(extractCondition('bnib 126710BLNR')).toBe('BNIB')
  })
  it('BNIB takes priority over "new"', () => {
    expect(extractCondition('bnib never worn brand new')).toBe('BNIB')
  })
  it('returns unworn for "unworn"', () => {
    expect(extractCondition('126710 unworn $14k')).toBe('unworn')
  })
  it('returns preowned for "pre-owned"', () => {
    expect(extractCondition('WTS sub pre-owned $12k')).toBe('preowned')
  })
  it('returns mint for "mint"', () => {
    expect(extractCondition('WTS Daytona mint $22k')).toBe('mint')
  })
  it('returns null when no condition found', () => {
    expect(extractCondition('WTS Rolex $14k')).toBeNull()
  })
})
