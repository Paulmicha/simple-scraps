# Simple scraps (WIP)

Experimental prototype of a [Puppeteer](https://github.com/checkly/puppeteer-examples)-based crawler to extract structured (JSON) data from public web pages.

## General process overview

1. Open an initial URL (`start`)
1. Collect links to other pages to crawl (`follow`)
1. Differenciate collected links : they can either point to `collection` pages (containing more links to follow - e.g. pager links) or to `entity` pages representing the individual entities to extract
1. Open links to entities and extract data according to the rules provided (`extract`) + write resulting output data (+ images and/or cached backup / screenshot / pdf ?)

This process must allow several crawling sessions (i.e. re-runs) on the same site without creating duplicates.

The file structure currently looks like this :

```txt
path/to/project/docroot/
  ├── data/                           ← [git-ignored] Project instance specific data
  │   ├── cache/                      ← Scraped pages backups (markup, screenshots, pdfs)
  │   │   └── www.chouette.net.br/
  │   ├── output/                     ← Extracted structured data
  │   │   └── www.chouette.net.br/
  │   │       └── content/
  │   │           ├── blog/
  │   │           │   ├── 02004e7b-ea2c-49d0-b050-dab13f0181a7.json
  │   │           │   └── ...
  │   │           └── page/
  │   │               ├── dc49234b-53a7-452a-a2be-23e7121d3be1.json
  │   │               └── ...
  │   ├── sessions/                   ← Configuration (JSON files)
  │   └── ...
  ├── src/
  └── ...
```

## Usage

TODO [wip] for now, this is merely one way to try the prototype at this stage.

In a terminal, from project docroot :

```sh
node ./scrap.js
```

Example script `./scrap.js` contents :

```js
const SimpleScraps = require('./src/Main')
const config = require('./data/sessions/www.chouette.net.br.blog.json')

const scraps = new SimpleScraps(config)

await scraps.run()
```

Quick test (without external config file, without writing output to files) :

```js
const SimpleScraps = require('./src/Main')
const scraps = new SimpleScraps([
  {
    url: 'https://www.test.com',
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

// When this event is listened to, it replaces the default storage process, so
// nothing will get written to the 'data' folder.
scraps.on('store.extraction.result', (entity) => {
  console.log(entity)
})

await scraps.run()
```

For the config file contents (`./data/sessions/www.chouette.net.br.blog.json`), see below :

## Configuration (individual crawling sessions setup)

TODO [wip] config object format and resulting process is currently being sketched out. Here's an example illustrating the current plan so far :

From the initial page at [www.chouette.net.br/blog](https://www.chouette.net.br/blog), extract *blog* entities (each entity having multiple components as "body" content), and keep a cached copy of all pages corresponding to individual blog post pages :

```json
{
  "start": [
    {
      "url": "https://www.chouette.net.br/blog",
      "follow": [
        {
          "selector": ".view-chouette-articles article h2 > a",
          "to": "content/blog",
          "cache": true,
          "maxPagesToCrawl": 1
        },
        {
          "selector": ".view-chouette-articles .c-pagination a",
          "to": "follow",
          "maxPagesToCrawl": 1
        }
      ]
    }
  ],
  "content/*": [
    {
      "selector": "header h1.c-title",
      "extract": "text",
      "as": "entity.title"
    },
    {
      "selector": "main .region-content",
      "extract": "components",
      "as": "entity.content"
    }
  ],
  "content/blog": [
    {
      "selector": "article.node .field-name-field-tags > a",
      "extract": "element",
      "as": "entity.tags",
      "emit": "extract.ref.taxonomy.tag"
    }
  ],
  "components": [
    {
      "selector": ".content > .p-percent-h > .c-text-block.u-fs-m",
      "extract": "text",
      "as": "component.Lede.text"
    },
    {
      "selector": ".c-pimg",
      "extract": [
        {
          "selector": ".c-pimg__img",
          "extract": "element",
          "as": "component.MediaGrid.items[].image",
          "emit": "extract.media.image"
        },
        {
          "selector": ".c-pimg__text > h2",
          "extract": "text",
          "as": "component.MediaGrid.items[].title"
        },
        {
          "selector": ".c-pimg__text > .s-rich-text",
          "extract": "markup",
          "as": "component.MediaGrid.items[].text"
        }
      ],
      "as": "component.MediaGrid"
    }
  ]
}
```

## Crawling process

API reference shortcut : [puppeteer repo](https://github.com/puppeteer/puppeteer/blob/main/docs/api.md)

The configuration object contains "entry points", or "destinations". Its root keys are values that may be used in `to` keys (except when they contain wildcards).

The `start` key defines the initial URLs where links to individual content pages or pager links will be collected. These will then be followed and associated with an entry point. The `"to": "start"` defines a recursion to start over the same process from followed link.

## Content Model and Structured Data Mapping

Borrows the concept of Drupal *entities*, which is essentially a data model that can have 2 "levels" when appropriate - i.e. **entity type** / **bundle** (~ *class* / *sub-class*), ex : `content` / `page`, `taxonomy_term` / `tag`, etc. Entity types or bundles share the same **fields**.

Example content entities object structure - i.e. this is what the resulting extracted JSON output will look like, e.g. in files like `data/output/www.chouette.net.br/content/blog/02004e7b-ea2c-49d0-b050-dab13f0181a7.json` :

```txt
{
  "lang": "fr",                             ← ISO 639-1 language code
  "title": "The main page title",           ← Should match page URL (slug)
  "short_title": "Short page title",        ← [optional] used in menus, breadcrumb
  "description": "Teaser text",             ← [optional] Used in <meta> tags (og:description)
  "image": "media/2020/08/visual.jpg",      ← [optional] Used in <meta> tags (og:image)
  "tags": [],                               ← [optional] Taxonomy terms entity references
  "published": "2020-08-25T15:12:36.594Z",  ← [optional] ISO 8601 publication date
  "uuid": "dd2aaa05-7d00-493c-9373-a0f695862850", ← [optional] For easier entity refs
  "content": []                             ← [optional] Main "body" contents
}
```

In the configuration object, the `content/*` key determines the extraction process for all *content* entities. The `content/blog` will then inherit it as overridable defaults for the *blog* content type.

The array items contained in these define individual extraction operations.

## Extraction

Possible values for `extract` :

- `text` : DOM node plain text content (without tags)
- `markup` : DOM node inner HTML
- `element` : return the DOM node itself (to be dealt with in a custom `emit` event listener)
- Array : list of sub-parts to be extracted individually (scoped by the `selector` of where it's defined), then mapped to props or reduced to string in a custom `emit` event listener

TODO detailed examples (input / output)

## Roadmap

- Resumable process in case of interruption
- Session multi-thread / queues to optimize the process
- Single configuration to extract all entity types in one go

## Initial considerations  (abandoned, archived)

All-in-one solutions (~ "larger" projects) :
- [OpenScraper](https://github.com/entrepreneur-interet-general/OpenScraper)
- [headless-chrome-crawler](https://github.com/yujiosaka/headless-chrome-crawler)

Building blocks to "roll your own" :
- [node-worker-farm](https://github.com/rvagg/node-worker-farm)
- [bee-queue](https://github.com/bee-queue/bee-queue)
