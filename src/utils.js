const micromatch = require('micromatch');
const path = require('path');

function parsePath(filepath, pattern) {
  const { base } = micromatch.scan(pattern);
  const pathObj = path.parse(filepath);

  return {
    directory: pathObj.dir,
    subdirectory: pathObj.dir.substring(base.length + 1),
    basename: pathObj.base,
    name: pathObj.name.split('.').filter(v => v !== 'tmpl').join('.'),
    ext: pathObj.ext.substring(1),
  };
}

function normalizePath(filepath) {
  return filepath.replace(/\/\//g, '/');
}

module.exports.parsePath = parsePath;
module.exports.normalizePath = normalizePath;
