const test = require('ava')
const { urls } = require('./shared.js')
const SimpleScraps = require('../src/Main')
const nestedComponentsConfig = require('./config/components_nested.json')

// The JSON test config file contains an entry point with an URL that needs to
// be replaced for resolving absolute paths (since we use local static files).
nestedComponentsConfig.start[0].url = urls.article

// NB. For performance reasons, we run all tests serially in order to avoid
// having too many headless browsers open at the same time (each having multiple
// pages open to process operations concurrently already).
// See https://github.com/avajs/ava/blob/master/docs/01-writing-tests.md
test.serial('1. Extract a single string (plain text + HTML markup)', async t => {
  // When an array is passed as 1st constructor argument, it means that only
  // entry points are specified.
  const scraps = new SimpleScraps([
    {
      url: urls.blog,
      extract: [
        {
          selector: 'head title',
          extract: 'text',
          // The 'as' key maps the extraction result to the output object
          // properties. Here, the 'title' prop will contain the text from the
          // <title> tag in <head>.
          as: 'entity.title'
        },
        {
          selector: '.blog-sidebar > .p-4:last-child a',
          extract: 'text_single',
          as: 'entity.test_plain_text_multi_matches'
        },
        {
          selector: '.blog-footer',
          extract: 'markup',
          as: 'entity.test_markup'
        }
      ]
    }
  ])

  // For local tests using static files, remove the default delay.
  scraps.setSetting('crawlDelay', false)

  // When this event is listened to, it replaces the default storage process, so
  // nothing will get written to the 'data' folder.
  scraps.on('store.extraction.result', (entity) => {
    t.is('Blog Template · Bootstrap', entity.title)
    t.is('<p>Blog template built for <a href="https://getbootstrap.com/">Bootstrap</a> by <a href="https://twitter.com/mdo">@mdo</a>.</p><p><a href="#">Back to top</a></p>', entity.test_markup)
    t.is('GitHub Twitter Facebook', entity.test_plain_text_multi_matches)
  })

  await scraps.run()
})

test.serial('2. Extract a simple component', async t => {
  const scraps = new SimpleScraps({
    settings: {
      crawlDelay: false
    },
    // The 'start' key defines entry points.
    start: [
      {
        // This entry point extracts components directly from the 'components'
        // static page.
        // @see test/static/Components.html
        url: urls.components,
        extract: [
          {
            selector: 'body > .container',
            extract: 'components',
            as: 'entity.content'
          }
        ]
      }
    ],
    // Subsequent keys define groups of extractors.
    // In this test, the only component extractor defined will output an object
    // representing a 'Button' with a single 'text' prop.
    components: [
      {
        selector: '.bs-docs-section:nth-child(3) .col-lg-7 .btn-primary.btn-lg',
        extract: 'text',
        // The extract 'as' syntax can support any of the following declarations :
        // - <thing>.<prop> (ex: entity.title, component.MediaGrid, etc)
        // - <thing>.<type>.<prop> (ex: component.Lede.text)
        // - <thing>.<type>.<nested>[].<prop> (ex: component.MediaGrid.items[].image)
        as: 'component.Button.text'
      }
    ]
  })

  scraps.on('store.extraction.result', (entity) => {
    t.is('Button', entity.content[0].c)
    t.is('Large button', entity.content[0].props.text)
  })

  await scraps.run()
})

test.serial('3. Extract nested components', async t => {
  const scraps = new SimpleScraps(nestedComponentsConfig)

  // Debug.
  // scraps.setSetting('maxExtractionNestingDepth', 4)

  scraps.on('store.extraction.result', (entity, entityType, bundle, url, pageWorker) => {
    // While we're at it, test that the entity type and bundle mapping is
    // correct.
    t.is('content', entityType)
    t.is('article', bundle)

    // At the root level, there should be exactly 1 Lede, and 1 NavTabs.
    t.is(2, entity.content.length)

    // Debug.
    console.log('TODO (wip) Extract nested components :')
    console.log(JSON.stringify(entity, null, 2))
  })

  await scraps.run()
})
