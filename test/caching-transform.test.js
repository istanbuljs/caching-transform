import path from 'path';
import fs from 'fs';
import assert from 'node:assert/strict';
import {before, after, test} from 'node:test';
import hasha from 'hasha';
import cachingTransform from '../index.js';
import ownHash from '../package-hash.js';

const mainCacheDir = path.join(import.meta.dirname, '.test-cache');
let currentDir = 0;

function rmrf(dir) {
	fs.rmSync(dir, {recursive: true, force: true});
}

function createCacheDir(id) {
	return path.join(mainCacheDir, `test-${id}`);
}

function wrap(opts, noCacheDirOpt) {
	if (typeof opts === 'function') {
		opts = {transform: opts};
	}

	if (!noCacheDirOpt && !opts.cacheDir) {
		opts.cacheDir = createCacheDir(currentDir);
		currentDir++;
	}

	if (opts.cacheDir) {
		rmrf(opts.cacheDir);
	}

	const wrapped = cachingTransform(opts);
	wrapped.cacheDir = opts.cacheDir;
	return wrapped;
}

function append(val) {
	return input => `${input} ${val}`;
}

function pkgHash() {
	// Match the library’s package-hash input (project-root package.json)
	return ownHash;
}

before(() => {
	rmrf(mainCacheDir);
});

after(() => {
	rmrf(mainCacheDir);
});

test('saves transform result to cache directory', () => {
	const transform = wrap(append('bar'));

	assert.equal(transform('foo'), 'foo bar');
	assert.equal(transform('FOO'), 'FOO bar');

	const hashFoo = hasha([pkgHash(), 'foo'], {algorithm: 'sha256'});
	const hashFOO = hasha([pkgHash(), 'FOO'], {algorithm: 'sha256'});

	const filename1 = path.join(transform.cacheDir, hashFoo);
	const filename2 = path.join(transform.cacheDir, hashFOO);

	assert.equal(fs.readFileSync(filename1, 'utf8'), 'foo bar');
	assert.equal(fs.readFileSync(filename2, 'utf8'), 'FOO bar');
});

test('skips transform if cache file exists', () => {
	const transform = wrap(() => assert.fail('transform should not run'));

	fs.mkdirSync(transform.cacheDir, {recursive: true});
	const filename = path.join(transform.cacheDir, hasha([pkgHash(), 'foo'], {algorithm: 'sha256'}));
	fs.writeFileSync(filename, 'foo bar');

	assert.equal(transform('foo'), 'foo bar');
});

test('able to specify alternate extension', () => {
	const transform = wrap({
		transform: append('bar'),
		ext: '.js'
	});

	assert.equal(transform('foo'), 'foo bar');

	const filename = path.join(
		transform.cacheDir,
		hasha([pkgHash(), 'foo'], {algorithm: 'sha256'}) + '.js'
	);

	assert.equal(fs.readFileSync(filename, 'utf8'), 'foo bar');
});

test('cache directory is created on first use', () => {
	const transform = wrap(append('bar'));
	assert.equal(fs.existsSync(transform.cacheDir), false);
	assert.equal(transform('foo'), 'foo bar');
	assert.equal(fs.existsSync(transform.cacheDir), true);
});

test('factory receives cacheDir and is only created once', () => {
	let factoryCallCount = 0;
	let firstArgs;

	const factory = cacheDir => {
		factoryCallCount++;
		if (factoryCallCount === 1) {
			firstArgs = [cacheDir];
		}
		return append('foo');
	};

	const transform = wrap({factory});

	assert.equal(factoryCallCount, 0);
	assert.equal(transform('bar'), 'bar foo');
	assert.equal(factoryCallCount, 1);
	assert.deepEqual(firstArgs, [transform.cacheDir]);
	assert.equal(transform('baz'), 'baz foo');
	assert.equal(factoryCallCount, 1);
});

test('checks for sensible options', () => {
	const transform = append('bar');
	const factory = () => transform;
	const cacheDir = '/someDir';

	assert.throws(() => wrap({factory, transform, cacheDir}));
	assert.throws(() => wrap({cacheDir}, true));
	assert.throws(() => wrap({factory}, true));
	assert.throws(() => wrap({transform}, true));

	assert.doesNotThrow(() => {
		wrap({factory});
		wrap({transform});
	});
});

