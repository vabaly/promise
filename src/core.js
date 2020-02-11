'use strict';

var asap = require('asap/raw');

function noop() {}

// States:
//
// 0 - pending
// 1 - fulfilled with _value
// 2 - rejected with _value
// 3 - adopted the state of another promise, _value
//
// once the state is no longer pending (0) it is immutable

// All `_` prefixed properties will be reduced to `_{random number}`
// at build time to obfuscate them and discourage their use.
// We don't use symbols or Object.defineProperty to fully hide them
// because the performance isn't good enough.


// to avoid using try/catch inside critical functions, we
// extract them to here.
var LAST_ERROR = null;
var IS_ERROR = {};

// obj 是 resolve 的值
// 只有 obj 是对象的是否才会执行这个函数，目的是获取 obj.then
function getThen(obj) {
  try {
    return obj.then;
  } catch (ex) {
    LAST_ERROR = ex;
    return IS_ERROR;
  }
}

function tryCallOne(fn, a) {
  try {
    return fn(a);
  } catch (ex) {
    LAST_ERROR = ex;
    return IS_ERROR;
  }
}
function tryCallTwo(fn, a, b) {
  try {
    // 执行 new Promise(fn) 中的 fn 函数
    fn(a, b);
  } catch (ex) {
    LAST_ERROR = ex;
    return IS_ERROR;
  }
}

module.exports = Promise;

// 1. Promise 函数的定义，主要做两件事：1) 初始化私有属性；2) 调用 doResolve 函数
function Promise(fn) {
  // 判断是否是通过 new 调用
  // 因为是 'use strict' 模式，所以非 new 调用的 this 不是 global 或 window
  if (typeof this !== 'object') {
    throw new TypeError('Promises must be constructed via new');
  }
  // 参数校验
  if (typeof fn !== 'function') {
    throw new TypeError('Promise constructor\'s argument is not a function');
  }

  // 2. 初始化 Promise 对象的私有属性，包括状态、值
  this._deferredState = 0;
  this._state = 0;
  this._value = null;
  this._deferreds = null;

  // 当 fn 是 Promise._noop（下面会给这个属性赋值） 时，就返回空
  // 因为 new 操作符的原因，当函数返回基本类型时，new 表达式的返回值还是 this
  // 如此设定的目的可能只是想获得一个带有上述私有属性的 Promise 对象
  if (fn === noop) return;
  // 3. 实际逻辑在 doResolve 中
  doResolve(fn, this);
}
Promise._onHandle = null;
Promise._onReject = null;
Promise._noop = noop;

// promise 原型上的 then 方法
// promise.then(onFulfilled, onRejected)，
// onFulfilled 是决议成功时调用的函数，
// onRejected 是决议失败时调用的函数
Promise.prototype.then = function(onFulfilled, onRejected) {
  // 对于非 new Promise 创建的对象，但 then 方法又引用了 Promise.prototype.then，且又关联原型到了 Promise.prototype，
  // 会内部创建一个 Promise 来保证 then 中的参数调用和 promise 对象是一致的
  if (this.constructor !== Promise) {
    return safeThen(this, onFulfilled, onRejected);
  }

  // 1. 再创建一个仅挂载一些属性的 promise 对象
  var res = new Promise(noop);
  handle(this, new Handler(onFulfilled, onRejected, res));
  return res;
};

function safeThen(self, onFulfilled, onRejected) {
  return new self.constructor(function (resolve, reject) {
    var res = new Promise(noop);
    res.then(resolve, reject);
    handle(self, new Handler(onFulfilled, onRejected, res));
  });
}
function handle(self, deferred) {
  // 【Todo】当 promise 状态还没 resolved 的时候，用个 while 循环暂停住进程
  while (self._state === 3) {
    self = self._value;
  }
  if (Promise._onHandle) {
    Promise._onHandle(self);
  }
  if (self._state === 0) {
    if (self._deferredState === 0) {
      self._deferredState = 1;
      self._deferreds = deferred;
      return;
    }
    if (self._deferredState === 1) {
      self._deferredState = 2;
      self._deferreds = [self._deferreds, deferred];
      return;
    }
    self._deferreds.push(deferred);
    return;
  }

  // 当 Promise resolve 的是个立即值的时候，直接就执行 handleResolved 了
  handleResolved(self, deferred);
}

