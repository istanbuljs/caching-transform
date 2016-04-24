'use strict';

var fs = require('fs');
var path = require('path');
var mkdirp = require('mkdirp');
var md5Hex = require('md5-hex');
var writeFileAtomic = require('write-file-atomic');

function wrap(opts) {
	if (!(opts.factory || opts.transform) || (opts.factory && opts.transform)) {
		throw new Error('specify factory or transform but not both');
	}
	if (typeof opts.cacheDir !== 'string' && !opts.disableCache) {
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
	var hashData = opts.hashData;
	var onHash = opts.onHash;
	var encoding = opts.encoding === 'buffer' ? undefined : opts.encoding || 'utf8';

	function transform(input, metadata, hash) {
		if (!created) {
			if (!cacheDirCreated && !disableCache) {
				mkdirp.sync(cacheDir);
			}
			if (!transformFn) {
				transformFn = factory(cacheDir);
			}
			created = true;
		}
		return transformFn(input, metadata, hash);
	}

	return function (input, metadata) {
		if (shouldTransform && !shouldTransform(input, metadata)) {
			return input;
		}
		if (disableCache) {
			return transform(input, metadata);
		}

		var data = [input];
		if (salt) {
			data.push(salt);
		}
		if (hashData) {
			data = data.concat(hashData(input, metadata));
		}

		var hash = md5Hex(data);
		var cachedPath = path.join(cacheDir, hash + ext);

		if (onHash) {
			onHash(input, metadata, hash);
		}

		try {
			return fs.readFileSync(cachedPath, encoding);
		} catch (e) {
			var result = transform(input, metadata, hash);
			writeFileAtomic.sync(cachedPath, result, encoding);
			return result;
		}
	};
}

module.exports = wrap;
