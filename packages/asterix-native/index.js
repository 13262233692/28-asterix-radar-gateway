'use strict';

try {
  const { decode } = require('./build/Release/asterix_decoder.node');
  module.exports = { decode };
} catch (e) {
  console.warn('[asterix-native] Native module not available, falling back to JS decoder');
  const { decodeFallback } = require('./src/js_fallback');
  module.exports = { decode: decodeFallback };
}
