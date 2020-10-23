import * as path from 'path';
import * as fs from 'fs-extra';
import { Component } from './component';
import { Eslint } from './eslint';
import { Jest, JestOptions } from './jest';
import { JsonFile } from './json';
import { NodeProject, NodeProjectOptions } from './node-project';
import { Semver } from './semver';
import { StartEntryCategory } from './start';
import { TypedocDocgen } from './typescript-typedoc';

export interface TypeScriptProjectOptions extends NodeProjectOptions {
  /**
   * Setup jest unit tests
   * @default true
   */
  readonly jest?: boolean;

  /**
   * Jest options
   * @default - default options
   */
  readonly jestOptions?: JestOptions;

  /**
   *
   * Setup eslint.
   * @default true
   */
  readonly eslint?: boolean;

  /**
   * TypeScript version to use.
   * @default ^3.9.5
   */
  readonly typescriptVersion?: Semver;

  /**
   * Docgen by Typedoc
   *
   * @default false
   */
  readonly docgen?: boolean;

  /**
   * Docs directory
   *
   * @default 'docs'
   */
  readonly docsDirectory?: string;

  /**
   * Custom TSConfig
   *
   */
  readonly tsconfig?: TypescriptConfigOptions;

  /**
   * Do not generate a `tsconfig.json` file (used by jsii projects since
   * tsconfig.json is generated by the jsii compiler).
   *
   * @default false
   */
  readonly disableTsconfig?: boolean;

  /**
   * Compile the code before running tests.
   *
   * @default - the default behavior is to delete the lib/ directory and run
   * jest typescript tests and only if all tests pass, run the compiler.
   */
  readonly compileBeforeTest?: boolean;

  /**
   * Generate one-time sample in `src/` and `test/` if there are no files there.
   * @default true
   */
  readonly sampleCode?: boolean;

  /**
   * The .d.ts file that includes the type declarations for this module.
   * @default - .d.ts file derived from the project's entrypoint (usually lib/index.d.ts)
   */
  readonly entrypointTypes?: string;

  /**
   * Defines a `yarn package` command that will produce a tarball and place it
   * under `dist/js`.
   *
   * @default true
   */
  readonly package?: boolean;
}

/**
 * TypeScript project
 * @pjid typescript
 */
export class TypeScriptProject extends NodeProject {
  public readonly docgen?: boolean;
  public readonly docsDirectory: string;
  public readonly eslint?: Eslint;
  public readonly jest?: Jest;
  public readonly tsconfig?: TypescriptConfig;

  /**
   * The directory in which the .ts sources reside.
   */
  public readonly srcdir: string;

  /**
   * The directory in which compiled .js files reside.
   */
  public readonly libdir: string;

  /**
   * The directory in which .ts tests reside.
   */
  public readonly testdir: string;

