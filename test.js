import test from 'ava';
import proxyquire from 'proxyquire';
import mockfs from 'mock-fs';
import {getHash} from './';
import path from 'path';
import sinon from 'sinon';

function withMockedFs(fsConfig) {
	const fs = mockfs.fs(fsConfig || {});
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
		t.same(additionalOpts, {bar: 'baz'});
		return 'FOO!'
	});

	t.is(transform('foo', {bar: 'baz'}), 'FOO!');
});

test('salt changes the hash', t => {
	t.is(getHash('foo', 'bar'), getHash('foo', 'bar'));
	t.not(getHash('foo', 'bar'), getHash('foo', 'baz'));

	const transform = wrap (
		{
			transform: append('bar'),
			salt: 'baz',
			cacheDir: '/someDir'
		}
	);

	transform('FOO');

	var filename = path.join('/someDir', getHash('FOO', 'baz'));

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
	t.same(factory.firstCall.args, ['/cacheDir']);
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

	t.doesNotThrow(() => {
		wrap({factory, cacheDir});
		wrap({transform, cacheDir});
	});
});
