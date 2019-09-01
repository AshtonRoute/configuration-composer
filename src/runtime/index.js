function setup() {
  const options = {
    context: {},
    _with: false,
    localsName: 'ctx',
    client: false,
    async: true,
    debug: false,
    compileDebug: true,
    outputFunctionName: 'print',
    delimiter: '%',
    openDelimiter: '<',
    closeDelimiter: '>',
  };

  const data = {
    ENV: process.env,
  };

  return { data, options };
}

module.exports.default = setup;