  constructor(options: TypeScriptProjectOptions) {
    super(options);

    this.srcdir = options.srcdir ?? 'src';
    this.libdir = options.libdir ?? 'lib';
    this.testdir = options.testdir ?? 'test';

    this.docgen = options.docgen;
    this.docsDirectory = options.docsDirectory ?? 'docs/';

    this.addCompileCommand('tsc');
    this.start?.addEntry('compile', {
      desc: 'Only compile',
      category: StartEntryCategory.BUILD,
    });

    this.addScript('watch', 'tsc -w');
    this.start?.addEntry('watch', {
      desc: 'Watch & compile in the background',
      category: StartEntryCategory.BUILD,
    });

    // by default, we first run tests (jest compiles the typescript in the background) and only then we compile.
    const compileBeforeTest = options.compileBeforeTest ?? false;

    if (compileBeforeTest) {
      this.addBuildCommand(`${this.runScriptCommand} compile`, `${this.runScriptCommand} test`);
    } else {
      this.addBuildCommand(`${this.runScriptCommand} test`, `${this.runScriptCommand} compile`);
    }
    this.start?.addEntry('build', {
      desc: 'Full release build (test+compile)',
      category: StartEntryCategory.BUILD,
    });

    if (options.package ?? true) {
      this.addScript('package',
        'rm -fr dist',
        'mkdir -p dist/js',
        `${this.packageManager} pack`,
        'mv *.tgz dist/js/',
      );

      this.addBuildCommand(`${this.runScriptCommand} package`);

      this.start?.addEntry('package', {
        desc: 'Create an npm tarball',
        category: StartEntryCategory.RELEASE,
      });
    }

    if (options.entrypointTypes || this.entrypoint !== '') {
      this.manifest.types = options.entrypointTypes ?? `${path.join(path.dirname(this.entrypoint), path.basename(this.entrypoint, '.js')).replace(/\\/g, '/')}.d.ts`;
    }

    const compilerOptions = {
      alwaysStrict: true,
      declaration: true,
      experimentalDecorators: true,
      inlineSourceMap: true,
      inlineSources: true,
      lib: ['es2018'],
      module: 'CommonJS',
      noEmitOnError: false,
      noFallthroughCasesInSwitch: true,
      noImplicitAny: true,
      noImplicitReturns: true,
      noImplicitThis: true,
      noUnusedLocals: true,
      noUnusedParameters: true,
      resolveJsonModule: true,
      strict: true,
      strictNullChecks: true,
      strictPropertyInitialization: true,
      stripInternal: true,
      target: 'ES2018',
    };

    if (!options.disableTsconfig) {
      this.tsconfig = new TypescriptConfig(this, {
        include: [`${this.srcdir}/**/*.ts`],
        exclude: [
          'node_modules',
          this.libdir,
        ],
        compilerOptions: {
          rootDir: this.srcdir,
          outDir: this.libdir,
          ...compilerOptions,
        },
        ...options.tsconfig,
      });
    }

    this.gitignore.exclude(`/${this.libdir}`);
    this.npmignore?.include(`/${this.libdir}`);

    this.gitignore.include(`/${this.srcdir}`);
    this.npmignore?.exclude(`/${this.srcdir}`);

    this.npmignore?.include(`/${this.libdir}/**/*.js`);
    this.npmignore?.include(`/${this.libdir}/**/*.d.ts`);

    this.gitignore.exclude('/dist');
    this.npmignore?.exclude('dist'); // jsii-pacmak expects this to be "dist" and not "/dist". otherwise it will tamper with it

    this.npmignore?.exclude('/tsconfig.json');
    this.npmignore?.exclude('/.github');
    this.npmignore?.exclude('/.vscode');
    this.npmignore?.exclude('/.projenrc.js');

    // the tsconfig file to use for estlint (if jest is enabled, we use the jest one, otherwise we use the normal one).
    let eslintTsConfig = 'tsconfig.json';

    if (options.jest ?? true) {
      // create a tsconfig for jest that does NOT include outDir and rootDir and
      // includes both "src" and "test" as inputs.
      const tsconfig = new TypescriptConfig(this, {
        fileName: 'tsconfig.jest.json',
        include: [
          `${this.srcdir}/**/*.ts`,
          `${this.testdir}/**/*.ts`,
        ],
        exclude: [
          'node_modules',
        ],
        compilerOptions,
      });

      eslintTsConfig = tsconfig.fileName;

      // if we test before compilation, remove the lib/ directory before running
      // tests so that we get a clean slate for testing.
      if (!compileBeforeTest) {
        // make sure to delete "lib" *before* runninng tests to ensure that
        // test code does not take a dependency on "lib" and instead on "src".
        this.addTestCommand(`rm -fr ${this.libdir}/`);
      }

      this.jest = new Jest(this, {
        typescript: tsconfig,
        ...options.jestOptions,
      });

      this.gitignore.include(`/${this.testdir}`);
      this.npmignore?.exclude(`/${this.testdir}`);
    }

    if (options.eslint ?? true) {
      this.eslint = new Eslint(this, {
        tsconfigPath: `./${eslintTsConfig}`,
        dirs: [this.srcdir, this.testdir],
      });
    }

    this.addDevDependencies({
      'typescript': options.typescriptVersion ?? Semver.caret('3.9.5'),
      '@types/node': Semver.caret(this.minNodeVersion ?? '10.17.0'), // install the minimum version to ensure compatibility
    });

    // generate sample code in `src` and `lib` if these directories are empty or non-existent.
    if (options.sampleCode ?? true) {
      new SampleCode(this);
    }

    if (this.docgen) {
      new TypedocDocgen(this);
    }
  }

  /**
   * Adds commands to run as part of `yarn build`.
   * @param commands The commands to add
   */
  public addBuildCommand(...commands: string[]) {
    this.addScriptCommand('build', ...commands);
  }
}

export interface TypescriptConfigOptions {
  /**
   * @default "tsconfig.json"
   */
  readonly fileName?: string;
  /**
   * The directory in which typescript sources reside.
   * @default - all .ts files recursively
   */
  readonly include?: string[];

  /**
   * @default - node_modules is excluded by default
   */
  readonly exclude?: string[];

  /**
   * Compiler options to use.
   *
   * @default - see above
   */
  readonly compilerOptions: TypeScriptCompilerOptions;
}

/**
 * Determines how modules get resolved.
 *
 * @see https://www.typescriptlang.org/docs/handbook/module-resolution.html
 */
export enum TypeScriptModuleResolution {
  /**
   * TypeScript's former default resolution strategy.
   *
   * @see https://www.typescriptlang.org/docs/handbook/module-resolution.html#classic
   */
  CLASSIC = 'classic',

