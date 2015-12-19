# caching-transform [![Build Status](https://travis-ci.org/jamestalmage/caching-transform.svg?branch=master)](https://travis-ci.org/jamestalmage/caching-transform) [![Coverage Status](https://coveralls.io/repos/jamestalmage/caching-transform/badge.svg?branch=master&service=github)](https://coveralls.io/github/jamestalmage/caching-transform?branch=master)

> Wraps a transform and provides caching.

Caching transform results can greatly improve performance. `nyc` saw [dramatic performance increases](https://github.com/bcoe/nyc/pull/101#issuecomment-165716069) when we implemented caching. 


## Install

```
$ npm install --save caching-transform
```


## Usage

```js
const cachingTransform = require('caching-transform');

cachingTransform({
  cacheDir: '/path/to/cache/directory',
  salt: 'hash-salt',
  transform: (input, additionalData, hash) => {
    // ...
    return transformedResult;
  }
});
```



## API

### cachingTransform(options)

Returns a transform callback that takes two arguments:
 - `input` is a string to be transformed
 - `additionalData` is an arbitrary data object.

Both arguments are passed to the wrapped transform.

#### options
                 
##### salt

Type: `string`
Default: `empty string`

A string that uniquely identifies your transform, a typical salt value might be the concatenation of the module name of your transform and it's version':

```js
  const pkg = require('my-transform/package.json');
  const salt = pkg.name + ':' + pkg.version;
```

Including the package version in the salt ensures existing cache entries will be automatically invalidated when you bump the version of your transform.

##### transform

Type: `Function(input: string, additionalData: *, hash: string): string`  

 - `input`: The string to be transformed. passed through from the wrapper.
 - `additionalData`: An arbitrary data object passed through from the wrapper. A typical value might be a string filename.
 - `hash`: The salted hash of `input`. You will rarely need to use this, unless you intend to create multiple cache entries per transform invocation.

Return a `string` containing the transformed results.

##### factory

Type: `Function(cacheDir: string): transformFunction`

If the `transform` function is expensive to create, at it is reasonable to expect that it may never be called during the life of the process, you can alternately supply a `factory` function that will be invoked the first time `transform` is needed.

##### cacheDir

Type: `string`

The directory where cached transform results will be stored. The directory is automatically created with [`mkdirp`](https://www.npmjs.com/package/mkdirp). You can set `options.createCacheDir = false` if you are certain  the directory already exists. 

##### ext

Type: `string`
Default: `empty string`

An extension that will be appended to the salted hash to create the filename inside your cache directory. It is not required, but it is recommended if you know the file type. Appending the extension allows you to easily inspect the cache directory contents with your file browser.

## License

MIT © [James Talmage](http://github.com/jamestalmage)
