/**
 * @file
 * Contains fixtures shared by more than 1 test suite.
 */

const path = require('path')

// Local static pages URLs.
const urls = {
  article: 'file://' + path.resolve(__dirname, 'static', 'Article.html'),
  blog: 'file://' + path.resolve(__dirname, 'static', 'Blog.html'),
  components: 'file://' + path.resolve(__dirname, 'static', 'Components.html')
}

module.exports = {
  urls
}