  /**
   * Resolution strategy which attempts to mimic the Node.js module resolution strategy at runtime.
   *
   * @see https://www.typescriptlang.org/docs/handbook/module-resolution.html#node
   */
  NODE = 'node'
}

/**
 * Determines how JSX should get transformed into valid JavaScript.
 *
 * @see https://www.typescriptlang.org/docs/handbook/jsx.html
 */
export enum TypeScriptJsxMode {
  /**
   * Keeps the JSX as part of the output to be further consumed by another transform step (e.g. Babel).
   */
  PRESERVE = 'preserve',

  /**
   * Converts JSX syntax into React.createElement, does not need to go through a JSX transformation before use, and the output will have a .js file extension.
   */
  REACT = 'react',

  /**
   * Keeps all JSX like 'preserve' mode, but output will have a .js extension.
   */
  REACT_NATIVE = 'react-native'
}

export interface TypeScriptCompilerOptions {
  /**
   * Allow JavaScript files to be compiled.
   *
   * @default false
   */
  readonly allowJs?: boolean;

  /**
   * Ensures that your files are parsed in the ECMAScript strict mode, and emit “use strict”
   * for each source file.
   *
   * @default true
   */
  readonly alwaysStrict?: boolean;

  /**
   * Offers a way to configure the root directory for where declaration files are emitted.
   *
   */
  readonly declarationDir?: string;

  /**
   * To be specified along with the above
   *
   */
  readonly declaration?: boolean;

  /**
   * Emit __importStar and __importDefault helpers for runtime babel
   * ecosystem compatibility and enable --allowSyntheticDefaultImports for
   * typesystem compatibility.
   *
   * @default false
   */
  readonly esModuleInterop?: boolean;

  /**
   * Enables experimental support for decorators, which is in stage 2 of the TC39 standardization process.
   *
   * @default true
   */
  readonly experimentalDecorators?: boolean;

  /**
   * Disallow inconsistently-cased references to the same file.
   *
   * @default false
   */
  readonly forceConsistentCasingInFileNames?: boolean;

  /**
   * When set, instead of writing out a .js.map file to provide source maps,
   * TypeScript will embed the source map content in the .js files.
   *
   * @default true
   */
  readonly inlineSourceMap?: boolean;

  /**
   * When set, TypeScript will include the original content of the .ts file as an embedded
   * string in the source map. This is often useful in the same cases as inlineSourceMap.
   *
   * @default true
   */
  readonly inlineSources?: boolean;

  /**
   * Perform additional checks to ensure that separate compilation (such as
   * with transpileModule or @babel/plugin-transform-typescript) would be safe.
   *
   * @default false
   */
  readonly isolatedModules?: boolean;

  /**
   * Support JSX in .tsx files: "react", "preserve", "react-native"
   *
   * @default undefined
   */
  readonly jsx?: TypeScriptJsxMode;

  /**
   * Reference for type definitions / libraries to use (eg. ES2016, ES5, ES2018).
   *
   * @default [ 'es2018' ]
   */
  readonly lib?: string[];

  /**
   * Sets the module system for the program.
   * See https://www.typescriptlang.org/docs/handbook/modules.html#ambient-modules.
   *
   * @default 'CommonJS'
   */
  readonly module?: string;

  /**
   * Determine how modules get resolved. Either "Node" for Node.js/io.js style resolution, or "Classic".
   *
   * @default 'node'
   */
  readonly moduleResolution?: TypeScriptModuleResolution;

  /**
   * Do not emit outputs.
   *
   * @default false
   */
  readonly noEmit?: boolean;

  /**
   * Do not emit compiler output files like JavaScript source code, source-maps or
   * declarations if any errors were reported.
   *
   * @default true
   */
  readonly noEmitOnError?: boolean;

  /**
   * Report errors for fallthrough cases in switch statements. Ensures that any non-empty
   * case inside a switch statement includes either break or return. This means you won’t
   * accidentally ship a case fallthrough bug.
   *
   * @default true
   */
  readonly noFallthroughCasesInSwitch?: boolean;

  /**
   * In some cases where no type annotations are present, TypeScript will fall back to a
   * type of any for a variable when it cannot infer the type.
   *
   * @default true
   */
  readonly noImplicitAny?: boolean;

  /**
   * When enabled, TypeScript will check all code paths in a function to ensure they
   * return a value.
   *
   * @default true
   */
  readonly noImplicitReturns?: boolean;
  /**
   * Raise error on ‘this’ expressions with an implied ‘any’ type.
   *
   * @default true
   */
  readonly noImplicitThis?: boolean;

  /**
   * Report errors on unused local variables.
   *
   * @default true
   */
  readonly noUnusedLocals?: boolean;

