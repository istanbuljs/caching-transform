import path from 'path';
import fs from 'fs';
import test from 'ava';
import proxyquire from 'proxyquire';
import hasha from 'hasha';
import makeDir from 'make-dir';
import sinon from 'sinon';
import rimraf from 'rimraf';

// Istanbul (used by nyc to instrument the code) won't load when mock-fs is
// installed. Require the index.js here so it can be instrumented.
import '.'; // eslint-disable-line import/no-unassigned-import

const PKG_HASH = '101044df7719e0cfa10cbf1ad7b1c63e';

const mainCacheDir = path.join(__dirname, '.test-cache');
let currentDir = 0;

function createCacheDir(id) {
	return path.join(mainCacheDir, `test-${id}`);
}

function withMockedFs() {
	const makeDir = proxyquire('make-dir', {});
	makeDir.sync = sinon.spy(makeDir.sync);

	const packageHash = {
		sync() {
			return PKG_HASH;
		}
	};

	const cachingTransform = proxyquire('.', {
		'make-dir': makeDir,
		'package-hash': packageHash
	});

	cachingTransform.makeDir = makeDir;

	return cachingTransform;
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
		rimraf.sync(opts.cacheDir);
	}

	const cachingTransform = withMockedFs();
	const wrapped = cachingTransform(opts);
	wrapped.makeDir = cachingTransform.makeDir;
	wrapped.cacheDir = opts.cacheDir;

	return wrapped;
}

function append(val) {
	return input => `${input} ${val}`;
}

test.before(() => {
	rimraf.sync(mainCacheDir);
});

test.after.always(() => {
	rimraf.sync(mainCacheDir);
});

test('saves transform result to cache directory', t => {
	const transform = wrap(append('bar'));

	t.is(transform('foo'), 'foo bar');
	t.is(transform('FOO'), 'FOO bar');

	// Manual sha256 sum of '<PKG_HASH>foo'
	const filename1 = path.join(transform.cacheDir, '1dc458245419414bbdd40b53bb266691bacc8abcd21ff3440e0f4bc5a04c77d2');
	const filename2 = path.join(transform.cacheDir, 'ccf3ca00a6fb76fa7ca8101e5a697ab1bf3544b762f64ea1e6c790f8095317d5');

	t.is(fs.readFileSync(filename1, 'utf8'), 'foo bar');
	t.is(fs.readFileSync(filename2, 'utf8'), 'FOO bar');
});

test('skips transform if cache file exists', t => {
	const transform = wrap(() => t.fail());

	transform.makeDir.sync(transform.cacheDir);
	fs.writeFileSync(path.join(transform.cacheDir, '1dc458245419414bbdd40b53bb266691bacc8abcd21ff3440e0f4bc5a04c77d2'), 'foo bar');

	t.is(transform('foo'), 'foo bar');
});

test('able to specify alternate extension', t => {
	const transform = wrap({
		transform: append('bar'),
		ext: '.js'
	});

	t.is(transform('foo'), 'foo bar');

	const filename = path.join(transform.cacheDir, '1dc458245419414bbdd40b53bb266691bacc8abcd21ff3440e0f4bc5a04c77d2.js');

	t.is(fs.readFileSync(filename, 'utf8'), 'foo bar');
});

test('makeDir is only called once', t => {
	const transform = wrap({
		transform: append('bar')
	});

	t.is(transform.makeDir.sync.callCount, 0);
	t.is(transform('foo'), 'foo bar');
	t.is(transform.makeDir.sync.callCount, 1);
	t.is(transform('bar'), 'bar bar');
	t.is(transform.makeDir.sync.callCount, 1);
});

test('makeDir is only called once, with factory', t => {
	const transform = wrap({
		factory: () => append('bar')
	});

	t.is(transform.makeDir.sync.callCount, 0);
	t.is(transform('foo'), 'foo bar');
	t.is(transform.makeDir.sync.callCount, 1);
	t.is(transform('bar'), 'bar bar');
	t.is(transform.makeDir.sync.callCount, 1);
});

