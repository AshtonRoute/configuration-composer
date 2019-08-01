const Bluebird = require('bluebird');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs-extra');
const throttle = require('p-throttle');

const ENV = require('./environment').default;
const log = require('./logger').default;
const { parsePath, normalizePath } = require('./utils');

const execFileAsync = promisify(execFile);

function spawnProc(args, filepath = '') {
  return new Promise((res, rej) => {
    try {
      const strArgs = args.command.join(' ');
      log.info(`${filepath}: Running [${strArgs}]`);

      const [procName, ...procArgs] = args.command;

      const curProc = spawn(procName, procArgs);

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
  };

  if (file.output_path) {
    const pathObj = parsePath(filepath, file.input_path);
    const outputPath = normalizePath(file.makeOutputPath(pathObj));

    newFile.outputPath = outputPath;
    newFile.outputDir = path.dirname(outputPath);
  }

  newFile.render = throttle(renderFile, 1, ENV.RENDER_FILE_DELAY).bind(newFile);

  return newFile;
}

async function renderFile(args) {
  const {
    otherDataSources,
    cacheMaps,
    configItem,
    changedObject,
  } = args;

  const execArgs = [];

  cacheMaps.datasources.forEach(({ filepath, outputAlias, file }) => {
    let val = filepath;

    if (outputAlias) {
      val = `${outputAlias}=${val}`;
    }

    execArgs.push('-d', val);

    if (file.args) {
      file.args.forEach(v => {
        execArgs.push(v);
      })
    }
  });

  otherDataSources.forEach(({ url, alias, file }) => {
    let val = url;

    if (alias) {
      val = `${alias}=${val}`;
    }

    execArgs.push('-d', val);

    if (file.args) {
      file.args.forEach(v => {
        execArgs.push(v);
      })
    }
  });

  cacheMaps.templates.forEach(({ filepath, file }) => {
    execArgs.push('-t', filepath);

    if (file.args) {
      file.args.forEach(v => {
        execArgs.push(v);
      })
    }
  });

  cacheMaps.dependencies.forEach(({ file }) => {
    if (file.args) {
      file.args.forEach(v => {
        execArgs.push(v);
      })
    }
  });

  execArgs.push('-f', this.filepath);

  if (this.outputPath) {
    execArgs.push('-o', this.outputPath);
    await fs.ensureDir(this.outputDir);
  }

  if (configItem.args) {
    configItem.args.forEach(v => {
      execArgs.push(v);
    })
  }


  try {
    const { stderr } = await execFileAsync(ENV.GOMPLATE_BIN_PATH, execArgs);

    if (stderr) {
      throw new Error(stderr);
    }
  } catch (err) {
    err.path = this.filepath;

    throw err;
  }

  log.info({ input_path: this.filepath, output_path: this.outputPath, message: 'Template rendered' });

  const spawnArr = [];

  if (this.on_change) {
    spawnArr.push(this);
  }

  if (configItem.on_change && changedObject === this) {
    spawnArr.push({ on_change: configItem.on_change });
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

    if (changedObject && changedObject.file.on_change) {
      spawnArr.push({
        on_change: changedObject.file.on_change,
        filepath: changedObject.filepath,
      });
    }

    if (configItem.on_change) {
      spawnArr.push({ on_change: configItem.on_change });
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