function handleResolved(self, deferred) {
  asap(function() {
    var cb = self._state === 1 ? deferred.onFulfilled : deferred.onRejected;
    if (cb === null) {
      if (self._state === 1) {
        resolve(deferred.promise, self._value);
      } else {
        reject(deferred.promise, self._value);
      }
      return;
    }
    var ret = tryCallOne(cb, self._value);
    if (ret === IS_ERROR) {
      reject(deferred.promise, LAST_ERROR);
    } else {
      resolve(deferred.promise, ret);
    }
  });
}

/**
 * 
 * @param {Promise} self promise 对象
 * @param {any} newValue resolve 决议的值
 */
function resolve(self, newValue) {
  // Promise Resolution Procedure: https://github.com/promises-aplus/promises-spec#the-promise-resolution-procedure
  // 1. Promise 的决议值不能是它自己
  if (newValue === self) {
    return reject(
      self,
      new TypeError('A promise cannot be resolved with itself.')
    );
  }

  // 如果决议值是对象类型（包括函数）的值，则需要进一步处理
  if (
    newValue &&
    (typeof newValue === 'object' || typeof newValue === 'function')
  ) {
    // 获取 resolve 对象中的 then 属性
    var then = getThen(newValue);
    if (then === IS_ERROR) {
      return reject(self, LAST_ERROR);
    }
    // 如果 resolve 的对象的 then 属性是 Promise 中的 then，
    // 说明 resolve 的是一个 promise
    if (
      // 光方法是同一个方法的判断不准，因为可能是一个普通对象往里面加了一个 then 属性，正好赋的值是 promise.then
      then === self.then &&
      // 所以还得加上一个原型链的判断，确定 newValue 是由 new Promise 生成的，
      // 当然，无聊的话是可以把普通对象的原型设为 Promise.prototype，但是这样也不会影响什么，
      // 只是一开始没有那些私有属性，但不影响给这些属性赋值
      newValue instanceof Promise
    ) {
      self._state = 3;
      self._value = newValue;
      finale(self);
      return;
    } else if (typeof then === 'function') {
      doResolve(then.bind(newValue), self);
      return;
    }
  }

  // 对于非 Promise 和这种 { then: function () {} }的决议值，
  // 直接更改 promise 对象的状态和值的属性即可
  // 然后调用 finale 函数
  self._state = 1;
  self._value = newValue;

  // 看 promise 是否有延迟的状态需要处理
  finale(self);
}

function reject(self, newValue) {
  self._state = 2;
  self._value = newValue;
  if (Promise._onReject) {
    Promise._onReject(self, newValue);
  }
  finale(self);
}

/**
 * @param {Promise} self promise 对象
 */
function finale(self) {
  if (self._deferredState === 1) {
    handle(self, self._deferreds);
    self._deferreds = null;
  }
  if (self._deferredState === 2) {
    for (var i = 0; i < self._deferreds.length; i++) {
      handle(self, self._deferreds[i]);
    }
    self._deferreds = null;
  }
}

function Handler(onFulfilled, onRejected, promise){
  this.onFulfilled = typeof onFulfilled === 'function' ? onFulfilled : null;
  this.onRejected = typeof onRejected === 'function' ? onRejected : null;
  this.promise = promise;
}

/**
 * Take a potentially（/pəˈtɛn(t)ʃəli/，潜在地） misbehaving（/ˌmɪsbəˈheɪv/，发生故障） resolver function and make sure
 * onFulfilled and onRejected are only called once.
 *
 * Makes no guarantees about asynchrony.
 * 
 * 1. 采取可能无法正常使用的 resolve function？
 * 2. 保证 onFulfilled 和 onRejected 只执行一次？
 * 3. 不保证异步？
 * 
 * 此函数也主要是调用 tryCallTwo 函数
 * 
 * @param fn new Promise(fn) 中的 fn 函数
 * @param promise new Promise 产生的 promise 对象
 */
function doResolve(fn, promise) {
  // promise 任务是否执行完
  var done = false;

  var res = tryCallTwo(fn, function (value) {
    // fn 中的 resolve 参数实际上就是这个函数
    // 在 Promise 中多次 resolve 实际上就是多次调用这个函数，而因为外层作用域的 done 使得无法真正执行 resolve
    // resolve 决议的值就是 value

    // 这句话保证 resolve 只执行一次
    if (done) return;

    done = true;
    // resolve 参数的调用实际上是执行这个文件定义的 resolve 函数
    resolve(promise, value);
  }, function (reason) {
    // fn 中的 reject 参数实际上就是这个函数
    if (done) return;
    done = true;
    reject(promise, reason);
  });

  // 没有执行完但是有错误认为是 reject
  if (!done && res === IS_ERROR) {
    done = true;
    reject(promise, LAST_ERROR);
  }
}
