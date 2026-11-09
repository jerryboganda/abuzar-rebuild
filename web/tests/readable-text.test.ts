import test from 'node:test'
import assert from 'node:assert/strict'
import { readableText } from '../src/ui/pb.ts'

test('Modern keeps readable source text colours and replaces unreadable ones with black or white', () => {
  // w_graph_color: white channel values on pure red, green and blue fields
  assert.equal(readableText('#ffffff', 'rgb(0, 255, 0)'), '#000000')
  assert.equal(readableText('#ffffff', 'rgb(255, 0, 0)'), '#000000')
  assert.equal(readableText('#ffffff', 'rgb(0, 0, 255)'), '#ffffff')
  // the "Green:" caption on the button face; readable captions keep their colour
  assert.equal(readableText('#00ff00', '#f0f0f0'), '#000000')
  assert.equal(readableText('#0000ff', '#f0f0f0'), '#0000ff')
  assert.equal(readableText('#ffff00', 'rgb(0, 0, 128)'), '#ffff00')
  // unknown or see-through backgrounds keep the source colour
  for (const background of ['', 'transparent', 'rgba(0, 0, 0, 0)', 'rgb(0 255 0 / 50%)', 'buttonface']) {
    assert.equal(readableText('#ffffff', background), '#ffffff')
  }
})
