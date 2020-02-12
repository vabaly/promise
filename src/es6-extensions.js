'use strict';

//This file contains the ES6 extensions to the core Promises/A+ API

var Promise = require('./core.js');

module.exports = Promise;

/* Static Functions */

var TRUE = valuePromise(true);
var FALSE = valuePromise(false);
var NULL = valuePromise(null);
var UNDEFINED = valuePromise(undefined);
var ZERO = valuePromise(0);
var EMPTYSTRING = valuePromise('');

function valuePromise(value) {
  var p = new Promise(Promise._noop);
  p._state = 1;
  p._value = value;
  return p;
}
Promise.resolve = function (value) {
  if (value instanceof Promise) return value;

  if (value === null) return NULL;
  if (value === undefined) return UNDEFINED;
  if (value === true) return TRUE;
  if (value === false) return FALSE;
  if (value === 0) return ZERO;
  if (value === '') return EMPTYSTRING;

  if (typeof value === 'object' || typeof value === 'function') {
    try {
      var then = value.then;
      if (typeof then === 'function') {
        return new Promise(then.bind(value));
      }
    } catch (ex) {
      return new Promise(function (resolve, reject) {
        reject(ex);
      });
    }
  }
  return valuePromise(value);
};

/**
 * Promise all 的实现
 */
Promise.all = function (arr) {
  // 确保是真数组
  var args = Array.prototype.slice.call(arr);

  // Promise.all 方法返回一个 Promise
  return new Promise(function (resolve, reject) {
    // 当参数是空数组时，决议值是 []
    if (args.length === 0) return resolve([]);

    // 记录还有多少个 promise 未决议
    var remaining = args.length;

    /**
     * 主要逻辑都在 res 函数中
     * @param {number} i promise 数组下标
     * @param {Promise|Object|Function} val 下标对应的 Promise，当然也可以是其他被兼容的对象，暂不考虑
     */
    function res(i, val) {
      if (val && (typeof val === 'object' || typeof val === 'function')) {
        // 主要考虑 val 是 promise 对象的情况
        if (val instanceof Promise && val.then === Promise.prototype.then) {
          // 如果 PromiseA resolve PromiseB，PromiseB 又 resolve PromiseC ...
          // 那么就一直寻找到最里层的不是 resolve Promise 的一个 Promise 为止
          // 这个寻找的过程就是通过 _state 这个私有属性来判断，它存储了 Promise resolve 的内容
          while (val._state === 3) {
            val = val._value;
          }
          // 成功决议时递归调用 res 函数，此时 res 的第二个参数变成了 Promise resolve 的值
          if (val._state === 1) return res(i, val._value);
          // 决议失败时直接就把 Promise.all 返回的 Promise 给 reject 掉了
          if (val._state === 2) reject(val._value);

          // 还处于 pending 状态的 promise 继续放入下一个微任务队列中去判断
          val.then(function (val) {
            res(i, val);
          }, reject);
          return;
        } else {
          var then = val.then;
          if (typeof then === 'function') {
            var p = new Promise(then.bind(val));
            p.then(function (val) {
              res(i, val);
            }, reject);
            return;
          }
        }
      }

      // 如果 val 的值是非 Promise 或非特殊对象和函数，都会走到这
      // 包括 promise 成功决议了之后也会调用 res 走到这
      args[i] = val;

      // 都决议完了之后再把最外层的 Promise 决议了
      if (--remaining === 0) {
        resolve(args);
      }
    }

    // 遍历 promise 数组，并执行 res 函数
    for (var i = 0; i < args.length; i++) {
      res(i, args[i]);
    }
  });
};

Promise.reject = function (value) {
  return new Promise(function (resolve, reject) {
    reject(value);
  });
};

Promise.race = function (values) {
  return new Promise(function (resolve, reject) {
    values.forEach(function(value){
      Promise.resolve(value).then(resolve, reject);
    });
  });
};

/* Prototype Methods */

Promise.prototype['catch'] = function (onRejected) {
  return this.then(null, onRejected);
};
