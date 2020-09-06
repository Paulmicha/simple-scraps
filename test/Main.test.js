const test = require('ava')
const { urls } = require('./shared.js')
const SimpleScraps = require('../src/Main')

// NB. For performance reasons, we run all tests serially in order to avoid
// having too many headless browsers open at the same time (each having multiple
// pages open to process operations concurrently already).
// See https://github.com/avajs/ava/blob/master/docs/01-writing-tests.md
test.serial('1. Extract a single string', async t => {
  const scraps = new SimpleScraps([
    {
      url: urls.blog,
      is: 'content/page',
      extract: [
        {
          selector: 'head title',
          extract: 'text',
          as: 'entity.title'
        }
      ]
    }
  ])

  let extractedValue = ''

  // When this event is listened to, it replaces the default storage process, so
  // nothing will get written to the 'data' folder.
  scraps.on('store.extraction.result', (entity) => {
    extractedValue = entity.title
  })

  await scraps.run()

  t.is('Blog Template · Bootstrap', extractedValue)
})