test('cacheDir is only required if caching is enabled', () => {
	assert.doesNotThrow(() => {
		wrap({transform: append('bar'), disableCache: true}, true);
	});

	assert.throws(() => {
		wrap({transform: append('bar')}, true);
	});
});

test('shouldTransform can bypass transform', () => {
	const transform = wrap({
		shouldTransform: (code, file) => {
			assert.equal(code, 'baz');
			assert.equal(file, '/baz.js');
			return false;
		},
		transform: () => assert.fail('transform should not run')
	});

	assert.equal(transform('baz', '/baz.js'), 'baz');
});

test('shouldTransform can enable transform', () => {
	const transform = wrap({
		shouldTransform: (code, file) => {
			assert.equal(code, 'foo');
			assert.equal(file, '/foo.js');
			return true;
		},
		transform: append('bar')
	});

	assert.equal(transform('foo', '/foo.js'), 'foo bar');
});

test('disableCache:true, disables cache - transform is called multiple times', () => {
	let callCount = 0;
	const transformFn = input => {
		callCount++;
		return append('bar')(input);
	};

	const transform = wrap({
		disableCache: true,
		transform: transformFn
	});

	assert.equal(callCount, 0);
	assert.equal(transform('foo'), 'foo bar');
	assert.equal(callCount, 1);
	assert.equal(transform('foo'), 'foo bar');
	assert.equal(callCount, 2);
});

test('disableCache:default, enables cache - transform is called once per hashed input', () => {
	let callCount = 0;
	const transformFn = input => {
		callCount++;
		return append('bar')(input);
	};

	const transform = wrap({transform: transformFn});

	assert.equal(callCount, 0);
	assert.equal(transform('foo'), 'foo bar');
	assert.equal(callCount, 1);
	assert.equal(transform('foo'), 'foo bar');
	assert.equal(callCount, 1);
});

test('filename is generated from the sha256 hash of the package hash, the input content and the salt', () => {
	const transform = wrap({
		transform: append('bar'),
		salt: 'baz'
	});

	transform('FOO');

	const filename = path.join(
		transform.cacheDir,
		hasha([pkgHash(), 'FOO', 'baz'], {algorithm: 'sha256'})
	);

	assert.equal(fs.readFileSync(filename, 'utf8'), 'FOO bar');
});

test('can provide additional input to the hash function', () => {
	let callCount = 0;
	const hashData = (code, filename) => {
		callCount++;
		assert.equal(code, 'foo');
		assert.equal(filename, '/foo.js');
		return 'extra-foo-data';
	};

	const transform = wrap({
		salt: 'this is salt',
		transform: append('bar'),
		hashData
	});

	const filename = path.join(
		transform.cacheDir,
		hasha([pkgHash(), 'foo', 'this is salt', 'extra-foo-data'], {algorithm: 'sha256'})
	);

	assert.equal(transform('foo', '/foo.js'), 'foo bar');
	assert.equal(fs.readFileSync(filename, 'utf8'), 'foo bar');
	assert.equal(callCount, 1);
});

test('can provide an array of additional input to the hash function', () => {
	let callCount = 0;
	const hashData = (code, filename) => {
		callCount++;
		assert.equal(code, 'foo');
		assert.equal(filename, '/foo.js');
		return ['extra-foo-data', 'even-more-data'];
	};

	const transform = wrap({
		salt: 'this is salt',
		transform: append('bar'),
		hashData
	});

	const filename = path.join(
		transform.cacheDir,
		hasha(
			[pkgHash(), 'foo', 'this is salt', 'extra-foo-data', 'even-more-data'],
			{algorithm: 'sha256'}
		)
	);

	assert.equal(transform('foo', '/foo.js'), 'foo bar');
	assert.equal(fs.readFileSync(filename, 'utf8'), 'foo bar');
	assert.equal(callCount, 1);
});

