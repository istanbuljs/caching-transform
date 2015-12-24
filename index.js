'use strict';

var mkdirp = require('mkdirp');
var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var writeFileAtomic = require('write-file-atomic');

function getHash(input, salt) {
	return crypto
		.createHash('md5')
		.update(input, 'utf8')
		.update(salt || '', 'utf8')
		.digest('hex');
}

function defaultHash(input, additionalData, salt) {
	return getHash(input, salt);
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
	var shouldTransform = opts.shouldTransform;
	var disableCache = opts.disableCache;
	var hashFn = opts.hash || defaultHash;

	function transform(input, additionalData, hash) {
		if (!created) {
			if (!cacheDirCreated && !disableCache) {
				mkdirp.sync(cacheDir);
			}
			if (!transformFn) {
				transformFn = factory(cacheDir);
			}
			created = true;
		}
		return transformFn(input, additionalData, hash);
	}

	return function (input, additionalData) {
		if (shouldTransform && !shouldTransform(input, additionalData)) {
			return input;
		}
		if (disableCache) {
			return transform(input, additionalData);
		}

		var hash = hashFn(input, additionalData, salt);
		var cachedPath = path.join(cacheDir, hash + ext);

		try {
			return fs.readFileSync(cachedPath, 'utf8');
		} catch (e) {
			var result = transform(input, additionalData, hash);
			writeFileAtomic.sync(cachedPath, result);
			return result;
		}
	};
}

module.exports = wrap;
module.exports.getHash = getHash;
