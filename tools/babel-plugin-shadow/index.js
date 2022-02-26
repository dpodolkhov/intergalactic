const fs = require('fs');
const path = require('path');
const t = require('@babel/types');
const template = require('@babel/template').default;
const syntaxJsx = require('@babel/plugin-syntax-jsx').default;
const { addDefault } = require('@babel/helper-module-imports');
const { stripIndent } = require('common-tags');
const stringHash = require('string-hash');

const postCssPluginInlineComment = require('postcss-inline-comment');

const utils = require('@reshadow/utils');
const { KEYS } = require('@reshadow/core');

const PLACEHOLDER_REPLACE = '_gg_';

const buildClassName = template.expression(`
    NAME.${KEYS.__styles__}["ELEMENT"]
`);

const projectRoot = path.resolve(__dirname, '../..');
const makeStringHash = (str) => stringHash(str.replaceAll(projectRoot, '<rootDir>'));

const toObjectExpression = (obj) =>
  t.objectExpression(
    Object.entries(obj).map(([key, value]) =>
      t.objectProperty(
        t.stringLiteral(key),
        t.templateLiteral(
          [
            t.templateElement({
              raw: value,
              cooked: value,
            }),
          ],
          [],
        ),
      ),
    ),
  );

/**
 * Basic React.Fragment check
 * We can improve it by checking import aliases if needs
 */
const isReactFragment = (node) => {
  if (!node) return false;

  if (t.isJSXFragment(node)) return true;

  const [element] = node.arguments || [];

  if (t.isIdentifier(element)) return element.name === 'Fragment';

  if (t.isMemberExpression(element)) {
    return element.object.name === 'React' && element.property.name === 'Fragment';
  }

  return false;
};

const version = require(path.join(process.cwd(), 'package.json')).version;
const defaultOptions = {
  elementFallback: true,
  stringStyle: false,
  files: /\.shadow\.css$/,
  processFiles: true,
  source: '@semcore/core',
  postcss: {
    generateScopedName: function generateScopedName(name, filename, css) {
      const i = css.indexOf(`.${name}`);
      const lineNumber = css.substr(0, i).split(/[\r\n]/).length;
      const hash = makeStringHash(css + version + filename + lineNumber)
        .toString(36)
        .substring(0, 5);

      return `_${name}_${hash}${PLACEHOLDER_REPLACE}`;
    },
    options: {
      presetEnv: {
        stage: 0,
        browsers: 'defaults',
        features: {
          'custom-properties': {
            preserve: false,
          },
          'custom-media-queries': {
            preserve: false,
          },
          'color-mod-function': {
            unresolved: 'error',
          },
        },
      },
    },
    plugins: [postCssPluginInlineComment()],
  },
};

const getIsInsideComment = (isInsideComment, lastString) => {
  /**
   * if we were inside a comment check if comment ended
   */
  if (isInsideComment) return !lastString.includes('*/');

  /**
   * if we were outside a comment check if comment started
   */

  // there can be multiple comments in a single quasi
  const lastCommentOpenning = lastString.lastIndexOf('/*');
  const lastCommentClosing = lastString.lastIndexOf('*/');

  return lastCommentOpenning > lastCommentClosing;
};

const PROJECT_ROOT = path.resolve(__dirname, '../..');

