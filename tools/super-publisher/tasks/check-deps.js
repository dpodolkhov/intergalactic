const { get } = require('axios');
const { satisfies, diff, coerce, parse, gt, minVersion } = require('semver');
const inquirer = require('inquirer');
const path = require('path');
const task = require('../task');

const registryUrl = 'https://registry.npmjs.org/';

async function fetchNpm(packageName) {
  try {
    const { data } = await get(registryUrl + packageName);
    return data;
  } catch (e) {
    console.error(`${packageName}: ${e.message}`);
  }
}

/**
 * Check if current version satisfies one of the published versions by semVer
 * @param current {String}
 * @param published {String[]}
 * @returns boolean
 */
function isValidRange(current, published) {
  return published.map((version) => satisfies(version, current)).includes(true);
}

module.exports = task('Dependency check', async (opt) => {
  // opt.progress('processing...');
  if (!opt.checkDeps) {
    opt.skip();
    return opt;
  }

  const { dependencies, name } = require(path.resolve(opt.root, 'package.json'));

  // if (name !== '@semcore/utils') {
  //   if (!dependencies['@semcore/utils']) {
  //     opt.warn(`[@semcore/utils] NOT FOUND`);
  //     process.exit(1);
  //   } else if (gt('3.15.0', minVersion(dependencies['@semcore/utils']))) {
  //     opt.warn(`[@semcore/utils] >= 3.15.0`);
  //     process.exit(1);
  //   }
  // }

  const warnings = await Promise.all(
    Object.keys(dependencies).map(async (name) => {
      const selfVersion = dependencies[name];
      const depNpm = await fetchNpm(name);
      const isPublished = isValidRange(selfVersion, Object.keys(depNpm.versions));
      if (isPublished) {
        const diffRelease = diff(depNpm['dist-tags'].latest, coerce(selfVersion));
        if (diffRelease === null || diffRelease === 'patch' || diffRelease === 'prepatch') {
          // opt.log(`[${name}] has valid range.`);
          return false;
        } else {
          const parseVersion = parse(depNpm['dist-tags'].latest);
          opt.log(
            `[${name}] THERE IS A NEWER VERSION (${selfVersion} -> ^${parseVersion.major}.${parseVersion.minor})`,
          );
          return false;
        }
      } else {
        opt.warn(`[${name}] HAS NO PUBLISHED VERSIONS TO SATISFY ${selfVersion}`);
        process.exit(1);
      }
    }),
  );

  if (warnings.filter(Boolean).length) {
    const { nextPublish } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'nextPublish',
        message: 'Would you like to next publish?',
        default: false,
      },
    ]);

    if (!nextPublish) {
      process.exit(1);
    }
  }

  return opt;
});
