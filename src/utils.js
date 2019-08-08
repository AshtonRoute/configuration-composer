const micromatch = require('micromatch');
const path = require('path');

function parsePath(filepath, pattern) {
  const { base } = micromatch.scan(pattern);
  const pathObj = path.parse(filepath);
  const subdirectory = pathObj.dir.substring(base.length + 1);
  const subdirectoryObjectPath = subdirectory.replace(/\//g, '.');
  const nameWithoutExt = pathObj.name.split('.').filter(v => v)[0];

  return {
    directory: pathObj.dir,
    subdirectory,
    subdirectoryObjectPath,
    fullSubdirectoryObjectPath: subdirectoryObjectPath ? `${subdirectoryObjectPath}.${nameWithoutExt}` : nameWithoutExt,
    fullObjectPath: filepath.replace(/\//g, '.'),
    basename: pathObj.base,
    nameWithoutExt,
    name: pathObj.name,
    ext: pathObj.ext.substring(1),
  };
}

function normalizePath(filepath) {
  return filepath.replace(/\/\//g, '/');
}

module.exports.parsePath = parsePath;
module.exports.normalizePath = normalizePath;
