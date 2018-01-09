import path from 'path';
import test from 'ava';
import proxyquire from 'proxyquire';
import mockfs from 'mock-fs';
import md5Hex from 'md5-hex';
import sinon from 'sinon';

// Istanbul (used by nyc to instrument the code) won't load when mock-fs is
// installed. Require the index.js here so it can be instrumented.
import '.'; // eslint-disable-line import/no-unassigned-import

const PKG_HASH = '101044df7719e0cfa10cbf1ad7b1c63e';

function withMockedFs(fsConfig) {
	const fs = mockfs.fs(fsConfig || {});
	fs['@global'] = true;

	const makeDir = proxyquire('make-dir', {fs});
	makeDir.sync = sinon.spy(makeDir.sync);

	const packageHash = {
		sync() {
			return PKG_HASH;
		}
	};

	const cachingTransform = proxyquire('.', {
		fs,
		'make-dir': makeDir,
		'package-hash': packageHash
	});

	cachingTransform.fs = fs;
	cachingTransform.makeDir = makeDir;

	return cachingTransform;
}

function wrap(opts, fsConfig) {
	if (typeof opts === 'function') {
		opts = {
			transform: opts,
			cacheDir: '/cacheDir'
		};
	}

	const cachingTransform = withMockedFs(fsConfig);
	const wrapped = cachingTransform(opts);
	wrapped.fs = cachingTransform.fs;
	wrapped.makeDir = cachingTransform.makeDir;

	return wrapped;
}

function append(val) {
	return input => `${input} ${val}`;
}

test('saves transform result to cache directory', t => {
	const transform = wrap(append('bar'));

	t.is(transform('foo'), 'foo bar');
	t.is(transform('FOO'), 'FOO bar');

	const filename1 = path.join('/cacheDir', '87714fa8335fa22814b7e113e82ade06');
	const filename2 = path.join('/cacheDir', 'b3ccaf374a0d63d6e8f67b5a0f3798dc');

	t.is(transform.fs.readFileSync(filename1, 'utf8'), 'foo bar');
	t.is(transform.fs.readFileSync(filename2, 'utf8'), 'FOO bar');
});

test('skips transform if cache file exists', t => {
	const transform = wrap(
		() => t.fail(),
		{
			'/cacheDir/87714fa8335fa22814b7e113e82ade06': 'foo bar'
		}
	);

	t.is(transform('foo'), 'foo bar');
});

test('able to specify alternate cacheDir', t => {
	const transform = wrap({
		transform: append('bar'),
		cacheDir: '/alternateDir'
	});

	t.is(transform('foo'), 'foo bar');

	const filename = path.join('/alternateDir', '87714fa8335fa22814b7e113e82ade06');

	t.is(transform.fs.readFileSync(filename, 'utf8'), 'foo bar');
});

test('able to specify alternate extension', t => {
	const transform = wrap({
		transform: append('bar'),
		ext: '.js',
		cacheDir: '/cacheDir'
	});

	t.is(transform('foo'), 'foo bar');

	const filename = path.join('/cacheDir', '87714fa8335fa22814b7e113e82ade06.js');

	t.is(transform.fs.readFileSync(filename, 'utf8'), 'foo bar');
});

test('makeDir is only called once', t => {
	const transform = wrap(
		{
			transform: append('bar'),
			cacheDir: '/someDir'
		}
	);

	t.is(transform.makeDir.sync.callCount, 0);
	t.is(transform('foo'), 'foo bar');
	t.is(transform.makeDir.sync.callCount, 1);
	t.is(transform('bar'), 'bar bar');
	t.is(transform.makeDir.sync.callCount, 1);
});

test('makeDir is only called once, with factory', t => {
	const transform = wrap(
		{
			factory: () => append('bar'),
			cacheDir: '/someDir'
		}
	);

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
			createCacheDir: false,
			cacheDir: '/someDir'
		},
		{
			'/someDir': {}
		}
	);

	t.is(transform.makeDir.sync.callCount, 0);
	t.is(transform('foo'), 'foo bar');
	t.is(transform.makeDir.sync.callCount, 0);
});

