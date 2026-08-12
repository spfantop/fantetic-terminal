import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { compileScript, parse } from 'vue/compiler-sfc';

const SOURCE_EXTENSION_LIST = ['.ts', '.tsx', '.vue', '.js'];

const normalizeRoot = (root: string | URL): string => (
  resolve(root instanceof URL ? fileURLToPath(root) : root)
);

const collectSourceFileList = (root: string): string[] => {
  const fileList: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = join(directory, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (SOURCE_EXTENSION_LIST.includes(extname(target))) fileList.push(resolve(target));
    }
  };
  walk(root);
  return fileList.sort((left, right) => left.localeCompare(right));
};

const readScriptSource = (file: string): string => {
  const source = readFileSync(file, 'utf8');
  if (extname(file) !== '.vue') return source;

  const { descriptor, errors } = parse(source, { filename: file });
  if (errors.length > 0) {
    throw new Error(`Unable to parse ${file}: ${errors.map(String).join('; ')}`);
  }
  if (!descriptor.script && !descriptor.scriptSetup) return '';
  return compileScript(descriptor, {
    id: 'runtime-import-graph',
  }).content;
};

const emitRuntimeSource = (file: string): string => {
  const extension = extname(file);
  const fileName = extension === '.tsx'
    ? 'module.tsx'
    : extension === '.js'
      ? 'module.js'
      : 'module.ts';
  return ts.transpileModule(readScriptSource(file), {
    compilerOptions: {
      jsx: ts.JsxEmit.Preserve,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ESNext,
      verbatimModuleSyntax: false,
    },
    fileName,
  }).outputText;
};

const collectRuntimeImportSpecifierList = (source: string): string[] => {
  const sourceFile = ts.createSourceFile('module.ts', source, ts.ScriptTarget.Latest, true);
  const specifierSet = new Set<string>();
  const visit = (node: ts.Node) => {
    const importClause = ts.isImportDeclaration(node) ? node.importClause : undefined;
    const hasValueImport = !importClause?.isTypeOnly && (
      !importClause
      || Boolean(importClause.name)
      || !importClause.namedBindings
      || ts.isNamespaceImport(importClause.namedBindings)
      || importClause.namedBindings.elements.some(element => !element.isTypeOnly)
    );
    if (ts.isImportDeclaration(node) && hasValueImport) {
      if (ts.isStringLiteral(node.moduleSpecifier)) specifierSet.add(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node)
      && !node.isTypeOnly
      && (!node.exportClause
        || !ts.isNamedExports(node.exportClause)
        || node.exportClause.elements.some(element => !element.isTypeOnly))
    ) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        specifierSet.add(node.moduleSpecifier.text);
      }
    } else if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteral(node.arguments[0])
    ) {
      specifierSet.add(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...specifierSet];
};

const resolveRelativeModule = (caller: string, specifier: string, fileSet: Set<string>): string | undefined => {
  if (!specifier.startsWith('.')) return undefined;

  const base = resolve(dirname(caller), specifier);
  const candidateList = [
    base,
    ...SOURCE_EXTENSION_LIST.map(extension => `${base}${extension}`),
    ...SOURCE_EXTENSION_LIST.map(extension => join(base, `index${extension}`)),
  ];
  return candidateList.find(candidate => fileSet.has(resolve(candidate)));
};

export const collectRuntimeImportGraph = (root: string | URL): Map<string, string[]> => {
  const rootPath = normalizeRoot(root);
  const fileList = collectSourceFileList(rootPath);
  const fileSet = new Set(fileList);
  return new Map(fileList.map(file => [
    file,
    collectRuntimeImportSpecifierList(emitRuntimeSource(file))
      .map(specifier => resolveRelativeModule(file, specifier, fileSet))
      .filter((dependency): dependency is string => Boolean(dependency))
      .sort((left, right) => left.localeCompare(right)),
  ]));
};

export const listStronglyConnectedModules = (graph: Map<string, string[]>): string[][] => {
  let nextIndex = 0;
  const indexByModule = new Map<string, number>();
  const lowLinkByModule = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const groupList: string[][] = [];

  const visit = (module: string) => {
    indexByModule.set(module, nextIndex);
    lowLinkByModule.set(module, nextIndex);
    nextIndex += 1;
    stack.push(module);
    onStack.add(module);

    for (const dependency of graph.get(module) ?? []) {
      if (!indexByModule.has(dependency)) {
        visit(dependency);
        lowLinkByModule.set(module, Math.min(
          lowLinkByModule.get(module)!,
          lowLinkByModule.get(dependency)!,
        ));
      } else if (onStack.has(dependency)) {
        lowLinkByModule.set(module, Math.min(
          lowLinkByModule.get(module)!,
          indexByModule.get(dependency)!,
        ));
      }
    }

    if (lowLinkByModule.get(module) !== indexByModule.get(module)) return;
    const group: string[] = [];
    let current: string;
    do {
      current = stack.pop()!;
      onStack.delete(current);
      group.push(current);
    } while (current !== module);
    if (group.length > 1) groupList.push(group.sort((left, right) => left.localeCompare(right)));
  };

  for (const module of graph.keys()) {
    if (!indexByModule.has(module)) visit(module);
  }
  return groupList.sort((left, right) => right.length - left.length || left[0].localeCompare(right[0]));
};
