const {
  mergeWith,
  uniq,
} = require('lodash');

const { Environment } = require('nunjucks');
const YAML = require('yaml');
const TOML = require('@iarna/toml');
const { promisify } = require('util');

const FileLoader = require('../FileLoader').default;

Environment.prototype.renderStringAsync = promisify(Environment.prototype.renderString);

function mergeWithArrays(...args) {
  return mergeWith({}, ...args, (objValue, srcValue) => {
    if (Array.isArray(objValue)) {
      return objValue.concat(srcValue);
    }
  });
}

function mergeWithArraysUnique(...args) {
  return mergeWith({}, ...args, (objValue, srcValue) => {
    if (Array.isArray(objValue)) {
      return uniq(objValue.concat(srcValue));
    }
  });
}

async function renderInline(inputStr, ctx = {}) {
  const setup = require('..').default;

  const tmpEnv = new Environment([new FileLoader()]);

  setup(tmpEnv);

  Object.keys(ctx, k => {
    tmpEnv.addGlobal(k, ctx[k]);
  });

  const str = await tmpEnv.renderStringAsync(inputStr, ctx);

  return str;
}

module.exports.utils = module.exports.Utils = {
  mergeWithArrays,
  mergeWithArraysUnique,
};

module.exports.data = module.exports.Data = {
  toJSON: JSON.stringify,
  fromJSON: JSON.parse,

  toYAML: YAML.stringify,
  fromYAML: YAML.parse,

  toTOML: TOML.stringify,
  fromTOML: TOML.parse,
};

module.exports.template = module.exports.Template = {
  inline: renderInline,
};
