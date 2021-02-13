'use strict';
const fs = require('fs');
const path = require('path');
const hasha = require('hasha');
const writeFileAtomic = require('write-file-atomic');
const packageHash = require('package-hash');

let ownHash = '';
function getOwnHash() {
	ownHash = packageHash.sync(path.join(__dirname, 'package.json'));
	return ownHash;
}

function wrap(options) {
	if (!(options.factory || options.transform) || (options.factory && options.transform)) {
		throw new Error('Specify factory or transform but not both');
	}

	if (typeof options.cacheDir !== 'string' && !options.disableCache) {
		throw new Error('cacheDir must be a string');
	}

	options = {
		ext: '',
		salt: '',
		hashData: () => [],
		filenamePrefix: () => '',
		onHash: () => {},
		...options
	};

	let transformFn = options.transform;
	const {factory, cacheDir, shouldTransform, disableCache, hashData, onHash, filenamePrefix, ext, salt} = options;
	const cacheDirCreated = options.createCacheDir === false;
	let created = transformFn && cacheDirCreated;
	const encoding = options.encoding === 'buffer' ? undefined : options.encoding || 'utf8';

	function transform(input, metadata, hash) {
		if (!created) {
			if (!cacheDirCreated && !disableCache) {
				fs.mkdirSync(cacheDir, {recursive: true});
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

		const data = [
			ownHash || getOwnHash(),
			input,
			salt,
			...[].concat(hashData(input, metadata))
		];
		const hash = hasha(data, {algorithm: 'sha256'});
		const cachedPath = path.join(cacheDir, filenamePrefix(metadata) + hash + ext);

		onHash(input, metadata, hash);

		let result;
		let retry = 0;
		/* eslint-disable-next-line no-constant-condition */
		while (true) {
			try {
				return fs.readFileSync(cachedPath, encoding);
			} catch {
				if (!result) {
					result = transform(input, metadata, hash);
				}

				try {
					writeFileAtomic.sync(cachedPath, result, {encoding});
					return result;
				} catch (error) {
					/* Likely https://github.com/npm/write-file-atomic/issues/28
					 * Make up to 3 attempts to read or write the cache. */
					retry++;
					if (retry > 3) {
						throw error;
					}
				}
			}
		}
	};
}

module.exports = wrap;
