import path from 'path';
import test from 'ava';
import proxyquire from 'proxyquire';
import mockfs from 'mock-fs';
import md5Hex from 'md5-hex';
import sinon from 'sinon';

function withMockedFs(fsConfig) {
	const fs = mockfs.fs(fsConfig || {});
	fs['@global'] = true;
	const mkdirp = sinon.spy(proxyquire('mkdirp', {fs}));
	mkdirp.sync = sinon.spy(mkdirp.sync);
	var cachingTransform = proxyquire('./', {fs, mkdirp});
	cachingTransform.fs = fs;
	cachingTransform.mkdirp = mkdirp;

	return cachingTransform;
}

function wrap(opts, fsConfig) {
	if (typeof opts === 'function') {
		opts = {
			transform: opts,
			cacheDir: '/cacheDir'
		};
	}
	var cachingTransform = withMockedFs(fsConfig);
	var wrapped = cachingTransform(opts);
	wrapped.fs = cachingTransform.fs;
	wrapped.mkdirp = cachingTransform.mkdirp;
	return wrapped;
}

function append(val) {
	return input => input + ' ' + val;
}

test('saves transform result to cache directory', t => {
	const transform = wrap(append('bar'));

	t.is(transform('foo'), 'foo bar');
	t.is(transform('FOO'), 'FOO bar');

	const filename1 = path.join('/cacheDir', 'acbd18db4cc2f85cedef654fccc4a4d8');
	const filename2 = path.join('/cacheDir', '901890a8e9c8cf6d5a1a542b229febff');

	t.is(transform.fs.readFileSync(filename1, 'utf8'), 'foo bar');
	t.is(transform.fs.readFileSync(filename2, 'utf8'), 'FOO bar');
});

test('skips transform if cache file exists', t => {
	const transform = wrap(
		() => t.fail(),
		{
			'/cacheDir/acbd18db4cc2f85cedef654fccc4a4d8': 'foo bar'
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

	const filename = path.join('/alternateDir', 'acbd18db4cc2f85cedef654fccc4a4d8');

	t.is(transform.fs.readFileSync(filename, 'utf8'), 'foo bar');
});

test('able to specify alternate extension', t => {
	const transform = wrap({
		transform: append('bar'),
		ext: '.js',
		cacheDir: '/cacheDir'
	});

	t.is(transform('foo'), 'foo bar');

	const filename = path.join('/cacheDir', 'acbd18db4cc2f85cedef654fccc4a4d8.js');

	t.is(transform.fs.readFileSync(filename, 'utf8'), 'foo bar');
});

test('mkdirp is only called once', t => {
	const transform = wrap(
		{
			transform: append('bar'),
			cacheDir: '/someDir'
		}
	);

	t.is(transform.mkdirp.sync.callCount, 0);
	t.is(transform('foo'), 'foo bar');
	t.is(transform.mkdirp.sync.callCount, 1);
	t.is(transform('bar'), 'bar bar');
	t.is(transform.mkdirp.sync.callCount, 1);
});

test('mkdirp is only called once, with factory', t => {
	const transform = wrap(
		{
			factory: () => append('bar'),
			cacheDir: '/someDir'
		}
	);

	t.is(transform.mkdirp.sync.callCount, 0);
	t.is(transform('foo'), 'foo bar');
	t.is(transform.mkdirp.sync.callCount, 1);
	t.is(transform('bar'), 'bar bar');
	t.is(transform.mkdirp.sync.callCount, 1);
});

test('mkdirp is never called if `createCacheDir === false`', t => {
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

	t.is(transform.mkdirp.sync.callCount, 0);
	t.is(transform('foo'), 'foo bar');
	t.is(transform.mkdirp.sync.callCount, 0);
});

test('mkdirp is never called if `createCacheDir === false`, with factory', t => {
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

	t.is(transform.mkdirp.sync.callCount, 0);
	t.is(transform('foo'), 'foo bar');
	t.is(transform.mkdirp.sync.callCount, 0);
});

test('additional opts are passed to transform', t => {
	const transform = wrap((input, additionalOpts) => {
		t.is(input, 'foo');
		t.deepEqual(additionalOpts, {bar: 'baz'});
		return 'FOO!';
	});

	t.is(transform('foo', {bar: 'baz'}), 'FOO!');
});

test('filename is generated from the md5 hash of the input content and the salt', t => {
	const transform = wrap(
		{
			transform: append('bar'),
			salt: 'baz',
			cacheDir: '/someDir'
		}
	);

	transform('FOO');

	const filename = path.join('/someDir', md5Hex(['FOO', 'baz']));

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

test('can provide custom hash function', t => {
	t.plan(5);

	const hash = sinon.spy(function (code, filename, salt) {
		t.is(code, 'foo');
		t.is(filename, '/foo.js');
		t.is(salt, 'this is salt');
		return 'foo-hash';
	});

	const transform = wrap({
		salt: 'this is salt',
		cacheDir: '/cacheDir',
		transform: append('bar'),
		hash
	});

	t.is(transform('foo', '/foo.js'), 'foo bar');
	t.is(transform.fs.readFileSync('/cacheDir/foo-hash', 'utf8'), 'foo bar');
});

test('custom encoding changes value loaded from disk', t => {
	const transform = wrap({
		transform: () => t.fail(),
		encoding: 'hex',
		cacheDir: '/cacheDir'
	}, {
		['/cacheDir/' + md5Hex('foo')]: 'foo bar'
	});

	t.is(transform('foo'), new Buffer('foo bar').toString('hex'));
});

test('custom encoding changes the value stored to disk', t => {
	const transform = wrap({
		transform: code => new Buffer(code + ' bar').toString('hex'),
		encoding: 'hex',
		cacheDir: '/cacheDir'
	});

	t.is(transform('foo'), new Buffer('foo bar').toString('hex'));
	t.is(transform.fs.readFileSync('/cacheDir/' + md5Hex('foo'), 'utf8'), 'foo bar');
});

test('buffer encoding returns a buffer', t => {
	const transform = wrap({
		transform: () => t.fail(),
		encoding: 'buffer',
		cacheDir: '/cacheDir'
	}, {
		['/cacheDir/' + md5Hex('foo')]: 'foo bar'
	});

	var result = transform('foo');
	t.true(Buffer.isBuffer(result));
	t.is(result.toString(), 'foo bar');
});

test('salt can be a buffer', t => {
	const transform = wrap({
		transform: () => t.fail(),
		salt: new Buffer('some-salt'),
		cacheDir: '/cacheDir'
	}, {
		['/cacheDir/' + md5Hex(['foo', new Buffer('some-salt', 'utf8')])]: 'foo bar'
	});

	t.is(transform('foo'), 'foo bar');
});
