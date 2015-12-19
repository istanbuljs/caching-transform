'use strict';

var mkdirp = require('mkdirp');
var crypto = require('crypto');
var fs = require('fs');
var path = require('path');

function getHash(input, salt) {
	return crypto
		.createHash('md5')
		.update(input, 'utf8')
		.update(salt || '', 'utf8')
		.digest('hex');
}

function wrap(opts) {
	if (!(opts.factory || opts.transform) || (opts.factory && opts.transform)) {
		throw new Error('specify factory or transform but not both');
	}
	if (typeof opts.cacheDir !== 'string') {
		throw new Error('cacheDir must be a string');
	}

	var transformFn = opts.transform;
	var factory = opts.factory;
	var cacheDir = opts.cacheDir;
	var cacheDirCreated = opts.createCacheDir === false;
	var created = transformFn && cacheDirCreated;
	var ext = opts.ext || '';
	var salt = opts.salt || '';

	return function (input, additionalData) {
		var hash = getHash(input, salt);
		var cachedPath = path.join(cacheDir, hash + ext);

		try {
			return fs.readFileSync(cachedPath, 'utf8');
		} catch (e) {
			if (!created) {
				if (!cacheDirCreated) {
					mkdirp.sync(cacheDir);
				}
				if (!transformFn) {
					transformFn = factory(cacheDir);
				}
				created = true;
			}
			var result = transformFn(input, additionalData, hash);
			fs.writeFileSync(cachedPath, result);
			return result;
		}
	};
}

module.exports = wrap;
module.exports.getHash = getHash;
