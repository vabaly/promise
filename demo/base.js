const Promise = require('../src/index')

console.log('aa')
// 生成一个 Promise 实例
// 此过程大概是在 promise 上挂载一些属性并立即执行 fn 函数
// 同时立马校验 resolve 的值，不允许 resolve promise 本身
// 1. 如果 resolve 一个 promsie 对象，则决议状态和其他的不一样
// 2. 如果 resolve 一个 then 属性是函数的普通对象，那么会立即执行这个 then 函数,
//    如果这个 then 函数有一个或两个参数，第一个参数将会是 resolve 函数，第二个参数将会是 reject 函数，
//    最终 new Promise 的决议值是 then 函数中 resolve 或 reject 中的值
//    这种情况在下面的例子中特别给出来
// 3. 其他情况，决议状态都是成功，决议值都是里面的值
const promise = new Promise(function fn (resolve, reject) {
    console.log('resolve')
    // 真正的 resolve 值由 then 方法中的 resolve 值决定
    resolve({
        then: (resolve, reject) => {
            resolve('hahaha')
        }
    })
    // 多次 resolve 都会因为 doResolve 中的变量 done 为 true 而不被真正的执行内部的 resolve 函数
})

promise.then(done => {
    console.log('done', done)
}, error => {
    console.log('error', error)
}).catch(error => {
    console.log('catch error', error)
}).finally(() => {
    console.log('finally')
})