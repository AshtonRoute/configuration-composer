const ejs = require('ejs');

function setup(env = {}) {
  if (!env.context) {
    env.context = {};
  }

  env.client = false;
  env.async = true;
  env.debug = false;
  env.compileDebug = true;
  env.outputFunctionName = 'print';
  env.delimiter = '%';
  env.openDelimiter = '<';
  env.closeDelimiter = '>';

  env.context = {
    process: process,
    console: console,
    require: require,

    ENV: process.env,

    async render(str, data = {}, opts = {}) {
      const curOpts = setup();

      const result = await ejs.render(
        str,
        {
          ...curOpts.context,
          ...data,
        },
        {
          ...curOpts,
          ...opts,
        }
      );

      return result;
    },
  };

  return env;
}

module.exports.default = setup;
