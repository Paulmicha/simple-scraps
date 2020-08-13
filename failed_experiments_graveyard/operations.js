
/**
 * @file
 * Exports operation types that need to run in a single session.
 */

/**
 * Look for links to crawl.
 *
 * @param {Object} options
 * @param {Function} callback
 */
function op_find_links(options, callback) {
  if (!options.url) {
    return callback("Error : no URL to follow.");
  }

  // Defaults to look for all <a href="..."> in the page.
  const items_selector = options.selector || 'a[href]';

  (async () => {
    await options.page.goto(url);
    await options.page.waitForSelector(items_selector);
    await options.page.evaluate((q) => {
      const anchors = Array.from(document.querySelectorAll(q));
      return anchors.map((anchor) => {
        callback(null, {
          "op": "extract",
          "url": anchor.href
        });
      });
    }, items_selector);
  })();
}

module.exports = {
  'find_links': op_find_links
}
