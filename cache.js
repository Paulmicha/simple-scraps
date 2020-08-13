/**
 * @file
 * Local file-based cache.
 */

const url_parse = require('url-parse');
const slugify = require('@sindresorhus/slugify');
const { write_file } = require('./fs');

/**
 * Converts an URL to a cache file path.
 */
const cache_get_file_path = (url) => {
	const parsed_url = url_parse(url);
	if (parsed_url.pathname.length === 0 || parsed_url.pathname === '/') {
		parsed_url.pathname = '/index';
	}
	const path_parts = parsed_url.pathname.split('/');
	const file_path = path_parts.map(part => slugify(part)).join('/');
	return `cache/${parsed_url.hostname + file_path}.html`;
}

/**
 * Saves page HTML into local cache file.
 */
const cache_page = (url, content) => {
	write_file(cache_get_file_path(url), content);
}

module.exports = {
	"cache_page": cache_page
};