test('makeDir is never called if `createCacheDir === false`, with factory', t => {
	const transform = wrap(
		{
			factory: () => append('bar'),
			createCacheDir: false,
			cacheDir: '/someDir'
		},
		{
			'/someDir': {}
		}
	);

	t.is(transform.makeDir.sync.callCount, 0);
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

test('filename is generated from the md5 hash of the package hash, the input content and the salt', t => {
	const transform = wrap(
		{
			transform: append('bar'),
			salt: 'baz',
			cacheDir: '/someDir'
		}
	);

	transform('FOO');

	const filename = path.join('/someDir', md5Hex([PKG_HASH, 'FOO', 'baz']));

	t.is(transform.fs.readFileSync(filename, 'utf8'), 'FOO bar');
});

test('factory is only called once', t => {
	const factory = sinon.spy(() => append('foo'));

	const transform = wrap(
		{
			factory,
			cacheDir: '/cacheDir'
		}
	);

	t.is(factory.callCount, 0);
	t.is(transform('bar'), 'bar foo');
	t.is(factory.callCount, 1);
	t.deepEqual(factory.firstCall.args, ['/cacheDir']);
	t.is(transform('baz'), 'baz foo');
	t.is(factory.callCount, 1);
});

test('checks for sensible options', t => {
	const transform = append('bar');
	const factory = () => transform;
	const cacheDir = '/someDir';

	t.throws(() => wrap({factory, transform, cacheDir}));
	t.throws(() => wrap({cacheDir}));
	t.throws(() => wrap({factory}));
	t.throws(() => wrap({transform}));

	t.notThrows(() => {
		wrap({factory, cacheDir});
		wrap({transform, cacheDir});
	});
});

test('cacheDir is only required if caching is enabled', t => {
	t.notThrows(() => {
		wrap({transform: append('bar'), disableCache: true});
	});

	t.throws(() => {
		wrap({transform: append('bar')});
	});
});

test('shouldTransform can bypass transform', t => {
	const transform = wrap({
		shouldTransform: (code, file) => {
			t.is(code, 'baz');
			t.is(file, '/baz.js');
			return false;
		},
		transform: () => t.fail(),
		cacheDir: '/someDir'
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
		transform: append('bar'),
		cacheDir: '/someDir'
	});

	t.is(transform('foo', '/foo.js'), 'foo bar');
});

test('disableCache:true, disables cache - transform is called multiple times', t => {
	const transformSpy = sinon.spy(append('bar'));
	const transform = wrap({
		disableCache: true,
		transform: transformSpy,
		cacheDir: '/someDir'
	});

	t.is(transformSpy.callCount, 0);
	t.is(transform('foo'), 'foo bar');
	t.is(transformSpy.callCount, 1);
	t.is(transform('foo'), 'foo bar');
	t.is(transformSpy.callCount, 2);
});

test('disableCache:default, enables cache - transform is called once per hashed input', t => {
	const transformSpy = sinon.spy(append('bar'));
	const transform = wrap({
		transform: transformSpy,
		cacheDir: '/someDir'
	});

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
		cacheDir: '/cacheDir',
		transform: append('bar'),
		hashData
	});

	const filename = path.join('/cacheDir', md5Hex([PKG_HASH, 'foo', 'this is salt', 'extra-foo-data']));

	t.is(transform('foo', '/foo.js'), 'foo bar');
	t.is(transform.fs.readFileSync(filename, 'utf8'), 'foo bar');
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
		cacheDir: '/cacheDir',
		transform: append('bar'),
		hashData
	});

	const filename = path.join('/cacheDir', md5Hex([PKG_HASH, 'foo', 'this is salt', 'extra-foo-data', 'even-more-data']));

	t.is(transform('foo', '/foo.js'), 'foo bar');
	t.is(transform.fs.readFileSync(filename, 'utf8'), 'foo bar');
});

test('onHash callback fires after hashing', t => {
	t.plan(3);

	const onHash = function (code, filename, hash) {
		t.is(code, 'foo');
		t.is(filename, '/foo.js');
		t.is(hash, md5Hex([PKG_HASH, code, 'this is salt']));
	};

	const transform = wrap({
		salt: 'this is salt',
		cacheDir: '/cacheDir',
		transform: append('bar'),
		onHash
	});

	transform('foo', '/foo.js');
});

test('custom encoding changes value loaded from disk', t => {
	const transform = wrap({
		transform: () => t.fail(),
		encoding: 'hex',
		cacheDir: '/cacheDir'
	}, {
		['/cacheDir/' + md5Hex([PKG_HASH, 'foo'])]: 'foo bar'
	});

	t.is(transform('foo'), Buffer.from('foo bar').toString('hex'));
});

test('custom encoding is respected when writing to disk', t => {
	const transform = wrap({
		transform: code => code,
		encoding: 'utf16le',
		cacheDir: '/cacheDir'
	});

	t.is(transform('foobar'), 'foobar');
	// The mock-fs package doesn't seem to read back the whole file, so just check the beginning of the string
	t.regex(transform.fs.readFileSync('/cacheDir/' + md5Hex([PKG_HASH, 'foobar']), 'binary'), /^f\u0000o\u0000o\u0000/);
});

test.failing('custom encoding changes the value stored to disk', t => {
	const transform = wrap({
		transform: code => Buffer.from(code + ' bar').toString('hex'),
		encoding: 'hex',
		cacheDir: '/cacheDir'
	});

	t.is(transform('foo'), Buffer.from('foo bar').toString('hex'));
	t.is(transform.fs.readFileSync('/cacheDir/' + md5Hex([PKG_HASH, 'foo']), 'utf8'), 'foo bar');
});

test('buffer encoding returns a buffer', t => {
	const transform = wrap({
		transform: () => t.fail(),
		encoding: 'buffer',
		cacheDir: '/cacheDir'
	}, {
		['/cacheDir/' + md5Hex([PKG_HASH, 'foo'])]: 'foo bar'
	});

	const result = transform('foo');
	t.true(Buffer.isBuffer(result));
	t.is(result.toString(), 'foo bar');
});

test('salt can be a buffer', t => {
	const transform = wrap({
		transform: () => t.fail(),
		salt: Buffer.from('some-salt'),
		cacheDir: '/cacheDir'
	}, {
		['/cacheDir/' + md5Hex([PKG_HASH, 'foo', Buffer.from('some-salt', 'utf8')])]: 'foo bar'
	});

	t.is(transform('foo'), 'foo bar');
});
