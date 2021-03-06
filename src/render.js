const Bluebird = require('bluebird');
const YAML = require('yaml');
const { spawn } = require('child_process');
const path = require('path');
const { createRequire } = require('module');
const fs = require('fs-extra');
const debounce = require('p-debounce');
const { merge, set } = require('lodash');

const ejs = require('./ejs');
const ENV = require('./environment').default;
const log = require('./logger').default;
const { parsePath, normalizePath } = require('./utils');

function spawnProc(args, filepath = '') {
  return new Promise((res, rej) => {
    try {
      const strArgs = args.command.join(' ');
      log.info(`${filepath}: Running [${strArgs}]`);

      const [procName, ...procArgs] = args.command;

      const curProc = spawn(procName, procArgs, { shell: '/bin/bash' });

      // drain stdout stream anyway
      curProc.stdout.on('data', (data) => {
        if (!args.stdout) return;

        log.debug(`${filepath} [${strArgs}]: ${data.toString('utf8')}`);
      });

      // drain stderr stream anyway
      curProc.stderr.on('data', (data) => {
        if (!args.stderr) return;

        log.error(`${filepath} [${strArgs}] (stderr): ${data.toString('utf8')}`);
      });

      curProc.on('close', (code) => {
        log.info(`${filepath}: [${strArgs}] finished with code ${code}`);

        if (code === 0) {
          res();
          return;
        }

        const err = new Error(`${procName} exited with code ${code}`);

        err.path = filepath;
        err.process = procName;
        err.processArgs = procArgs;

        rej(err);
      });
    } catch (err) {
      rej(err);
    }
  });
}

function createFileObj(filepath, file) {
  const newFile = {
    filepath,
    file,
    outputPath: null,
    outputDir: null,
    render: null,
    requireRelative: createRequire(path.dirname(filepath)),
  };

  if (file.output_path) {
    const pathObj = parsePath(filepath, file.input_path);
    const outputPath = normalizePath(file.makeOutputPath(pathObj));

    newFile.outputPath = outputPath;
    newFile.outputDir = path.dirname(outputPath);
  }

  newFile.render = debounce(renderFile, ENV.RENDER_FILE_DELAY).bind(newFile);

  return newFile;
}

async function renderFile(args) {
  const {
    cacheMaps,
    configItem,
    changedObject,
  } = args;

  const ctx = {};

  await Bluebird.map(cacheMaps.datasources, async ([filepath, { outputAlias }]) => {
    const content = await fs.readFile(filepath, 'utf8');
    const obj = YAML.parse(content);

    const newCtx = {};
    set(newCtx, outputAlias, obj);

    merge(ctx, newCtx);
  });

  let renderedStr = null;

  try {
    renderedStr = await ejs.renderFile(this.filepath, {
      ...configItem.env.data,
      ...ctx,
      requireRelative: this.requireRelative,
    }, configItem.env.options);
  } catch (err) {
    err.path = this.filepath;

    throw err;
  }

  if (this.outputPath) {
    try {
      await fs.writeFile(this.outputPath, renderedStr);
    } catch (err) {
      if (err.code == 'ENOENT') {
        await fs.ensureDir(this.outputDir);
        await fs.writeFile(this.outputPath, renderedStr);
      } else {
        throw err;
      }
    }
  }

  log.info({ input_path: this.filepath, output_path: this.outputPath, message: 'Template rendered' });

  const spawnArr = [];

  if (this.file.on_change && this.file.on_change.length) {
    this.file.on_change.forEach(fn => {
      spawnArr.push({ on_change: fn, filepath: this.filepath });
    });
  }

  if (configItem.on_change && configItem.on_change.length && changedObject === this) {
    configItem.on_change.forEach(fn => {
      spawnArr.push({ on_change: fn, filepath: this.filepath });
    });
  }

  spawnArr.forEach(v => {
    spawnProc(v.on_change, v.filepath).catch(log.error);
  });
}

async function renderFiles(args) {
  const {
    cacheMaps,
    changedObject,
    configItem,
  } = args;

  const renderErrors = [];

  await Bluebird.map(cacheMaps.files, async ([filepath, file]) => {
    try {
      await file.render(args);
    } catch (err) {
      err.path = filepath;

      renderErrors.push(err);
    }
  }, { concurrency: ENV.RENDER_FILES_CONCURRENCY });

  if (renderErrors.length !== cacheMaps.files.size) {
    const spawnArr = [];

    if (changedObject && changedObject.file.on_change && changedObject.file.on_change.length) {
      changedObject.file.on_change.forEach(fn => {
        spawnArr.push({
          on_change: fn,
          filepath: changedObject.filepath,
        });
      });
    }

    if (configItem.on_change && configItem.on_change.length) {
      configItem.on_change.forEach(fn => {
        spawnArr.push({ on_change: fn });
      })
    }

    spawnArr.forEach(v => {
      spawnProc(v.on_change, v.filepath).catch(log.error);
    });
  }

  if (renderErrors.length) {
    const err = new Error('Couldn\'t render some files');

    err.details = renderErrors;

    throw err;
  }
}

module.exports.createFileObj = createFileObj;
module.exports.renderFiles = renderFiles;
