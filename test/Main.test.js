const test = require('ava')
const { urls } = require('./shared.js')
const SimpleScraps = require('../src/Main')

// NB. For performance reasons, we run all tests serially in order to avoid
// having too many headless browsers open at the same time (each having multiple
// pages open to process operations concurrently already).
// See https://github.com/avajs/ava/blob/master/docs/01-writing-tests.md
test.serial('1. Extract a single string (plain text + HTML markup)', async t => {
  const scraps = new SimpleScraps([
    {
      url: urls.blog,
      is: 'content/page',
      extract: [
        {
          selector: 'head title',
          extract: 'text',
          as: 'entity.title'
        },
        {
          selector: '.blog-footer',
          extract: 'markup',
          as: 'entity.test_markup'
        }
      ]
    }
  ])
  // When this event is listened to, it replaces the default storage process, so
  // nothing will get written to the 'data' folder.
  scraps.on('store.extraction.result', (entity) => {
    t.is('Blog Template · Bootstrap', entity.title)
    t.is('<p>Blog template built for <a href="https://getbootstrap.com/">Bootstrap</a> by <a href="https://twitter.com/mdo">@mdo</a>.</p><p><a href="#">Back to top</a></p>', entity.test_markup)
  })
  await scraps.run()
})