module.exports = (babel, pluginOptions = {}) => {
  const options = Object.assign({}, defaultOptions, pluginOptions);

  const classProp = options.classProp || KEYS.__classProp__;

  let moduleName = '@reshadow/core';

  /* ADD MY CODE */
  if (options.source) {
    moduleName = options.source;
  }
  /* ADD MY CODE */

  let STYLED = new Set();
  let IGNORE_TAGS = new Set();
  let BINDINGS = {};
  let imports = {};
  let IMPORT = null;
  let cache = new Set();
  let FILE = null;
  let FILENAME_HASH = '';

  let filename;

  let postcss;
  let cssFileRe = null;

  let index;
  const hashById = (id) => Math.round(id * 100).toString(16);
  const getHash = () => hashById(++index);

  const pre = (file) => {
    ({ filename } = file.opts);

    FILENAME_HASH = makeStringHash(filename || '').toString(36);
    FILE = file;
    index = 1;
    STYLED = new Set();
    IGNORE_TAGS = new Set();
    imports = {};
    IMPORT = null;
    cache = new Set();
    BINDINGS = file.scope.bindings;
  };

  const addImport = (name) => {
    if (!IMPORT) {
      addDefault(FILE.path, moduleName, {
        nameHint: 'styled',
      });

      [{ node: IMPORT }] = FILE.path.get('body').filter((p) => {
        const { node } = p;
        return t.isImportDeclaration(node) && node.source.value === moduleName;
      });
    }

    if (imports[name]) return imports[name];

    let localName;

    if (name === 'default') {
      localName = 'styled' in BINDINGS ? '_styled' : 'styled';

      IMPORT.specifiers.push(t.importDefaultSpecifier(t.identifier(localName)));
    } else {
      localName = name in BINDINGS ? `_${name}` : name;

      IMPORT.specifiers.push(t.importSpecifier(t.identifier(localName), t.identifier(name)));
    }

    imports[name] = localName;

    return localName;
  };

  const createCSSVarIndexer = () => {
    const map = {};

    const getIndex = (node, i) => {
      if (!t.isIdentifier(node)) return i;

      const { name } = node;
      if (name in map) return map[name];
      return (map[name] = i);
    };

    return getIndex;
  };

  const getCSSVarName = (index) => `--${FILENAME_HASH}_${index}`;

  const appendCode = ({ quasi, name, hash }) => {
    const { expressions, quasis } = quasi;
    let code = '';

    const getIndex = createCSSVarIndexer();

    let isInsideComment = false;
    quasis.forEach(({ value }, i) => {
      code += value.raw;

      isInsideComment = getIsInsideComment(isInsideComment, value.raw);

      const node = expressions[i];
      if (node) {
        if (isInsideComment) {
          code += `\${${t.isIdentifier(node) ? node.name : 'someVar'}}`;
        } else {
          const index = getIndex(node, i);
          code += `var(${getCSSVarName(index)})`;
        }
      }
    });

    code = stripIndent(code);

    const append = t.taggedTemplateExpression(
      t.identifier(addImport('css')),
      t.templateLiteral(
        [
          t.templateElement({
            raw: code,
            cooked: code,
          }),
        ],
        [],
      ),
    );

    return append;
  };

  const prepareExpressions = ({ expressions, quasis }, hash) => {
    const getIndex = createCSSVarIndexer();

    const filterUniqueIdentifiers = () => {
      const unique = [];
      return (node) => {
        const { name, type } = node;
        if (type !== 'Identifier' || unique.find((i) => i === name)) return;
        unique.push(name);
        return node;
      };
    };

    if (options.stringStyle) {
      let isInsideComment = false;
      return t.templateLiteral(
        expressions
          .reduce((acc, x, i) => {
            const index = getIndex(x, i);

            if (index !== i) return acc;

            isInsideComment = getIsInsideComment(isInsideComment, quasis[i].value.raw);

            if (isInsideComment) return acc;

            const value = (i > 0 ? ';' : '') + getCSSVarName(index) + ':';

            return acc.concat(
              t.templateElement({
                raw: value,
                cooked: value,
              }),
            );
          }, [])
          .concat(
            t.templateElement(
              {
                raw: ';',
                cooked: ';',
              },
              true,
            ),
          ),
        /*
         * We should filter unique identifiers, because of babel check number of quasis/idetifiers passed
         * to templateLiteral builder since 7.6.3
         * https://github.com/babel/babel/issues/10486
         * Reshadow now uses babel 7.5.5
         */
        expressions.filter(filterUniqueIdentifiers()),
      );
    }

    let isInsideComment = false;

    return t.objectExpression(
      expressions.reduce((acc, x, i) => {
        const index = getIndex(x, i);

        if (index !== i) return acc;

        /**
         * similar to appendCode
         * an attempt to avoid creation of redundant css custom properties
         * for commented template placeholder expressions
         */
        isInsideComment = getIsInsideComment(isInsideComment, quasis[i].value.raw);

        if (isInsideComment) return acc;

        return acc.concat(t.objectProperty(t.stringLiteral(getCSSVarName(index)), x));
      }, []),
    );
  };

  const traverseStyled = (p, { quasi } = {}) => {
    const { callee } = p.node;
    const { name } = callee.callee || callee;

    const hash = getHash();
    const hashName = `${name}_${hash}`;

    const globalStyles = [];
    const localStyles = [t.identifier(hashName)];

    for (const arg of callee.arguments || []) {
      if (!t.isIdentifier(arg)) {
        localStyles.push(arg);
        continue;
      }

      (arg.name in BINDINGS ? globalStyles : localStyles).push(arg);
    }

    p.node.callee = t.identifier(name);

    const variables = quasi && quasi.expressions.length && prepareExpressions(quasi, hash);

    const [jsxNode] = p.node.arguments;

    const setCall = t.callExpression(t.identifier(addImport('set')), [
      t.arrayExpression(localStyles),
    ]);

    if (variables) {
      setCall.arguments.push(variables);
    }

    const stylesSet = t.sequenceExpression([setCall, jsxNode]);

    p.node.arguments = [stylesSet];

    let path = p;

    while (path.parentPath.type !== 'Program') {
      path = path.parentPath;
    }

    path.insertBefore(
      t.variableDeclaration('const', [
        t.variableDeclarator(
          t.identifier(hashName),
          t.callExpression(t.identifier(addImport('create')), [
            t.arrayExpression(globalStyles.concat(quasi ? appendCode({ quasi, name, hash }) : [])),
          ]),
        ),
      ]),
    );

    const getElementName = (node) => {
      if (t.isJSXNamespacedName(node))
        return [getElementName(node.namespace), getElementName(node.name)].join(':');

      if (t.isJSXIdentifier(node)) return node.name;

      if (t.isJSXMemberExpression(node)) {
        return [getElementName(node.object), getElementName(node.property)].join('.');
      }
    };

    let depth = 0;

    const elementMap = new Map();
    const roots = new Set();

    p.traverse({
      ...visitor,
      JSXElement(elementPath) {
        const { node } = elementPath;

        if (isReactFragment(node) || cache.has(node)) return;

        cache.add(node);

        if (variables && depth === 0) {
          for (const x of elementPath.container) {
            if (!t.isJSXElement(x)) continue;

            roots.add(x);
          }
        }

        depth++;

        const __style__ = roots.has(node)
          ? t.memberExpression(t.identifier(name), t.identifier(KEYS.__style__))
          : null;

        const { openingElement, closingElement } = node;

        let elementName = getElementName(openingElement.name);

        elementName = elementName.replace(/^use\./, 'use:');

        let isElement = true;

        if (elementName.startsWith('use:')) {
          elementName = elementName.replace('use:', 'use--');
          openingElement.name = t.JSXIdentifier('div');
        } else if (
          utils.isCustomElement(elementName) &&
          !(options.filterElement && options.filterElement(elementName))
        ) {
          if (options.elementFallback) {
            openingElement.name = t.JSXIdentifier(
              typeof options.elementFallback === 'boolean' ? 'div' : options.elementFallback,
            );
          }
        } else if (!/[^A-Z]\w+/.test(elementName)) {
          isElement = false;
        }

        elementMap.set(elementPath, { elementName });

        const spreads = [];
        const filtered = [];

        let props = [];
        const uses = [];

        const getProp = (name, valueNode) => {
          const key = /^[$0-9a-z_]+$/i.test(name) ? t.identifier(name) : t.stringLiteral(name);

          const value = t.isJSXExpressionContainer(valueNode) ? valueNode.expression : valueNode;

          return t.objectProperty(key, value || t.booleanLiteral(true));
        };

        if (openingElement.attributes.length > 0) {
          const indexesToRemove = [];
          let useAttr = null;

          openingElement.attributes.forEach((attr, i) => {
            if (t.isJSXSpreadAttribute(attr)) {
              if (t.isCallExpression(attr.argument) && attr.argument.callee.name === 'use') {
                indexesToRemove.push(i);
                useAttr = attr;
              } else {
                if (props.length) {
                  spreads.push(t.objectExpression(props));
                  props = [];
                }

                spreads.push(attr.argument);
              }

              return;
            }

            if (isElement && t.isJSXIdentifier(attr.name) && attr.name.name === 'as') {
              indexesToRemove.push(i);
              openingElement.name.name = attr.value.value;
            } else if (t.isJSXNamespacedName(attr.name) && attr.name.namespace.name === 'use') {
              indexesToRemove.push(i);
              const name = attr.name.name.name;

              uses.push(getProp(name, attr.value));
            } else {
              const name = getElementName(attr.name);

              if (options.filterProp && options.filterProp(name)) {
                filtered.push(attr);
              } else {
                props.push(getProp(name, attr.value));
              }
            }
          });

          if (props.length > 0) {
            spreads.push(t.objectExpression(props));
          }

          if (useAttr || uses.length > 0) {
            if (!useAttr) {
              const USE = addImport('use');

              useAttr = t.JSXSpreadAttribute(
                t.callExpression(t.identifier(USE), [t.objectExpression([])]),
              );
            }

            useAttr.argument.arguments[0].properties.push(...uses);

            spreads.push(useAttr.argument);
          }
        }

        if (spreads.length > 0) {
          if (__style__) {
            props.push(getProp(KEYS.__style__, __style__));
            if (props.length === 1) {
              spreads.push(t.objectExpression(props));
            }
          }

          openingElement.attributes = [
            t.JSXSpreadAttribute(
              t.callExpression(t.identifier(addImport('map')), [
                t.stringLiteral(elementName),
                ...spreads,
              ]),
            ),
          ];
        } else {
          openingElement.attributes = [
            t.JSXAttribute(
              t.JSXIdentifier(classProp),
              t.JSXExpressionContainer(
                buildClassName({
                  NAME: name,
                  ELEMENT: t.stringLiteral(`__${elementName}`),
                }),
              ),
            ),
          ];

          if (__style__) {
            openingElement.attributes.push(
              t.jSXAttribute(t.JSXIdentifier('style'), t.JSXExpressionContainer(__style__)),
            );
          }
        }

        openingElement.attributes.push(...filtered);

        if (closingElement) {
          closingElement.name = openingElement.name;
        }
      },
    });
  };

  const traverseTaggedTemplate = (p) => {
    const { callee } = p.node;

    const { tag, quasi } = callee;

    if (!(isStyledExpression(tag) || STYLED.has(tag.name))) return;

    p.node.callee = tag;

    return traverseStyled(p, { quasi });
  };

  const isStyledExpression = (node) => {
    if (t.isCallExpression(node)) return STYLED.has(node.callee.name);

    return false;
  };

  /**
   * Adds a comment which is very useful to extract CSS in the bundler without
   * parsing the code back into AST.
   */
  const wrapBundlerComments = (node) => {
    t.addComment(node, 'leading', `__reshadow_css_start__`);
    t.addComment(node, 'trailing', `__reshadow_css_end__`);

    t.addComment(node.arguments[0], 'leading', `__inner_css_start__`);
    t.addComment(node.arguments[0], 'trailing', `__inner_css_end__`);
  };

  const createMediaStylesCall = (styles, hash) => {
    const cssCallExpression = t.callExpression(t.identifier(addImport('__css__')), [
      t.templateLiteral([t.templateElement({ raw: styles, cooked: styles })], []),
      t.stringLiteral(hash + PLACEHOLDER_REPLACE),
    ]);

    wrapBundlerComments(cssCallExpression);

    return t.ifStatement(
      t.booleanLiteral(false),
      t.blockStatement([t.expressionStatement(cssCallExpression)]),
    );
  };

  const visited = new WeakSet();

  const visitor = {
    CallExpression(p) {
      if (STYLED.size === 0) return;

      if (visited.has(p.node)) return;

      visited.add(p.node);

      const { callee } = p.node;

      if (t.isTaggedTemplateExpression(callee)) {
        traverseTaggedTemplate(p);
        return;
      }

      if (isStyledExpression(callee)) {
        traverseStyled(p);
        return;
      }

      if (isStyledExpression(p.node)) {
        p.replaceWith(
          t.CallExpression(p.node, [t.CallExpression(t.identifier(addImport('__extract__')), [])]),
        );
      }
    },

    TaggedTemplateExpression(p) {
      let { node } = p;
      const { quasi, tag } = node;

      const isIgnored = IGNORE_TAGS.has(node);

      if (isStyledExpression(tag) || (tag.name && tag.name === imports.default)) {
        p.replaceWith(
          t.CallExpression(p.node, [t.CallExpression(t.identifier(addImport('__extract__')), [])]),
        );
        return;
      }

      if (!imports.css || tag.name !== imports.css) {
        return;
      }

      const { raw } = quasi.quasis[0].value;

      const hash = makeStringHash(raw).toString(36);

      // addTrailingBundlerComment(quasi);

      p.replaceWith(
        t.callExpression(t.identifier(addImport('__css__')), [
          quasi,
          t.stringLiteral(hash + PLACEHOLDER_REPLACE),
        ]),
      );

      ({ node } = p);

      if (!postcss) {
        wrapBundlerComments(node);
        return;
      }

      let result;

      if (isIgnored) {
        result = { code: raw, tokens: {} };
      } else {
        result = postcss.process(raw, { from: filename });
      }

      const code = result.code;
      const media = result.media;
      const tokens = toObjectExpression(result.tokens);
      const processedStylesHash = makeStringHash(code).toString(36);

      /* Replace hash of unprocessed styles with hash of processed styles
         Required to prevent possible collisions between versions with same styles,
         because processed styles alredy have hashes from content + version */
      p.node.arguments[1] = t.stringLiteral(processedStylesHash + PLACEHOLDER_REPLACE);

      if (media) {
        const mediaHash = makeStringHash(media).toString(36);
        const mediaStylesNode = createMediaStylesCall(media, mediaHash);
        p.findParent((path) => {
          if (!t.isVariableDeclaration(path)) return;
          if (!path.node.leadingComments) return;
          if (path.node.leadingComments.length < 1) return;
          if (!path.node.leadingComments[0].value.includes('__reshadow-styles__:')) return;
          path.insertAfter(mediaStylesNode);
        });
      }

      const templateLiteral = t.templateLiteral(
        [
          t.templateElement({
            raw: code,
            cooked: code,
          }),
        ],
        [],
      );
      // addTrailingBundlerComment(templateLiteral);
      node.arguments[0] = templateLiteral;

      p.replaceWith(t.sequenceExpression([node, tokens]));

      wrapBundlerComments(node);
    },
  };

  return {
    pre,
    name: 'babel-plugin-reshadow',
    inherits: syntaxJsx,
    visitor: {
      Program: {
        enter(path, state) {
          // babel 6 compatibility
          Object.assign(options, state.opts);

          if (options.postcss && !postcss) {
            postcss = require('./postcss')(options.postcss);
          }
          if (options.files && !cssFileRe) {
            cssFileRe = new RegExp(options.files);
          }

          pre(state.file);
        },
      },
      ImportDeclaration(p) {
        const { source, specifiers } = p.node;

        if (cssFileRe && cssFileRe.test(source.value)) {
          const file = utils.resolveDependency({
            filename: source.value,
            basedir: path.dirname(filename),
          });

          const code = fs
            .readFileSync(file)
            .toString()
            // escape backticks and backslashes
            .replace(/[`\\]/g, '\\$&');

          const append = t.taggedTemplateExpression(
            t.identifier(addImport('css')),
            t.templateLiteral(
              [
                t.templateElement({
                  raw: code,
                  cooked: code,
                }),
              ],
              [],
            ),
          );

          if (!options.processFiles) {
            IGNORE_TAGS.add(append);
          }

          p.replaceWith(
            t.variableDeclaration('const', [
              t.variableDeclarator(
                t.objectPattern(
                  specifiers.map((spec) => {
                    if (t.isImportDefaultSpecifier(spec))
                      return t.restElement(t.identifier(spec.local.name));

                    return t.objectProperty(
                      t.identifier(spec.imported.name),
                      t.identifier(spec.local.name),
                      false,
                      spec.imported.name === spec.local.name,
                    );
                  }),
                ),
                append,
              ),
            ]),
          );

          p.addComment('leading', `__reshadow-styles__:"${source.value}"`);

          return;
        }

        const SOURCE = options.source || 'reshadow';

        if (source.value !== SOURCE) return;

        if (source.value !== moduleName) {
          source.value = moduleName;
        }
        IMPORT = p.node;

        for (const spec of specifiers) {
          // ADD MY CODE
          if (t.isImportSpecifier(spec)) {
            if (spec.local.name === 'styled') {
              const name = spec.local.name;
              STYLED.add(name);
              imports.default = name;
            } else {
              if (spec.imported.name === 'css') {
                imports.css = spec.local.name;
              } else if (spec.imported.name === 'use') {
                imports.use = spec.local.name;
              }
            }
          }
        }
      },
      ...visitor,
    },
  };
};

module.exports.defaultOptions = defaultOptions;
