import test from 'node:test'
import assert from 'node:assert/strict'
import { imageDataUrl, imageMime } from '../src/ui/image-data.ts'

test('tableblob images are recognised from their stored bytes', () => {
  assert.equal(imageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), 'image/png')
  assert.equal(imageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg')
  assert.equal(imageMime(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])), 'image/gif')
  assert.equal(imageMime(new Uint8Array([0x42, 0x4d, 0x00])), 'image/bmp')
  assert.equal(imageMime(new Uint8Array([0x00, 0x01])), null)
  assert.equal(imageMime(new Uint8Array()), null)
})

test('tableblob data becomes an image data URL and empty or unknown data is not painted', () => {
  assert.equal(imageDataUrl(new Uint8Array([0x42, 0x4d])), 'data:image/bmp;base64,Qk0=')
  assert.equal(imageDataUrl(new DataView(new Uint8Array([0x42, 0x4d]).buffer)), 'data:image/bmp;base64,Qk0=')
  assert.equal(imageDataUrl(null), null)
  assert.equal(imageDataUrl(new Uint8Array()), null)
  assert.equal(imageDataUrl(new Uint8Array([0x00, 0x01])), null)
})
