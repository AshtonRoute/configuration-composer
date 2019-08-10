const anymatch = require('anymatch').default;
const chokidar = require('chokidar');
const debounce = require('p-debounce');

const ENV = require('./environment').default;
const { getConfig, parseConfig } = require('./config');
const { renderFiles, createFileObj } = require('./render');
const log = require('./logger').default;
const { parsePath } = require('./utils');

const eventsSet = new Set([
  'add',
  'change',
]);

function watchFiles(args) {
  const {
    paths,
    options = {},
    cacheMap,
    createCacheEntry,
    onError,
    onEvent,
  } = args;

  return new Promise((res, rej) => {
    try {
      if (!paths || !paths.length) {
        res();
        return;
      }

      const watcher = chokidar.watch(paths, {
        alwaysStat: true,
        awaitWriteFinish: {
          stabilityThreshold: ENV.AWAIT_FILE_WRITE_BEFORE_RENDER,
          pollInterval: ENV.AWAIT_FILE_WRITE_POLL_INTERVAL,
        },
        ...options,
      });

      watcher.on('error', err => onError(err));

      watcher.on('ready', () => {
        try {
          const watchedPaths = watcher.getWatched();

          res({
            watcher,
            watchedPaths,
          });
        } catch (err) {
          rej(err);
        }
      });

      watcher.on('all', async (event, filepath, stats) => {
        try {
          if (!stats) return;

          let cachedObject = null;

          if (cacheMap && !stats.isDirectory()) {
            cachedObject = cacheMap.get(filepath);

            if (event === 'add' || event === 'change') {
              if (!cachedObject) {
                cachedObject = createCacheEntry(filepath, stats);

                if (cachedObject) {
                  cacheMap.set(filepath, cachedObject);
                }
              }
            } else if (event === 'unlink') {
              cachedObject = null;
              cacheMap.delete(filepath);
            }
          }

          if (onEvent) {
            await onEvent({
              event,
              filepath,
              stats,
              cachedObject,
              watcher,
            });
          }
        } catch (err) {
          err.path = filepath;

          onError(err);
        }
      });
    } catch (err) {
      rej(err);
    }
  });
}

const renderFilesDebounced = debounce(renderFiles, ENV.DEPENDENCIES_RENDER_DELAY);

async function main() {
  const { config, configDeps } = await getConfig();

  log.debug(config);

  const configItems = parseConfig(config);

  const shouldWatch = configItems.some(v => v.watch);
  const watchItems = [];

  function onError(err) {
    log.error(err);

    if (!shouldWatch) {
      process.exit(1);
    }
  }

  if (shouldWatch && configDeps.length) {
    await watchFiles({
      paths: configDeps,
      onError,
      onEvent: ({ event, watcher }) => {
        if (event !== 'change') return;

        log.info(`Config changed. Reloading...`);

        watchItems.forEach(v => {
          v.close();
        });

        watcher.close();

        Object.keys(require.cache).forEach(k => {
          delete require.cache[k];
        });

        main().catch(log.error);
      },
    });
  }

  log.info(`Initializing (watch=${shouldWatch})...`);

  await Promise.all(configItems.map(async (confItem) => {
    const {
      watch,
      custom,
      dependencies,
      fileDataSources,
      otherDataSources,
      templates,
      files,
    } = confItem;

    const cacheMaps = {
      dependencies: new Map(),
      datasources: new Map(),
      templates: new Map(),
      files: new Map(),
    };

    let srcInit = false;

    const watchDepItems = await Promise.all(
      [
        {
          paths: custom.map(v => v.path),
          onEvent: async ({ event, filepath }) => {
            if (!eventsSet.has(event)) return;

            delete require.cache[filepath];
            const curModule = require(filepath).default;

            const newEnv = curModule(confItem.env);
            if (newEnv != null) {
              confItem.env = newEnv;
            }

            if (!srcInit) return;

            await renderFilesDebounced({
              otherDataSources,
              cacheMaps,
              configItem: confItem,
            });
          },
        },

        {
          paths: fileDataSources.map(v => v.path),
          cacheMap: cacheMaps.datasources,
          createCacheEntry: (filepath) => {
            const f = fileDataSources.find(v => v.path === filepath || anymatch(v.path, filepath));
            if (!f) return null;

            const pathObject = parsePath(filepath, f.path);

            return {
              filepath,
              file: f,
              outputAlias: f.makeAlias(pathObject),
              pathObject,
            };
          },
        },

        {
          paths: templates.map(v => v.path),
          cacheMap: cacheMaps.templates,
          createCacheEntry: (filepath) => {
            const f = templates.find(v => v.path === filepath || anymatch(v.path, filepath));
            if (!f) return null;

            return {
              filepath,
              file: f,
            };
          },
        },

        {
          paths: dependencies.map(v => v.path),
          cacheMap: cacheMaps.dependencies,
          createCacheEntry: (filepath) => {
            const f = dependencies.find(v => v.path === filepath || anymatch(v.path, filepath));
            if (!f) return null;

            return {
              filepath,
              file: f,
            };
          },
        },
      ].map((args) => {
        return watchFiles({
          onError,
          onEvent: async ({ event, cachedObject }) => {
            if (!srcInit || !eventsSet.has(event)) return;

            await renderFilesDebounced({
              otherDataSources,
              cacheMaps,
              configItem: confItem,
              changedObject: cachedObject,
            });
          },
          ...args,
        });
      })
    ).then(arr => arr.filter(v => v));

    if (watch) {
      watchDepItems.forEach(({ watcher }) => {
        watchItems.push(watcher);
      });
    }

    srcInit = true;

    const watchFilesItem = await watchFiles({
      paths: files.map(v => v.input_path),
      cacheMap: cacheMaps.files,
      createCacheEntry: (filepath) => {
        const f = files.find(v => v.input_path === filepath || anymatch(v.input_path, filepath));
        if (!f) return null;

        return createFileObj(filepath, f);
      },
      onError,
      onEvent: async ({ event, stats, cachedObject }) => {
        if (stats.isDirectory()) return;

        if (!cachedObject || !eventsSet.has(event)) return;

        await cachedObject.render({
          otherDataSources,
          cacheMaps,
          configItem: confItem,
          changedObject: cachedObject,
        });
      },
    });

    if (watch) {
      if (watchFilesItem) {
        watchItems.push(watchFilesItem.watcher);
      }
    } else {
      [
        ...watchDepItems,
        watchFilesItem,
      ].filter(v => v)
        .forEach(({ watcher }) => {
          watcher.close();
        });
    }
  }));

  log.info('Ready');
}

main().catch(log.error);
