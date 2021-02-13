const path = require('path');
const fs = require('fs');
const t = require('libtap');
const hasha = require('hasha');
const sinon = require('sinon');
const rimraf = require('rimraf');
const packageHash = require('package-hash');

const cachingTransform = require('./index.js');

const PKG_HASH = packageHash.sync(path.join(__dirname, 'package.json'));

const mainCacheDir = path.join(__dirname, '.test-cache');
let currentDir = 0;

function createCacheDir(id) {
	return path.join(mainCacheDir, `test-${id}`);
}

function wrap(options, noCacheDirOpt) {
	if (typeof options === 'function') {
		options = {transform: options};
	}

	if (!noCacheDirOpt && !options.cacheDir) {
		options.cacheDir = createCacheDir(currentDir);
		currentDir++;
	}

	if (options.cacheDir) {
		rimraf.sync(options.cacheDir);
	}

	const wrapped = cachingTransform(options);
	wrapped.cacheDir = options.cacheDir;
	wrapped.cacheFile = data => {
		const hash = hasha(
			[
				PKG_HASH,
				data,
				options.salt || ''
			],
			{algorithm: 'sha256'}
		);

		return path.join(options.cacheDir, hash + (options.ext || ''));
	};

	return wrapped;
}

function append(value) {
	return input => `${input} ${value}`;
}

rimraf.sync(mainCacheDir);

t.teardown(() => rimraf.sync(mainCacheDir));

t.test('saves transform result to cache directory', async t => {
	const transform = wrap(append('bar'));

	t.equal(transform('foo'), 'foo bar');
	t.equal(transform('FOO'), 'FOO bar');

	t.equal(fs.readFileSync(transform.cacheFile('foo'), 'utf8'), 'foo bar');
	t.equal(fs.readFileSync(transform.cacheFile('FOO'), 'utf8'), 'FOO bar');
});

t.test('skips transform if cache file exists', async t => {
	const transform = wrap(() => t.fail());

	fs.mkdirSync(transform.cacheDir, {recursive: true});
	fs.writeFileSync(transform.cacheFile('foo'), 'foo bar');

	t.equal(transform('foo'), 'foo bar');
});

t.test('able to specify alternate extension', async t => {
	const transform = wrap({
		transform: append('bar'),
		ext: '.js'
	});

	t.equal(transform('foo'), 'foo bar');

	t.equal(fs.readFileSync(transform.cacheFile('foo'), 'utf8'), 'foo bar');
});

t.test('makeDir is only called once', async t => {
	const transform = wrap({
		transform: append('bar')
	});

	t.equal(transform('foo'), 'foo bar');
	t.equal(transform('bar'), 'bar bar');
	rimraf.sync(transform.cacheDir);
	t.throws(() => transform('bar'), {code: 'ENOENT'});
});

t.test('makeDir is only called once, with factory', async t => {
	const transform = wrap({
		factory: () => append('bar')
	});

	t.equal(transform('foo'), 'foo bar');
	t.equal(transform('bar'), 'bar bar');
	rimraf.sync(transform.cacheDir);
	t.throws(() => transform('bar'), {code: 'ENOENT'});
});

t.test('makeDir is never called if `createCacheDir === false`', async t => {
	const transform = wrap({
		transform: append('bar'),
		createCacheDir: false
	});

	t.throws(() => transform('foo'), {code: 'ENOENT'});

	fs.mkdirSync(transform.cacheDir, {recursive: true});
	t.equal(transform('foo'), 'foo bar');
});

t.test('makeDir is never called if `createCacheDir === false`, with factory', async t => {
	const transform = wrap({
		factory: () => append('bar'),
		createCacheDir: false
	});

	t.throws(() => transform('foo'), {code: 'ENOENT'});

	fs.mkdirSync(transform.cacheDir, {recursive: true});
	t.equal(transform('foo'), 'foo bar');
});

t.test('additional options are passed to transform', async t => {
	const transform = wrap((input, additionalOptions) => {
		t.equal(input, 'foo');
		t.same(additionalOptions, {bar: 'baz'});
		return 'FOO!';
	});

	t.equal(transform('foo', {bar: 'baz'}), 'FOO!');
});

t.test('filename is generated from the sha256 hash of the package hash, the input content and the salt', async t => {
	const transform = wrap({
		transform: append('bar'),
		salt: 'baz'
	});

	transform('FOO');
	t.equal(fs.readFileSync(transform.cacheFile('FOO'), 'utf8'), 'FOO bar');
});

t.test('factory is only called once', async t => {
	const factory = sinon.spy(() => append('foo'));

	const transform = wrap({factory});

	t.equal(factory.callCount, 0);
	t.equal(transform('bar'), 'bar foo');
	t.equal(factory.callCount, 1);
	t.same(factory.firstCall.args, [transform.cacheDir]);
	t.equal(transform('baz'), 'baz foo');
	t.equal(factory.callCount, 1);
});

t.test('checks for sensible options', async t => {
	const transform = append('bar');
	const factory = () => transform;
	const cacheDir = '/someDir';

	t.throws(() => wrap({factory, transform, cacheDir}));
	t.throws(() => wrap({cacheDir}, true));
	t.throws(() => wrap({factory}, true));
	t.throws(() => wrap({transform}, true));

	t.doesNotThrow(() => {
		wrap({factory});
		wrap({transform});
	});
});

t.test('cacheDir is only required if caching is enabled', async t => {
	t.doesNotThrow(() => {
		wrap({transform: append('bar'), disableCache: true}, true);
	});

	t.throws(() => {
		wrap({transform: append('bar')}, true);
	});
});

