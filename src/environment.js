const Joi = require('@hapi/joi');

const schema = Joi.object({
  CONFIG_PATH: Joi.string().default('/config.yml'),
  RENDER_FILES_CONCURRENCY: Joi.number().integer().min(0).default(1000),
  DEPENDENCIES_RENDER_DELAY: Joi.number().integer().min(0).default(1000),
  RENDER_FILE_DELAY: Joi.number().integer().min(0).default(500),
  AWAIT_FILE_WRITE_BEFORE_RENDER: Joi.number().integer().min(0).default(2000),
  AWAIT_FILE_WRITE_POLL_INTERVAL: Joi.number().integer().min(0).default(100),
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
