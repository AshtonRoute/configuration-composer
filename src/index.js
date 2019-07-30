const anymatch = require('anymatch').default;
const chokidar = require('chokidar');
const throttle = require('p-throttle');

const { getConfig, parseConfig } = require('./config');
const { renderFiles, createFileObj } = require ('./render');
const log = require('./logger').default;
const { parsePath } = require('./utils');
const ENV = require('./environment').default;

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
    onEvent,
  } = args;

  return new Promise((res, rej) => {
      try {
        const watcher = chokidar.watch(paths, {
          alwaysStat: true,
          ...options,
        });

        watcher.on('error', log.error);

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
            log.error({ path: filepath }, err);
          }
        });
      } catch (err) {
        rej(err);
      }
  });
}

const renderFilesThrottled = throttle(renderFiles, 1, 1000);

async function main() {
  const confPath = ENV.CONFIG_PATH;
  const conf = await getConfig(confPath);
  const configItems = parseConfig(conf);

  const shouldWatch = configItems.some(v => v.watch);
  const watchItems = [];

  if (shouldWatch) {
    await watchFiles({
      paths: [confPath],
      options: {
        awaitWriteFinish: true,
      },
      onEvent: ({ event, watcher, filepath }) => {
        if (event === 'unlink') {
          log.error(`Config file has been removed. ${filepath}`);

          process.exit(1);
          return;
        }

        if (event !== 'change') return;

        log.info(`Config changed. Reloading...`);

        watchItems.forEach(v => {
          v.close();
        });

        watcher.close();
        main().catch(log.error);
      },
    });
  }

  log.info(`Initializing (watch=${shouldWatch})...`);

  await Promise.all(configItems.map(async (confItem) => {
    const {
      watch,
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
          paths: fileDataSources.map(v => v.path),
          cacheMap: cacheMaps.datasources,
          createCacheEntry: (filepath) => {
            const f = fileDataSources.find(v => v.path === filepath || anymatch(v.path, filepath));
            if (!f) return null;

            const pathObj = parsePath(filepath, f.path);

            return {
              filepath,
              file: f,
              outputAlias: f.makeAlias(pathObj),
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
          ...args,
          onEvent: async ({ event, cachedObject }) => {
            if (!srcInit || !eventsSet.has(event)) return;

            await renderFilesThrottled({
              otherDataSources,
              cacheMaps,
              configItem: confItem,
              changedObject: cachedObject,
            });
          },
        });
      })
    );

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
      watchItems.push(watchFilesItem.watcher);
    } else {
      [
        ...watchDepItems,
        watchFilesItem,
      ].forEach(({ watcher }) => {
        watcher.close();
      });
    }
  }));

  log.info('Ready');
}

main().catch(log.error);