t.test('shouldTransform can bypass transform', async t => {
	const transform = wrap({
		shouldTransform: (code, file) => {
			t.equal(code, 'baz');
			t.equal(file, '/baz.js');
			return false;
		},
		transform: () => t.fail()
	});

	t.equal(transform('baz', '/baz.js'), 'baz');
});

t.test('shouldTransform can enable transform', async t => {
	const transform = wrap({
		shouldTransform: (code, file) => {
			t.equal(code, 'foo');
			t.equal(file, '/foo.js');
			return true;
		},
		transform: append('bar')
	});

	t.equal(transform('foo', '/foo.js'), 'foo bar');
});

t.test('disableCache:true, disables cache - transform is called multiple times', async t => {
	const transformSpy = sinon.spy(append('bar'));
	const transform = wrap({
		disableCache: true,
		transform: transformSpy
	});

	t.equal(transformSpy.callCount, 0);
	t.equal(transform('foo'), 'foo bar');
	t.equal(transformSpy.callCount, 1);
	t.equal(transform('foo'), 'foo bar');
	t.equal(transformSpy.callCount, 2);
});

t.test('disableCache:default, enables cache - transform is called once per hashed input', async t => {
	const transformSpy = sinon.spy(append('bar'));
	const transform = wrap({transform: transformSpy});

	t.equal(transformSpy.callCount, 0);
	t.equal(transform('foo'), 'foo bar');
	t.equal(transformSpy.callCount, 1);
	t.equal(transform('foo'), 'foo bar');
	t.equal(transformSpy.callCount, 1);
});

t.test('can provide additional input to the hash function', async t => {
	t.plan(4);

	const hashData = function (code, filename) {
		t.equal(code, 'foo');
		t.equal(filename, '/foo.js');
		return 'extra-foo-data';
	};

	const transform = wrap({
		salt: 'this is salt',
		transform: append('bar'),
		hashData
	});

	const filename = path.join(transform.cacheDir, hasha([PKG_HASH, 'foo', 'this is salt', 'extra-foo-data'], {algorithm: 'sha256'}));

	t.equal(transform('foo', '/foo.js'), 'foo bar');
	t.equal(fs.readFileSync(filename, 'utf8'), 'foo bar');
});

t.test('can provide an array of additional input to the hash function', async t => {
	t.plan(4);

	const hashData = function (code, filename) {
		t.equal(code, 'foo');
		t.equal(filename, '/foo.js');
		return ['extra-foo-data', 'even-more-data'];
	};

	const transform = wrap({
		salt: 'this is salt',
		transform: append('bar'),
		hashData
	});

	const filename = path.join(transform.cacheDir, hasha([PKG_HASH, 'foo', 'this is salt', 'extra-foo-data', 'even-more-data'], {algorithm: 'sha256'}));

	t.equal(transform('foo', '/foo.js'), 'foo bar');
	t.equal(fs.readFileSync(filename, 'utf8'), 'foo bar');
});

t.test('onHash callback fires after hashing', async t => {
	t.plan(3);

	const onHash = function (code, filename, hash) {
		t.equal(code, 'foo');
		t.equal(filename, '/foo.js');
		t.equal(hash, hasha([PKG_HASH, code, 'this is salt'], {algorithm: 'sha256'}));
	};

	const transform = wrap({
		salt: 'this is salt',
		transform: append('bar'),
		onHash
	});

	transform('foo', '/foo.js');
});

t.test('custom encoding changes value loaded from disk', async t => {
	const transform = wrap({
		transform: () => t.fail(),
		encoding: 'hex'
	});

	fs.mkdirSync(transform.cacheDir, {recursive: true});
	fs.writeFileSync(transform.cacheFile('foo'), 'foo bar');

	t.equal(transform('foo'), Buffer.from('foo bar').toString('hex'));
});

t.test('custom encoding is respected when writing to disk', async t => {
	const transform = wrap({
		transform: code => code,
		encoding: 'utf16le'
	});

	fs.mkdirSync(transform.cacheDir, {recursive: true});
	t.equal(transform('foobar'), 'foobar');
	fs.readFileSync(transform.cacheFile('foobar'), 'binary');
});

t.test('custom encoding changes the value stored to disk', async t => {
	const transform = wrap({
		transform: code => Buffer.from(code + ' bar').toString('hex'),
		encoding: 'hex'
	});

	t.equal(transform('foo'), Buffer.from('foo bar').toString('hex'));
	t.equal(fs.readFileSync(transform.cacheFile('foo'), 'utf8'), 'foo bar');
});

t.test('buffer encoding returns a buffer', async t => {
	const transform = wrap({
		transform: () => t.fail(),
		encoding: 'buffer'
	});

	fs.mkdirSync(transform.cacheDir, {recursive: true});
	fs.writeFileSync(transform.cacheFile('foo'), 'foo bar');

	const result = transform('foo');
	t.equal(Buffer.isBuffer(result), true);
	t.equal(result.toString(), 'foo bar');
});

t.test('salt can be a buffer', async t => {
	const transform = wrap({
		transform: () => t.fail(),
		salt: Buffer.from('some-salt')
	});

	fs.mkdirSync(transform.cacheDir, {recursive: true});
	fs.writeFileSync(transform.cacheFile('foo'), 'foo bar');

	t.equal(transform('foo'), 'foo bar');
});

t.test('filenamePrefix uses metadata to prefix filename', async t => {
	const transform = wrap({
		transform: () => t.fail(),
		filenamePrefix: metadata => path.parse(metadata.filename || '').name + '-'
	});

	fs.mkdirSync(transform.cacheDir, {recursive: true});
	const filename = path.join(transform.cacheDir, 'source-' + hasha([PKG_HASH, 'foo'], {algorithm: 'sha256'}));
	fs.writeFileSync(filename, 'foo bar');

	t.equal(transform('foo', {filename: path.join(__dirname, 'source.js')}), 'foo bar');
});
