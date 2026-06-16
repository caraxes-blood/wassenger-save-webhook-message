import { describe, it, expect } from 'vitest'
import { extractColumns } from '../src/payload.js'

const textData = {
  id:   'text-msg-1',
  type: 'text',
  body: 'WTS Rolex 126710BLNR $14k BNIB',
  chat: {
    id:   'chat-1@g.us',
    date: '2026-06-01T00:00:00.000Z',
    name: 'Watch Dealers',
    type: 'group',
    group: {
      imageUrl:          'https://example.com/img.jpg',
      description:       'Watch group',
      totalParticipants: 100,
    },
  },
  meta:       { notifyName: 'John Dealer' },
  toNumber:   '+13053817705',
  timestamp:  1780415610,
  fromNumber: '+13059548700',
}

const imageData = {
  id:   'img-msg-1',
  type: 'image',
  chat: {
    id:   'chat-2@g.us',
    date: '2026-06-02T00:00:00.000Z',
    name: 'Downtown Dealers',
    type: 'group',
    group: {
      imageUrl:          'https://example.com/img2.jpg',
      description:       'Downtown group',
      totalParticipants: 155,
    },
  },
  meta: { notifyName: 'Jane Buyer' },
  media: {
    id:   'media-1',
    chat: 'chat-2@g.us',
    flow: 'in',
    meta: { hasPreview: false, aspectRatio: 1 },
    mime: 'image/jpeg',
    size: 111819,
    links: {
      chat:     '/v1/chat/abc/chats/chat-2@g.us',
      contact:  '/v1/chat/abc/contacts/chat-2@g.us',
      message:  '/v1/chat/abc/messages/img-msg-1',
      download: '/v1/chat/abc/files/media-1/download',
      resource: '/v1/chat/abc/files/media-1',
    },
    caption:   'Rolex Daytona asking $18k',
    preview:   { image: null },
    filename:  'image.jpeg',
    extension: 'jpeg',
  },
  toNumber:   '+13053817705',
  timestamp:  1780415610,
  fromNumber: '+13059548700',
}

const dmData = {
  id:   'dm-msg-1',
  type: 'text',
  body: 'hey',
  chat: { id: 'phone@c.us', date: '2026-06-01T00:00:00.000Z', name: 'Bob', type: 'contact' },
  meta:       { notifyName: 'Bob' },
  toNumber:   '+13053817705',
  timestamp:  1780415610,
  fromNumber: '+15551234567',
}

// ── extractColumns ────────────────────────────────────────────────────────────

describe('extractColumns — text message', () => {
  it('sets type to "text"', () => {
    expect(extractColumns(textData).type).toBe('text')
  })

  it('sets group_name for group chats', () => {
    expect(extractColumns(textData).group_name).toBe('Watch Dealers')
  })

  it('sets message_body from data.body', () => {
    expect(extractColumns(textData).message_body).toBe('WTS Rolex 126710BLNR $14k BNIB')
  })

  it('sets caption to null', () => {
    expect(extractColumns(textData).caption).toBeNull()
  })

  it('sets image_url to null', () => {
    expect(extractColumns(textData).image_url).toBeNull()
  })
})

describe('extractColumns — image message', () => {
  it('sets type to "image"', () => {
    expect(extractColumns(imageData).type).toBe('image')
  })

  it('sets group_name for group chats', () => {
    expect(extractColumns(imageData).group_name).toBe('Downtown Dealers')
  })

  it('sets message_body to null', () => {
    expect(extractColumns(imageData).message_body).toBeNull()
  })

  it('sets caption from data.media.caption', () => {
    expect(extractColumns(imageData).caption).toBe('Rolex Daytona asking $18k')
  })

  it('sets image_url from data.media.links.download', () => {
    expect(extractColumns(imageData).image_url).toBe('/v1/chat/abc/files/media-1/download')
  })
})

describe('extractColumns — DM chat', () => {
  it('sets group_name to null for non-group chats', () => {
    expect(extractColumns(dmData).group_name).toBeNull()
  })

  it('sets image_url to null for text messages', () => {
    expect(extractColumns(dmData).image_url).toBeNull()
  })
})
