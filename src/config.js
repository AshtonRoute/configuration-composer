const YAML = require('yaml');
const path = require('path');
const { URL } = require('url');
const fs = require('fs-extra');
const { promisify } = require('util');
const Joi = require('@hapi/joi');
const { partition, template } = require('lodash');
const { Environment } = require('nunjucks');

const ENV = require('./environment').default;
const FileLoader = require('./nunjucks/FileLoader').default;
const nunjucksSetup = require('./nunjucks').default;

Environment.prototype.renderAsync = promisify(Environment.prototype.render);
Environment.prototype.renderStringAsync = promisify(Environment.prototype.renderString);

function checkUniqueField(field) {
  return (v1, v2) => {
    let curV1 = v1;

    if (typeof curV1 === 'string') {
      curV1 = { [field]: curV1 };
    }

    let curV2 = v2;

    if (typeof curV2 === 'string') {
      curV2 = { [field]: curV2 };
    }

    return curV1[field] === curV2[field] || curV1[field] === curV2[field];
  };
}

const argsSchema = Joi.array().min(1);

const onChangeCmdSchema = Joi.array().min(1);

const onChangeSchema = Joi.alternatives().try([
  onChangeCmdSchema,
  Joi.object({
    command: onChangeCmdSchema,
    stdout: Joi.boolean().default(false),
    stderr: Joi.boolean().default(true),
  }),
]);

const DataSourceSchema = Joi.alternatives().try([
  Joi.string().required(),
  Joi.object({
    url: Joi.string().uri().required(),
    alias: Joi.string().alphanum(),
    on_change: onChangeSchema,
    args: argsSchema,
  }),
]);

const FileSchema = Joi.alternatives().try([
  Joi.string().required(),
  Joi.object({
    left_delimiter: Joi.string(),
    right_delimiter: Joi.string(),
    input_path: Joi.string().required(),
    output_path: Joi.string(),
    on_change: onChangeSchema,
    args: argsSchema,
  }),
]);

const FilePathSchema = Joi.alternatives().try([
  Joi.string().required(),
  Joi.object({
    path: Joi.string().required(),
    on_change: onChangeSchema,
    args: argsSchema,
  }),
]);

const ConfigItemSchema = Joi.object({
  watch: Joi.boolean().default(false),
  dependencies: Joi.array().items(FilePathSchema).unique(checkUniqueField('path')).default([]),
  templates: Joi.array().items(FilePathSchema).unique(checkUniqueField('path')).default([]),
  custom: Joi.array().items(FilePathSchema).unique(checkUniqueField('path')).default([]),
  datasources: Joi.array().items(DataSourceSchema).unique(checkUniqueField('url')).default([]),
  files: Joi.array().items(FileSchema).default([]).unique(checkUniqueField('input_path')),
  on_change: onChangeSchema,
  args: argsSchema,
});

const ConfigSchema = Joi.array()
  .items(ConfigItemSchema)
  .single(true)
  .min(1);

const templateInterpolateReg = /\[([\w]+?)\]/g;

function getPathFromArg(arg, v) {
  if (['t', 'f'].includes(arg)) {
    return v;
  }

  if (arg === 'd') {
    const curUrl = new URL(v.substring(v.indexOf('=') + 1));

    if (!curUrl.protocol.startsWith('file')) return null;

    return curUrl.pathname;
  }

  return null;
}

async function getConfig() {
  let conf = null;

  try {
    conf = await fs.readFile(ENV.CONFIG_PATH, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }

  const { dir, name } = path.parse(ENV.CONFIG_PATH);
  let curPath = path.join(dir, name);

  try {
    conf = await fs.readFile(`${curPath}.yaml`, 'utf8');
    curPath = `${curPath}.yaml`;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }

  try {
    conf = await fs.readFile(`${curPath}.yml`, 'utf8');
    curPath = `${curPath}.yml`;
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`Couldn't find config at ${ENV.CONFIG_PATH} or ${curPath}.yml or ${curPath}.yaml`);
    }

    throw err;
  }

  const tmpEnv = new Environment([new FileLoader()]);

  nunjucksSetup(tmpEnv);

  conf = await tmpEnv.renderStringAsync(conf);

  return {
    config: conf,
    configDeps: [curPath],
  };
}

function mapOnChange(v) {
  if (Array.isArray(v)) {
    return {
      command: v,
      stdout: false,
      stderr: true,
    };
  }

  return v;
}

function mapDataSource(v) {
  const curV = {
    url: null,
  };

  if (typeof v === 'string') {
    curV.url = v;
  } else {
    Object.assign(curV, v);
  }

  if (curV.on_change) {
    curV.on_change = mapOnChange(curV.on_change);
  }

  const curUrl = new URL(curV.url);

  if (curUrl.protocol.startsWith('file')) {
    curV.path = curUrl.pathname;
    curV.makeAlias = template(curV.alias, { interpolate: templateInterpolateReg });
  }

  return curV;
}

function mapFile(v) {
  const curV = {
    input_path: null,
  };

  if (typeof v === 'string') {
    curV.input_path = v;
  } else {
    Object.assign(curV, v);
  }

  if (curV.on_change) {
    curV.on_change = mapOnChange(curV.on_change);
  }

  if (curV.output_path) {
    curV.makeOutputPath = template(curV.output_path, { interpolate: templateInterpolateReg });
  }

  return curV;
}

function mapFilePath(v) {
  const curV = {
    path: null,
  };

  if (typeof v === 'string') {
    curV.path = v;
  } else {
    Object.assign(curV, v);
  }

  if (curV.on_change) {
    curV.on_change = mapOnChange(curV.on_change);
  }

  return curV;
}

function parseConfig(conf) {
  let curData = YAML.parse(conf);

  const { value, error } = ConfigSchema.validate(curData, {
    abortEarly: false,
    allowUnknown: false,
    stripUnknown: {
      arrays: false,
      objects: true,
    },
  });

  if (error) {
    throw error;
  }

  return value.map(item => {
    if (item.on_change) {
      item.on_change = mapOnChange(item.on_change);
    }

    const datasources = item.datasources.map(v => mapDataSource(v));

    [item.fileDataSources, item.otherDataSources] = partition(datasources, v => v.path != null);

    item.dependencies = item.dependencies.map(v => mapFilePath(v));
    item.templates = item.templates.map(v => mapFilePath(v));
    item.custom = item.custom.map(v => mapFilePath(v));
    item.files = item.files.map(v => mapFile(v));

    item.env = new Environment([new FileLoader()]);

    nunjucksSetup(item.env);

    return item;
  });
}

module.exports.getConfig = getConfig;
module.exports.parseConfig = parseConfig;
