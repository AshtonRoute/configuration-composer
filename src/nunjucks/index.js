const path = require('path');
const lodash = require('lodash');
const fs = require('fs-extra');

const filters = require('./filters');
const helpers = require('./helpers').default;

const defaults = [
  {
    names: ['env', 'Env'],
    value: process.env,
  },

  {
    names: ['path', 'Path'],
    value: lodash.omitBy(path, v => v === path),
  },

  {
    names: ['utils', 'Utils'],
    value: { ...lodash },
  },

  {
    names: ['fs', 'FS', 'io', 'IO'],
    value: fs,
  },
];

function setup(env) {
  env.opts.autoescape = false;
  env.globals = {};
  env.filters = {};
  env.asyncFilters = [];

  defaults.forEach(obj => {
    const objFilters = helpers.objectToFilters(obj.value);

    obj.names.forEach(name => {
      env.addGlobal(name, obj.value);

      objFilters.forEach(f => {
        helpers.addFilter(env, `${name}.${f.name}`, f.handler);
      });
    });
  });

  helpers.addObjectToFilters(env, filters);
}

module.exports.default = setup;
