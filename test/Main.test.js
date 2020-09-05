const test = require('ava')
const { urls } = require('./shared.js')
const SimpleScraps = require('../src/Main')

test('1. Extract a single string', async t => {
  const scraps = new SimpleScraps([
    {
      url: urls.blog,
      is: 'content/page',
      extract: [
        {
          // selector: 'header a.blog-header-logo',
          selector: 'head title',
          extract: 'text',
          as: 'entity.title'
        }
      ]
    }
  ])

  // Do not write output.
  scraps.on('store.extraction.result', (entity, entityType, bundle, url, pageWorker) => {
    // Debug.
    // console.log([entity, entityType, bundle, url])
    console.log('extraction.result / entity :')
    console.log(entity)
  })

  await scraps.init()
  await scraps.start()
  await scraps.stop()

  t.pass()
  // t.is(urls.blog, pageWorker.page.url())
})
