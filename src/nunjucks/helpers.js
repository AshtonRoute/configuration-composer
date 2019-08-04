function iterateObjectDeepHelper(args) {
  const {
    obj,
    cb,
    key = '',
    keysPath = [],
    maxDepth,
    dups = new WeakSet(),
  } = args;

  if (key) {
    keysPath.push(key);
  }

  if (typeof obj !== 'object') {
    cb(obj, key, keysPath);

    if (keysPath.length) {
      keysPath.pop();
    }

    return;
  }

  if (keysPath.length >= maxDepth) {
    keysPath.pop();
    return;
  }

  dups.add(obj);

  Object.keys(obj).forEach(k => {
    const curV = obj[k];

    if (dups.has(curV)) {
      throw new Error(`Recursive object filter at [${[...keysPath, k].join(', ')}]`);
    }

    iterateObjectDeepHelper({
      obj: curV,
      maxDepth,
      cb,
      key: k,
      keysPath,
      dups,
    });
  });

  dups.delete(obj);
  keysPath.pop();
}

function iterateObjectDeep(obj, cb, maxDepth) {
  if (typeof obj !== 'object') {
    throw new TypeError(`Expected an object, received: ${typeof obj}`);
  }

  return iterateObjectDeepHelper({ obj, cb, maxDepth });
}

function objectToFilters(obj, maxDepth = 1) {
  const filters = [];

  iterateObjectDeep(obj, (v, k, keysPath) => {
    if (typeof v !== 'function' || keysPath.some(v => v.startsWith('_'))) return;

    filters.push({
      name: keysPath.join('.'),
      handler: v,
    });
  }, maxDepth);

  return filters;
}

function addFilter(env, name, handler) {
  env.addFilter(name, async (...args) => {
    const cb = args.pop();

    try {
      const res = await handler(...args);
      cb(null, res);
    } catch (err) {
      cb(err);
    }
  }, true);
}

function addObjectToFilters(env, obj, maxDepth = 2, prefixes = ['']) {
  const filters = objectToFilters(obj, maxDepth);

  filters.forEach(f => {
    prefixes.forEach(prefix => {
      const curPrefix = prefix ? `${prefix}.` : '';

      addFilter(env, `${curPrefix}${f.name}`, f.handler);
    });
  });
}

module.exports.default = {
  iterateObjectDeep,
  objectToFilters,
  addFilter,
  addObjectToFilters,
};