  /**
   * Report errors on unused parameters in functions.
   *
   * @default true
   */
  readonly noUnusedParameters?: boolean;

  /**
   * Allows importing modules with a ‘.json’ extension, which is a common practice
   * in node projects. This includes generating a type for the import based on the static JSON shape.
   *
   * @default true
   */
  readonly resolveJsonModule?: boolean;

  /**
   * Skip type checking of all declaration files (*.d.ts).
   *
   * @default false
   */
  readonly skipLibCheck?: boolean;

  /**
   * The strict flag enables a wide range of type checking behavior that results in stronger guarantees
   * of program correctness. Turning this on is equivalent to enabling all of the strict mode family
   * options, which are outlined below. You can then turn off individual strict mode family checks as
   * needed.
   *
   * @default true
   */
  readonly strict?: boolean;

  /**
   * When strictNullChecks is false, null and undefined are effectively ignored by the language.
   * This can lead to unexpected errors at runtime.
   * When strictNullChecks is true, null and undefined have their own distinct types and you’ll
   * get a type error if you try to use them where a concrete value is expected.
   *
   * @default true
   */
  readonly strictNullChecks?: boolean;

  /**
   * When set to true, TypeScript will raise an error when a class property was declared but
   * not set in the constructor.
   *
   * @default true
   */
  readonly strictPropertyInitialization?: boolean;

  /**
   * Do not emit declarations for code that has an @internal annotation in it’s JSDoc comment.
   *
   * @default true
   */
  readonly stripInternal?: boolean;

  /**
   * Modern browsers support all ES6 features, so ES6 is a good choice. You might choose to set
   * a lower target if your code is deployed to older environments, or a higher target if your
   * code is guaranteed to run in newer environments.
   *
   * @default 'ES2018'
   */
  readonly target?: string;

  /**
   * Output directory for the compiled files.
   */
  readonly outDir?: string;

  /**
   * Specifies the root directory of input files.
   *
   * Only use to control the output directory structure with `outDir`.
   */
  readonly rootDir?: string;
}

export class TypescriptConfig {
  public readonly compilerOptions: TypeScriptCompilerOptions;
  public readonly include: string[];
  public readonly exclude: string[];
  public readonly fileName: string;
  public readonly file: JsonFile;

  constructor(project: NodeProject, options: TypescriptConfigOptions) {
    const fileName = options.fileName ?? 'tsconfig.json';

    this.include = options.include ?? ['**/*.ts'];
    this.exclude = options.exclude ?? ['node_modules'];
    this.fileName = fileName;

    this.compilerOptions = options.compilerOptions;

    this.file = new JsonFile(project, fileName, {
      obj: {
        compilerOptions: this.compilerOptions,
        include: this.include,
        exclude: this.exclude,
      },
    });

    project.npmignore?.exclude(`/${fileName}`);
  }
}


class SampleCode extends Component {
  private readonly nodeProject: TypeScriptProject;

  constructor(project: TypeScriptProject) {
    super(project);

    this.nodeProject = project;
  }

  public synthesize(outdir: string) {
    const srcdir = path.join(outdir, this.nodeProject.srcdir);
    if (fs.pathExistsSync(srcdir) && fs.readdirSync(srcdir).filter(x => x.endsWith('.ts'))) {
      return;
    }

    const srcCode = [
      'export class Hello {',
      '  public sayHello() {',
      '    return \'hello, world!\'',
      '  }',
      '}',
    ];

    fs.mkdirpSync(srcdir);
    fs.writeFileSync(path.join(srcdir, 'index.ts'), srcCode.join('\n'));

    const testdir = path.join(outdir, this.nodeProject.testdir);
    if (fs.pathExistsSync(testdir) && fs.readdirSync(testdir).filter(x => x.endsWith('.ts'))) {
      return;
    }

    const testCode = [
      "import { Hello } from '../src'",
      '',
      "test('hello', () => {",
      "  expect(new Hello().sayHello()).toBe('hello, world!');",
      '});',
    ];

    fs.mkdirpSync(testdir);
    fs.writeFileSync(path.join(testdir, 'hello.test.ts'), testCode.join('\n'));
  }
}

/**
 * TypeScript app.
 *
 * @pjid typescript-app
 */
export class TypeScriptAppProject extends TypeScriptProject {
  constructor(options: TypeScriptProjectOptions) {
    super({
      allowLibraryDependencies: false,
      releaseWorkflow: false,
      entrypoint: '', // "main" is not needed in typescript apps
      package: false,
      ...options,
    });
  }
}

/**
 * @deprecated use `TypeScriptProject`
 */
export class TypeScriptLibraryProject extends TypeScriptProject { };

/**
 * @deprecated use TypeScriptProjectOptions
 */
export interface TypeScriptLibraryProjectOptions extends TypeScriptProjectOptions { }