test('makeDir is never called if `createCacheDir === false`', t => {
	const transform = wrap(
		{
			transform: append('bar'),
			createCacheDir: false
		}
	);

	t.is(transform.makeDir.sync.callCount, 0);
	const error = t.throws(() => transform('foo'), Error);
	t.is(error.code, 'ENOENT');
	t.is(transform.makeDir.sync.callCount, 0);

	makeDir.sync(transform.cacheDir);
	t.is(transform('foo'), 'foo bar');
	t.is(transform.makeDir.sync.callCount, 0);
});

test('makeDir is never called if `createCacheDir === false`, with factory', t => {
	const transform = wrap(
		{
			factory: () => append('bar'),
			createCacheDir: false
		}
	);

	t.is(transform.makeDir.sync.callCount, 0);
	const error = t.throws(() => transform('foo'), Error);
	t.is(error.code, 'ENOENT');
	t.is(transform.makeDir.sync.callCount, 0);

	makeDir.sync(transform.cacheDir);
	t.is(transform('foo'), 'foo bar');
	t.is(transform.makeDir.sync.callCount, 0);
});

test('additional opts are passed to transform', t => {
	const transform = wrap((input, additionalOpts) => {
		t.is(input, 'foo');
		t.deepEqual(additionalOpts, {bar: 'baz'});
		return 'FOO!';
	});

	t.is(transform('foo', {bar: 'baz'}), 'FOO!');
});

test('filename is generated from the sha256 hash of the package hash, the input content and the salt', t => {
	const transform = wrap(
		{
			transform: append('bar'),
			salt: 'baz'
		}
	);

	transform('FOO');

	const filename = path.join(transform.cacheDir, hasha([PKG_HASH, 'FOO', 'baz'], {algorithm: 'sha256'}));

	t.is(fs.readFileSync(filename, 'utf8'), 'FOO bar');
});

test('factory is only called once', t => {
	const factory = sinon.spy(() => append('foo'));

	const transform = wrap({factory});

	t.is(factory.callCount, 0);
	t.is(transform('bar'), 'bar foo');
	t.is(factory.callCount, 1);
	t.deepEqual(factory.firstCall.args, [transform.cacheDir]);
	t.is(transform('baz'), 'baz foo');
	t.is(factory.callCount, 1);
});

test('checks for sensible options', t => {
	const transform = append('bar');
	const factory = () => transform;
	const cacheDir = '/someDir';

	t.throws(() => wrap({factory, transform, cacheDir}));
	t.throws(() => wrap({cacheDir}, true));
	t.throws(() => wrap({factory}, true));
	t.throws(() => wrap({transform}, true));

	t.notThrows(() => {
		wrap({factory});
		wrap({transform});
	});
});

test('cacheDir is only required if caching is enabled', t => {
	t.notThrows(() => {
		wrap({transform: append('bar'), disableCache: true}, true);
	});

	t.throws(() => {
		wrap({transform: append('bar')}, true);
	});
});

test('shouldTransform can bypass transform', t => {
	const transform = wrap({
		shouldTransform: (code, file) => {
			t.is(code, 'baz');
			t.is(file, '/baz.js');
			return false;
		},
		transform: () => t.fail()
	});

	t.is(transform('baz', '/baz.js'), 'baz');
});

test('shouldTransform can enable transform', t => {
	const transform = wrap({
		shouldTransform: (code, file) => {
			t.is(code, 'foo');
			t.is(file, '/foo.js');
			return true;
		},
		transform: append('bar')
	});

	t.is(transform('foo', '/foo.js'), 'foo bar');
});

test('disableCache:true, disables cache - transform is called multiple times', t => {
	const transformSpy = sinon.spy(append('bar'));
	const transform = wrap({
		disableCache: true,
		transform: transformSpy
	});

	t.is(transformSpy.callCount, 0);
	t.is(transform('foo'), 'foo bar');
	t.is(transformSpy.callCount, 1);
	t.is(transform('foo'), 'foo bar');
	t.is(transformSpy.callCount, 2);
});

test('disableCache:default, enables cache - transform is called once per hashed input', t => {
	const transformSpy = sinon.spy(append('bar'));
	const transform = wrap({transform: transformSpy});

	t.is(transformSpy.callCount, 0);
	t.is(transform('foo'), 'foo bar');
	t.is(transformSpy.callCount, 1);
	t.is(transform('foo'), 'foo bar');
	t.is(transformSpy.callCount, 1);
});

