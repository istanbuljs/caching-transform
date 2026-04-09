import fs from 'fs';
import path from 'path';
import {createHash} from 'crypto';
import writeFileAtomic from 'write-file-atomic';
import ownHash from './package-hash.js';

export default function wrap(opts) {
	if (!(opts.factory || opts.transform) || (opts.factory && opts.transform)) {
		throw new Error('Specify factory or transform but not both');
	}

	if (typeof opts.cacheDir !== 'string' && !opts.disableCache) {
		throw new Error('cacheDir must be a string');
	}

	opts = {
		ext: '',
		salt: '',
		hashData: () => [],
		filenamePrefix: () => '',
		onHash: () => {},
		...opts
	};

	let transformFn = opts.transform;
	const {factory, cacheDir, shouldTransform, disableCache, hashData, onHash, filenamePrefix, ext, salt} = opts;
	const cacheDirCreated = opts.createCacheDir === false;
	let created = transformFn && cacheDirCreated;
	const encoding = opts.encoding === 'buffer' ? undefined : opts.encoding || 'utf8';

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

		const data = createHash('sha256');
		data.update(ownHash);
		data.update(input);
		data.update(salt);
		for (const item of [].concat(hashData(input, metadata))) {
			data.update(item);
		}
		const hash = data.digest('hex');
		const cachedPath = path.join(cacheDir, filenamePrefix(metadata) + hash + ext);

		onHash(input, metadata, hash);

		let result;
		let retry = 0;
		while (true) {
			try {
				return fs.readFileSync(cachedPath, encoding);
			} catch (_) {
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
