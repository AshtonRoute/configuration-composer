const { Loader } = require('nunjucks');
const fs = require('fs-extra');

class FileLoader extends Loader {
  noCache = true;

  get async() {
    return true;
  }

  async getSource(name, cb) {
    try {
      const source = {
        src: await fs.readFile(name, 'utf-8'),
        path: name,
        noCache: this.noCache
      };

      cb(null, source);
    } catch (err) {
      if (err.code === 'ENOENT') {
        cb(null, null);
        return;
      }

      cb(err);
    }
  }
}

module.exports.default = FileLoader;
