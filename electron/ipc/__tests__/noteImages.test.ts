import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: {}, Menu: {}, clipboard: {}, dialog: {}, nativeImage: {},
}))

import { decodeImageDataUrl, imageSaveName } from '../noteImages'

describe('noteImages (MAC-IMG)', () => {
  it('decodes a base64 image data URL into mime, extension and bytes', () => {
    const d = decodeImageDataUrl('data:image/png;base64,iVBORw0KGgo=')
    expect(d?.mime).toBe('image/png')
    expect(d?.ext).toBe('png')
    expect(d?.bytes.subarray(0, 4).toString('hex')).toBe('89504e47')
    expect(decodeImageDataUrl('data:image/jpeg;name=x.jpg;base64,/9j/')?.ext).toBe('jpg')
  })
  it('rejects non-image and non-base64 URLs', () => {
    expect(decodeImageDataUrl('data:text/plain;base64,aGk=')).toBeNull()
    expect(decodeImageDataUrl('https://example.com/a.png')).toBeNull()
  })
  it('builds a filesystem-safe default Save As name from alt text', () => {
    expect(imageSaveName('Temple: plan/elevation', 'png')).toBe('Temple- plan-elevation.png')
    expect(imageSaveName('', 'jpg')).toBe('image.jpg')
    expect(imageSaveName(undefined, 'gif')).toBe('image.gif')
  })
})
