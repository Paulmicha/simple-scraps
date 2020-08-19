# Simple scraps (WIP)

Experimental prototype of a [Puppeteer](https://github.com/checkly/puppeteer-examples)-based crawler to extract structured (JSON) data from public web pages.

## Goal / operations

1. Open an initial URL (`start`)
1. Collect links to other pages to crawl (`follow`)
1. Organize the links into types - either `collection` links (contains more links to follow - e.g. pager links) or `entity` links (pages representing the individual entities to extract)
1. Open links to entities and extract data according to the rules provided (`extract`) + write resulting output data (+ images and/or cached backup / screenshot / pdf ?)

## Ideal solution

- Resumable process in case of interruption
- Session multi-thread / queues to optimize the process
- Single configuration to extract all entity types in one go

## Initial considerations  (abandoned)

All-in-one solutions (~ "larger" projects) :
- [OpenScraper](https://github.com/entrepreneur-interet-general/OpenScraper)
- [headless-chrome-crawler](https://github.com/yujiosaka/headless-chrome-crawler)

Building blocks to "roll your own" :
- [node-worker-farm](https://github.com/rvagg/node-worker-farm)
- [bee-queue](https://github.com/bee-queue/bee-queue)

## Current plan

Borrows the concept of Drupal entities, roughly : a data model that can have 2 "levels" when appropriate - i.e. **entity type** / **bundle** (~ *class* / *sub-class*), ex : `content` / `page`, `taxonomy_term` / `tag`, `user` / `content_editor`, etc.

Entities may have URLs (i.e. pages, articles, users, or even taxonomy terms), or not (i.e. config, blocks, menus).
Entity types or bundles share the same **fields**.

Example content entities object structure (JSON output, see section *Content model and Structured Data Mapping* below) :

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
  "content": []                             ← [optional] Main page contents (see Rich content editing)
}
```

TODO [wip] config object format and resulting process is currently being sketched out. Meanwhile, the file structure looks like this :

```txt
path/to/project/docroot/
  ├── data/                           ← [git-ignored] Structured data
  │   ├─ cache/                       ← [git-ignored] Crawl sessions backups
  │   │   └── www.chouette.net.br/
  │   │       └── ...                 ← Maps the URL structure of the site (HTML markup + screenshots / pdfs ?)
  │   ├── output/
  │   │   └── www.chouette.net.br/
  │   │       ├── blog/
  │   │       │   ├── 02004e7b-ea2c-49d0-b050-dab13f0181a7.json
  │   │       │   └── ...
  │   │       └── page/
  │   │           ├── dc49234b-53a7-452a-a2be-23e7121d3be1.json
  │   │           └── ...
  │   ├── sessions/
  │   └── ...
  ├── src/
  └── ...
```

## Crawling process

The configuration object contains "entry points", or "destinations". Its root keys are values that may be used in `to` keys (except when they contain wildcards).

The `start` key defines the initial URLs where links to individual content pages or pager links will be collected. These will then be followed and associated with an entry point. The `"to": "start"` defines a recursion to start over the same process on selected link.

## Content model and Structured Data Mapping

The `content/*` key determines the extraction process for all *content* entities. The `content/blog` will then inherit it as overridable defaults for the *blog* content type.

The array items contained in these define individual extraction operations.

## Extraction

Possible values for `extract` :

- `text` : DOM node plain text content (without tags)
- `markup` : DOM node inner HTML
- `element` : return the DOM node itself (to be dealt with in a custom `postprocess` callback)
- Array : list of sub-parts to be extracted individually (scoped by the `selector` of where it's defined), then mapped to props or reduced to string in a custom `postprocess` callback

## Example

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
          "cache": true
        },
        {
          "selector": ".view-chouette-articles .c-pagination a",
          "to": "start"
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
      "extract": "text",
      "as": "taxonomy/tag",
      "postprocess": "tag_link_text"
    }
  ],
  "components": [
    {
      "selector": ".content > .p-percent-h > .c-text-block.u-fs-m",
      "extract": "text",
      "to": "component/Lede",
      "as": "prop.text"
    },
    {
      "selector": ".c-pimg",
      "extract": [
        {
          // TODO [wip] inner selectors to map to component props.
        }
      ],
      "to": "component/MediaGrid"
    }
  ]
}
```
