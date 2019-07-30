const Joi = require('@hapi/joi');

const schema = Joi.object({
  CONFIG_PATH: Joi.string().default('/config.yml'),
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

module.exports.default = value;
