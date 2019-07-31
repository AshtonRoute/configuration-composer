const Joi = require('@hapi/joi');

const schema = Joi.object({
  GOMPLATE_BIN_PATH: Joi.string().default('gomplate'),
  CONFIG_PATH: Joi.string().default('/config.yml'),
  CONFIG_TEMPLATE_ARGS: Joi.string(),
  RENDER_FILES_CONCURRENCY: Joi.number().integer().min(0).default(1000),
  DEPENDENCIES_RENDER_DELAY: Joi.number().integer().min(0).default(1000),
  RENDER_FILE_DELAY: Joi.number().integer().min(0).default(500),
});

const { value, error } = schema.validate(process.env, {
  abortEarly: false,
  allowUnknown: true,
  stripUnknown: {
    arrays: false,
    objects: true,
  },
});

if (error) {
  throw error;
}

if (value.RENDER_FILES_CONCURRENCY === 0) {
  value.RENDER_FILES_CONCURRENCY = Infinity;
}

module.exports.default = value;
