/**
 * Shim that maps pdfjs-dist's `require('canvas')` to @napi-rs/canvas.
 * Must be loaded before pdfjs-dist.
 */
const napi = require("@napi-rs/canvas");
const Module = require("module");

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...args) {
  if (request === "canvas") {
    return require.resolve("@napi-rs/canvas");
  }
  return originalResolve.call(this, request, parent, ...args);
};

module.exports = napi;