test('onHash callback fires after hashing', () => {
	let called = 0;
	const onHash = (code, filename, hash) => {
		called++;
		assert.equal(code, 'foo');
		assert.equal(filename, '/foo.js');
		assert.equal(hash, hasha([pkgHash(), code, 'this is salt'], {algorithm: 'sha256'}));
	};

	const transform = wrap({
		salt: 'this is salt',
		transform: append('bar'),
		onHash
	});

	transform('foo', '/foo.js');
	assert.equal(called, 1);
});

test('custom encoding changes value loaded from disk', () => {
	const transform = wrap({
		transform: () => assert.fail('transform should not run'),
		encoding: 'hex'
	});

	fs.mkdirSync(transform.cacheDir, {recursive: true});
	fs.writeFileSync(
		path.join(transform.cacheDir, hasha([pkgHash(), 'foo'], {algorithm: 'sha256'})),
		'foo bar'
	);

	assert.equal(transform('foo'), Buffer.from('foo bar').toString('hex'));
});

test('custom encoding is respected when writing to disk', () => {
	const transform = wrap({
		transform: code => code,
		encoding: 'utf16le'
	});

	fs.mkdirSync(transform.cacheDir, {recursive: true});
	assert.equal(transform('foobar'), 'foobar');

	assert.doesNotThrow(() => {
		fs.readFileSync(
			path.join(transform.cacheDir, hasha([pkgHash(), 'foobar'], {algorithm: 'sha256'})),
			'binary'
		);
	});
});

test('custom encoding changes the value stored to disk', () => {
	const transform = wrap({
		transform: code => Buffer.from(code + ' bar').toString('hex'),
		encoding: 'hex'
	});

	assert.equal(transform('foo'), Buffer.from('foo bar').toString('hex'));
	const filename = path.join(transform.cacheDir, hasha([pkgHash(), 'foo'], {algorithm: 'sha256'}));
	assert.equal(fs.readFileSync(filename, 'utf8'), 'foo bar');
});

test('buffer encoding returns a buffer', () => {
	const transform = wrap({
		transform: () => assert.fail('transform should not run'),
		encoding: 'buffer'
	});

	fs.mkdirSync(transform.cacheDir, {recursive: true});
	fs.writeFileSync(
		path.join(transform.cacheDir, hasha([pkgHash(), 'foo'], {algorithm: 'sha256'})),
		'foo bar'
	);

	const result = transform('foo');
	assert.equal(Buffer.isBuffer(result), true);
	assert.equal(result.toString(), 'foo bar');
});

test('salt can be a buffer', () => {
	const transform = wrap({
		transform: () => assert.fail('transform should not run'),
		salt: Buffer.from('some-salt')
	});

	fs.mkdirSync(transform.cacheDir, {recursive: true});
	const filename = path.join(
		transform.cacheDir,
		hasha([pkgHash(), 'foo', Buffer.from('some-salt', 'utf8')], {algorithm: 'sha256'})
	);
	fs.writeFileSync(filename, 'foo bar');

	assert.equal(transform('foo'), 'foo bar');
});

test('filenamePrefix uses metadata to prefix filename', () => {
	const transform = wrap({
		transform: () => assert.fail('transform should not run'),
		filenamePrefix: metadata => path.parse(metadata.filename || '').name + '-'
	});

	fs.mkdirSync(transform.cacheDir, {recursive: true});
	const filename = path.join(
		transform.cacheDir,
		'source-' + hasha([pkgHash(), 'foo'], {algorithm: 'sha256'})
	);
	fs.writeFileSync(filename, 'foo bar');

	assert.equal(transform('foo', {filename: path.join(import.meta.dirname, 'source.js')}), 'foo bar');
});

test('retries writing cache and throws after too many failures', () => {
	// If cache dir is never created and caching is enabled, writes will fail and
	// the library should retry a few times before giving up.
	const cacheDir = createCacheDir('missing-cache-dir');
	rmrf(cacheDir);

	const transform = cachingTransform({
		transform: code => code,
		cacheDir,
		createCacheDir: false
	});

	assert.throws(() => transform('foo'), /ENOENT/);
});
