/**
 * @file
 * Provides default file-based storage implementations for scraper output and
 * cache.
 */

const urlParse = require('url-parse')
const slugify = require('@sindresorhus/slugify')

/**
 * Converts an URL to a file path.
 *
 * TODO write tests to see if there could be naming collisions caused by query
 * args conversion.
 *
 * @param {string} dir Where to write. No trailing slash.
 * @param {string} url of crawled page.
 * @param {string} suffix optional: Suffix and/or file extension. Defaults to
 *  ".json".
 * @return {string} The generated file path.
 */
const urlToFilePath = (dir, url, suffix) => {
  if (!suffix) {
    suffix = '.json'
  }
  const parsedUrl = urlParse(url)
  if (parsedUrl.pathname.length === 0 || parsedUrl.pathname === '/') {
    parsedUrl.pathname = '/index'
  }
  const pathParts = parsedUrl.pathname.split('/')
  const filePath = pathParts.map(part => slugify(part)).join('/')

  // For query args and anchors, convert to a file name safe string.
  let extras = ''
  if (parsedUrl.query) {
    extras += '.' + slugify(parsedUrl.query)
  }
  if (parsedUrl.hash) {
    extras += parsedUrl.hash.replace('#', '.')
  }

  return `${dir}/${parsedUrl.hostname}${filePath}${extras}${suffix}`
}

/**
 * Converts an entity type and (optional) bundle to a file path.
 *
 * @param {string} dir Where to write. No trailing slash.
 * @param {string} url of crawled page.
 * @param {string} entityType of object to store.
 * @param {string} bundle (optional) of object to store.
 * @return {string} The generated file path.
 */
const entityToFilePath = (dir, url, entityType, bundle) => {
  // TODO (wip) entities will need paths like :
  //  - block/the_block_id.json
  //  - page/my-page-slug.json
  //  - page/deeper/page-slug.json
  //  - blog/2020/09/my-blog-page-slug.json
}

module.exports = {
  urlToFilePath,
  entityToFilePath
}
