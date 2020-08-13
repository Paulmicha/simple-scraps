# Simple scraps

At this stage, this repo contains evaluations of potential implementations to extract structured (JSON) data from public web pages.

## Goal / operations

1. Open an initial URL (`start`)
1. Collect links to other pages to crawl (`follow`)
1. Organize the links into types - either `collection` links (contains more links to follow - e.g. pager links) or `entity` links (pages representing the individual entities to extract)
1. Open links to entities and extract data according to the field mapping provided (`extract`) + write resulting data (+ images and/or cached backup / screenshot / pdf ?)

## Ideal solution

- Resumable process in case of interruption
- Session multi-thread / queues to optimize the process
- Single configuration to extract all entity types in one go

## Initial considerations  (abandoned)

All-in-one solutions (~ "larger" projects) :
- (OpenScraper)[https://github.com/entrepreneur-interet-general/OpenScraper]
- (headless-chrome-crawler)[https://github.com/yujiosaka/headless-chrome-crawler]

Building blocks to "roll your own" :
- (node-worker-farm)[https://github.com/rvagg/node-worker-farm]
- (bee-queue)[https://github.com/bee-queue/bee-queue]

## Current status

- 1 file per entity
- Organized by entity type / bundle
- Named using a UUID in case of URL change / redirects between sessions / whatever constitutes unicity (identifying reliably the same entity, or we might just use canonical URIs instead ?)

### Expected implementation

Given this configuration input :

```js
{
  "start": "https://www.chouette.net.br/blog",
  "follow": [
    {
      "in": ".view-chouette-articles article h2 > a",
      "to": "content/blog"
    },
    {
      "in": ".view-chouette-articles .c-pagination a",
      "as": "pager"
    }
  ],
  "field_mapping": {
    "content/*": {
      "title": "h1",
      "<any field applying to all 'content' entities>": "<enter CSS selector here>"
    },
    "content/blog": {
      "<any field specific to the 'blog' content type>": "<enter CSS selector here>"
    }
  }
}
```

... the expected output would be :

```txt
path/to/project/docroot/
  ├── cache/                      ← [git-ignored] Crawl sessions backups
  │   └── www.chouette.net.br/
  │       └── ...                 ← Maps the URL structure of the site (HTML markup + screenshots / pdfs ?)
  ├── data/                       ← [git-ignored] Structured data
  │   ├── www.chouette.net.br/
  │   │   └── content/
  │   │       ├── blog/
  │   │       │   ├── 02004e7b-ea2c-49d0-b050-dab13f0181a7.json
  │   │       │   └── ...
  │   │       └── page/
  │   │           ├── dc49234b-53a7-452a-a2be-23e7121d3be1.json
  │   │           └── ...
  │   └── ...
  ├── src/
  └── ...
```
