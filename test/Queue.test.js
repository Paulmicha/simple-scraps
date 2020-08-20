const test = require('ava')
const Queue = require('../src/Queue')

const key = 'test-key'
const additionalKeys = ['test-key-1', 'test-key-2']

test('1. Queued items must be correctly counted', t => {
  const queue = new Queue()
  queue.addItem(key, { hello: 'world' })
  queue.addItem(key, { hello: 'world2' })
  t.is(2, queue.getItemsCount(key))
})

test('2. Items pulled from queue must be correctly counted and returned', t => {
  const queue = new Queue()
  queue.addItem(key, { hello: 'world' })
  const dequeuedItem = queue.getItem(key)
  t.is(0, queue.getItemsCount(key))
  t.is('world', dequeuedItem.hello)
})

test('3. Keys must be unique and iterable via getNextKey()', t => {
  const queue = new Queue()
  queue.addItem(key, { hello: 'world' })
  queue.addItem(key, { hello: 'world2' })
  additionalKeys.forEach(k => {
    queue.addItem(k, { hello: 'world' })
    queue.addItem(k, { hello: 'world2' })
    queue.addItem(k, { hello: 'world3' })
  })
  t.is(3, queue.getKeysCount())
  t.is(key, queue.getNextKey())
  const [val1, val2, val3] = queue.getKeys()
  t.is(key, val1)
  t.is(additionalKeys[0], val2)
  t.is(additionalKeys[1], val3)
})

test('4. Items enqueued or dequeued in a loop must correctly impact its lifetime', t => {
  let cycleCount = 0
  const queue = new Queue()
  for (let i = 1; i <= 10; i++) {
    queue.addItem(key, { hello: 'world' + i })
  }
  while (queue.getItemsCount(key)) {
    cycleCount++
    queue.getItem(key)
    if (cycleCount === 3) {
      queue.addItem(key, { hello: 'world randomly added in loop' })
    }
    // Safety circuit breaker.
    if (cycleCount > 22) {
      break
    }
  }
  t.is(11, cycleCount)
  t.is(0, queue.getItemsCount(key))
})

test('5. A loop on the keys must correctly end when all items from all keys are pulled', t => {
  const queue = new Queue()
  const keys = [key, additionalKeys[0], additionalKeys[1]]

  for (let i = 1; i <= 10; i++) {
    keys.forEach(k => {
      queue.addItem(k, { hello: 'world' + i })
    })
  }

  let cycleCount = 0
  while (queue.getKeysCount()) {
    // console.log('getKeysCount = ' + queue.getKeysCount())
    if (keys[cycleCount]) {
      // console.log('emptying key : ' + keys[cycleCount])
      // console.log('getItemsCount before = ' + queue.getItemsCount(keys[cycleCount]))

      // Before emptying the items from current key, getNextKey() must still
      // return the current key.
      t.is(keys[cycleCount], queue.getNextKey())

      let innerCycleCount = 0
      while (queue.getItemsCount(keys[cycleCount])) {
        innerCycleCount++
        queue.getItem(keys[cycleCount])
        // Safety circuit breaker.
        if (innerCycleCount > 22) {
          break
        }
      }
      // console.log('getItemsCount after = ' + queue.getItemsCount(keys[cycleCount]))

      // Immediately after emptying the items from current key, getNextKey()
      // now must return the next key.
      if (keys[cycleCount + 1]) {
        t.is(keys[cycleCount + 1], queue.getNextKey())
      }
    }
    cycleCount++
    // Safety circuit breaker.
    if (cycleCount > 22) {
      break
    }
  }
  t.is(3, cycleCount)
  t.is(0, queue.getItemsCount(key))
  t.is(0, queue.getItemsCount(additionalKeys[0]))
  t.is(0, queue.getItemsCount(additionalKeys[1]))
})
