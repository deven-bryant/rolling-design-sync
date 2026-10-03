'use strict';

// Not run: tests/store-contract.test.js type-checks it and expects these errors.
const { MemoryStore } = require('../../src/store/memory');

/** @typedef {import('../../src/store/types').Store} Store */

/** @implements {Store} */
class MissingMethod {
  async getNode(fileKey, nodeId) { return null; }
}

/** @implements {Store} */
class WrongReturn extends MemoryStore {
  async getNodeV3(fileKey, nodeId) { return 42; }
}

module.exports = { MissingMethod, WrongReturn };
