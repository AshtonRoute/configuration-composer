const YAML = require('yaml');
const path = require('path');
const { URL } = require('url');
const fs = require('fs-extra');
const Joi = require('@hapi/joi');
const { partition, template } = require('lodash');

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

const FileSchema = Joi.object({
  left_delimiter: Joi.string(),
  right_delimiter: Joi.string(),
  input_path: Joi.string().required(),
  output_path: Joi.string().required(),
  on_change: onChangeSchema,
  args: argsSchema,
});

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
  dependencies: Joi.array().items(FilePathSchema).unique().default([]),
  templates: Joi.array().items(FilePathSchema).unique().default([]),
  datasources: Joi.array().items(DataSourceSchema).unique('url').default([]),
  files: Joi.array().items(FileSchema).default([]).unique((a, b) => a.input_path === b.input_path || a.output_path === b.output_path),
  on_change: onChangeSchema,
  args: argsSchema,
});

const ConfigSchema = Joi.array()
                        .items(ConfigItemSchema)
                        .single(true)
                        .min(1);

const templateInterpolateReg = /\[([\w]+?)\]/g;

async function getConfig(confPath) {
    const { dir, name } = path.parse(confPath);
    const curPath = path.join(dir, name);

    let conf = null;

    try {
      conf = await fs.readFile(`${curPath}.yaml`, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }

    conf = await fs.readFile(`${curPath}.yml`, 'utf8');

    return conf;
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
    if (v.on_change) {
      v.on_change = mapOnChange(v.on_change);
    }

    v.makeOutputPath = template(v.output_path, { interpolate: templateInterpolateReg });

    return v;
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
      item.files = item.files.map(v => mapFile(v));

      return item;
    });
  }

  module.exports.getConfig = getConfig;
  module.exports.parseConfig = parseConfig;