test('can provide additional input to the hash function', t => {
	t.plan(4);

	const hashData = function (code, filename) {
		t.is(code, 'foo');
		t.is(filename, '/foo.js');
		return 'extra-foo-data';
	};

	const transform = wrap({
		salt: 'this is salt',
		transform: append('bar'),
		hashData
	});

	const filename = path.join(transform.cacheDir, hasha([PKG_HASH, 'foo', 'this is salt', 'extra-foo-data'], {algorithm: 'sha256'}));

	t.is(transform('foo', '/foo.js'), 'foo bar');
	t.is(fs.readFileSync(filename, 'utf8'), 'foo bar');
});

test('can provide an array of additional input to the hash function', t => {
	t.plan(4);

	const hashData = function (code, filename) {
		t.is(code, 'foo');
		t.is(filename, '/foo.js');
		return ['extra-foo-data', 'even-more-data'];
	};

	const transform = wrap({
		salt: 'this is salt',
		transform: append('bar'),
		hashData
	});

	const filename = path.join(transform.cacheDir, hasha([PKG_HASH, 'foo', 'this is salt', 'extra-foo-data', 'even-more-data'], {algorithm: 'sha256'}));

	t.is(transform('foo', '/foo.js'), 'foo bar');
	t.is(fs.readFileSync(filename, 'utf8'), 'foo bar');
});

test('onHash callback fires after hashing', t => {
	t.plan(3);

	const onHash = function (code, filename, hash) {
		t.is(code, 'foo');
		t.is(filename, '/foo.js');
		t.is(hash, hasha([PKG_HASH, code, 'this is salt'], {algorithm: 'sha256'}));
	};

	const transform = wrap({
		salt: 'this is salt',
		transform: append('bar'),
		onHash
	});

	transform('foo', '/foo.js');
});

test('custom encoding changes value loaded from disk', t => {
	const transform = wrap({
		transform: () => t.fail(),
		encoding: 'hex'
	});

	makeDir.sync(transform.cacheDir);
	fs.writeFileSync(path.join(transform.cacheDir, hasha([PKG_HASH, 'foo'], {algorithm: 'sha256'})), 'foo bar');

	t.is(transform('foo'), Buffer.from('foo bar').toString('hex'));
});

test('custom encoding is respected when writing to disk', t => {
	const transform = wrap({
		transform: code => code,
		encoding: 'utf16le'
	});

	makeDir.sync(transform.cacheDir);
	t.is(transform('foobar'), 'foobar');
	fs.readFileSync(path.join(transform.cacheDir, hasha([PKG_HASH, 'foobar'], {algorithm: 'sha256'})), 'binary');
});

test('custom encoding changes the value stored to disk', t => {
	const transform = wrap({
		transform: code => Buffer.from(code + ' bar').toString('hex'),
		encoding: 'hex'
	});

	t.is(transform('foo'), Buffer.from('foo bar').toString('hex'));
	const filename = path.join(transform.cacheDir, hasha([PKG_HASH, 'foo'], {algorithm: 'sha256'}));
	t.is(fs.readFileSync(filename, 'utf8'), 'foo bar');
});

test('buffer encoding returns a buffer', t => {
	const transform = wrap({
		transform: () => t.fail(),
		encoding: 'buffer'
	});

	makeDir.sync(transform.cacheDir);
	fs.writeFileSync(path.join(transform.cacheDir, hasha([PKG_HASH, 'foo'], {algorithm: 'sha256'})), 'foo bar');

	const result = transform('foo');
	t.true(Buffer.isBuffer(result));
	t.is(result.toString(), 'foo bar');
});

test('salt can be a buffer', t => {
	const transform = wrap({
		transform: () => t.fail(),
		salt: Buffer.from('some-salt')
	});

	makeDir.sync(transform.cacheDir);
	const filename = path.join(transform.cacheDir, hasha([PKG_HASH, 'foo', Buffer.from('some-salt', 'utf8')], {algorithm: 'sha256'}));
	fs.writeFileSync(filename, 'foo bar');

	t.is(transform('foo'), 'foo bar');
});
