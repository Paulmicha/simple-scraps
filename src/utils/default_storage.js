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
 * TODO write more examples in this function docblock.
 *
 * @example
 *  // Expected output : 'www.domain.com/test/page'
 *  console.log(makeUrlFilenameSafe('https://www.domain.com/test/page.html'))
 *
 * @param {string} dir Where to write. No trailing slash.
 * @param {string} url of crawled page.
 * @param {string} suffix optional: Suffix and/or file extension. Defaults to
 *  ".json".
 * @param {boolean} noHostname optional: do not include hostname in result.
 * @return {string} The generated file path.
 */
const urlToFilePath = (dir, url, suffix, noHostname) => {
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

  if (noHostname) {
    return `${dir}${filePath}${extras}${suffix}`
  }

  return `${dir}/${parsedUrl.hostname}${filePath}${extras}${suffix}`
}

/**
 * Converts an entity type and (optional) bundle to a file path.
 *
 * TODO write tests.
 * TODO write examples in this function docblock.
 *
 * Example return values for entities represented by an URL :
 * - page/my-page-slug.json
 * - page/deeper/page-slug.json
 * - blog/2020/09/my-blog-page-slug.json
 * - taxonomy/tag/my-tag.json
 *
 * Example return values for other entities :
 * - menu/main.json
 * - block/the-block-id.json
 *
 * @param {string} dir Where to write. No trailing slash.
 * @param {string} domain (optional) for cases where URL is not used as basis for result.
 * @param {string} url (optional) of crawled page.
 * @param {string} entityType of object to store.
 * @param {string} bundle (optional) of object to store.
 * @param {string} title (optional) a label used for generating a slug.
 * @return {string} The generated file path.
 */
const entityToFilePath = (dir, domain, url, entityType, bundle, title) => {
  // The domain can be derived from URL.
  if (!domain && !url) {
    throw Error('entityToFilePath() requires the domain argument when no URL is provided.')
  }
  if (!domain) {
    const parsedUrl = urlParse(url)
    domain = parsedUrl.hostname
  }
  const sharedPrefix = `${dir}/${domain}`

  // When no URL is provided, we base the result solely on entity props and
  // title.
  if (!url) {
    if (!title) {
      throw Error('entityToFilePath() requires the title argument when no URL is provided.')
    }
    if (!bundle) {
      return `${sharedPrefix}/${slugify(entityType)}/${slugify(title)}.json`
    }
    return `${sharedPrefix}/${slugify(entityType)}/${slugify(bundle)}/${slugify(title)}.json`
  }

  // When we have a URL, we use it almost "as is" because it means it already is
  // a slug we can preserve).
  const pathByUrl = urlToFilePath('', url, '.json', true)
  if (!bundle) {
    return `${sharedPrefix}/${slugify(entityType)}/${pathByUrl}`
  }
  return `${sharedPrefix}/${slugify(entityType)}/${slugify(bundle)}/${pathByUrl}`
}

module.exports = {
  urlToFilePath,
  entityToFilePath
}
