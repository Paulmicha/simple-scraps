/**
 * @file
 * File system related shared utilities.
 */

// import * as fs from 'fs';
// import * as path from 'path';
const fs = require('fs');
const path = require('path');
const mkdirp = require('mkdirp');

/**
 * Helper to write file creating missing parent folder(s) if necessary.
 *
 * See https://stackoverflow.com/a/50927704/2592338
 *
 * @param {String} file_path
 * @param {String} content
 */
const write_file = async (file_path, content) => {
	const dirname = path.dirname(file_path);
	if (!fs.existsSync(dirname)) {
		await mkdirp.sync(dirname);
	}
  fs.writeFileSync(file_path, content);
}

/**
 * Recursively gets file paths from given dir.
 *
 * @param {String} dir
 * @param {String} extension optional: filter by file extension.
 * @returns {Array} List of file paths sorted by name.
 */
const walk = (dir, extension) => {
	let files = [];
	fs.readdirSync(dir).map(file => {
		if (fs.statSync(path.join(dir, file)).isFile()) {
			if (extension === undefined || path.extname(file) === extension) {
				files.push(path.join(dir, file));
			}
		}
		else {
			files = files.concat(walk(path.join(dir, file), extension))
		}
	});
	return files.sort();
}

module.exports = {
	"walk": walk,
	"write_file": write_file
};
